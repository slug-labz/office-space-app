/**
 * The switch, and the only place it is honoured.
 *
 * Laptop 1's condition on accepting F4, and it is the sharpest sentence in that round:
 * *"a master network switch enforced in main, not in the renderer. A toggle the main process
 * does not honour is a claim, not a control."*
 *
 * A checkbox in the privacy panel that sets a flag the requests do not read would be worse than
 * no checkbox — it would be the panel whose entire job is telling the truth about what leaves
 * the machine, lying about it, with a control on it.
 *
 * ## Why it wraps `fetch` rather than checking at each call site
 *
 * There are five places in `client.ts` and one in `connect.ts` that could reach the network. A
 * check in each is five chances to forget and one guaranteed omission the day somebody adds a
 * sixth. Wrapping the function they all receive means **the switch cannot be bypassed by
 * writing new code** — a new call site inherits it by construction, because there is no other
 * `fetch` in reach.
 *
 * It is also why the guard throws rather than returning a fake response: a caller that gets
 * something back has to decide what it means, and one of them will decide wrong. A throw has
 * exactly one meaning and `client.ts` maps it to a state that says so.
 */

/** Thrown when the switch is off. Named so callers can tell it from a network failure. */
export class NetworkOff extends Error {
  constructor() {
    super('Office Space is set not to make its own network requests.')
    this.name = 'NetworkOff'
  }
}

/**
 * Wrap a fetch so it refuses while the switch is off.
 *
 * `allowed` is read **per call**, not captured, so turning the switch off stops the next request
 * rather than the next restart. That distinction is the whole value of the control: somebody
 * switching it off is doing so because they want it off *now*.
 */
export function gated(allowed: () => boolean, real: typeof globalThis.fetch): typeof globalThis.fetch {
  // Typed off `fetch` itself rather than naming `RequestInfo`, which is a DOM type the main
  // process's tsconfig deliberately does not have — the same reason `props.ts` declares its own
  // canvas slice.
  return ((...args: Parameters<typeof globalThis.fetch>) => {
    if (!allowed()) return Promise.reject(new NetworkOff())
    return real(...args)
  }) as typeof globalThis.fetch
}
