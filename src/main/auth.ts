/**
 * Which account pays for this.
 *
 * Office Space exists on one premise: the office you clone costs nothing extra to run, because
 * it spawns the `claude` you already installed and already logged into, and requests go out on
 * the subscription you already pay for. `VISION.md` §7.1 makes that a hard requirement, and it
 * names the way it silently fails:
 *
 * > **Known trap:** an exported `ANTHROPIC_API_KEY` *shadows* a subscription profile in the
 * > standard credential precedence. A user with that variable set would be silently billed at
 * > API rates instead of using their subscription. Office Space must detect this and say so
 * > plainly.
 *
 * This module is that detection. It did not exist until now, and `docs/auth.md` had been
 * asserting for some time that the office "checks for this at startup" — which was the office
 * making a claim about itself that was not true, in the one place where being wrong costs the
 * user money rather than time.
 *
 * ## What this never does
 *
 * **It does not read a credential.** Not the key, not a prefix of the key, not its length —
 * only whether the variable occupies its slot. There is no version of this feature that needs
 * the value, and a module that never holds one cannot leak one into a log, an error message, or
 * a transcript that gets pasted into an issue.
 *
 * ## The empty-string trap inside the trap
 *
 * `ANTHROPIC_API_KEY=""` still occupies its slot in the precedence order and still wins. It has
 * to be genuinely unset, not blank — so `if (process.env.ANTHROPIC_API_KEY)` is exactly the
 * check that misses the case somebody is most likely to have got into by accident.
 */

/** An environment variable that changes who is billed, and what it does. */
interface Redirect {
  readonly name: string
  /** How to describe the effect, in a sentence that starts "…". */
  readonly effect: string
  /** True when merely being present is enough — the value is irrelevant. */
  readonly presenceIsEnough: boolean
}

const REDIRECTS: readonly Redirect[] = [
  {
    name: 'ANTHROPIC_API_KEY',
    effect: 'requests are billed at API rates instead of on your subscription',
    presenceIsEnough: true,
  },
  {
    name: 'ANTHROPIC_AUTH_TOKEN',
    effect: 'requests authenticate with that token rather than your subscription login',
    presenceIsEnough: true,
  },
  {
    name: 'CLAUDE_CODE_USE_BEDROCK',
    effect: 'requests go to AWS Bedrock and are billed by AWS',
    presenceIsEnough: false,
  },
  {
    name: 'CLAUDE_CODE_USE_VERTEX',
    effect: 'requests go to Google Vertex and are billed by Google Cloud',
    presenceIsEnough: false,
  },
]

export interface Shadow {
  readonly name: string
  readonly effect: string
  /**
   * Set, but to an empty string.
   *
   * Worth reporting separately because it looks unset to almost every check somebody would
   * write by hand, including the obvious one, and it is the state a half-finished `unset`
   * leaves behind.
   */
  readonly blank: boolean
}

export type Billing =
  /** Nothing in the environment redirects billing. The intended path. */
  | { readonly state: 'subscription' }
  /** Something will be paid for by an account other than the subscription. */
  | { readonly state: 'redirected'; readonly shadows: readonly Shadow[] }

/**
 * Read the environment for anything that decides who pays.
 *
 * `env` is a parameter rather than a read of `process.env` so this is testable against a
 * fixture instead of against whatever the developer's own shell happens to export — which, for
 * this particular check, is the environment most likely to be wrong in an interesting way.
 */
export function billingRoute(env: Record<string, string | undefined>): Billing {
  const shadows: Shadow[] = []

  for (const redirect of REDIRECTS) {
    const value = env[redirect.name]
    if (value === undefined) continue

    // A provider flag is a switch: `0`, `false` and `""` mean it is off. An API key is not a
    // switch — its mere presence occupies the slot, whatever is in it.
    if (!redirect.presenceIsEnough && !isOn(value)) continue

    shadows.push({ name: redirect.name, effect: redirect.effect, blank: value === '' })
  }

  return shadows.length === 0 ? { state: 'subscription' } : { state: 'redirected', shadows }
}

function isOn(value: string): boolean {
  const v = value.trim().toLowerCase()
  return v !== '' && v !== '0' && v !== 'false' && v !== 'no' && v !== 'off'
}

/**
 * What to tell somebody whose requests are not going where they think.
 *
 * `null` when there is nothing to say, so the caller never has to decide whether a message is
 * worth showing — an office that warns about the ordinary case teaches people to dismiss it.
 *
 * Names the variable and the fix, because "your billing may be misconfigured" is the kind of
 * warning that sends somebody looking through settings for half an hour.
 */
export function billingWarning(billing: Billing): string | null {
  if (billing.state === 'subscription') return null

  return billing.shadows
    .map((s) => {
      const blank = s.blank
        ? ` It is set to an empty string, which still counts as set — it has to be genuinely` +
          ` unset, not blank.`
        : ''
      return (
        `${s.name} is set in this environment, so ${s.effect}.` +
        `${blank} Run \`unset ${s.name}\` and restart Office Space to use the subscription you` +
        ` are already paying for.`
      )
    })
    .join(' ')
}
