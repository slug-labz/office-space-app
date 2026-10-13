/**
 * The office stereo — the only thing in this app that makes a sound.
 *
 * There are no audio files. Three oscillators through a low-pass filter, generated here, because
 * a folder of tracks needs IPC and a stream needs network egress out of a `default-src 'self'`
 * CSP — and either means shipping something that is not code. Nothing was aimed at it.
 *
 * The module states three rules and this checks all three, because each fails silently:
 *
 *   **Nothing starts without a click.** No context is constructed until `toggle()`. A browser
 *   will refuse one created outside a gesture anyway, so an app that builds it early gets a
 *   stereo that never works and no error saying why.
 *
 *   **It fades rather than cuts.** A gain that jumps is a click in the speaker. There is no
 *   assertion a listener could make here, and nothing on screen changes either way.
 *
 *   **It stops completely.** `stop()` closes the context — *"Closing is what makes 'off' mean
 *   off rather than silent."* A muted office holding an audio graph open sounds exactly like a
 *   muted office that is not.
 *
 * ## The fake
 *
 * A recording `AudioContext`: every node it hands out logs what was done to it. That is enough,
 * because all three rules are about *what was called and in what order*, not about sound. What
 * this cannot check is whether it is pleasant to listen to, and nothing in a test suite can.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installDom } from './dom.js'
import { Stereo } from '../src/renderer/music.js'

installDom()

interface Call {
  readonly on: string
  readonly method: string
  readonly args: readonly unknown[]
}

/** An `AudioParam` that remembers how it was driven. */
function param(on: string, log: Call[]): Record<string, unknown> {
  const record = (method: string) => (...args: unknown[]) => log.push({ on, method, args })
  return {
    value: 0,
    setValueAtTime: record('setValueAtTime'),
    linearRampToValueAtTime: record('linearRampToValueAtTime'),
    cancelScheduledValues: record('cancelScheduledValues'),
  }
}

interface Fake {
  readonly log: Call[]
  readonly built: string[]
  readonly closed: () => number
  readonly Ctor: new () => AudioContext
}

function fakeAudio(options: { throws?: boolean } = {}): Fake {
  const log: Call[] = []
  const built: string[] = []
  let closes = 0

  const node = (kind: string): Record<string, unknown> => {
    built.push(kind)
    return {
      type: '',
      gain: param(`${kind}.gain`, log),
      frequency: param(`${kind}.frequency`, log),
      Q: param(`${kind}.Q`, log),
      connect: (...args: unknown[]) => log.push({ on: kind, method: 'connect', args }),
      start: (...args: unknown[]) => log.push({ on: kind, method: 'start', args }),
      stop: (...args: unknown[]) => log.push({ on: kind, method: 'stop', args }),
    }
  }

  class FakeContext {
    currentTime = 0
    destination = { kind: 'destination' }
    constructor() {
      if (options.throws) throw new Error('no audio device')
    }
    createGain(): unknown {
      return node('gain')
    }
    createOscillator(): unknown {
      return node('oscillator')
    }
    createBiquadFilter(): unknown {
      return node('filter')
    }
    close(): Promise<void> {
      closes += 1
      return Promise.resolve()
    }
  }

  return { log, built, closed: () => closes, Ctor: FakeContext as unknown as new () => AudioContext }
}

/** Install a constructor for the duration of one test, and take it away afterwards. */
function withAudio<T>(fake: Fake | null, run: () => T): T {
  const w = globalThis as unknown as Record<string, unknown>
  const before = w['window'] as Record<string, unknown>
  const had = 'AudioContext' in before
  const previous = before['AudioContext']
  if (fake) before['AudioContext'] = fake.Ctor
  else delete before['AudioContext']
  try {
    return run()
  } finally {
    if (had) before['AudioContext'] = previous
    else delete before['AudioContext']
  }
}

test('nothing is built until somebody presses it', () => {
  const fake = fakeAudio()
  withAudio(fake, () => {
    const stereo = new Stereo()
    assert.equal(stereo.isPlaying, false)
    assert.deepEqual(fake.built, [], 'an audio graph was constructed before any gesture — a browser refuses one made outside a click, so this is a stereo that never comes on and never says why')

    assert.equal(stereo.toggle(), true, 'toggle() must report the state it just moved to')
    assert.ok(fake.built.length > 0, 'pressing it built nothing')
    assert.equal(stereo.isPlaying, true)
  })
})

test('the chord is three voices, each drifting at its own rate', () => {
  const fake = fakeAudio()
  withAudio(fake, () => {
    new Stereo().toggle()

    // Three voices and three LFOs. The drift is the whole reason it does not sound like a test
    // tone: three sines held still beat in a pattern the ear learns in about four seconds.
    const oscillators = fake.built.filter((k) => k === 'oscillator').length
    assert.equal(oscillators, 6, `expected three voices and three LFOs, got ${oscillators} oscillators`)

    const lfoRates = fake.log
      .filter((c) => c.on === 'oscillator.frequency' && c.method === 'setValueAtTime')
      .map((c) => c.args[0] as number)
      .filter((hz) => hz < 1)
    assert.equal(new Set(lfoRates).size, 3, `the three drifts must run at different rates, got ${JSON.stringify(lfoRates)}`)
  })
})

test('it fades in rather than starting at volume', () => {
  const fake = fakeAudio()
  withAudio(fake, () => {
    new Stereo().toggle()

    const master = fake.log.filter((c) => c.on === 'gain.gain')
    const first = master[0]
    assert.ok(first, 'the master gain was never driven at all')
    assert.equal(first.method, 'setValueAtTime', 'the first thing done to the master gain was not to pin it')
    assert.equal(first.args[0], 0, `it starts at ${String(first.args[0])} rather than silence, which is a click in the speaker`)

    const ramp = master.find((c) => c.method === 'linearRampToValueAtTime')
    assert.ok(ramp, 'the gain never ramps — it jumps to volume, which is the app being startling')
    assert.ok((ramp.args[0] as number) > 0, 'the ramp goes to silence rather than to volume')
    assert.ok((ramp.args[1] as number) > 0, 'the ramp has no duration, so it is a jump wearing a ramp\'s name')
  })
})

test('stopping fades to silence and then closes the context', async () => {
  const fake = fakeAudio()
  await withAudio(fake, async () => {
    const stereo = new Stereo()
    stereo.toggle()
    const before = fake.log.length

    assert.equal(stereo.toggle(), false, 'toggle() must report that it is now off')
    assert.equal(stereo.isPlaying, false, 'it still reports itself as playing after being stopped')

    const after = fake.log.slice(before).filter((c) => c.on === 'gain.gain')
    assert.ok(
      after.some((c) => c.method === 'cancelScheduledValues'),
      'the fade-in was left scheduled, so it fights the fade-out',
    )
    const out = after.find((c) => c.method === 'linearRampToValueAtTime')
    assert.ok(out, 'it cut rather than faded')
    assert.equal(out.args[0], 0, 'the fade-out does not go to silence')

    // And the context is closed, not merely silenced. This is the one with a cost: a muted
    // office holding an audio graph open sounds identical to one that is not.
    assert.equal(fake.closed(), 0, 'it closed before the fade had a chance to run')
    await new Promise((resolve) => setTimeout(resolve, 1.4 * 1000 + 300))
    assert.equal(
      fake.closed(),
      1,
      'the context was never closed. "Off" then means silent, and the app holds an audio graph ' +
        'open for as long as it runs.',
    )
  })
})

test('a machine with no audio is a stereo that does not come on, not an error', () => {
  withAudio(null, () => {
    const stereo = new Stereo()
    assert.equal(stereo.toggle(), false, 'it claimed to start with no AudioContext to start with')
    assert.equal(stereo.isPlaying, false)
  })
})

test('a browser that refuses is the same answer, not a thrown one', () => {
  const fake = fakeAudio({ throws: true })
  withAudio(fake, () => {
    const stereo = new Stereo()
    assert.doesNotThrow(() => stereo.toggle(), 'a refused audio context reached the caller as an exception')
    assert.equal(stereo.isPlaying, false)
  })
})
