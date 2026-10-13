/**
 * Every channel the renderer can reach, and whether anything is listening.
 *
 * `preload.ts` is the only path between the renderer and everything this app can do, and until
 * now no test imported it. Audited with `office-space-6c`, whose first finding is the reason
 * half of the obvious test is not written here.
 *
 * ## What is already guaranteed, and must not be re-asserted
 *
 * *"A channel that does not exist fails to compile."* `CHANNEL.describe` is a property access on
 * a `const` object literal, and `const api: OfficeApi = { … }` forces preload to implement
 * exactly the declared surface — no more, no less. So *"a channel string in preload with no
 * definition"* and *"a declared method nobody wired"* are both impossible today, and a test
 * asserting them would be green forever regardless of the code. 61 methods, 61 keys, as the
 * compiler requires.
 *
 * That is worth writing down rather than testing: a permanently green assertion in a file whose
 * name promises to cover the bridge is worse than no file at all.
 *
 * ## What is not guaranteed
 *
 * The channel is a plain string on both sides. **Nothing** connects `CHANNEL.foo` in preload to
 * `ipcMain.handle(CHANNEL.foo, …)` in main. A channel with no handler produces, at runtime:
 *
 *     Error: No handler registered for 'office:foo'
 *
 * — a rejected `invoke`, invisible to the compiler and to every other test. That is a button that
 * does nothing. The reverse is invisible too: a handler nothing invokes is a feature that shipped
 * unreachable, and nothing anywhere says so.
 *
 * The same holds in the other direction. `send(CHANNEL.speak, …)` in main and
 * `ipcRenderer.on(CHANNEL.speak, …)` in preload are two string literals that happen to match. A
 * push nobody subscribes to is main talking to itself; a subscription nothing pushes is a
 * callback that never fires, and both look exactly like a quiet app.
 *
 * ## Reading it
 *
 * Both ends are written across lines — `ipcMain.handle(\n  CHANNEL.send,\n  …)` — so the patterns
 * span whitespace. A first pass that matched a single line found fourteen channels with no
 * handler; twelve of them were multi-line registrations and one was a push. Every count below is
 * guarded for that reason: a scan that has stopped reading its file reports a clean bill, which
 * is the failure mode this suite exists to refuse.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { CHANNEL } from '../src/shared/ipc.js'

// Derived from this file's own location. Not `resolve('.')` and not a directory name — the suite
// runs from the repo root today and from a packaged tree in the release check, and a path built
// either of those ways has already been wrong here twice.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  )
}

const preload = readFileSync(join(root, 'src', 'preload', 'preload.ts'), 'utf8')
const main = sources(join(root, 'src', 'main')).map((f) => readFileSync(f, 'utf8')).join('\n')

/** Every `CHANNEL.<key>` reached through `call(`, across line breaks. */
function keysVia(source: string, call: string): Set<string> {
  const found = new Set<string>()
  const pattern = new RegExp(`${call.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(\\s*CHANNEL\\.(\\w+)`, 'g')
  for (const m of source.matchAll(pattern)) if (m[1]) found.add(m[1])
  return found
}

/** What a person greps for when a channel breaks: the string, not the key that names it. */
const wire = (keys: Iterable<string>): string[] =>
  [...keys].map((k) => (CHANNEL as Record<string, string>)[k] ?? `${k} (no such key)`).sort()

const missing = (from: Set<string>, present: Set<string>): string[] =>
  wire([...from].filter((k) => !present.has(k)))

const invoked = keysVia(preload, 'ipcRenderer.invoke')
// Both subscribe helpers, plus a direct `ipcRenderer.on` if one is ever written.
const subscribed = new Set([
  ...keysVia(preload, 'on'),
  ...keysVia(preload, 'onPlain'),
  ...keysVia(preload, 'ipcRenderer.on'),
])
const handled = new Set([...keysVia(main, 'ipcMain.handle'), ...keysVia(main, 'ipcMain.on')])
// `send` is main's one-line wrapper over `window.webContents.send`; the raw form counts too.
const pushed = new Set([...keysVia(main, 'send'), ...keysVia(main, 'webContents.send')])

test('the scan is reading both files, or every result below is a clean bill on nothing', () => {
  // First, and unconditional. Each assertion in this file is a set difference, and a set that
  // came back empty because the regex stopped matching satisfies all of them.
  assert.ok(invoked.size >= 40, `only ${invoked.size} invoked channels found in preload — this is not reading it`)
  assert.ok(handled.size >= 40, `only ${handled.size} handlers found under src/main — this is not reading it`)
  assert.ok(subscribed.size >= 5, `only ${subscribed.size} subscriptions found in preload — this is not reading it`)
  assert.ok(pushed.size >= 5, `only ${pushed.size} pushes found under src/main — this is not reading it`)
})

test('every channel the renderer invokes has something in main that answers it', () => {
  assert.deepEqual(
    missing(invoked, handled),
    [],
    'these channels are reachable from the renderer and no handler is registered for them. At ' +
      'runtime each is `Error: No handler registered for …` — a rejected promise behind whatever ' +
      'control calls it, which is a button that does nothing.',
  )
})

test('every handler in main is reachable from the renderer', () => {
  assert.deepEqual(
    missing(handled, invoked),
    [],
    'these handlers are registered and nothing in preload invokes them, so the feature behind ' +
      'each one shipped unreachable. Either wire it, or delete it — a handler nobody can call is ' +
      'not a smaller feature, it is an absent one that looks present in the source.',
  )
})

test('every channel main pushes has a subscriber', () => {
  assert.deepEqual(
    missing(pushed, subscribed),
    [],
    'main sends on these channels and nothing in preload listens, so the payload is built every ' +
      'time and thrown away. Nothing errors; the app is simply quieter than the code reads.',
  )
})

test('every subscription in preload is fed by something in main', () => {
  assert.deepEqual(
    missing(subscribed, pushed),
    [],
    'the renderer subscribes to these and nothing in main ever sends them, so the callback never ' +
      'fires. A view waiting on one of these looks like a view with nothing to show.',
  )
})

test('the bridge is the whole of CHANNEL, and CHANNEL is the whole of the bridge', () => {
  // Every key is either invoked or subscribed; a key nothing reaches is a channel that exists
  // only as a declaration, which is where an unreachable feature hides in plain sight.
  const reached = new Set([...invoked, ...subscribed])
  assert.deepEqual(
    wire(Object.keys(CHANNEL).filter((k) => !reached.has(k))),
    [],
    'these channels are declared and preload neither invokes nor subscribes to them',
  )
})
