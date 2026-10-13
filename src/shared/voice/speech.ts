/**
 * Speaking, and the rather more important business of shutting up.
 *
 * Text-to-speech itself is a solved problem the operating system already ships — see
 * {@link systemSpeaker}. What is not solved, and what this file is, is *when*. A voice that
 * talks at the wrong moment is worse than no voice, and there are exactly three ways to get
 * the moment wrong.
 *
 *   **Talking over you.** This is the one that would quietly ruin the whole feature. Dictation
 *   works by opening the microphone, and a microphone hears the speakers. If the office says
 *   "the reviewer finished" while you are mid-sentence, those words land in your transcript and
 *   go to the manager as though you had said them. So: while the mic is open, the office is
 *   silent, and anything queued waits its turn.
 *
 *   **Reading out stale news.** Speech is slow. Three digests can queue up during one
 *   utterance, and by the time the third is read aloud the first is history. A newer digest
 *   therefore replaces an older one still waiting, rather than joining a backlog — you hear
 *   where things stand now, never a recital of where they stood.
 *
 *   **Refusing to be stopped.** Anything being said can be cut off mid-word. That is what
 *   {@link SpeechDirector.hush} is for, and it is wired to the mic opening.
 *
 * The policy is a plain state machine with no browser in it, so all of the above is testable.
 * {@link Speaker} is the seam where the actual noise happens.
 */

/** Whatever actually makes sound. Implemented by the OS; stubbed in tests. */
export interface Speaker {
  speak(text: string): void
  cancel(): void
  readonly speaking: boolean
}

export type Urgency = 'routine' | 'urgent'

export interface Utterance {
  readonly text: string
  readonly urgency: Urgency
}

export interface DirectorState {
  /** What is being said right now, if anything. */
  readonly saying: string | null
  /** What is waiting. At most one — see the note on stale news. */
  readonly pending: Utterance | null
  readonly muted: boolean
  readonly listening: boolean
}

export class SpeechDirector {
  private pending: Utterance | null = null
  private saying: string | null = null
  private listening = false
  private muted = false

  constructor(private readonly speaker: Speaker) {}

  get state(): DirectorState {
    return {
      saying: this.saying,
      pending: this.pending,
      muted: this.muted,
      listening: this.listening,
    }
  }

  /** Turn the voice off entirely. Text always remains; speech is the optional half. */
  setMuted(muted: boolean): void {
    this.muted = muted
    if (muted) this.hush()
  }

  /**
   * You have the floor, or you have given it back.
   *
   * Driven by **focus on the chat composer**, not by microphone detection — and that is the
   * design, not a compromise. System-wide dictation tools type into whichever field is
   * focused, so a focused composer is the one signal that reliably covers both talking and
   * typing, without the app having to guess at the state of a microphone it does not own.
   *
   * It also means one gesture does everything: click into the composer and the office falls
   * quiet while the manager walks over to listen.
   *
   * Taking the floor stops speech immediately rather than letting the sentence finish — half a
   * sentence in your transcript is no better than a whole one.
   */
  setListening(listening: boolean): void {
    this.listening = listening
    if (listening) {
      this.hush()
      return
    }
    this.drain()
  }

  /**
   * Offer something to say.
   *
   * Returns true if it was spoken immediately. Anything else was either dropped (muted) or is
   * now the single pending utterance, replacing whatever was waiting before.
   */
  offer(utterance: Utterance): boolean {
    if (this.muted) return false

    if (this.listening) {
      this.pending = utterance
      return false
    }

    // Urgent news does not wait behind a leisurely one. A failure that needs you is exactly
    // the case where interrupting is the courteous thing to do.
    if (this.speaker.speaking && utterance.urgency !== 'urgent') {
      this.pending = utterance
      return false
    }

    this.say(utterance)
    return true
  }

  /** Stop mid-word. What was being said is dropped, not queued — it is already half-heard. */
  hush(): void {
    this.speaker.cancel()
    this.saying = null
  }

  /** Call when the speaker finishes an utterance. */
  finished(): void {
    this.saying = null
    this.drain()
  }

  private drain(): void {
    if (this.muted || this.listening || this.pending === null) return
    if (this.speaker.speaking) return
    const next = this.pending
    this.pending = null
    this.say(next)
  }

  private say(utterance: Utterance): void {
    this.pending = null
    this.saying = utterance.text
    this.speaker.speak(utterance.text)
  }
}

/**
 * The slice of the Web Speech API this actually uses.
 *
 * Declared here rather than pulling `lib.dom` into the whole project: this is the only
 * renderer-only file, and adding DOM globally would let main-process code reference `document`
 * and still typecheck — a mistake that would not show up until runtime.
 */
interface WebUtterance {
  onend: (() => void) | null
  onerror: (() => void) | null
}
interface WebSpeechSynthesis {
  readonly speaking: boolean
  speak(utterance: WebUtterance): void
  cancel(): void
}

/**
 * The operating system's own voice.
 *
 * macOS and Windows both ship speech synthesis, it is offline, it is free, and it needs no
 * account and no key — which is the whole reason to prefer it. A hosted voice would sound
 * better and would mean every user of a clone-and-run app needs a billing relationship with a
 * third party before the office can talk. That trade is not worth making for a feature whose
 * job is to read two sentences.
 *
 * Returns `null` where there is no synthesiser, so the caller can disable the toggle honestly
 * instead of offering a button that does nothing.
 */
export function systemSpeaker(onEnd: () => void): Speaker | null {
  const global = globalThis as unknown as {
    speechSynthesis?: WebSpeechSynthesis
    SpeechSynthesisUtterance?: new (text: string) => WebUtterance
  }
  const synth = global.speechSynthesis
  const Utter = global.SpeechSynthesisUtterance
  if (!synth || !Utter) return null

  return {
    speak(text: string) {
      const utterance = new Utter(text)
      utterance.onend = onEnd
      // A voice that stops silently on error would leave the director thinking it is still
      // talking, and nothing would ever be said again.
      utterance.onerror = onEnd
      synth.speak(utterance)
    },
    cancel() {
      synth.cancel()
    },
    get speaking() {
      return synth.speaking
    },
  }
}
