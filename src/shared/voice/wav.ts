/**
 * Microphone samples into a file a transcriber will accept.
 *
 * Asked for after Wispr Flow cut a user off mid-sentence: a mic, and whatever the
 * user is saying typed into the chat.
 *
 * The browser's own `SpeechRecognition` is the obvious way to do this and it does not work here.
 * **Measured in the running app**, not assumed:
 *
 * ```
 * ERROR:network | trace: start > audiostart > audioend
 * ```
 *
 * The microphone opens and Chromium then fails to reach the speech backend, because Electron
 * ships without the API key that service requires. So the audio has to be captured here and
 * transcribed by something local.
 *
 * ## Why this file exists rather than `MediaRecorder`
 *
 * `MediaRecorder` produces WebM/Opus, and every local transcriber wants 16 kHz mono PCM. Bridging
 * those means depending on ffmpeg, which is one more thing a person has to install before
 * speaking a sentence. Reading the samples out of the audio graph and writing the header by hand
 * is forty lines and depends on nothing.
 *
 * 16 kHz because that is what Whisper's front end resamples to anyway; sending it 48 kHz is three
 * times the bytes for a file it will immediately throw two thirds of away.
 */

/** What Whisper expects, and what everything else local expects too. */
export const TARGET_RATE = 16_000

/**
 * Resample to {@link TARGET_RATE} by linear interpolation.
 *
 * Not a windowed sinc, and deliberately. The signal is a person talking into a laptop
 * microphone, the destination is a speech model that resamples again internally, and the
 * artefacts linear interpolation introduces sit far above the band that carries speech. A better
 * resampler here would be measurable only in a test written to measure it.
 */
export function resample(samples: Float32Array, from: number, to: number = TARGET_RATE): Float32Array {
  if (from === to || samples.length === 0) return samples

  const ratio = from / to
  const out = new Float32Array(Math.max(1, Math.floor(samples.length / ratio)))

  for (let i = 0; i < out.length; i += 1) {
    const at = i * ratio
    const low = Math.floor(at)
    const high = Math.min(low + 1, samples.length - 1)
    const t = at - low
    out[i] = (samples[low] ?? 0) * (1 - t) + (samples[high] ?? 0) * t
  }

  return out
}

/**
 * A complete 16-bit PCM WAV file.
 *
 * Clamped before scaling, because a sample above 1.0 — which a hot microphone produces — wraps
 * to a large negative number in two's complement and arrives as a click loud enough to make a
 * transcriber hallucinate a word that was never said.
 */
export function encodeWav(samples: Float32Array, rate: number = TARGET_RATE): ArrayBuffer {
  const bytes = samples.length * 2
  const buffer = new ArrayBuffer(44 + bytes)
  const view = new DataView(buffer)

  const ascii = (at: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(at + i, text.charCodeAt(i))
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + bytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM header length
  view.setUint16(20, 1, true) // PCM, uncompressed
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true) // byte rate: one channel, two bytes a sample
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits a sample
  ascii(36, 'data')
  view.setUint32(40, bytes, true)

  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0))
    // Asymmetric on purpose: 16-bit PCM runs -32768..32767, so the two directions do not scale
    // by the same number and using one of them for both clips the loud half of every waveform.
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  }

  return buffer
}

/**
 * Is there anything in here worth sending?
 *
 * A person who taps the mic and changes their mind produces a second of room tone, and a
 * transcriber handed room tone does not return nothing — it returns its best guess at what the
 * room might have been saying, which arrives in the composer as a sentence nobody spoke. That is
 * the third standing order broken by a feature that is otherwise working perfectly.
 *
 * Peak rather than mean: speech is mostly silence between the parts that carry it, so an average
 * over a sentence sits close to an average over an empty room.
 */
export function hasSpeech(samples: Float32Array, floor = SPEECH_FLOOR): boolean {
  return peak(samples) > floor
}

/**
 * The floor, and why it moved.
 *
 * It was `0.012`, which was a guess, and the guess was wrong on the first machine that was not
 * mine. Measured there, three seconds of a live microphone that a person was talking into:
 *
 * ```
 * device: "Default - External Microphone (Built-in)"    peak: 0.00327
 * ```
 *
 * The system default was one of seven inputs on that laptop and not one anybody would have
 * chosen. `0.012` threw the recording away and the app said "nothing was said" — which was the
 * app reporting *its own reading* as though it were the world.
 *
 * `0.006` sits above a quiet room and below a quiet talker. The real fix is not this number
 * though: it is that the level is now visible while recording, and that a rejection quotes the
 * peak and names the device. A threshold you can see being crossed does not need to be perfect.
 */
export const SPEECH_FLOOR = 0.006

/** The loudest sample, unsigned. */
export function peak(samples: Float32Array): number {
  let loudest = 0
  for (const sample of samples) {
    const size = Math.abs(sample)
    if (size > loudest) loudest = size
  }
  return loudest
}

/** Seconds of audio, for the label on a recording that is still going. */
export function seconds(sampleCount: number, rate: number = TARGET_RATE): number {
  return rate === 0 ? 0 : sampleCount / rate
}
