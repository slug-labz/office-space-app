/**
 * Speaking into the office.
 *
 * Asked for after Wispr Flow cut a user off mid-sentence: a mic, and whatever the
 * user is saying typed into the chat.
 *
 * The browser's own `SpeechRecognition` is the obvious way and it does not work here. Measured in
 * the running app rather than assumed:
 *
 *     ERROR:network | trace: start > audiostart > audioend
 *
 * The microphone opens, and Chromium then cannot reach the speech backend because Electron ships
 * without the key it needs. So the audio is captured in the renderer and transcribed by a local
 * program, and these are the two halves of that: the file, and the program.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, chmod, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { encodeWav, hasSpeech, resample, seconds, TARGET_RATE } from '../src/shared/voice/wav.js'
import { clean, findWhisper, transcribe, WHISPER_NAMES } from '../src/main/voice/transcribe.js'
import { NetworkOff } from '../src/main/spotify/gate.js'
import { spawn } from 'node:child_process'

import { tempDir } from './temp-dir.js'

// ───────────────────────────────────────────────────────────────────── the file ──

const tone = (length: number, amplitude = 0.5): Float32Array =>
  Float32Array.from({ length }, (_, i) => Math.sin((i / 8) * Math.PI * 2) * amplitude)

test('the header describes the samples that follow it', () => {
  const wav = encodeWav(tone(1000))
  const view = new DataView(wav)
  const ascii = (at: number, n: number): string =>
    Array.from({ length: n }, (_, i) => String.fromCharCode(view.getUint8(at + i))).join('')

  assert.equal(ascii(0, 4), 'RIFF')
  assert.equal(ascii(8, 4), 'WAVE')
  assert.equal(view.getUint16(22, true), 1, 'mono')
  assert.equal(view.getUint32(24, true), TARGET_RATE)
  assert.equal(view.getUint16(34, true), 16, 'sixteen bits a sample')
  assert.equal(view.getUint32(40, true), 2000, 'two bytes for each of a thousand samples')
  assert.equal(wav.byteLength, 44 + 2000)
})

test('a hot microphone clips instead of wrapping', () => {
  // A sample above 1.0 scaled without clamping wraps through two's complement and arrives as a
  // click loud enough to make a transcriber hallucinate a word nobody said.
  const wav = new DataView(encodeWav(Float32Array.from([2, -2, 1, -1])))
  assert.equal(wav.getInt16(44, true), 32767)
  assert.equal(wav.getInt16(46, true), -32768)
  assert.equal(wav.getInt16(48, true), 32767)
  assert.equal(wav.getInt16(50, true), -32768)
})

test('the two directions scale by their own maximum', () => {
  // 16-bit PCM runs -32768..32767. Using one number for both clips the loud half of every wave.
  const wav = new DataView(encodeWav(Float32Array.from([-1])))
  assert.equal(wav.getInt16(44, true), -32768, 'not -32767')
})

test('resampling lands on the rate whisper wants, from whatever the machine gave us', () => {
  for (const rate of [48_000, 44_100, 16_000]) {
    const out = resample(tone(rate), rate)
    assert.ok(Math.abs(out.length - TARGET_RATE) <= 1, `a second at ${rate} is a second at 16k`)
  }
})

test('resampling at the target rate is not a copy operation', () => {
  const samples = tone(100)
  assert.equal(resample(samples, TARGET_RATE), samples, 'the common case does no work')
})

test('room tone is not speech', () => {
  // Somebody taps the mic and changes their mind. A transcriber handed room tone does not return
  // nothing — it returns its best guess at what the room might have said, which arrives in the
  // composer as a sentence nobody spoke.
  const room = Float32Array.from({ length: 16_000 }, () => (Math.sin(1) - 0.84) * 0.004)
  assert.equal(hasSpeech(room), false)
  assert.equal(hasSpeech(tone(16_000)), true)
})

test('a peak counts, because speech is mostly the silence between words', () => {
  const mostlySilent = new Float32Array(16_000)
  mostlySilent[9_000] = 0.6
  assert.equal(hasSpeech(mostlySilent), true, 'an average over a sentence looks like an empty room')
})

test('length is reported in seconds of audio, not in samples', () => {
  assert.equal(seconds(TARGET_RATE * 3), 3)
  assert.equal(seconds(0), 0)
})

// ────────────────────────────────────────────────────────────────── the program ──

/** A whisper that costs nothing: a real process, real argv, real exit codes. */
async function fakeWhisper(t: TestContext, script: string, name = 'whisper-cli'): Promise<string> {
  const dir = await tempDir(t, 'office-whisper-')
  const path = join(dir, name)
  await writeFile(path, `#!/bin/sh\n${script}\n`)
  await chmod(path, 0o755)
  return dir
}

test('the office looks in its own directory before it looks on PATH', async (t) => {
  const own = await fakeWhisper(t, 'echo mine')
  const elsewhere = await fakeWhisper(t, 'echo theirs')
  await writeFile(join(own, 'ggml-base.en.bin'), 'not really a model')

  const found = await findWhisper({ own, path: elsewhere })
  assert.equal(found.state, 'ready')
  assert.ok(found.state === 'ready' && found.whisper.binary.startsWith(own), 'its own copy wins')
})

test('every name the binary has shipped under is looked for', async (t) => {
  // `whisper-cli` is current, `whisper-cpp` is Homebrew's, and `main` is what it was called for
  // years — an older install leaves that behind and it still works.
  for (const name of WHISPER_NAMES) {
    const dir = await fakeWhisper(t, 'echo hi', name)
    await writeFile(join(dir, 'ggml-base.en.bin'), 'x')
    const found = await findWhisper({ own: dir, path: '' })
    assert.equal(found.state, 'ready', `did not find ${name}`)
  }
})

test('no program and no model are different problems, and it says which', async (t) => {
  const empty = await tempDir(t, 'office-whisper-')

  const noBinary = await findWhisper({ own: empty, path: '' })
  assert.equal(noBinary.state, 'incomplete')
  assert.equal(noBinary.state === 'incomplete' && noBinary.missing, 'binary')

  const dir = await fakeWhisper(t, 'echo hi')
  const noModel = await findWhisper({ own: dir, path: '' })
  assert.equal(noModel.state, 'incomplete')
  assert.equal(noModel.state === 'incomplete' && noModel.missing, 'model')
  // And the detail names the file it wanted, so the setup step has something to act on.
  assert.match(noModel.state === 'incomplete' ? noModel.detail : '', /ggml-base\.en\.bin/)
})

test('what whisper says about itself never reaches the composer', () => {
  // The CLI interleaves its own timing and system lines with the transcript, and brackets
  // non-speech with markers nobody said. Putting one of those in the composer as though it were
  // spoken is the third standing order broken by a feature that is otherwise working.
  const noisy = [
    'whisper_init_from_file_with_params_no_state: loading model',
    'whisper_model_load: n_vocab = 51864',
    '[BLANK_AUDIO]',
    ' Add a stop button to the composer.',
    '(silence)',
  ].join('\n')
  assert.equal(clean(noisy), 'Add a stop button to the composer.')
})

test('a real recording comes back as a sentence', async (t) => {
  const dir = await fakeWhisper(t, 'echo " Add a stop button to the composer."')
  const out = await transcribe({
    whisper: { binary: join(dir, 'whisper-cli'), model: join(dir, 'model.bin') },
    wav: new Uint8Array(encodeWav(tone(1600))),
  })
  assert.equal(out.ok, true)
  assert.equal(out.text, 'Add a stop button to the composer.')
})

test('the recording is deleted whether it worked or not', async (t) => {
  const before = (await readdir(tmpdir())).filter((n) => n.startsWith('office-dictation-')).length
  const dir = await fakeWhisper(t, 'exit 3')
  await transcribe({
    whisper: { binary: join(dir, 'whisper-cli'), model: join(dir, 'model.bin') },
    wav: new Uint8Array(encodeWav(tone(1600))),
  })
  const after = (await readdir(tmpdir())).filter((n) => n.startsWith('office-dictation-')).length
  assert.equal(after, before, 'a directory of every sentence somebody dictated is not a thing to keep')
})

test('a program that fails says why, in words, rather than failing silently', async (t) => {
  const dir = await fakeWhisper(t, 'echo "error: failed to open model file" >&2; exit 1')
  const out = await transcribe({
    whisper: { binary: join(dir, 'whisper-cli'), model: '/nowhere/model.bin' },
    wav: new Uint8Array(encodeWav(tone(1600))),
  })
  assert.equal(out.ok, false)
  assert.match(out.reason ?? '', /failed to open model file/)
})

test('a program that cannot be spawned is reported, not thrown', async () => {
  // The same shape as the digest bug found by running the app: a rejection nobody catches is a
  // feature that stops working with nothing anywhere saying so.
  const out = await transcribe({
    whisper: { binary: '/nonexistent/whisper-cli', model: '/nowhere/model.bin' },
    wav: new Uint8Array(encodeWav(tone(1600))),
  })
  assert.equal(out.ok, false)
  assert.match(out.reason ?? '', /Could not run/)
})

// ─────────────────────────────────────────────────────────────── the one download ──

test('a URL outside the declared egress list is refused before any request is made', async (t) => {
  // The privacy panel lists HOSTS as the complete set of places this app can reach. A declared
  // list nothing enforces is a comment, and the panel would be describing a promise rather than
  // the software.
  const { fetchModel } = await import('../src/main/voice/transcribe.js')
  const home = await tempDir(t, 'office-whisper-')
  const out = await fetchModel(home, globalThis.fetch, 'https://example.com/ggml-base.en.bin')
  assert.equal(out.ok, false)
  assert.match(out.reason ?? '', /example\.com is not in this app's declared egress list/)
})

test('the declared host is the one the model URL actually points at', async () => {
  const { HOSTS, MODEL_URL } = await import('../src/main/voice/transcribe.js')
  assert.ok(
    HOSTS.includes(new URL(MODEL_URL).hostname),
    'the panel lists HOSTS; a URL pointing somewhere else would make the panel wrong',
  )
})

// ────────────────────────────────────────────────────────────── setting it up ──

/**
 * A user pressed Speak and nothing happened.
 *
 * The button was working exactly as written: it refused before opening the microphone, because
 * nothing on the machine could transcribe — and it said so in the chat transcript, which is not
 * where somebody is looking a tenth of a second after pressing a button. From outside, the
 * microphone simply never opened, which is the correct reading of what that looked like.
 *
 * The fix is not a louder notice. It is that the app installs the thing, because **a desktop app
 * that answers a button press with "open a terminal and run this" has documented the feature
 * rather than shipped it.**
 */
test('brew is found by path, not by asking a shell', async () => {
  // An Electron app launched from Finder inherits a PATH that has never seen a login shell, so
  // /opt/homebrew/bin is simply absent. This is the shape of bug that works for whoever wrote it
  // and for nobody else.
  const { findBrew } = await import('../src/main/voice/transcribe.js')
  const found = await findBrew()
  if (found !== null) {
    assert.match(found, /^\/(opt\/homebrew|usr\/local)\/bin\/brew$/)
  }
})

test('installing runs the command the dialog named, and nothing else', async () => {
  const { installWhisper } = await import('../src/main/voice/transcribe.js')
  const seen: Array<{ cmd: string; args: readonly string[] }> = []

  const fake = ((cmd: string, args: readonly string[]) => {
    seen.push({ cmd, args })
    const listeners = new Map<string, (arg: unknown) => void>()
    return {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event: string, fn: (arg: unknown) => void) => {
        listeners.set(event, fn)
        if (event === 'close') setTimeout(() => fn(0), 0)
      },
    }
  }) as unknown as typeof import('node:child_process').spawn

  const out = await installWhisper(() => true, fake)
  // Skipped rather than asserted when there is no brew: the function refuses before spawning,
  // which is its own correct behaviour and is covered by the message below.
  if (seen.length > 0) {
    assert.equal(out.ok, true)
    assert.deepEqual(seen[0]?.args, ['install', 'whisper-cpp'])
    assert.match(seen[0]?.cmd ?? '', /brew$/)
  } else {
    assert.equal(out.ok, false)
    assert.match(out.reason ?? '', /Homebrew is not installed/)
  }
})

test('a failed install says what brew said, not that something went wrong', async () => {
  const { installWhisper, findBrew } = await import('../src/main/voice/transcribe.js')
  if ((await findBrew()) === null) return // nothing to spawn; covered above

  const fake = (() => ({
    stdout: { on: () => {} },
    stderr: {
      on: (_e: string, fn: (chunk: Buffer) => void) => fn(Buffer.from('Error: No available formula\n')),
    },
    on: (event: string, fn: (arg: unknown) => void) => {
      if (event === 'close') setTimeout(() => fn(1), 0)
    },
  })) as unknown as typeof import('node:child_process').spawn

  const out = await installWhisper(() => true, fake)
  assert.equal(out.ok, false)
  assert.match(out.reason ?? '', /No available formula/)
})

test('a redirect out of the declared list is refused, and nothing is fetched from it', async (t) => {
  /*
   * `HOSTS` was enforced against the URL and the fetch ran with `redirect: 'follow'`, so the
   * check validated the request and the connection went wherever it was sent. The model URL is
   * always sent elsewhere:
   *
   *     $ curl -sI https://huggingface.co/…/resolve/main/ggml-base.en.bin
   *     302  →  https://us.aws.cdn.hf.co/xet-bridge-us/…
   *
   * So the panel's "complete set of destinations" was wrong for anybody who had ever pressed the
   * microphone, and the older test could not see it: it asserts `HOSTS.includes(hostname of
   * MODEL_URL)`, one declaration checked against another. Both sides can be right while every
   * byte arrives from a third place.
   *
   * The policy is injected because the first version of *this* test was worse than that one. It
   * pointed `fetchModel` at a local redirector and asserted `ok === false` — which the **initial**
   * host check returns for free, since `127.0.0.1` is not `huggingface.co`. The hop loop was
   * never reached, both assertions passed, and the comment said the list was stubbed when nothing
   * stubbed it. A test that cannot tell its guard's refusal from a different refusal is not
   * testing the guard.
   */
  const { createServer } = await import('node:http')
  const { fetchModel } = await import('../src/main/voice/transcribe.js')

  let fetchedFromElsewhere = false
  const elsewhere = createServer((_req, res) => {
    fetchedFromElsewhere = true
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    res.end(Buffer.alloc(20_000_000))
  })
  await new Promise<void>((r) => elsewhere.listen(0, '127.0.0.1', r))
  const evilPort = (elsewhere.address() as { port: number }).port

  const redirector = createServer((_req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${evilPort}/model.bin` })
    res.end()
  })
  await new Promise<void>((r) => redirector.listen(0, '127.0.0.1', r))
  const startPort = (redirector.address() as { port: number }).port
  const from = `http://127.0.0.1:${startPort}/ggml-base.en.bin`

  try {
    const home = await tempDir(t, 'office-redirect-')
    // Starting host allowed, redirect target not — so the only thing that can refuse this is the
    // hop check, and a pass means the hop check ran.
    const out = await fetchModel(home, globalThis.fetch, from, {
      startsAt: (host) => host === '127.0.0.1',
      follows: () => false,
      startsInsecure: true,
      followsInsecure: true,
    })

    assert.equal(out.ok, false, 'the download followed a redirect out of the declared list')
    assert.match(
      out.ok ? '' : (out.reason ?? ''),
      /redirected to 127\.0\.0\.1/,
      'refused for some other reason than the hop — the guard may not have run at all',
    )
    assert.equal(fetchedFromElsewhere, false, 'a request was made to the host the redirect named')
    assert.deepEqual(await readdir(home), [], 'a refused hop left a file behind')
  } finally {
    elsewhere.close()
    redirector.close()
  }
})

test('a redirect inside the declared list is followed, so the model can actually be fetched', async (t) => {
  // The other direction, because a guard that refuses everything also passes the test above. The
  // real download is one hop to a CDN, and this is that shape: allowed start, allowed hop, bytes.
  const { createServer } = await import('node:http')
  const { fetchModel, MODEL_FILE } = await import('../src/main/voice/transcribe.js')

  const cdn = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    res.end(Buffer.alloc(20_000_000))
  })
  await new Promise<void>((r) => cdn.listen(0, '127.0.0.1', r))
  const cdnPort = (cdn.address() as { port: number }).port

  const origin = createServer((_req, res) => {
    // Relative, because a `Location` may be — and one resolved against the wrong base is how a
    // check like this gets walked past. `response.url` is populated under `redirect: 'manual'`
    // in this Node; checked rather than assumed.
    res.writeHead(302, { location: `http://127.0.0.1:${cdnPort}/xet-bridge-us/model` })
    res.end()
  })
  await new Promise<void>((r) => origin.listen(0, '127.0.0.1', r))
  const from = `http://127.0.0.1:${(origin.address() as { port: number }).port}/ggml-base.en.bin`

  try {
    // Twenty megabytes land in here, and every run used to leave them behind.
    const home = await tempDir(t, 'office-redirect-ok-')
    const out = await fetchModel(home, globalThis.fetch, from, { startsAt: () => true, follows: () => true, startsInsecure: true, followsInsecure: true })

    assert.equal(out.ok, true, out.ok ? '' : (out.reason ?? ''))
    assert.deepEqual(await readdir(home), [MODEL_FILE], 'the model is not where it should be')
  } finally {
    cdn.close()
    origin.close()
  }
})

test('a redirect loop ends, rather than being followed until something else gives up', async (t) => {
  // `MAX_REDIRECTS` had no test, and a cap nothing exercises is a number. A server that always
  // answers 302 with its own address is the shape this guards against — following it is not a
  // slow download, it is one that never finishes, on the path a person triggers by pressing the
  // microphone for the first time.
  //
  // The assertion is that this call *returns*. Without the cap the loop is unbounded and this
  // test is what hangs, which is the correct failure: it is the same hang the app would do.
  const { createServer } = await import('node:http')
  const { fetchModel } = await import('../src/main/voice/transcribe.js')

  let hops = 0
  const carousel = createServer((_req, res) => {
    hops++
    res.writeHead(302, { location: '/round-again' })
    res.end()
  })
  await new Promise<void>((r) => carousel.listen(0, '127.0.0.1', r))
  const from = `http://127.0.0.1:${(carousel.address() as { port: number }).port}/ggml-base.en.bin`

  try {
    const home = await tempDir(t, 'office-carousel-')
    const out = await fetchModel(home, globalThis.fetch, from, { startsAt: () => true, follows: () => true, startsInsecure: true, followsInsecure: true })

    assert.equal(out.ok, false, 'a redirect loop was followed to a result')
    assert.match(out.ok ? '' : (out.reason ?? ''), /redirected more than/, 'ended for some other reason than the cap')
    assert.ok(hops <= 8, `followed ${hops} hops — the cap is not holding`)
    assert.deepEqual(await readdir(home), [], 'a refused loop left a file behind')
  } finally {
    carousel.close()
  }
})

test('the first request is checked for scheme too, not only for host', async (t) => {
  // Hop 0 was host-checked and not scheme-checked, while every hop after it got both — so the
  // request the comment above `HOSTS` is actually about was the least checked thing in the
  // function. `spotify/client.ts` checks the scheme on its initial request, and two modules
  // disagreeing about their own rule is how one of them ends up wrong later.
  //
  // `MODEL_URL` is https, so nothing shipped was reachable through this; `url` is a parameter on
  // an exported function, which is the reason it is a guard rather than an assumption.
  const { fetchModel } = await import('../src/main/voice/transcribe.js')
  const home = await tempDir(t, 'office-first-hop-')

  const out = await fetchModel(home, globalThis.fetch, 'http://huggingface.co/model.bin', { startsAt: () => true, follows: () => true })

  assert.equal(out.ok, false, 'a plaintext initial request was made')
  assert.match(out.ok ? '' : (out.reason ?? ''), /not https/, 'refused for the host rather than the scheme')
  assert.deepEqual(await readdir(home), [], 'a refused request left a file behind')
})

test('a redirect down to plaintext is refused, even to a host that is declared', async (t) => {
  // The declared set is a set of *connections*, not of names. `us.aws.cdn.hf.co` over http is a
  // different thing from the same host over https, and the panel implies the second. The initial
  // request is https, so this needs a hostile first hop — but the claim this loop makes is that
  // what is declared is what is reached, and a plaintext hop is not what is declared.
  const { createServer } = await import('node:http')
  const { fetchModel } = await import('../src/main/voice/transcribe.js')

  let reached = false
  const plaintext = createServer((_req, res) => {
    reached = true
    res.writeHead(200); res.end(Buffer.alloc(20_000_000))
  })
  await new Promise<void>((r) => plaintext.listen(0, '127.0.0.1', r))
  const port = (plaintext.address() as { port: number }).port

  const origin = createServer((_req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${port}/model.bin` })
    res.end()
  })
  await new Promise<void>((r) => origin.listen(0, '127.0.0.1', r))
  const from = `http://127.0.0.1:${(origin.address() as { port: number }).port}/ggml-base.en.bin`

  try {
    const home = await tempDir(t, 'office-plaintext-')
    // The start is permitted and the hop is not — the exact case the two knobs exist for. A
    // test cannot supply a certificate, so both servers are `http:`; without `startsInsecure`
    // the *initial* check refuses this and the assertion below passes on the wrong refusal.
    const out = await fetchModel(home, globalThis.fetch, from, { startsAt: () => true, follows: () => true, startsInsecure: true })

    assert.equal(out.ok, false, 'a hop dropped to plaintext and was followed')
    assert.match(out.ok ? '' : (out.reason ?? ''), /plaintext/, 'refused for some other reason than the scheme')
    assert.equal(reached, false, 'the plaintext host was contacted')
  } finally {
    plaintext.close(); origin.close()
  }
})

test('a redirect to something that is not a web address at all is refused', async (t) => {
  // `file:` and `data:` have no hostname, so the host check refuses them by accident rather than
  // on purpose — and an accident is not a guarantee. Named explicitly so the refusal survives
  // somebody making the host rule more permissive.
  const { createServer } = await import('node:http')
  const { fetchModel } = await import('../src/main/voice/transcribe.js')

  const origin = createServer((_req, res) => {
    res.writeHead(302, { location: 'file:///etc/passwd' })
    res.end()
  })
  await new Promise<void>((r) => origin.listen(0, '127.0.0.1', r))
  const from = `http://127.0.0.1:${(origin.address() as { port: number }).port}/ggml-base.en.bin`

  try {
    const home = await tempDir(t, 'office-scheme-')
    const out = await fetchModel(home, globalThis.fetch, from, { startsAt: () => true, follows: () => true, startsInsecure: true, followsInsecure: true })
    assert.equal(out.ok, false, 'a file: redirect was followed')
    assert.match(out.ok ? '' : (out.reason ?? ''), /not a web address/)
  } finally {
    origin.close()
  }
})

test('the declared list covers the CDN the model is actually served from', async () => {
  // A suffix, because the host is regional and rotates. The leading dot is what makes it a
  // suffix rule and not a substring one.
  const { isDeclaredDownloadHost } = await import('../src/main/voice/transcribe.js')

  assert.equal(isDeclaredDownloadHost('huggingface.co'), true)
  assert.equal(isDeclaredDownloadHost('us.aws.cdn.hf.co'), true, 'the host every download is sent to')
  assert.equal(isDeclaredDownloadHost('cdn-lfs.huggingface.co'), true)

  assert.equal(isDeclaredDownloadHost('example.com'), false)
  assert.equal(isDeclaredDownloadHost('evil-hf.co'), false, 'a substring rule would have let this through')
  assert.equal(isDeclaredDownloadHost('huggingface.co.evil.com'), false, 'a prefix rule would have let this through')
})

/*
 * The switch, honoured by the two things that reach the network from here.
 *
 * `spotify/gate.ts` says the master switch "cannot be bypassed by writing new code — a new call
 * site inherits it by construction, because there is no other `fetch` in reach." That claim was
 * false of this module: `fetchModel` called the global `fetch`, so with the switch off, pressing
 * the microphone still opened a connection and pulled 148 MB.
 *
 * The switch's label promises the whole app, not the music panel it happens to live in —
 * "Office Space may make its own network requests. Click to stop it."
 */
test('the model download cannot reach the network while the switch is off', async (t) => {
  const { fetchModel, MODEL_URL } = await import('../src/main/voice/transcribe.js')
  const home = await tempDir(t, 'office-gated-')

  /*
   * The **first** URL, not a count of calls.
   *
   * A count was the first version of this and it did not pin the line that matters. `fetchModel`
   * calls `net` twice — once for the initial request and once per redirect hop — so putting only
   * the *first* call back on the global `fetch` left the redirect hop still calling the stub,
   * `asked` still 1, and both assertions still true. Measured: that single-line mutant passes 30
   * of 30 and typechecks on both configs.
   *
   * Worse than merely surviving. For the redirect hop to run at all, the first request must have
   * returned a 3xx — so the mutant reached huggingface.co for real, and the passing test *is* the
   * evidence that it did, since `asked` could not have become 1 by any other path.
   *
   * Recording the URL fixes it at the line that opens the connection: the first thing the gated
   * fetch is asked for must be the model URL itself. A bypass at the initial request either never
   * calls this stub, or calls it first with a redirect target, and both fail here.
   */
  const asked: string[] = []
  const refusing: typeof globalThis.fetch = (input) => {
    asked.push(String(input))
    return Promise.reject(new NetworkOff())
  }

  const out = await fetchModel(home, refusing)

  assert.equal(out.ok, false, 'the download reported success with the network off')
  assert.deepEqual(asked, [MODEL_URL], 'the first request did not go through the gated fetch')
  assert.deepEqual(await readdir(home), [], 'something was written despite the refusal')
})

test('installing whisper is refused while the switch is off, without spawning brew', async () => {
  const { installWhisper } = await import('../src/main/voice/transcribe.js')
  let spawned = 0
  const countingSpawn = ((...args: Parameters<typeof spawn>) => {
    spawned += 1
    return spawn(...args)
  }) as typeof spawn

  const out = await installWhisper(() => false, countingSpawn)

  assert.equal(out.ok, false, 'brew was allowed to run with the network off')
  assert.equal(spawned, 0, 'brew was spawned before the switch was consulted')
  assert.match(out.ok ? '' : (out.reason ?? ''), /network requests/, 'the refusal does not say why')
})
