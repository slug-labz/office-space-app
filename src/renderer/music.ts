/**
 * The office stereo.
 *
 * The brief: a section of the floor you can click to play music, and an office whose vibe
 * changes while it is playing.
 *
 * **There are no audio files.** The sound is generated here, by three oscillators through a
 * low-pass filter, and that is a decision rather than a shortcut. A folder of tracks needs a
 * folder to read, which needs IPC, which crosses a boundary; a stream needs network egress out
 * of a `default-src 'self'` CSP; and either one means the office ships with something in it
 * that is not code. A drone made of three sine waves ships as forty lines and sounds like the
 * room it is in.
 *
 * It is also the only thing in this app that makes a sound, so the rules are strict:
 *
 *   **Nothing starts without a click.** The context is created on the first toggle, inside the
 *   gesture, which is also the only way a browser will let it start.
 *   **It fades rather than cuts.** A gain that jumps produces a click in the speaker, and a
 *   click in the speaker is the app being startling.
 *   **It stops completely.** `stop()` closes the context, so a muted office is not an office
 *   quietly holding an audio graph open.
 */

/** The chord. A minor ninth spread over two octaves — open enough not to resolve, so it loops. */
const VOICES = [110, 164.81, 246.94] as const

/** Loud enough to be present in a quiet room, quiet enough to talk over. */
const GAIN = 0.045

/** Seconds. Long enough that neither end of the fade is audible as an event. */
const FADE = 1.4

/**
 * How far each voice drifts, in Hz, and how long it takes.
 *
 * The drift is the whole of why this does not sound like a test tone: three sines held exactly
 * still beat against each other in a fixed pattern the ear learns in about four seconds. Detuned
 * slowly and by different amounts, they never quite repeat.
 */
const DRIFT_HZ = 0.7
const DRIFT_S = [17, 23, 31] as const

export class Stereo {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null

  get isPlaying(): boolean {
    return this.ctx !== null
  }

  /** Returns what the state now is, so the caller does not have to ask twice. */
  toggle(): boolean {
    if (this.ctx) {
      this.stop()
      return false
    }
    return this.start()
  }

  private start(): boolean {
    // An office with no audio device, or a browser that refuses, is not an error worth showing
    // anybody — it is a stereo that does not come on.
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return false

    try {
      const ctx = new Ctor()
      const master = ctx.createGain()
      master.gain.setValueAtTime(0, ctx.currentTime)
      master.gain.linearRampToValueAtTime(GAIN, ctx.currentTime + FADE)

      // The lid on the whole thing. Sines have no harmonics to remove, but the filter is what
      // keeps the drift from ever becoming bright as the voices cross.
      const lid = ctx.createBiquadFilter()
      lid.type = 'lowpass'
      lid.frequency.setValueAtTime(720, ctx.currentTime)
      lid.Q.setValueAtTime(0.6, ctx.currentTime)

      master.connect(lid)
      lid.connect(ctx.destination)

      VOICES.forEach((hz, i) => {
        const osc = ctx.createOscillator()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(hz, ctx.currentTime)

        // A slow LFO on the frequency. Each voice drifts at its own rate, so the three of them
        // do not come back into phase on any interval anybody is going to sit through.
        const lfo = ctx.createOscillator()
        lfo.type = 'sine'
        lfo.frequency.setValueAtTime(1 / (DRIFT_S[i] ?? 19), ctx.currentTime)
        const depth = ctx.createGain()
        depth.gain.setValueAtTime(DRIFT_HZ, ctx.currentTime)
        lfo.connect(depth)
        depth.connect(osc.frequency)

        const voice = ctx.createGain()
        // The upper voices quieter than the root, or the chord reads as three tones rather
        // than one sound.
        voice.gain.setValueAtTime(1 / (i + 1.4), ctx.currentTime)
        osc.connect(voice)
        voice.connect(master)

        osc.start()
        lfo.start()
      })

      this.ctx = ctx
      this.master = master
      return true
    } catch {
      return false
    }
  }

  /** Fade out, then close. Closing is what makes "off" mean off rather than silent. */
  stop(): void {
    const ctx = this.ctx
    const master = this.master
    this.ctx = null
    this.master = null
    if (!ctx || !master) return

    master.gain.cancelScheduledValues(ctx.currentTime)
    master.gain.setValueAtTime(master.gain.value, ctx.currentTime)
    master.gain.linearRampToValueAtTime(0, ctx.currentTime + FADE)
    window.setTimeout(() => void ctx.close().catch(() => {}), FADE * 1000 + 120)
  }
}
