/**
 * Say a standing condition when it changes, not every time it is noticed.
 *
 * `loadCommands` runs at boot **and** on every workspace rescan — `.claude/` is watched, so a
 * rescan is also the signal that somebody has just written a command, which is the point. It
 * then said every problem it found, every time.
 *
 * Measured with `.claude/commands/` unreadable: three notices at boot, and **three more from
 * three file touches**. An unreadable directory is a condition that is true until somebody fixes
 * it, and reporting it as a fresh event on every scan fills the transcript with one fact — the
 * same failure the mishap repeat-gate exists to prevent, arriving somewhere else.
 *
 * ## Why changed rather than once
 *
 * Once would be wrong in the other direction. A directory that becomes unreadable, is fixed, and
 * breaks again has failed twice, and the second time is news. What is not news is the same
 * condition observed a fourth time in ninety seconds.
 *
 * So the rule is *tell me when the answer changes*, which also covers the case nobody writes a
 * guard for: the problem going away. A caller can say so.
 */
export class SaidOnce {
  private last: string | null = null

  /**
   * Whether this is worth saying.
   *
   * `null` is a legitimate value and means *nothing to report* — passing it is how a caller says
   * the condition has cleared, and the next occurrence after that is news again.
   */
  changed(what: string | null): boolean {
    if (what === this.last) return false
    this.last = what
    return true
  }

  /** What was last said, for a caller that wants to know without changing it. */
  get current(): string | null {
    return this.last
  }
}
