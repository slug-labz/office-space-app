/**
 * Enough DOM to test the two renderers that had none.
 *
 * The repo's rule is that the DOM is the part `styles.css` can change, so the *models* are
 * tested and the drawing is not — and that rule is right for `Ledger`, whose whole point is
 * that the honesty lives in the data. It is wrong for the two things in this change, because
 * for both of them the claim **is** about the drawing:
 *
 * - "nineteen refusals render as **one block**" is a statement about how many elements exist;
 * - "a two-question turn renders **one card**, and the second appears when the first is
 *   answered" is a statement about what is on screen and when.
 *
 * A test of the view model would assert the summariser returns one object and the queue reports
 * one open question, and would pass just as happily against a renderer that drew all nineteen
 * paragraphs anyway. That is the shape of test this repo keeps finding and deleting.
 *
 * So: a small DOM, no dependency, deliberately partial. It implements what these renderers
 * actually touch and nothing else — a `querySelector` that understands a tag name or a single
 * class, events that bubble to the parent, and `hidden` as a plain property, because that is
 * what the code under test uses. It is not a browser and must not grow into one; anything that
 * needs more than this needs a real one.
 *
 * Not under `src/`, so it ships with nothing.
 */

type Listener = (event: FakeEvent) => void

export interface FakeEvent {
  readonly type: string
  readonly bubbles: boolean
  readonly detail?: unknown
  /**
   * Optional here, always present when `dispatchEvent` hands one to a listener.
   *
   * A form's submit handler calls it before doing anything else — `preventDefault()` is what
   * stops a browser navigating away — so an event without it throws rather than being ignored.
   * Throwing is the right failure: a silently-swallowed `preventDefault` would let a test drive a
   * form that a browser would have reloaded out from under.
   */
  preventDefault?: () => void
  /**
   * Optional here, always present when `dispatchEvent` hands one to a listener — same reasoning
   * as `preventDefault`.
   *
   * A row that carries its own controls needs it: `switcher.ts` calls `stopPropagation()` on the
   * archive and delete presses so choosing a project's *control* does not also choose the
   * project. An event without it threw, which is the right failure and the reason this is
   * declared rather than left to a cast at each call site — the shim's job is to be missing
   * nothing the code under test reads.
   */
  stopPropagation?: () => void
  readonly target?: El
  /** Keyboard events carry one. Declared rather than cast in, so a typo is a type error. */
  readonly key?: string
}

/**
 * Whatever a canvas method hands back — a gradient, a pattern, a text metric.
 *
 * Numbers where a renderer expects a measurement, and a callable for anything else, so a chain
 * like `createLinearGradient(...).addColorStop(...)` completes instead of throwing. It measures
 * nothing: every dimension is zero, and a test that asserted on one would be asserting about
 * this function.
 */
function recordingValue(): unknown {
  const measurements = new Set(['width', 'height', 'actualBoundingBoxAscent', 'actualBoundingBoxDescent', 'fontBoundingBoxAscent', 'fontBoundingBoxDescent'])
  return new Proxy(
    {},
    {
      get: (_target, property) => {
        if (typeof property !== 'string') return undefined
        if (measurements.has(property)) return 0
        return (): unknown => recordingValue()
      },
    },
  )
}

/** An element, and a text node when `tag` is `#text`. */
export class El {
  readonly children: El[] = []

  /**
   * How many element children there are.
   *
   * Here because its absence read as a source bug. `renderWorkLog` asks `childElementCount === 0`
   * to decide whether to say "no steps yet"; on an element that does not have the property the
   * comparison is `undefined === 0`, which is quietly false, so the branch never ran and the
   * test blamed the renderer. A fake DOM missing a property the code under test reads does not
   * fail — it answers wrongly, which is the more expensive of the two.
   */
  get childElementCount(): number {
    return this.children.length
  }
  parent: El | null = null
  className = ''
  /** `hidden`, `disabled`, `type` — plain properties, the way the renderers set them. */
  hidden = false
  disabled = false
  type = ''
  /**
   * `id` and `value`, for the forms.
   *
   * Added when the hire form became testable and nothing could find its name field or type into
   * it. Both are plain properties on a real element too, so there is nothing to emulate — their
   * absence simply meant a whole class of view, the ones that take input, could not be driven at
   * all. `value` defaults to `''` rather than `undefined` so `value.trim()` works on an untouched
   * field, which is what a real input does.
   */
  id = ''
  value = ''
  checked = false
  /**
   * `dataset` and `data-*` are one store, for the reason `id` and `style` are.
   *
   * A real element has no seam: `el.dataset.state = 'failed'` **is**
   * `el.setAttribute('data-state', 'failed')`, and CSS selectors match on the attribute. This
   * shim kept `dataset` as a plain object and attributes in a map, so `paintMark` writing
   * `el.dataset['state']` produced a mark that `getAttribute('data-state')` reported as `null` —
   * a test asserting on the attribute reads a failed turn as an unmarked one, and the fault looks
   * like the code's.
   *
   * Third instance of this exact shape in this file. The rule it settles: anything a browser
   * stores once must be stored once here, whatever it is spelled.
   */
  readonly dataset: Record<string, string> = dataStore(this)
  private text = ''
  private readonly listeners = new Map<string, Listener[]>()

  /**
   * Whether anything is listening for this kind of event.
   *
   * Exposed for one check: **a button nobody is listening to is a dead control**, and it looks
   * exactly like a live one. That is the shape `window.prompt` had — a button that closed the
   * switcher and did nothing — and the shape `views/select.ts` had before it, where rebuilding
   * rows on `mouseenter` destroyed the element between the press and the release. Both were
   * found by hand, and one of them twice.
   */
  listensFor(type: string): boolean {
    return (this.listeners.get(type) ?? []).length > 0
  }

  constructor(readonly tag: string) {}

  get textContent(): string {
    if (this.tag === '#text') return this.text
    return this.children.map((c) => c.textContent).join('')
  }

  /** Setting it replaces every child, exactly as the real one does. */
  set textContent(value: string) {
    if (this.tag === '#text') {
      this.text = value
      return
    }
    this.children.length = 0
    if (value !== '') this.appendChild(text(value))
  }

  /**
   * Move or insert a child before `before`, exactly as the real one does — including that a node
   * already in this parent is **moved** rather than duplicated.
   *
   * Added for `orderColumns`, which puts the conversation column on the side the settings ask for
   * by moving the node instead of setting `order: -1`. A shim without this made the reordering
   * untestable, which is how a layout ends up reordered in CSS in the first place: the visual
   * move is one line and the real one needs a method nobody had.
   */
  insertBefore(child: El, before: El | null): El {
    if (before === null) return this.appendChild(child)
    const at = this.children.indexOf(before)
    if (at === -1) return this.appendChild(child)

    child.parent?.detach(child)
    this.children.splice(this.children.indexOf(before), 0, child)
    child.parent = this
    return child
  }

  appendChild(child: El): El {
    // A fragment is not inserted — its children are. The renderers rely on this: every
    // `renderMarkdown` result is a fragment that gets appended into a body element.
    if (child.tag === '#fragment') {
      for (const grandchild of [...child.children]) this.appendChild(grandchild)
      child.children.length = 0
      return child
    }
    // Appending a node that is already somewhere **moves** it, which is what the real one does
    // and what `orderColumns` relies on to put the conversation column on the right-hand side.
    // Without this the shim left the node where it was and pushed a second reference, so one
    // element appeared twice in `children` — a fixture with two conversation columns, both
    // focusable, testing a layout that cannot exist.
    child.parent?.detach(child)
    child.parent = this
    this.children.push(child)
    return child
  }

  /**
   * Detach one child, if it is one. The private half of every move.
   *
   * Named apart from the DOM's own `remove()`, which takes no argument and detaches *this* node
   * — one method cannot be both, and the shim already has the second.
   */
  private detach(child: El): void {
    const at = this.children.indexOf(child)
    if (at !== -1) this.children.splice(at, 1)
  }

  /**
   * A 2D context that records rather than draws.
   *
   * `floor-view.ts` was parked as "the largest single surface nothing aims at", and the only
   * thing standing between it and this harness was one method — it constructs, and then calls
   * `getContext('2d')` and throws. Everything else about it loads in plain node.
   *
   * A Proxy rather than a list of methods, deliberately. A canvas API surface written out by
   * hand is a list that goes stale silently: the first call to something not on it throws, and
   * the module goes back to being "untestable" for a reason that is about this file. Anything
   * asked for is a function that records its name; anything read that is not a function reads
   * as a number, which is what the properties a renderer sets are.
   *
   * It draws nothing, and nothing here should ever assert about pixels. What it makes possible
   * is asking a canvas module about its *decisions* — when it repaints, when it stops, whether a
   * mutator wakes it — which is where its bugs are.
   */
  private context: Record<string, unknown> | null = null

  getContext(kind: string): unknown {
    if (kind !== '2d') return null
    if (this.context) return this.context
    const calls: { method: string; args: unknown[] }[] = []
    const own: Record<string, unknown> = { calls, canvas: this }
    this.context = new Proxy(own, {
      get: (target, property) => {
        if (property in target) return target[property as string]
        if (typeof property !== 'string') return undefined
        const fn = (...args: unknown[]): unknown => {
          calls.push({ method: property, args })
          // Chainable, because a canvas API returns things you then call: a gradient gets
          // `addColorStop`, a `measureText` gets a `width`. Returning `undefined` made the
          // module throw on its first gradient, which reads as "untestable" and is really
          // "the fake stopped one call short".
          return recordingValue()
        }
        target[property] = fn
        return fn
      },
      set: (target, property, value) => {
        target[property as string] = value
        return true
      },
    }) as Record<string, unknown>
    return this.context
  }

  /**
   * `prepend`, which is how the "N earlier messages" button gets above the turns.
   *
   * The button has to be first or it is not a header, and `showEarlier` prepends it every time
   * the count changes. Its own comment records what happened when that interacted with `trim()`
   * — the button became `firstElementChild` and windowing stopped — so this is the method whose
   * absence hid that whole interaction from the suite.
   */
  prepend(...nodes: El[]): void {
    for (const [index, node] of nodes.entries()) {
      node.parent?.children.splice(node.parent.children.indexOf(node), 1)
      node.parent = this
      this.children.splice(index, 0, node)
    }
  }

  /**
   * The three navigation properties `chat-view.ts` windows with.
   *
   * Its `trim()` walks `firstElementChild` / `nextElementSibling` and asks `isConnected` to
   * decide whether the "N earlier messages" button is chrome that should not be counted. Without
   * them the loop reads `undefined`, the guard breaks out on the first pass, and **nothing
   * trims** — the transcript grows without bound and no error says so.
   *
   * Which is the exact failure the comment beside that loop records: a button prepended so it
   * became `firstElementChild`, the next trim hit it, broke out, and windowing stopped after
   * exactly one trim. *"Nothing looked wrong — no error, no warning — the transcript simply grew
   * to six thousand children again and got slow."* A harness that cannot walk siblings cannot
   * see any of that.
   */
  get firstElementChild(): El | null {
    return this.children[0] ?? null
  }

  /** Whether `node` is this element or anywhere beneath it. */
  contains(node: El | null | undefined): boolean {
    for (let at: El | null | undefined = node; at; at = at.parent) if (at === this) return true
    return false
  }

  /**
   * The other end of the same walk.
   *
   * `views/music.ts` appends a body and then reaches back for it with `lastElementChild` rather
   * than holding a reference — which is ordinary DOM and was invisible here because the last
   * module to need a sibling walk only needed the first one. Eighth gap of this shape on this
   * branch, and the cheapest: one getter.
   */
  get lastElementChild(): El | null {
    return this.children[this.children.length - 1] ?? null
  }

  get nextElementSibling(): El | null {
    const siblings = this.parent?.children
    if (!siblings) return null
    const at = siblings.indexOf(this)
    return at >= 0 ? (siblings[at + 1] ?? null) : null
  }

  /** In the tree at all. A detached node is one nothing can reach. */
  get isConnected(): boolean {
    return this.parent !== null
  }

  /**
   * Take this node out of the tree, the way `Element.remove()` does.
   *
   * Added because `views/record.ts` closes its drawer with `panel?.remove()` and nothing else,
   * so without this the module could not be driven at all — the same reason
   * `document.documentElement` had to be added before the settings panel could be rendered.
   * A module is not untested because nobody tried; it is untested because the harness could not
   * reach it, and that is a fact about the harness.
   *
   * Silent on a node with no parent. That is what the real one does, and a drawer closed twice
   * is an ordinary thing rather than a fault.
   */
  remove(): void {
    const siblings = this.parent?.children
    if (!siblings) return
    const at = siblings.indexOf(this)
    if (at >= 0) siblings.splice(at, 1)
    this.parent = null
  }

  /**
   * Focus, as a recorded fact rather than a real one.
   *
   * The hire form calls `name.focus()` after refusing a name — putting the cursor back where the
   * problem is. There is nothing to emulate without a document, and the useful part for a test is
   * *that it was asked for*, which is a claim a form makes about where your attention should go.
   */
  focused = false

  /**
   * Focus, recorded — and now also remembered by the document.
   *
   * `focused` was the whole of this, under a comment saying focus here is "recorded, not
   * performed": a claim about where attention should go, without a viewport to move it in. That
   * is still true, and it was not enough. `views/switcher.ts` walks its rows with
   * `rows.indexOf(document.activeElement)`, so a shim with no active element cannot answer the
   * only question its keyboard navigation asks.
   *
   * So the document remembers the last element asked for, which is the smallest thing that makes
   * "which row is focused" answerable. It is still not a viewport: nothing here can take focus
   * away by being clicked, and nothing tabs.
   */
  focus(): void {
    const document = (globalThis as unknown as Record<string, Record<string, unknown>>)['document']
    // Only one thing has focus. `focused` used to be set and never cleared, so every element
    // that had ever been focused still answered yes — which is fine for "was this asked for"
    // and useless for "which row is focused now", and the second is the question a keyboard
    // list asks. Clearing the previous one is what makes both readings true.
    const previous = document?.['activeElement'] as El | undefined
    if (previous && previous !== this) previous.focused = false
    this.focused = true
    if (document) document['activeElement'] = this
  }

  /**
   * Recorded, not performed. There is nothing to scroll without a layout.
   *
   * Worth having as a fact: `views/select.ts` scrolls its list for the keyboard and deliberately
   * *not* for the pointer, because moving the target out from under a hand reaching for it is
   * the same bug as rebuilding the rows underneath it.
   */
  scrolledIntoView = 0
  scrollIntoView(): void {
    this.scrolledIntoView += 1
  }

  /**
   * How big this element is, which nothing here can work out and a test may declare.
   *
   * Zero by default, and the reasoning behind that has not changed: this shim has no layout, and
   * inventing plausible numbers would let a test assert something about placement that is true
   * only of the invention.
   *
   * But some modules cannot run at all without a box. `floor-view.ts` sizes its canvas from
   * `stage.clientWidth`, and with the property simply absent the arithmetic went to `NaN` and
   * the floor had no pixels to be clicked on — a module that looked untestable because the
   * harness had no opinion, rather than because it needed one.
   *
   * So a test writes the size it wants and the element reports it. That keeps the invention out
   * of this file and puts it in the test that depends on it, where it reads as the premise it is.
   */
  clientWidth = 0
  clientHeight = 0

  /** A rectangle, agreeing with the size above — a real element does not disagree with itself. */
  getBoundingClientRect(): { top: number; left: number; bottom: number; right: number; width: number; height: number } {
    return {
      top: 0,
      left: 0,
      bottom: this.clientHeight,
      right: this.clientWidth,
      width: this.clientWidth,
      height: this.clientHeight,
    }
  }

  /**
   * Inline style, with one store behind both ways of writing to it.
   *
   * It used to carry `setProperty`/`removeProperty` only, under a comment saying the mic's live
   * input level was "the one place a view here reaches for `style` at all". That stopped being
   * true: `avatar.ts` sizes its box with `style.width = '32px'`, and a plain assignment landed
   * somewhere `getPropertyValue` could not see — so a test reading the value the module had just
   * written got back an empty string and blamed the module.
   *
   * A real `CSSStyleDeclaration` has no such seam, and neither does this now. Assignment and
   * `setProperty` write the same map; `style.width` and `getPropertyValue('width')` read it.
   * Camel-cased names are hyphenated on the way in, the way the DOM maps them, so
   * `backgroundColor` and `background-color` are one entry rather than two.
   */
  readonly style = styleStore()

  /**
   * Attributes, as a map.
   *
   * `aria-*` and `title` are how a control says what it is to somebody not looking at it, and
   * several views set them on every redraw. They were missing, so any view that labels itself
   * threw before it drew anything — which is most of the ones that were still parked.
   */
  readonly attributes = new Map<string, string>()

  /**
   * `title` is one value with two spellings, the way `id` is.
   *
   * The views set it as a property — `toggle.title = '…'` — and a real element stores that in the
   * same place `setAttribute('title', …)` writes. Here it was landing on an ad-hoc field that
   * `getAttribute('title')` could not see, so a test asserting on a tooltip read `null` no matter
   * what the view had said, and an assertion aimed at a tooltip's *text* could only ever be
   * vacuous. A control's tooltip is a claim somebody acts on; it has to be readable to be checked.
   */
  get title(): string {
    return this.attributes.get('title') ?? ''
  }

  set title(value: string) {
    this.attributes.set('title', value)
  }

  /**
   * `id` is one value with two spellings, not two values.
   *
   * A real element has no seam here: `el.id = 'x'` and `el.getAttribute('id')` are the same
   * thing. This shim kept `id` as a plain field and everything else in a map, so `select.ts`
   * writing `row.id = ...` and then pointing `aria-activedescendant` at it produced an id that
   * `getAttribute('id')` could not find — a control whose highlighted row and announced row
   * looked like they disagreed, when it was the harness storing them in two places.
   */
  setAttribute(name: string, value: string): void {
    if (name === 'id') {
      this.id = value
      return
    }
    this.attributes.set(name, value)
  }

  /** `data-my-thing` ⇄ `myThing`, which is the mapping the real one uses. */
  static camel(attribute: string): string {
    return attribute.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
  }

  static dashed(key: string): string {
    return `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
  }

  getAttribute(name: string): string | null {
    if (name === 'id') return this.id || null
    return this.attributes.get(name) ?? null
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  blur(): void {
    this.focused = false
    this.dispatchEvent({ type: 'blur', bubbles: false })
  }

  replaceChildren(...nodes: El[]): void {
    this.children.length = 0
    for (const node of nodes) this.appendChild(node)
  }

  /**
   * `element.click()` — a real method, and the way one control reaches another.
   *
   * The switcher's `+` menu uses it to land in the new-project row's own field rather than being
   * a second way to name a project. Without it here, that route throws where the app works.
   */
  click(): void {
    this.dispatchEvent({ type: 'click', bubbles: true })
  }

  /** `append` is `appendChild` that takes several and accepts strings. Views use both. */
  append(...nodes: (El | string)[]): void {
    for (const node of nodes) this.appendChild(typeof node === 'string' ? text(node) : node)
  }

  /**
   * `add`, `contains`, `remove`.
   *
   * `remove` was missing, and the first test to reach for it — the roster's two-click Fire
   * button, which removes the armed class when it disarms — threw `classList.remove is not a
   * function`. Throwing is the good outcome and the reason `childElementCount` is here too: a
   * fake DOM missing a property the code under test *reads* does not fail, it answers wrongly.
   * A missing method at least says so.
   */
  get classList(): {
    add: (c: string) => void
    contains: (c: string) => boolean
    remove: (c: string) => void
    toggle: (c: string, force?: boolean) => void
  } {
    return {
      add: (c: string) => {
        if (!this.classList.contains(c)) this.className = `${this.className} ${c}`.trim()
      },
      contains: (c: string) => this.className.split(/\s+/).includes(c),
      remove: (c: string) => {
        this.className = this.className
          .split(/\s+/)
          .filter((each) => each && each !== c)
          .join(' ')
      },
      // The two-argument form, which is the one the views use — `toggle(c, isBad)` reads as the
      // condition it is, where an if/else around `add` and `remove` does not.
      toggle: (c: string, force?: boolean) => {
        const on = force === undefined ? !this.classList.contains(c) : force
        if (on) this.classList.add(c)
        else this.classList.remove(c)
      },
    }
  }

  /**
   * A tag name, a single `.class`, or a descendant sequence of those.
   *
   * The descendant form is not decoration. `music.ts` finds the search box it has just redrawn
   * with `.music__search .music__input`, and a `matches` that understood only one segment
   * returned null there — so the query and the focus were never restored, and the test read
   * that as the module dropping them. It was the harness declining to find the element.
   *
   * Right to left, like the real thing: this node must match the last segment, and each earlier
   * segment must match some ancestor, in order.
   */
  /**
   * A selector, as much of one as the app actually writes.
   *
   * Supported: **selector lists** (`button, input`), descendant combinators (`.card .row`), tags,
   * `.class`, `#id`, `[attr]`, `[attr="value"]`, and `:not(<simple>)`. Not supported: `>`, `+`,
   * `~`, pseudo-classes other than `:not`, and anything structural. Each of those was added when
   * the app used it and a test could not see it — most recently the focusable-element list, which
   * is `'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'` and matched
   * nothing at all here, so a menu that took focus correctly tested as one that did not.
   *
   * The rule this file keeps settling in different words: a harness that silently cannot see a
   * thing reports the code as broken, and that is worse than a harness that cannot do the thing.
   */
  matches(selector: string): boolean {
    return splitTop(selector, ',').some((one) => this.matchesDescendant(one))
  }

  private matchesDescendant(selector: string): boolean {
    const parts = selector.trim().split(/\s+/).filter((p) => p !== '')
    const last = parts[parts.length - 1]
    if (last === undefined || !this.matchesOne(last)) return false

    let node: El | null = this.parent
    for (let i = parts.length - 2; i >= 0; i -= 1) {
      const want = parts[i]!
      while (node && !node.matchesOne(want)) node = node.parent
      if (!node) return false
      node = node.parent
    }
    return true
  }

  /** One compound selector — no combinators, any number of `.class`, `#id`, `[attr]`, `:not()`. */
  private matchesOne(selector: string): boolean {
    // `:not(...)` first, because its argument contains the characters everything below splits on.
    const not = /:not\(([^)]*)\)/g
    let rest = selector
    for (const m of selector.matchAll(not)) {
      if (m[1] !== undefined && this.matchesOne(m[1])) return false
      rest = rest.replace(m[0], '')
    }
    if (rest === '') return true

    for (const token of rest.match(/(\[[^\]]*\]|[.#]?[^.#[\]]+)/g) ?? []) {
      if (token.startsWith('.')) {
        if (!this.classList.contains(token.slice(1))) return false
      } else if (token.startsWith('#')) {
        if (this.id !== token.slice(1)) return false
      } else if (token.startsWith('[')) {
        const inner = token.slice(1, -1)
        const eq = inner.indexOf('=')
        if (eq === -1) {
          if (this.getAttribute(inner) === null) return false
        } else {
          const name = inner.slice(0, eq)
          const want = inner.slice(eq + 1).replace(/^["']|["']$/g, '')
          if (this.getAttribute(name) !== want) return false
        }
      } else if (token !== '*' && this.tag !== token) return false
    }
    return true
  }

  querySelectorAll(selector: string): El[] {
    const found: El[] = []
    for (const child of this.children) {
      if (child.matches(selector)) found.push(child)
      found.push(...child.querySelectorAll(selector))
    }
    return found
  }

  querySelector(selector: string): El | null {
    return this.querySelectorAll(selector)[0] ?? null
  }

  addEventListener(type: string, listener: Listener): void {
    const existing = this.listeners.get(type)
    if (existing) existing.push(listener)
    else this.listeners.set(type, [listener])
  }

  /** Fires here, then walks up while the event bubbles — which is how `office:answer` travels. */
  dispatchEvent(event: FakeEvent): void {
    // Filled in here rather than demanded of every caller: a listener may call it, and a test
    // writing `{ type: 'submit', bubbles: false }` should not have to know that.
    if (!event.preventDefault) (event as { preventDefault?: () => void }).preventDefault = () => {}
    if (!event.stopPropagation) (event as { stopPropagation?: () => void }).stopPropagation = () => {}
    if (!event.target) (event as { target?: El }).target = this
    for (const listener of this.listeners.get(event.type) ?? []) listener(event)
    if (event.bubbles) this.parent?.dispatchEvent(event)
  }

  /** Every element under here, in document order. Convenient for counting in a test. */
  get descendants(): El[] {
    return this.children.flatMap((c) => [c, ...c.descendants])
  }
}

/** `backgroundColor` -> `background-color`. Custom properties (`--x`) are already correct. */
const cssName = (name: string): string =>
  name.startsWith('--') ? name : name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

interface StyleStore {
  readonly properties: Map<string, string>
  setProperty(name: string, value: string): void
  removeProperty(name: string): void
  getPropertyValue(name: string): string
  [key: string]: unknown
}

/**
 * `dataset`, backed by the element's attribute map.
 *
 * A Proxy rather than a copy, because the two spellings must not be able to drift: a write
 * through `dataset` has to be readable through `getAttribute` in the same tick, and vice versa,
 * exactly as in a browser.
 */
function dataStore(el: El): Record<string, string> {
  return new Proxy(Object.create(null) as Record<string, string>, {
    get: (_target, key) =>
      typeof key === 'string' ? (el.attributes.get(El.dashed(key)) ?? undefined) : undefined,
    set: (_target, key, value) => {
      if (typeof key === 'string') el.attributes.set(El.dashed(key), String(value))
      return true
    },
    deleteProperty: (_target, key) => {
      if (typeof key === 'string') el.attributes.delete(El.dashed(key))
      return true
    },
    has: (_target, key) => typeof key === 'string' && el.attributes.has(El.dashed(key)),
    ownKeys: () =>
      [...el.attributes.keys()].filter((k) => k.startsWith('data-')).map((k) => El.camel(k.slice(5))),
    getOwnPropertyDescriptor: (_target, key) =>
      typeof key === 'string' && el.attributes.has(El.dashed(key))
        ? { configurable: true, enumerable: true, value: el.attributes.get(El.dashed(key)) }
        : undefined,
  })
}

/** Split on a separator that is not inside brackets or parentheses. */
function splitTop(text: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (c === '(' || c === '[') depth += 1
    else if (c === ')' || c === ']') depth -= 1
    else if (c === sep && depth === 0) {
      out.push(text.slice(start, i))
      start = i + 1
    }
  }
  out.push(text.slice(start))
  return out.map((p) => p.trim()).filter((p) => p !== '')
}

function styleStore(): StyleStore {
  const properties = new Map<string, string>()
  const own: StyleStore = {
    properties,
    setProperty: (name, value) => void properties.set(cssName(name), String(value)),
    removeProperty: (name) => void properties.delete(cssName(name)),
    getPropertyValue: (name) => properties.get(cssName(name)) ?? '',
  }
  return new Proxy(own, {
    get: (target, property) => {
      if (property in target || typeof property !== 'string') return target[property as string]
      return properties.get(cssName(property)) ?? ''
    },
    set: (_target, property, value) => {
      if (typeof property !== 'string') return false
      properties.set(cssName(property), String(value))
      return true
    },
  })
}

function text(value: string): El {
  const node = new El('#text')
  node.textContent = value
  return node
}

class FakeCustomEvent implements FakeEvent {
  readonly detail: unknown
  readonly bubbles: boolean
  constructor(readonly type: string, init: { bubbles?: boolean; detail?: unknown } = {}) {
    this.bubbles = init.bubbles ?? false
    this.detail = init.detail
  }
}

/**
 * The document itself, so views that listen on it can be wired.
 *
 * `document.addEventListener` is how a control closes itself when you click elsewhere or press
 * Escape — the microphone's menu does both. Without it, wiring such a view throws at the first
 * listener and the whole class stays untestable. `documentEvent` is how a test plays the
 * outside-click that dismisses one.
 */
const documentListeners = new Map<string, ((event: FakeEvent) => void)[]>()

/** Fire an event on the document, the way a click somewhere else in the app would. */
export function documentEvent(event: FakeEvent): void {
  for (const listener of documentListeners.get(event.type) ?? []) listener(event)
}

/**
 * Put the fake `document` in place for this process.
 *
 * Called once per test file, before anything that draws. Returns nothing to restore, because a
 * test process that has installed a DOM has no reason to want the absence of one back.
 */
export function installDom(): void {
  const globals = globalThis as unknown as Record<string, unknown>
  documentListeners.clear()
  globals['document'] = {
    createElement: (tag: string) => new El(tag),
    createTextNode: (value: string) => text(value),
    createDocumentFragment: () => new El('#fragment'),
    /**
     * Search from `documentElement`, which is the only root this shim has.
     *
     * Absent until `applySettings` reached for `#building` to move the conversation column, and
     * absent is why: a module that calls it threw `document.getElementById is not a function`
     * inside a test that was about something else entirely, and the first reading of that is
     * that the module is broken. The app builds its element map with these, so anything that
     * looks an element up rather than being handed one was unreachable from here.
     */
    getElementById: (id: string): El | null => {
      const root = (globalThis as unknown as Record<string, Record<string, unknown>>)['document']?.[
        'documentElement'
      ] as El | undefined
      if (!root) return null
      return root.id === id ? root : root.querySelector(`#${id}`)
    },
    querySelector: (selector: string): El | null => {
      const root = (globalThis as unknown as Record<string, Record<string, unknown>>)['document']?.[
        'documentElement'
      ] as El | undefined
      return root ? root.querySelector(selector) : null
    },
    addEventListener: (type: string, listener: (event: FakeEvent) => void) => {
      documentListeners.set(type, [...(documentListeners.get(type) ?? []), listener])
    },
    removeEventListener: (type: string, listener: (event: FakeEvent) => void) => {
      documentListeners.set(type, (documentListeners.get(type) ?? []).filter((each) => each !== listener))
    },
  }
  globals['CustomEvent'] = FakeCustomEvent

  /**
   * `HTMLElement`, so `instanceof` narrows the way the app expects.
   *
   * `chat-view.ts` guards its windowing with `if (!(first instanceof HTMLElement)) break` — a
   * real guard, because `firstElementChild` can be a text node. Without the global the check
   * throws a ReferenceError on the first trim, which is not "the class is untested" but "the
   * harness stops at line 637". Fourth gap of this shape found while unparking modules, and the
   * cheapest one yet.
   *
   * `El` is what this shim makes, so `El` is what it answers with.
   */
  globals['HTMLElement'] = El
  /**
   * `Node`, which is `El` again — the same identity `HTMLElement` gets, for the same reason.
   *
   * Every menu in this app closes on a click elsewhere, and each one narrows the event target
   * with `event.target instanceof Node` before asking whether it is inside. With no such global
   * the guard throws, the listener dies, and the menu stays open over whatever was clicked —
   * which reads as the close-on-click-away logic being absent rather than the harness being.
   */
  globals['Node'] = El

  /**
   * Animation frames the test drives, rather than a clock.
   *
   * `frame-gate.ts` says of the loop it governs: *"The dangerous half of parking a loop is
   * failing to restart it — a floor frozen on a stale picture is a worse failure than the waste
   * it replaced, and it is invisible until somebody notices the office has stopped reacting.
   * That transition has to be tested, and it cannot be."*
   *
   * It gives two reasons, and both are true: the root `tsconfig` excludes `src/renderer`, and a
   * hidden page throttles `requestAnimationFrame` to nothing, so measuring it through a browser
   * measures the throttle. Neither reason applies here. Frames only happen when a test asks for
   * one, so "did anything ask for another frame" is a question with an exact answer — which is
   * the whole of parking and waking.
   */
  const frames: (((now: number) => void) | null)[] = []
  globals['requestAnimationFrame'] = (fn: (now: number) => void): number => frames.push(fn)
  globals['cancelAnimationFrame'] = (handle: number): void => {
    if (handle >= 1 && handle <= frames.length) frames[handle - 1] = null
  }
  /** Run whatever is queued, once. Returns how many callbacks ran. */
  globals['__runFrame'] = (now = 0): number => {
    const due = frames.splice(0, frames.length).filter(Boolean) as ((n: number) => void)[]
    for (const fn of due) fn(now)
    return due.length
  }
  /** How many frames are waiting. Zero means the loop has parked. */
  globals['__pendingFrames'] = (): number => frames.filter(Boolean).length

  /**
   * A `ResizeObserver` that observes nothing.
   *
   * `floor-view.ts` watches its stage so the office re-lays-out when the window changes. There
   * is no layout here to change, so this never fires on its own — which is the honest model: a
   * resize this harness did not announce is one it cannot produce. `fire()` is there for a test
   * that says so, and calls the callback on purpose rather than pretending the window moved.
   */
  globals['ResizeObserver'] = class {
    constructor(private readonly on: (entries: unknown[]) => void) {}
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    /** For a test that wants to say "the stage changed size" out loud. */
    fire(entries: unknown[] = []): void {
      this.on(entries)
    }
  }

  /**
   * A clipboard, and the refusal it can answer with.
   *
   * `navigator` is a getter-only global in Node 22, so this is defined rather than assigned —
   * a plain write throws and takes the whole harness with it.
   *
   * Writable because the interesting case is the one that says no. A clipboard write can be
   * refused by permission or by the page not being focused, and the first-run panel answers that
   * by relabelling the button rather than leaving a press that did nothing. Only a clipboard a
   * test can make fail reaches that line.
   */
  globals['__clipboardWrites'] = [] as string[]
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: {
      clipboard: {
        refuse: false,
        writeText(text: string): Promise<void> {
          if (this.refuse) return Promise.reject(new Error('clipboard permission denied'))
          ;(globals['__clipboardWrites'] as string[]).push(text)
          return Promise.resolve()
        },
      },
    },
  })

  /**
   * `ImageData` and `createImageBitmap`, which are what stand between this harness and the cast.
   *
   * `floor-view.ts` takes its sprite fetcher as a parameter — the seam is already there — but
   * every path through it ends in `toBitmaps`, and that reaches for two globals Node does not
   * have. Without them the art map stays empty, and `rebuild` skips everybody:
   *
   *     No art means the theme could not be drawn from for this person; it has already been
   *     reported, and a desk with nobody at it is the honest picture.
   *
   * So the floor renders an empty office and every test about who is on it passes by drawing
   * nobody — which is the shape of a check that cannot fail for the right reason. The gap was
   * two globals, not a boundary.
   *
   * These carry dimensions and bookkeeping, nothing more: `ImageData` keeps its buffer and checks
   * its length, and a bitmap records whether it was closed. Nothing here is ever painted; a test
   * that claimed something about pixels would be describing this stub. What they make answerable
   * is *who the floor decided to draw*, which is a decision and not an image.
   */
  globals['ImageData'] = class {
    readonly data: Uint8ClampedArray
    constructor(
      data: Uint8ClampedArray | number,
      readonly width: number,
      readonly height: number = 1,
    ) {
      if (typeof data === 'number') {
        this.data = new Uint8ClampedArray(data * width * 4)
        return
      }
      // The real constructor throws when the buffer does not match the dimensions, and that is
      // not a detail to skip: it is the failure `setCast` catches and reports through
      // `onArtFailed`. A permissive stub makes a pack that will not decode look like one that
      // decodes fine, so the branch that exists to report it can never be entered — the check
      // would pass because the failure it describes cannot happen here.
      if (data.length !== width * height * 4) {
        throw new Error(`ImageData: ${data.length} bytes is not ${width}\u00d7${height}\u00d74`)
      }
      this.data = data
    }
  }

  globals['createImageBitmap'] = (source: { width?: number; height?: number } = {}): Promise<unknown> =>
    Promise.resolve({
      width: source.width ?? 1,
      height: source.height ?? 1,
      // Real bitmaps hold GPU memory and `floor-view.ts` closes every one on a theme change.
      // Closing is recorded rather than ignored, so a test can ask whether it happened.
      closed: false,
      close(): void {
        this.closed = true
      },
    })

  // `document.documentElement`, which is where the whole-window preferences land: the theme's
  // CSS variables, the density attribute, the text scale. `applySettings` writes to it before
  // anything else is drawn, so a view that touches it could not be rendered at all without one.
  ;(globals['document'] as Record<string, unknown>)['documentElement'] = new El('html')

  /**
   * A window, with the two things views ask it for.
   *
   * `innerHeight` is how a popup decides which way to open; the listeners are how a control
   * closes itself on resize or scroll. Both are zero and inert here — the point is not to model
   * a viewport, it is that a view which asks about one can be driven at all.
   */
  Object.defineProperty(globals, 'window', {
    configurable: true,
    writable: true,
    value: {
      innerHeight: 0,
      innerWidth: 0,
      addEventListener: () => {},
      removeEventListener: () => {},
      /**
       * The real timers, reached through `window` because that is how the app spells them.
       *
       * `music.ts` schedules its context close with `window.setTimeout`, and `app.ts` clears the
       * status line the same way. Without these the modules are not slow to test — they throw,
       * which is the third harness gap in this suite to have looked like an untestable module.
       *
       * Delegated rather than faked: a test that wants to control time can install its own, and
       * one that just needs the callback to run eventually should get the real behaviour rather
       * than a queue somebody has to remember to drain.
       */
      setTimeout: (fn: () => void, ms?: number): unknown => setTimeout(fn, ms),
      clearTimeout: (handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>),
      /**
       * The interval pair, added when the microphone's level meter needed them.
       *
       * `views/mic.ts` ticks `draw` every 100ms while recording, so without these the whole
       * recording path throws on the line that starts listening — the seventh time on this
       * branch that "untestable" meant one missing method. `unref()` so a forgotten interval
       * cannot hold the test runner open, which a real one would not do either.
       */
      setInterval: (fn: () => void, ms?: number): unknown => {
        const handle = setInterval(fn, ms)
        handle.unref?.()
        return handle
      },
      clearInterval: (handle: unknown): void => clearInterval(handle as ReturnType<typeof setInterval>),
      /** The scale a canvas backs itself at. One here: the shim has no device to be retina. */
      devicePixelRatio: 1,
    },
  })
}

/** Press a button the way a person does: the click listeners, in order. */
export function click(button: El): void {
  button.dispatchEvent({ type: 'click', bubbles: true })
}
