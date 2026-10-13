import { test } from 'node:test'
import assert from 'node:assert/strict'

import { SpeechDirector, type Speaker } from '../src/shared/voice/speech.js'
import { notable, MomentRecorder, DIGEST_PROMPT, type Moment, type Spoken } from '../src/main/voice/digest.js'
import { quietNote } from '../src/shared/activity.js'
import { digest } from '../src/main/voice/digest.js'
import { assistantText, fakeClaude, init, result } from './fake-claude.js'

/** A speaker that records instead of making noise, and only "finishes" when told to. */
class FakeSpeaker implements Speaker {
  said: string[] = []
  cancelled = 0
  speaking = false

  speak(text: string) {
    this.said.push(text)
    this.speaking = true
  }
  cancel() {
    this.cancelled++
    this.speaking = false
  }
  /** Simulate the utterance ending naturally. */
  end(director: SpeechDirector) {
    this.speaking = false
    director.finished()
  }
}

const setup = () => {
  const speaker = new FakeSpeaker()
  return { speaker, director: new SpeechDirector(speaker) }
}

const routine = (text: string) => ({ text, urgency: 'routine' as const })

// ────────────────────────────────────────────────── never talk over the user ──

test('THE BUG: the office does not speak while the microphone is open', () => {
  // Dictation opens the mic, and a mic hears the speakers. Anything said here lands in the
  // user's transcript and gets sent to the manager as though they had said it.
  const { speaker, director } = setup()
  director.setListening(true)
  assert.equal(director.offer(routine('the reviewer finished')), false)
  assert.deepEqual(speaker.said, [])
})

test('what it held back is said once the mic closes', () => {
  const { speaker, director } = setup()
  director.setListening(true)
  director.offer(routine('the reviewer finished'))
  director.setListening(false)
  assert.deepEqual(speaker.said, ['the reviewer finished'])
})

test('opening the mic cuts off a sentence already in progress', () => {
  // Letting it finish would put half a sentence in the transcript, which is no better.
  const { speaker, director } = setup()
  director.offer(routine('the reviewer has finished reviewing the auth change and'))
  assert.equal(speaker.speaking, true)

  director.setListening(true)
  assert.equal(speaker.cancelled, 1)
  assert.equal(director.state.saying, null)
})

test('an interrupted sentence is dropped, not re-read from the top', () => {
  const { speaker, director } = setup()
  director.offer(routine('half-heard already'))
  director.setListening(true)
  director.setListening(false)
  assert.deepEqual(speaker.said, ['half-heard already'], 'should not have been said twice')
})

// ────────────────────────────────────────────────────── stale news is not news ──

test('a newer digest replaces an older one still waiting', () => {
  // Speech is slow. Reading a backlog aloud tells you where things stood, not where they are.
  const { speaker, director } = setup()
  director.offer(routine('one'))
  director.offer(routine('two'))
  director.offer(routine('three'))
  assert.deepEqual(speaker.said, ['one'])

  speaker.end(director)
  assert.deepEqual(speaker.said, ['one', 'three'], 'two was superseded before it was ever said')
  assert.equal(director.state.pending, null)
})

test('urgent news interrupts; routine news waits its turn', () => {
  const { speaker, director } = setup()
  director.offer(routine('the builder is still going'))
  director.offer({ text: 'the deploy failed', urgency: 'urgent' })
  assert.deepEqual(speaker.said, ['the builder is still going', 'the deploy failed'])
})

test('nothing is queued behind a mute', () => {
  const { speaker, director } = setup()
  director.setMuted(true)
  assert.equal(director.offer(routine('anything')), false)
  director.setMuted(false)
  assert.deepEqual(speaker.said, [], 'unmuting must not release a backlog')
})

test('muting stops what is being said', () => {
  const { speaker, director } = setup()
  director.offer(routine('mid-sentence'))
  director.setMuted(true)
  assert.equal(speaker.cancelled, 1)
})

// ───────────────────────────────────────────────────────────── the local gate ──

test('ordinary tool calls never reach the model', () => {
  // The gate is free and instant. On a normal session it answers every time, which is what
  // makes silence cost nothing.
  const acted: Moment[] = [
    { kind: 'acted', who: 'builder', detail: 'Read' },
    { kind: 'acted', who: 'builder', detail: 'Edit' },
    { kind: 'acted', who: 'builder', detail: 'Bash' },
  ]
  assert.deepEqual(notable(acted), [])
})

test('a failure always survives the gate', () => {
  const moments: Moment[] = [
    { kind: 'acted', who: 'builder', detail: 'Bash' },
    { kind: 'failed', who: 'builder', detail: 'the test suite is red' },
  ]
  assert.deepEqual(notable(moments), [moments[1]])
})

test('the digest is told, in as many words, that saying nothing is allowed', () => {
  // Without this the model finds something to say every time, and the office becomes a radio.
  assert.match(DIGEST_PROMPT, /reply with exactly: SILENCE/)
  assert.match(DIGEST_PROMPT, /do not say that it finished/)
})

// ────────────────────────────────────────────────────── what counts as a moment ──

test("a subagent's result is news; a file coming back is not", () => {
  const r = new MomentRecorder('manager')
  r.observe({
    kind: 'assistant',
    model: null,
    parentToolUseId: null,
    blocks: [
      { type: 'tool_use', id: 'toolu_a', name: 'Task', input: { subagent_type: 'reviewer', description: 'review auth' } },
      { type: 'tool_use', id: 'toolu_b', name: 'Read', input: {} },
    ],
  })

  const results = r.observe({
    kind: 'user',
    blocks: [
      { type: 'tool_result', tool_use_id: 'toolu_b', content: 'file contents…' },
      { type: 'tool_result', tool_use_id: 'toolu_a', content: 'Found two problems with the token refresh.' },
    ],
  })

  assert.deepEqual(results, [
    { kind: 'finished', who: 'reviewer', detail: 'Found two problems with the token refresh.' },
  ])
})

test('a finished run reports that you are the blocker', () => {
  const r = new MomentRecorder('manager')
  const moments = r.observe({
    kind: 'result',
    denials: [],
    isError: false,
    text: 'done',
    costUsd: 0.1,
    turns: 3,
    durationMs: 900,
  })
  assert.equal(moments[0]?.kind, 'awaiting-you')
})

test('a failed run is urgent news, carrying the actual reason', () => {
  const r = new MomentRecorder('manager')
  const moments = r.observe({
    kind: 'result',
    denials: [],
    isError: true,
    text: 'Failed to authenticate. API Error: 401 OAuth access token has expired.',
    costUsd: 0,
    turns: 1,
    durationMs: 120,
  })
  assert.equal(moments[0]?.kind, 'failed')
  assert.match(moments[0]?.detail ?? '', /401/)
})

test('a long result is trimmed to something speakable', () => {
  const r = new MomentRecorder('manager')
  r.observe({
    kind: 'assistant',
    model: null,
    parentToolUseId: null,
    blocks: [{ type: 'tool_use', id: 't', name: 'Task', input: { subagent_type: 'tester' } }],
  })
  const moments = r.observe({
    kind: 'user',
    blocks: [{ type: 'tool_result', tool_use_id: 't', content: `${'x'.repeat(5000)}\nsecond line` }],
  })
  assert.ok((moments[0]?.detail.length ?? 0) <= 201, 'nobody wants five thousand characters read aloud')
})

// ─────────────────────────────────────────────────── saying that it said nothing ──

/**
 * A feature designed to say nothing has to be able to say that it said nothing.
 *
 * This was on the plan and did not get built with the rest of it. Before it, three different
 * things produced the identical experience — no sound: the gate finding nothing notable, the
 * digest reading the turn and judging it not worth an interruption, and the digest run dying.
 * The first is the app working. The last is the app broken. From outside they were the same
 * silence, which is the third standing order failing by omission rather than by claim.
 */
test('a silence that was decided is a note; a silence that was a fault is a failure', () => {
  const decided = quietNote('judged', 'payments', '2026-08-21T10:00:00.000Z')
  assert.equal(decided.kind, 'note')
  assert.match(decided.text, /nothing worth reading aloud/i)

  const broke = quietNote('failed', 'payments', '2026-08-21T10:00:00.000Z')
  assert.equal(broke.kind, 'failed', 'a digest that could not run is a fault, and reads as one')
  assert.match(broke.text, /could not/i)
})

test('neither note apologises for the feature doing its job', () => {
  // The digest's whole product is restraint. A line that reads as an apology — "sorry", "failed
  // to find anything", "unable" — teaches somebody to switch off the thing protecting them from
  // a narrating office.
  const decided = quietNote('judged', 'payments', '2026-08-21T10:00:00.000Z')
  assert.doesNotMatch(decided.text, /sorry|unable|fail|error|couldn't|could not/i)
  // And neither says "voice", which is the toggle's old name and no longer on screen anywhere.
  for (const q of ['judged', 'failed'] as const) {
    assert.doesNotMatch(quietNote(q, 'payments', 'now').text, /\bvoice\b/i)
  }
})

test('a decided silence and a broken one are told apart, and the gate stays quiet about itself', () => {
  // The gate answers on nearly every turn — a line each time would bury the strip in the app
  // working correctly, so `quiet` is deliberately absent there and the renderer sends nothing.
  const gate: Spoken = { speak: false, text: '', costUsd: null, free: true }
  assert.equal(gate.quiet, undefined, 'the common silence is not news')
})

/**
 * The three answers, end to end against a real process.
 *
 * `digest` is the piece with the actual logic, and the fake binary makes it testable without
 * spending: a real child process, real stdout, real exit codes — only the program on the other
 * end is a stand-in. What is being pinned here is that the two silences arrive *distinguishable*,
 * because that is precisely what they were not before.
 */
test('SILENCE from the model is a judgement; a dead run is a fault; speech is neither', async (t) => {
  const moments: Moment[] = [{ kind: 'finished', who: 'tester', detail: 'the suite is green' }]

  const quiet = await fakeClaude(t, { lines: [init('d1'), assistantText('SILENCE'), result(false)] })
  const judged = await digest({ moments, cwd: quiet.dir, claudePath: quiet.path })
  assert.equal(judged.speak, false)
  assert.equal(judged.text, '', 'the sentinel is never read aloud as a word')
  assert.equal(judged.quiet, 'judged')

  const dead = await fakeClaude(t, { lines: [init('d2'), result(true)] })
  const broke = await digest({ moments, cwd: dead.dir, claudePath: dead.path })
  assert.equal(broke.speak, false)
  assert.equal(broke.quiet, 'failed', 'a silence caused by a dead run must not read as good judgement')

  const loud = await fakeClaude(t, { lines: [init('d3'), assistantText('The tester is green.'), result(false)] })
  const spoke = await digest({ moments, cwd: loud.dir, claudePath: loud.path })
  assert.equal(spoke.speak, true)
  assert.equal(spoke.text, 'The tester is green.')
  assert.equal(spoke.quiet, undefined, 'speech has no silence to explain')
})

test('the local gate stays silent about its own silence, and spends nothing to do it', async () => {
  // Every turn of ordinary work lands here. A note each time would bury the strip in the app
  // working correctly, and asking a model whether an edit is interesting would be absurd.
  const gate = await digest({ moments: [{ kind: 'acted', who: 'builder', detail: 'read a file' }], cwd: '.' })
  assert.equal(gate.speak, false)
  assert.equal(gate.free, true, 'nothing was spent')
  assert.equal(gate.quiet, undefined, 'and nothing is said about it')
})

/**
 * The silence that was permanent and invisible.
 *
 * Found by running the app rather than by testing it — the seventh time in three days, and the
 * one that most deserved to be found that way, because the feature under test *is* silence.
 *
 * `runClaude` rejects when the process cannot be spawned at all: a path that is not there, a
 * binary that dies before it says anything. That rejection travelled up into `void listen(...)`
 * in main, where nothing caught it. The office stopped having a voice, permanently, and nothing
 * anywhere said so — the exact failure this file had just been extended to name, in its worst
 * form, sitting one layer below the fix.
 */
test('a claude that cannot be spawned is a reported fault, not a thrown one', async () => {
  const out = await digest({
    moments: [{ kind: 'finished', who: 'tester', detail: 'the suite is green' }],
    cwd: '.',
    claudePath: '/nonexistent/office-space-has-no-claude-here',
  })
  assert.equal(out.speak, false)
  assert.equal(out.quiet, 'failed', 'a voice that cannot start must say it could not start')
  assert.equal(out.costUsd, null, 'nothing ran, so nothing was spent')
})
