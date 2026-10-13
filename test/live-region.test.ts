/**
 * The one element in this app that speaks must stay in the accessibility tree.
 *
 * `#said` is `role="status" aria-live="polite"`, and everything the app announces goes through
 * it: *"Spotify connected."*, *"Spotify disconnected. The stored token has been deleted."*,
 * *"Office Space will make no network requests of its own."* Those are the confirmations for
 * writes that touch a keychain, delete a credential, and change what leaves the machine — the
 * three places `main.ts` says out loud that a silent success is the fault it is guarding against.
 *
 * A live region announces a change that happens **while the region is in the accessibility
 * tree**. `say()` set the text and *then* revealed the element:
 *
 *     els.said.textContent = text
 *     els.said.hidden = false
 *
 * so the change landed on a node that was not in the tree, and the node then arrived with its
 * text already in place — the one case screen readers are documented not to announce. Every
 * confirmation this app makes was very likely never spoken.
 *
 * Measured in the running app, reading the real accessibility tree over CDP:
 *
 *     hidden (as it shipped)     inTree=false
 *     display:none               inTree=false
 *     visibility:hidden          inTree=false
 *     opacity:0                  inTree=true   live=polite
 *     height:0;overflow:hidden   inTree=true   live=polite
 *
 * The three obvious ways to hide something are the three that break it. It collapses by opacity
 * now, so the node, its role and its `live` property are present at every moment and the only
 * thing that ever changes is the text.
 *
 * ## What this checks, and what it cannot
 *
 * Whether a screen reader actually speaks is not checkable here, or anywhere in this suite —
 * that needs a browser and an assistive technology. The CDP reading above is a **receipt**.
 *
 * What this checks is the three ways the source can put it back: the attribute in the markup, a
 * `display`/`visibility` rule in the stylesheet, and `say()` going back to toggling presence
 * instead of text. Each of those is a one-line change that looks harmless, breaks the feature
 * completely, and shows nothing on screen to anybody who can see the screen.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => readFileSync(join(root, p), 'utf8')

const html = read('src/renderer/index.html')
const css = read('src/renderer/styles.css') + read('src/renderer/panels.css')
const app = read('src/renderer/app.ts')

/** The `#said` tag, as written in the markup. */
function saidTag(): string {
  const tag = /<p[^>]*\bid="said"[^>]*>/.exec(html)?.[0]
  assert.ok(tag, '#said is gone from index.html — the app has no live region, so it announces nothing')
  return tag
}

test('the live region is still a live region', () => {
  const tag = saidTag()
  assert.match(tag, /aria-live="polite"/, '#said lost aria-live, so nothing it holds is announced')
  assert.match(tag, /role="status"/, '#said lost role="status"')
})

test('the live region is in the tree from the start, not revealed with its text already in it', () => {
  const tag = saidTag()
  assert.doesNotMatch(
    tag,
    /\shidden(\s|>|=)/,
    'the markup marks #said `hidden`, so it starts outside the accessibility tree. Whatever ' +
      'reveals it then delivers a node that already contains its text, which is the one case a ' +
      'live region does not announce. It must be present and empty instead.',
  )
})

test('nothing in the stylesheets takes the live region out of the tree', () => {
  // Every rule whose selector mentions `.said`, and what it sets.
  const offenders: string[] = []
  for (const match of css.matchAll(/([^{}]*\.said[^{}]*)\{([^}]*)\}/g)) {
    const selector = match[1]!.replace(/\/\*[\s\S]*?\*\//g, '').trim().split('\n').pop()!.trim()
    const body = match[2]!
    for (const property of [/display\s*:\s*none/, /visibility\s*:\s*hidden/, /content-visibility\s*:\s*hidden/]) {
      if (property.test(body)) offenders.push(`${selector} sets ${property.source.replace(/\\s\*/g, ' ')}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'these rules remove the live region from the accessibility tree, measured — `display: none`, ' +
      '`visibility: hidden` and `hidden` all do, and `opacity: 0` does not. Collapse it with ' +
      `opacity so it stays announceable:\n  ${offenders.join('\n  ')}`,
  )
})

test('say() changes the text and never the presence', () => {
  const body = /function say\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(app)?.[1]
  assert.ok(body, 'say() has been renamed or restructured — this test can no longer see what it guards')

  // The control: if the parse ever comes back with something that is not say(), every assertion
  // below passes on a body that does nothing.
  assert.match(body, /els\.said\.textContent/, 'the parsed body does not write to #said — this is not say()')

  assert.doesNotMatch(
    body,
    /els\.said\.hidden\s*=/,
    'say() sets `els.said.hidden`. That is what shipped, and it means the text is written into a ' +
      'node outside the accessibility tree and the node is then revealed with the text already ' +
      'in it — announcing nothing. Set `dataset.shown` and let CSS fade it instead.',
  )
})

test('the timeout clears the text, so the same message twice is announced twice', () => {
  const body = /sayTimer = window\.setTimeout\(\(\) => \{([\s\S]*?)\}, tone/.exec(app)?.[1]
  assert.ok(body, "say()'s timeout has been restructured — this test can no longer see what it guards")

  assert.match(
    body,
    /els\.said\.textContent\s*=\s*''/,
    'the timeout must clear the text as well as fade the region. A live region reports a ' +
      '*change*, so leaving the old string in place means the second identical announcement — ' +
      'two failed writes in a row, say — is silent.',
  )
  assert.doesNotMatch(body, /els\.said\.hidden\s*=/, 'the timeout hides #said, taking it back out of the tree')
})
