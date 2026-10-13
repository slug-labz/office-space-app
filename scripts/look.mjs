/**
 * Boot the real app against a named workspace state and print what is on the screen.
 *
 * ## Why this is checked in
 *
 * Every fault this project has found in something *drawn* was found by launching the app and
 * reading it — never by a test. `CLAUDE.md` says so in as many words. And the script that does
 * it had been written from scratch at least six times across two sessions in one night, thrown
 * away in a scratchpad each time, and each rebuild paid the same tax and made the same two
 * mistakes. Those two are the reason this file exists rather than a note saying "just run it":
 *
 * **1. An ordinary empty directory is not an empty office.** `reconcile.ts` restores the shipped
 * agents on boot, so `OFFICE_WORKSPACE=/tmp/whatever` comes up with seven staff and a populated
 * floor. It even announces it — *"Your office was updated: 7 files brought forward"* — which
 * reads like first-run seeding working rather than like a fact about the state you are now in.
 * Reaching a genuinely empty office means writing `.office-space/shipped.json` first, so
 * reconcile reads their absence as deliberate. Cost: three launches, and a false conclusion in
 * a report before that.
 *
 * **2. CDP's `Input.dispatchMouseEvent` does not open this app's controls, and it is not a
 * targeting problem.** Measured on a live boot: the command-palette button sits at (1219,769)
 * in a 1280x817 viewport, `document.elementFromPoint` at its centre returns that BUTTON, and a
 * `mousePressed`/`mouseReleased` pair at exactly that point leaves the palette shut. The same
 * app, same second, opens it from `dispatchEvent(new MouseEvent('mousedown'))` then `'click'`
 * on the element.
 *
 * The **cause is not established** — the obvious suspects (a coordinate outside the window, a
 * `devicePixelRatio` of 2) are both ruled out by the numbers above, and I have not chased it
 * further because the working method costs nothing. It is recorded as a measurement rather than
 * an explanation on purpose: this file is the wrong place to enshrine a guess about why, and
 * the previous version of this paragraph did exactly that. Cost of rediscovering it: two
 * mis-aimed crops and a four-minute timeout.
 *
 * Neither is discoverable from the code. Both are now in one place.
 *
 * ## Use
 *
 *     node scripts/look.mjs                          # a seeded office, the default chrome
 *     node scripts/look.mjs --state empty            # nobody works here
 *     node scripts/look.mjs --state unreadable       # .claude/agents/ exists and will not open
 *     node scripts/look.mjs --state blind            # memory/ holds a match and will not open
 *     node scripts/look.mjs --state partial          # memory/ opens; one file in it does not
 *     node scripts/look.mjs --state elsewhere        # two projects; the term is in the other
 *     node scripts/look.mjs --state conversation     # a real transcript, in the other project
 *     node scripts/look.mjs --panel changed          # open a panel by its palette name first
 *     node scripts/look.mjs --find backoff            # type a query and read what comes back
 *     node scripts/look.mjs --find greeter --open 1   # ...then press the first result
 *     node scripts/look.mjs --state empty --json     # for a script rather than a person
 *     node scripts/look.mjs --no-build               # skip the rebuild between looks
 *     node scripts/look.mjs --state empty --tab      # what Tab reaches, in that state
 *     node scripts/look.mjs --state ungated          # a seeded office whose approval gate is gone
 *     node scripts/look.mjs --state working --project greeter --panel "task list"
 *     node scripts/look.mjs --state undoable --undo         # put a dispatch's edit back, for real
 *     node scripts/look.mjs --state busy                    # a dispatch still out, which must refuse an undo
 *
 * It builds first, boots Electron, reads, kills it, and removes the workspace it made. Nothing
 * it does touches a workspace you own.
 */

import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, chmod } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 9412

const args = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? fallback : (args[at + 1] ?? true)
}
const has = (name) => args.includes(`--${name}`)

const state = flag('state', 'seeded')
const panel = flag('panel', null)
const find = flag('find', null)
const open = flag('open', null)
const pick = flag('pick', null)
const vanish = has('vanish')
const project = flag('project', null)
const asJson = has('json')

/**
 * The workspace to point the office at.
 *
 * `seeded` is what a first run looks like and what nearly every bug hides behind. `empty` is the
 * one that has to be constructed — see the header.
 */
async function makeWorkspace() {
  const root = await mkdtemp(join(tmpdir(), `office-look-${state}-`))

  if (state === 'seeded') return root

  /*
   * These two run **before** the shipped manifest below, and that placement is the point.
   *
   * Every state after that manifest is an office declared already-handed-over, so `reconcile`
   * leaves `.claude/agents/` empty — which is how the empty-office states are built. An office
   * with no agents has no manager, and `openSession` throws by design. Driven from below the
   * line, pressing a conversation result opened nothing and read exactly like the navigation
   * being broken. It was the fixture having nobody to open a conversation with.
   */
  if (state === 'conversation') {
    /*
     * Two projects and a real transcript, so the conversation arm can actually be pressed.
     *
     * This is the only destination whose correctness is an **ordering** — `switchTo` then
     * `openSession` — rather than one call. `openSession(project, id)` binds the conversation to
     * whatever project is active, so if `switchTo` resolves before the renderer has really
     * switched, the fix binds against the project still on screen and the original bug is back
     * wearing the fix's clothes. A unit test asserts the two calls happened in order; only a real
     * run can say whether the first one finished.
     *
     * The transcript is written where the app looks for one — under the real
     * `~/.claude/projects`, in a directory named from this run's own temp workspace path, so the
     * name cannot collide with anything of the user's. `cleanup` removes it.
     */
    for (const named of ['greeter', 'checkout']) {
      const dir = join(root, 'projects', named)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'PLAN.md'), `# ${named}\n\nNothing much.\n`, 'utf8')
    }

    // Made here rather than inherited: the block that used to create it now runs after this one.
    await mkdir(join(root, '.office-space'), { recursive: true })

    /*
     * The workspace root, not the project directory.
     *
     * `main.ts` constructs every session with `cwd: WORKSPACE_ROOT` — "every project's session
     * runs in the workspace root", because a session started inside `projects/<name>/` cannot find
     * `.claude/agents/`. So a real transcript for this app lives under the root's encoded path,
     * and a fixture that writes one under the project directory puts it where the app will never
     * look while still being findable by anything that trusts the registry's own `cwd`.
     */
    /*
     * A session id unique to this run.
     *
     * `locateTranscript` falls back to scanning every directory under `~/.claude/projects` for the
     * exact filename when it is not where the registry says. With a fixed id, a leftover from an
     * earlier run answers instead — which silently voided the deleted-target check: the file was
     * confirmed gone and the office still showed its contents, out of another run's copy.
     *
     * Production ids are UUIDs, so this is a fixture collision and not a product fault. It is a
     * fixture that made the product look wrong, which is the thing this script must never do.
     */
    sessionId = `look-${Date.now().toString(36)}`
    const cwd = root
    transcriptDir = join(homedir(), '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'))
    await mkdir(transcriptDir, { recursive: true })
    await writeFile(
      join(transcriptDir, `${sessionId}.jsonl`),
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'does conversationterm belong in the basket' },
      }) + '\n',
      'utf8',
    )
    await writeFile(
      join(root, '.office-space', 'sessions.json'),
      JSON.stringify({
        version: 1,
        sessions: [
          {
            id: sessionId,
            project: 'checkout',
            cwd,
            agent: 'manager',
            createdAt: '2026-09-03T09:00:00.000Z',
            updatedAt: '2026-09-03T09:00:00.000Z',
            costUsd: null,
            title: 'the basket conversation',
            mode: 'building',
            /*
             * `opened`, and it is not optional.
             *
             * `resumable()` filters on `s.opened && s.closed !== true` — "unopened ids name no
             * conversation". Without it the office lists the project as having *no conversations*
             * while the registry file plainly contains one, so nothing could open or restore it.
             * A search result pressed against that fixture landed in a new empty conversation,
             * which is indistinguishable on screen from the product failing to resume.
             */
            opened: true,
            closed: false,
          },
        ],
      }),
      'utf8',
    )

    // Returned, like every other state above. Falling through reaches the shipped manifest
    // below, which declares the whole office already handed over — so `reconcile` leaves
    // `.claude/agents/` empty, there is no manager, and `openSession` throws by design.
    return root
  }

  if (state === 'elsewhere') {
    /*
     * Two projects, and the term is in the one that is **not** on screen.
     *
     * `working` seeds a single project, so pressing a result that lands on it proves nothing —
     * the app was already there. Navigation is only observable when the destination differs from
     * the origin, which is the same reason `--project checkout` seeding `greeter` was a fault
     * rather than a convenience.
     */
    for (const [named, plan] of [
      ['greeter', '# greeter\n\nA greeting, and nothing else.\n'],
      ['checkout', '# checkout\n\nThe basket and the elsewhereterm it settles.\n'],
    ]) {
      const dir = join(root, 'projects', named)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'PLAN.md'), plan, 'utf8')
      await writeFile(join(dir, 'PROGRESS.md'), `# Progress — ${named}\n\n- Started.\n`, 'utf8')
      await writeFile(join(dir, 'TASKS.md'), `# Tasks — ${named}\n\n## In progress\n`, 'utf8')
    }
  }


  /*
   * A working office whose approval gate has been removed.
   *
   * Seeded, so everything else about it is normal — and then the hook deleted, which is a thing a
   * person may legitimately do and which `reconcile.ts` deliberately will not undo. What the
   * office sees afterwards is an approvals directory with nothing in it, which is exactly what a
   * working gate looks like when nobody has run a command. That indistinguishability is the whole
   * reason this state is constructible here.
   *
   * The removal happens after the app has seeded, so it is done by the caller below rather than
   * here — see `ungate`.
   */
  if (state === 'ungated') return root

  /*
   * A seeded office with a project in it, and a task list with each outcome the harness can
   * report — passed, failed, uncheckable, and not yet run.
   *
   * Every other state here is about something being absent. This one is about the office having
   * work, which is the state a person is in for all but their first ten minutes and the only one
   * where the task surfaces draw anything at all.
   */
  /*
   * A finished dispatch with one recorded edit, and the edited file on disk.
   *
   * Built because the undo is the only thing in this app that writes over a file it did not
   * create, and it had been proved by unit tests and by a harness whose bridge writes nothing.
   * Neither of those can catch a wrong path, a bad join, or a button wired to nothing — and the
   * cost of finding that out from a user is somebody's file.
   */
  if (state === 'undoable') {
    await mkdir(join(root, '.office-space', 'changes'), { recursive: true })
    const file = join(root, 'greeting.js')
    await writeFile(file, 'const hello = () => "HELLO, WORLD"\n', 'utf8')
    await writeFile(
      join(root, '.office-space', 'dispatches.jsonl'),
      JSON.stringify({
        line: 'sent', id: 'toolu_demo', sessionId: 's-1', project: '', employee: 'builder',
        brief: 'Shout the greeting.', verify: null, sentAt: '2026-09-01T08:00:00.000Z',
      }) + '\n' +
      JSON.stringify({
        line: 'outcome', id: 'toolu_demo', kind: 'reported', output: 'done',
        at: '2026-09-01T08:01:00.000Z',
      }) + '\n',
      'utf8',
    )
    await writeFile(
      join(root, '.office-space', 'changes', 'toolu_demo.json'),
      JSON.stringify({
        version: 1,
        changes: [{ path: file, kind: 'edit', before: '"hello, world"', after: '"HELLO, WORLD"' }],
        shell: 0,
        unattributed: 0,
      }, null, 2) + '\n',
      'utf8',
    )
    return root
  }

  /*
   * A dispatch that was sent and has not come back, with files already changed under it.
   *
   * The safety path of the undo, and the only one never seen outside a unit test: an employee is
   * mid-edit, and the office must refuse to put anything back rather than race them. The change
   * view's own finding is what makes it necessary — concurrent dispatches share one working tree,
   * so an undo running now is that collision with the office on one side of it.
   *
   * Constructed by writing the `sent` line and no outcome, which is exactly what `unfinished()`
   * reads and is the office's one definition of somebody still being out.
   */
  if (state === 'busy') {
    await mkdir(join(root, '.office-space', 'changes'), { recursive: true })
    const file = join(root, 'mid-edit.js')
    await writeFile(file, 'const x = "AFTER"\n', 'utf8')
    await writeFile(
      join(root, '.office-space', 'dispatches.jsonl'),
      JSON.stringify({
        line: 'sent', id: 'toolu_busy', sessionId: 's-1', project: '', employee: 'builder',
        brief: 'Still working on this one.', verify: null, sentAt: '2026-09-01T09:00:00.000Z',
      }) + '\n',
      'utf8',
    )
    await writeFile(
      join(root, '.office-space', 'changes', 'toolu_busy.json'),
      JSON.stringify({
        version: 1,
        changes: [{ path: file, kind: 'edit', before: '"before"', after: '"AFTER"' }],
        shell: 0,
        unattributed: 0,
      }, null, 2) + '\n',
      'utf8',
    )
    return root
  }

  if (state === 'working') {
    /*
     * Named from `--project`, not hardcoded.
     *
     * This was `const project = ...'greeter'`, shadowing the module-level `--project` flag. The
     * documented `--state working --project greeter` worked only because the two literals
     * happened to match: `--project checkout` seeded `greeter`, then failed to switch to
     * `checkout` and reported "no such project on screen" — which reads as the product's project
     * switcher being broken. `main.ts` in this same branch says why that is not allowed: a
     * development instrument may not be indistinguishable from a bug in the product it checks.
     */
    const named = project ?? 'greeter'
    const dir = join(root, 'projects', named)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'PLAN.md'), `# ${named}\n\n## What we are building\nA greeting.\n`, 'utf8')
    await writeFile(join(dir, 'PROGRESS.md'), `# Progress — ${named}\n\n- Started.\n`, 'utf8')
    await writeFile(
      join(dir, 'TASKS.md'),
      [
        `# Tasks — ${named}`,
        '',
        '## In progress',
        '',
        '| # | Task | Owner | VERIFY |',
        '|---|------|-------|--------|',
        '| 1 | Add the retry helper | builder | `node -e "process.exit(0)"` exits 0 |',
        '| 2 | Make the failing one fail | tester | `node -e "process.exit(1)"` exits 0 |',
        '| 3 | Read it over | reviewer | reviewed by eye |',
        '',
        '## Queued',
        '',
        '| # | Task | Owner | VERIFY |',
        '|---|------|-------|--------|',
        '| 4 | Write the README | builder | `node -e "process.exit(0)"` exits 0 |',
        '',
        '## Done',
        '',
        '| # | Task | Owner | VERIFY | Completed |',
        '|---|------|-------|--------|-----------|',
      ].join('\n') + '\n',
      'utf8',
    )
    return root
  }

  await mkdir(join(root, '.claude', 'agents'), { recursive: true })
  await mkdir(join(root, '.office-space'), { recursive: true })

  // Every path this build ships, marked as already handed over — so their absence reads as
  // "removed on purpose" and reconcile leaves the office empty instead of refilling it.
  const manifest = JSON.parse(await readFile(join(ROOT, 'dist', 'shipped-hashes.json'), 'utf8'))
  const given = Object.keys(manifest.files ?? manifest).filter((k) => k !== 'generatedAt')
  await writeFile(join(root, '.office-space', 'shipped.json'), JSON.stringify({ given }, null, 2), 'utf8')

  if (state === 'unreadable') {
    // A directory that exists and will not open, which must never read as a directory with
    // nobody in it. Restored in `cleanup`, or the temp dir cannot be removed.
    await chmod(join(root, '.claude', 'agents'), 0o000)

    return root
  }

  if (state === 'partial') {
    /*
     * A memory directory that opens, holding one memory that reads and one file that will not.
     *
     * `blind` is the total case. This is the one that produced a sentence contradicting its own
     * parenthetical — a source reported as *not searched* directly above a match found in it —
     * and the two have to be distinguishable on screen, not only in the type.
     */
    await mkdir(join(root, 'memory'), { recursive: true })
    await writeFile(
      join(root, 'memory', 'why-backoff.md'),
      '---\nname: why-backoff\ndescription: the retry decision\n---\n\nWe chose retry-with-backoff.\n',
      'utf8',
    )
    await writeFile(join(root, 'memory', 'sealed.md'), '---\nname: sealed\n---\n\nbackoff\n', 'utf8')
    await chmod(join(root, 'memory', 'sealed.md'), 0o000)
  }

  if (state === 'blind') {
    /*
     * A workspace with something real in memory, and a `memory/` that will not open.
     *
     * `unreadable` shuts `.claude/agents/`, which a search never reads — so it cannot show the
     * one thing a search must get right: "nothing matched" and "nothing matched in the part I
     * could read" are the same sentence unless something forces them apart, and that difference
     * has to survive the trip through IPC, not merely hold in the module that computes it.
     *
     * Written first, then shut, so what is behind the door is known to be a real match.
     */
    await mkdir(join(root, 'memory'), { recursive: true })
    await writeFile(
      join(root, 'memory', 'why-backoff.md'),
      '---\nname: why-backoff\ndescription: the retry decision\n---\n\nWe chose retry-with-backoff.\n',
      'utf8',
    )
    await chmod(join(root, 'memory'), 0o000)
  }
  return root
}

/**
 * Evaluate an expression in the page and return its value.
 *
 * **No backticks inside the expressions passed here.** They are built as template literals, so a
 * backtick in a comment — even in prose about `textContent` — ends the template and makes this
 * whole file unparseable. It has happened three times; the error points at a line far from the
 * comment, which is why it keeps costing a run to find.
 */
async function ask(expression) {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
  const page = list.find((t) => t.type === 'page')
  if (!page) throw new Error('the app is up but has no page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('could not attach to the renderer'))
  })
  const got = await new Promise((res) => {
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data)
      if (msg.id === 1) res(msg)
    }
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true, userGesture: true },
    }))
  })
  ws.close()
  if (got.result?.exceptionDetails) {
    throw new Error(got.result.exceptionDetails.exception?.description ?? 'the page threw')
  }
  return got.result?.result?.value
}

/**
 * Open a panel the way a person does — through the command palette.
 *
 * `mousedown` then `click`, on the element. See the header: a CDP-synthesised press does not
 * reach these controls at all.
 */
const OPEN_PANEL = (name) => `(async () => {
  const press = (el) => { for (const t of ['mousedown','click'])
    el?.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true })) }
  press([...document.querySelectorAll('button')].find(b => b.textContent.trim() === '⌘K'))
  await new Promise(r => setTimeout(r, 350))
  const input = [...document.querySelectorAll('input')].find(i => i.offsetParent !== null)
  if (!input) return 'no palette input'
  input.value = ${JSON.stringify(name)}
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 350))
  const hit = [...document.querySelectorAll('[role=option],li,button')]
    .find(e => e.offsetParent !== null && new RegExp(${JSON.stringify(name)}, 'i').test(e.textContent || ''))
  if (!hit) return 'no palette entry matched'
  press(hit)
  await new Promise(r => setTimeout(r, 1200))
  return 'opened'
})()`

/** The surfaces worth reading on every look, as a person would describe them. */
const READ = `(async () => {
  const t = (sel) => document.querySelector(sel)?.textContent?.replace(/\\s+/g,' ').trim() ?? null
  const el = (sel) => document.querySelector(sel)
  const snapshot = await window.office.describe()
  const openPanel = [...document.querySelectorAll('[id$="-panel"]')].find(p => !p.hidden)
  return {
    workspace: {
      root: snapshot.root,
      staff: snapshot.staff.length,
      skills: snapshot.skills.length,
      problems: snapshot.problems.map(p => p.kind + (p.rule ? ':' + p.rule : '')),
    },
    chrome: {
      statusLine: t('#staff-count'),
      composerPlaceholder: el('#composer')?.placeholder ?? null,
      composerDisabled: el('#composer')?.disabled ?? null,
      sendDisabled: el('#send')?.disabled ?? null,
      modeBannerShown: el('#mode') ? !el('#mode').hidden : null,
      modeLede: t('#mode-lede'),
      transcriptEmpty: t('.empty'),
    },
    openPanel: openPanel ? {
      id: openPanel.id,
      text: (openPanel.textContent || '').replace(/\\s+/g,' ').trim().slice(0, 1400),
    } : null,
  }
})()`

/**
 * What Tab actually reaches, in whatever state the app is in.
 *
 * Here rather than in a sweep of its own, because of the finding that produced it. Two keyboard
 * audits were run tonight — one seeded, one empty — and they see **disjoint** surfaces. The
 * seeded sweep covered sixteen controls and never saw the first-run panel, because in that state
 * it does not exist. The empty sweep sees four and never touches the status bar, because that
 * panel is modal and traps focus, correctly.
 *
 * Neither sweep covers the app, and each looked complete on its own. One was reported as *"the
 * Tab order"*, which is a claim about one state wearing the clothes of a claim about the product.
 *
 * So the reading belongs to the state rather than the other way round, and a focus trap is
 * exactly the kind of difference that makes a sweep look thorough while being blind to
 * everything behind it.
 *
 * Read from the document rather than by pressing Tab: focus does not move for an untrusted key
 * event, and the trusted route is the one measured not to work here — see the header. The order
 * is the spec's: positive `tabindex` first in numeric order, then document order.
 *
 * One escaping trap, since this is a template literal and cost a wrong reading already: a
 * backslash-s inside it collapses to a bare `s` before the page ever sees the string, so the
 * whitespace regex below is written with a doubled backslash. Single-escaped, it becomes /s+/g
 * and strips every letter s from every control name — "Close" came back as "Clo e", which looks
 * like a rendering bug in the app rather than a bug in the instrument reading it.
 */
const TAB_ORDER = `(() => {
  const focusable = 'a[href],button,input,select,textarea,[tabindex],details>summary'
  const visible = (el) => {
    if (el.hidden || el.disabled) return false
    if (el.getAttribute('aria-hidden') === 'true') return false
    if (el.closest('[hidden],[aria-hidden="true"]')) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const all = [...document.querySelectorAll(focusable)]
    .filter((el) => visible(el) && Number(el.getAttribute('tabindex') ?? 0) >= 0)
  // A modal traps focus, so what Tab reaches is what is inside it — not the whole document.
  const modal = document.querySelector('[role=dialog][aria-modal=true]:not([hidden])')
  const reachable = modal ? all.filter((el) => modal.contains(el)) : all
  const rank = (el) => Number(el.getAttribute('tabindex') ?? 0)
  const ordered = [
    ...reachable.filter((el) => rank(el) > 0).sort((a, b) => rank(a) - rank(b)),
    ...reachable.filter((el) => rank(el) === 0),
  ]
  const name = (el) =>
    (el.getAttribute('aria-label') || el.textContent || el.placeholder || el.id || el.tagName)
      .replace(/\\s+/g, ' ').trim().slice(0, 40)
  return {
    trappedBy: modal ? (modal.id || 'a modal') : null,
    reaches: ordered.map(name),
    // Controls that exist and Tab cannot get to. Behind a trap this is expected and named as
    // such; with no trap it is a keyboard user unable to reach part of the app.
    unreachable: all.filter((el) => !reachable.includes(el)).map(name),
  }
})()`

/** The file each state's `--undo` should check, by the name that state wrote. */
/*
 * Null-prototype, so a state name is looked up and not inherited.
 *
 * `UNDO_TARGET[state]` reached `Object.prototype`: `--state toString --undo` resolved to a
 * function, took the truthy branch, and `join(workspace, Object)` threw synchronously — outside
 * the `.catch` beside it, so the run died with a TypeError about a path argument instead of
 * saying the state was unknown. Same for `constructor`, `valueOf`, `__proto__`.
 */
const UNDO_TARGET = Object.assign(Object.create(null), { undoable: 'greeting.js', busy: 'mid-edit.js' })

let child = null
let workspace = null
let seenUndo = null

/** Kill the whole spawned group, not the shim in front of it. See `detached` above. */
function killTree(signal) {
  if (!child?.pid) return
  try { process.kill(-child.pid, signal) } catch { try { child.kill(signal) } catch {} }
}

/*
 * One cleanup, however many times this is called.
 *
 * The first Ctrl-C is invisible: `cleanup` sends SIGTERM and then spends its time in `rm`, so the
 * window is still up and pressing Ctrl-C again is the normal reaction. That second press used to
 * start a second concurrent `cleanup`, whose `rm` finished quickly against the already-thinned
 * tree and called `process.exit` while the first was still walking it — leaving a half-deleted
 * workspace in `/tmp`, which for `--state unreadable` includes a directory at mode 000 that `rm
 * -rf` cannot remove without a `chmod` first.
 *
 * Later callers await the same promise rather than starting their own.
 */
/** Written under the real `~/.claude/projects`, so `cleanup` must remove it by name. */
let transcriptDir = null
/** The id this run's seeded transcript was written under. Unique per run — see the state. */
let sessionId = null

let cleaning = null
function cleanup() {
  cleaning ??= (async () => {
    killTree('SIGTERM')
    if (workspace) {
      try { await chmod(join(workspace, '.claude', 'agents'), 0o755) } catch {}
      try { await chmod(join(workspace, 'memory'), 0o755) } catch {}
      try { await chmod(join(workspace, 'memory', 'sealed.md'), 0o644) } catch {}
      try { await rm(workspace, { recursive: true, force: true }) } catch {}
      // Outside the workspace, so the line above does not reach it.
      if (transcriptDir) { try { await rm(transcriptDir, { recursive: true, force: true }) } catch {} }
      /*
       * And any directory a previous run left behind.
       *
       * These live under the user's real `~/.claude/projects`, so a run that changed where it
       * writes — or died before cleanup — leaks one. Matched on this script's own temp prefix, so
       * nothing of the user's can be caught by it.
       */
      try {
        const projects = join(homedir(), '.claude', 'projects')
        for (const name of await readdir(projects)) {
          if (name.includes('office-look-')) await rm(join(projects, name), { recursive: true, force: true })
        }
      } catch {}
    }
  })()
  return cleaning
}

/*
 * Kill the app even when this script is killed.
 *
 * `cleanup` runs on the success path and in the catch, and neither happens if the script is
 * interrupted — Ctrl-C, a harness stopping the task, a terminal closing. The child then outlives
 * it and sits in somebody's Dock until they notice and quit it by hand.
 *
 * That is the same fault as the missing Dock icon one commit ago, one degree worse: not an
 * instrument that *looks* like a bug in the product, but one that leaves a window of the product
 * running with a workspace that no longer exists. Somebody clicking around in it would be looking
 * at a deleted temp directory.
 *
 * Synchronous on `exit`, because an async handler there never runs. The signals get the full
 * cleanup and then re-exit with the conventional code.
 */
process.on('exit', () => {
  killTree('SIGKILL')
})
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    void cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143))
  })
}

try {
  // Rebuilt by default, because the commonest way to be misled here is to look at the last
  // build after editing the source — which costs a wrong conclusion rather than thirty seconds.
  if (!has('no-build')) execFileSync('node', [join(ROOT, 'scripts', 'build.mjs')], { cwd: ROOT, stdio: 'ignore' })
  workspace = await makeWorkspace()

  child = spawn('npx', ['electron', '.', `--remote-debugging-port=${PORT}`], {
    cwd: ROOT,
    /*
     * Its own process group, so the whole tree can be killed rather than the shim in front of it.
     *
     * `npx` is a shell shim and Electron is its grandchild. Measured: the shim forwards SIGTERM
     * and does **not** forward SIGKILL — a killed shim leaves Electron reparented to PID 1 and
     * still running. So the `exit` backstop, whose entire job is the case where the polite path
     * did not happen, was killing the one process that did not matter.
     *
     * `detached` makes the child a group leader; `kill(-pid)` then reaches every descendant.
     */
    detached: true,
    env: {
      ...process.env,
      OFFICE_WORKSPACE: workspace,
      /*
       * No Dock icon. This boots a real app and kills it seconds later, and run from a clone it
       * is a *separate* application from an installed Office Space — so every run put an
       * "Electron" icon in somebody's Dock and took it away again while they were working. It
       * read as their own clicks opening and closing an app.
       */
      OFFICE_HEADLESS: '1',
    },
    stdio: 'ignore',
  })

  // Poll rather than sleep a fixed time: a cold start is slower than a warm one, and a fixed
  // wait is either a flake or a tax on every run.
  let up = false
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500))
    up = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.ok).catch(() => false)
  }
  if (!up) throw new Error('the app did not come up within 30s')

  /*
   * Wait for the office to have finished drawing, rather than for a number of milliseconds.
   *
   * A fixed sleep read the app mid-paint at least once: a `--tab` run reported a modal present
   * with nothing focusable inside it, which is not a state the app is ever in — the panel element
   * had been created and its buttons had not. That reading was wrong and looked exactly like a
   * finding. An instrument that is occasionally wrong is worse than no instrument, because its
   * output is believed.
   *
   * "Settled" is: the status line has been written, and any modal on screen has something in it
   * a person could press. Both are things the app does once and does not undo.
   */
  const settled = async () => {
    for (let i = 0; i < 40; i++) {
      const ready = await ask(`(() => {
        const line = document.querySelector('#staff-count')?.textContent?.trim()
        if (!line) return false
        const modal = document.querySelector('[role=dialog][aria-modal=true]:not([hidden])')
        return modal === null || modal.querySelector('button, a[href], input') !== null
      })()`).catch(() => false)
      if (ready === true) return true
      await new Promise((r) => setTimeout(r, 250))
    }
    return false
  }
  if (!(await settled())) throw new Error('the app came up but never finished drawing')

  /*
   * The gate is removed once the office has seeded itself.
   *
   * It cannot be arranged in advance: on a first boot `shipped.json` does not yet record having
   * given the hook, so `reconcile` puts it back. Deleting afterwards is also what actually
   * happens to a person.
   */
  if (state === 'ungated') {
    await rm(join(workspace, '.claude', 'hooks', 'approval-gate.mjs'), { force: true })
  }

  /*
   * Switch to a project before reading, when one was asked for.
   *
   * The name is matched as **text**, not compiled into a pattern. It used to build a RegExp from
   * whatever was passed: `--project "c++"` threw "Nothing to repeat", `--project "a(b"` threw
   * "Unterminated group", and `--project "next.js"` quietly matched any character for the dot and
   * could select a different row. There was also no visibility filter, unlike the sibling
   * `OPEN_PANEL` — so it could press a row inside a closed menu and report success. Exact match is
   * tried first, so a project whose name contains another's is not ambiguous.
   *
   * (The explanation lives out here rather than inside the evaluated string: that string is a
   * template literal, and a backtick in a comment inside it ends the template. Which is exactly
   * what happened when this note was first written in there.)
   *
   * The office opens its own conversation, not a project's — so every task surface answers "this
   * is the office conversation rather than a project" until somebody switches, which is a true
   * sentence about a state nobody wants to look at.
   */
  if (project !== null) {
    const went = await ask(`(async () => {
      const press = (el) => { for (const t of ['mousedown','click'])
        el?.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true })) }

      // Open the switcher first. Adding a visibility filter below revealed that this used to
      // press a row inside a *closed* menu and report success — the row is in the DOM either way,
      // so the old selector found it and nothing said the menu was shut.
      press([...document.querySelectorAll('button')].find(b => b.textContent.trim() === '⌘K'))
      await new Promise(r => setTimeout(r, 300))
      const box = [...document.querySelectorAll('input')].find(i => i.offsetParent !== null)
      if (box) {
        box.value = 'Switch project'
        box.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise(r => setTimeout(r, 300))
        press([...document.querySelectorAll('[role=option],li,button')]
          .find(e => e.offsetParent !== null && /Switch project/i.test(e.textContent || '')))
        await new Promise(r => setTimeout(r, 600))
      }

      const want = ${JSON.stringify(String(project))}.toLowerCase()
      const rows = [...document.querySelectorAll('button, [role=option], .swrow')]
        .filter((e) => e.offsetParent !== null)
      const text = (e) => (e.textContent || '').trim().toLowerCase()
      const row = rows.find((e) => text(e) === want) ?? rows.find((e) => text(e).includes(want))
      if (!row) return 'no such project on screen'
      press(row)
      await new Promise((r) => setTimeout(r, 1800))
      return 'switched'
    })()`)
    if (went !== 'switched') throw new Error(`could not open the "${project}" project: ${went}`)
  }

  /*
   * `--undo` needs the changed panel open, so it opens it.
   *
   * `#changed-body` is only rendered by `showChanged()`, the panel-open path — so `--undo` on its
   * own found no button and reported "no Put back button on any row" **beside an unreverted
   * file**. A false "the undo is wired to nothing", produced by the instrument built precisely
   * because a write-nothing harness cannot catch a button wired to nothing.
   *
   * The usage line in this file's header documented that broken invocation. I had verified the
   * undo by running it *with* `--panel` and then written the example *without* — so the command
   * I checked and the command I published were different commands.
   *
   * Implying the panel rather than correcting the example, because a flag that only works when
   * combined with another flag is a trap the next person also falls into.
   */
  const wants =
    panel ??
    (has('undo') ? 'What the office changed' : null) ??
    (find !== null ? 'Find anything in this workspace' : null)

  if (wants !== null) {
    const opened = await ask(OPEN_PANEL(wants))
    if (opened !== 'opened') throw new Error(`could not open the "${wants}" panel: ${opened}`)

    /*
     * Press the panel's own "Look again" when the workspace changed under it.
     *
     * `office.recheck()` from here returns a fresh snapshot to *this script* and leaves the
     * renderer's own copy untouched, so the panel goes on drawing what it read at boot. That cost
     * one wrong reading — a removed gate reported as present. The button is the path a person
     * takes and the only one that updates what is on screen.
     */
    /*
     * `--find` types a query and waits for the answer.
     *
     * Implying the panel the way `--undo` does, for the reason written above it: a flag that only
     * works alongside another flag is a trap. Typing rather than calling `runSearch()` because the
     * input event is the path a person takes — a search wired to a handler nothing dispatches
     * looks identical from the outside to one that works.
     */
    if (find !== null) {
      const asked = await ask(`(async () => {
        const box = document.getElementById('search-input')
        if (!box) return 'no search input'
        box.value = ${JSON.stringify(find)}
        box.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise(r => setTimeout(r, 2500))
        return 'typed'
      })()`)
      if (asked !== 'typed') throw new Error(`could not search: ${asked}`)

      /*
       * `--open N` presses the Nth result and reports where it landed.
       *
       * The report is what the *app* looks like afterwards, not what the click returned. A
       * handler that resolves cleanly and navigates nowhere is exactly the failure this feature
       * replaced, and it would look like success from inside the promise.
       */
      /*
       * `--vanish` deletes the hit's transcript between the search and the press.
       *
       * The case a review raised and then withdrew as unverified: a target that is gone by the
       * time somebody clicks. The claim was that nothing throws, so the office lands in an empty
       * conversation wearing the name of the thing that was searched for — absent read as empty,
       * in the arm the whole change is about. It was inferred from the same read whose twin the
       * drive had already falsified, so it is checked here rather than believed.
       */
      /*
       * The memory equivalent: delete what the first hit points at, then press it.
       *
       * A review found the two arms asymmetric — a conversation that has gone says so, and a
       * memory that has gone opens the panel with nothing marked. Checked rather than taken,
       * because that reviewer's own record on this PR is one right out of three from reading and
       * three out of three from driving.
       */
      if (vanish && state === 'partial') {
        await rm(join(workspace, 'memory', 'why-backoff.md'), { force: true })
        let still = true
        try { await readFile(join(workspace, 'memory', 'why-backoff.md'), 'utf8') } catch { still = false }
        console.log(`\n  memory deleted before the press — still readable: ${still}`)
      }

      if (vanish && transcriptDir) {
        await rm(transcriptDir, { recursive: true, force: true })
        // Confirmed gone, not assumed gone. A delete that silently did nothing would make the
        // press look like a clean restore and prove the opposite of what this checks.
        let still = true
        try { await readFile(join(transcriptDir, `${sessionId}.jsonl`), 'utf8') } catch { still = false }
        console.log(`\n  transcript deleted before the press — still readable: ${still}`)
      }

      if (open !== null) {
        const went = await ask(`(async () => {
          const was = document.getElementById('switcher')?.textContent?.trim() ?? '?'
          const rows = [...document.querySelectorAll('#search-body .find__row')]
          if (rows.length === 0) return 'no results to open'
          const row = rows[${Number(open) - 1}]
          if (!row) return \`only \${rows.length} results\`
          const said = row.querySelector('.find__does')?.textContent ?? '?'
          for (const t of ['mousedown', 'click']) {
            row.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }))
          }
          await new Promise(r => setTimeout(r, 2000))
          for (const t of ['mousedown', 'click']) {
            document.getElementById('switcher')?.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }))
          }
          await new Promise(r => setTimeout(r, 700))
          const panel = document.getElementById('search-panel')
          const marked = document.querySelector('.memory__card--found')
          return [
            \`row said: \${said}\`,
            // Both halves. The project alone cannot show whether openSession landed, and the
            // conversation is the half the ordering actually decides. (No backticks in here: this
            // comment lives inside a template literal, and one would end it.)
            \`switcher: \${was} → \${document.getElementById('switcher')?.textContent?.trim() ?? '?'}\`,
            \`search panel closed: \${panel?.hidden === true}\`,
            \`memory marked: \${marked ? 'yes' : 'no'}\`,
            // Whether the conversation actually restored, which the switcher label cannot say.
            \`open tabs: \${document.getElementById('transcripts')?.children.length ?? 0} (visible \${[...(document.getElementById('transcripts')?.children ?? [])].filter(c => !c.hidden).length})\`,
            // Every tab, marked for which is fronted. One tab reading empty says nothing about
            // whether the right one is in front or whether the content simply did not load.
            // What the app itself lists as this project's conversations. If the seeded one is not
            // here, the fixture never reached the registry and nothing downstream can be read as
            // the product failing.
            \`switcher list: \${(document.getElementById('switcher-list')?.textContent ?? '(closed)').replace(/\\s+/g, ' ').trim().slice(0, 140)}\`,
            /*
             * The placeholder is kept in the DOM and hidden by CSS, so textContent starts with
             * "Nothing said in this conversation yet" even for a fully restored transcript. A
             * short slice therefore shows the empty state for both — this reported a restored
             * conversation as empty for four runs. Read what is after it.
             */
            ...[...(document.getElementById('transcripts')?.children ?? [])].map((c, i) => {
              const all = (c.textContent ?? '').replace(/\\s+/g, ' ').trim()
              const after = all.replace(/^Nothing said in this conversation yet\\.[^.]*\\.\\s*/, '')
                               .replace(/^The office is waiting\\.[^.]*\\.\\s*/, '')
              return \`tab \${i}\${c.hidden ? '' : ' (front)'}: \${after === '' ? '(genuinely empty)' : after.slice(0, 260)}\`
            }),
          ].join(' | ')
        })()`)
        console.log(`\n  opened result ${open}\n    ${went}\n`)
        // The registry as it stands after the press. If opening rewrote it, that is where a
        // restored conversation would have lost the record it needed.
        try {
          const after = JSON.parse(await readFile(join(workspace, '.office-space', 'sessions.json'), 'utf8'))
          for (const r of after.sessions ?? []) {
            console.log(`    registry: id=${r.id} project=${r.project} title=${JSON.stringify(r.title)} cwd=${r.cwd === workspace ? '<root>' : r.cwd}`)
          }
        } catch (err) {
          console.log(`    registry: could not be read — ${err.message}`)
        }
      }
    }

    if (state === 'ungated') {
      await ask(`(async () => {
        const again = [...document.querySelectorAll('button')].find(b => /Look again/i.test(b.textContent || ''))
        for (const t of ['mousedown','click']) again?.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }))
        await new Promise(r => setTimeout(r, 1500))
        return 'pressed'
      })()`)
    }
  }

  /*
   * `--pick` opens a conversation through the app's **own** switcher instead of through a
   * search result.
   *
   * The control experiment. An empty transcript after pressing a result is ambiguous between
   * this fixture being wrong and the office creating a conversation rather than resuming one —
   * the two produce the identical screen. Driving the app's own path against the same
   * conversation tells them apart: if the switcher restores it and the result does not, the
   * fault is in the result's path; if neither does, the result's path is innocent.
   */
  if (pick !== null) {
    // Escape first: the first-run panel is modal and traps focus, so a click on the switcher
    // underneath it does nothing — which would read as the switcher being broken.
    await ask(`(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await new Promise(r => setTimeout(r, 500))
      return 'escaped'
    })()`)
    const picked = await ask(`(async () => {
      for (const t of ['mousedown', 'click']) {
        document.getElementById('switcher')?.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }))
      }
      await new Promise(r => setTimeout(r, 800))
      const rows = [...document.querySelectorAll('#switcher-list [data-id], #switcher-list button, #switcher-list a')]
      const row = rows.find(r => (r.textContent || '').includes(${JSON.stringify(pick)}))
      if (!row) return 'no row matching: ' + rows.map(r => (r.textContent||'').trim().slice(0,30)).join(' | ')
      for (const t of ['mousedown', 'click']) row.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }))
      await new Promise(r => setTimeout(r, 2500))
      const front = [...(document.getElementById('transcripts')?.children ?? [])].find(c => !c.hidden)
      return 'front tab: ' + (front?.textContent ?? '(none)').replace(/\\s+/g, ' ').trim().slice(0, 90)
    })()`)
    console.log(`\n  picked via the switcher: ${pick}\n    ${picked}\n`)
  }


  /*
   * Press Put back, twice, and read the file off disk afterwards.
   *
   * Twice because the button arms on the first click and acts on the second — the same
   * confirmation the roster's Fire uses, and a driver that clicked once would report the whole
   * feature broken. What is checked is the file, not the sentence the app puts on screen: the
   * office saying it put something back is exactly the claim under test.
   */
  if (has('undo')) {
    const pressed = await ask(`(async () => {
      const b = document.querySelector('#changed-body .roster__actions button')
      if (!b) return 'no Put back button on any row'
      for (const t of ['mousedown','click']) b.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }))
      await new Promise(r => setTimeout(r, 250))
      const armed = b.textContent
      for (const t of ['mousedown','click']) b.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }))
      await new Promise(r => setTimeout(r, 1800))
      return { armed, said: document.querySelector('#said')?.textContent ?? null }
    })()`)
    seenUndo = {
      ...(typeof pressed === 'string' ? { problem: pressed } : pressed),
      /*
       * The file this state actually made. Hardcoding one name printed a confusing ENOENT for
       * `--state busy`, where the point is that *nothing* was written and the reader then has to
       * work out whether that error is the finding or the instrument.
       */
      ...(Object.hasOwn(UNDO_TARGET, state)
        ? {
            fileNow: await readFile(join(workspace, UNDO_TARGET[state]), 'utf8').catch(
              (e) => `could not read: ${e.message}`,
            ),
          }
        : { fileNow: `--undo has no file to check in --state ${state}` }),
    }
  }

  const seen = await ask(READ)
  if (has('tab')) seen.tab = await ask(TAB_ORDER)

  if (seenUndo) seen.undo = seenUndo
  if (asJson) {
    console.log(JSON.stringify(seen, null, 2))
  } else {
    console.log(`\nworkspace  ${state}  →  ${seen.workspace.root}`)
    console.log(`           ${seen.workspace.staff} staff, ${seen.workspace.skills} skills` +
      (seen.workspace.problems.length ? `, problems: ${seen.workspace.problems.join(', ')}` : ''))
    console.log('\nchrome')
    for (const [k, v] of Object.entries(seen.chrome)) {
      console.log(`  ${k.padEnd(21)} ${v === null ? '—' : v}`)
    }
    if (seen.tab) {
      console.log('\ntab order' + (seen.tab.trappedBy ? `  (trapped by ${seen.tab.trappedBy})` : ''))
      seen.tab.reaches.forEach((n, i) => console.log(`  ${String(i + 1).padStart(2)}. ${n}`))
      if (seen.tab.unreachable.length) {
        console.log(`  ${seen.tab.unreachable.length} control(s) Tab cannot reach` +
          (seen.tab.trappedBy ? ' from behind the trap' : ' at all') + `: ${seen.tab.unreachable.join(', ')}`)
      }
    }
    if (seen.undo) {
      console.log('\nundo')
      for (const [k, v] of Object.entries(seen.undo)) console.log(`  ${k.padEnd(9)} ${String(v).trim()}`)
    }
    if (seen.openPanel) {
      console.log(`\n${seen.openPanel.id}\n  ${seen.openPanel.text}`)
    }
    console.log()
  }
} catch (err) {
  console.error(`\nlook.mjs: ${err.message}\n`)
  await cleanup()
  process.exit(1)
}

await cleanup()
process.exit(0)
