/**
 * What the main-process boot actually costs, as a command rather than as a remembered number.
 *
 * ## Why this exists
 *
 * `PLAN.md` §4b justified V4's four-beat fly-in on the grounds that **"the whole main-process
 * boot is 7 ms warm, 24 ms cold, so this covers no work."** Audited 2026-09-09: no boot timer
 * existed in `scripts/`, no `performance.now` or `hrtime` anywhere in `src/main/`, and nothing in
 * `docs/retracted.md` — weak evidence, since that file only covers commit messages and source
 * comments on one branch. The figures first appear in `fbe0482`, and on `dev` in `b3e462d`, the
 * same patch under a later commit date; its "Measured before designing" is about a different
 * measurement entirely — that seven of eight modules under `src/shared/floor/` contain no pixel
 * arithmetic.
 *
 * Standing order 5 says a claim carries how you know it. This file is how you know it.
 *
 * ## What the numbers are
 *
 * **Milliseconds on `performance.now()` in the Electron main process**, absolute and unsubtracted.
 * Node documents that clock's zero as the start of the process. The #231 review measured it landing
 * about 30 ms after the binary is spawned, so that much of Electron's startup falls before zero; the
 * module graph and the rest are inside the number.
 *
 * That is not a stylistic choice. The first version of this subtracted a constant captured
 * between main's imports and called the result "since main's own module evaluation" — but ESM
 * hoists every import above every statement, so main's whole transitive graph had already
 * evaluated before that clock started. A probe timing `await import()` of the built main put that
 * at 71 and 87 ms in the #231 review, at load average 11–14, and at 21–24 ms over five runs of the
 * author's own at load 3.5. Both probes ran before #231 was rebased onto `e457bee`, which changed
 * `src/main/claude/run.ts`, a file main loads. On `cb86000`, the independent check of #231
 * measured 24.4–51.1 ms, median 27.2, at load 4.2–5.2. Why the figures differ, whether load or
 * code, was not measured. Reporting absolute time cannot have that bug: nothing between the
 * process's zero and the first mark is subtracted away.
 *
 * Four phases, so the reader picks the slice rather than trusting this file's idea of "boot":
 *
 * - `ready`          — Electron reached `app.whenReady`.
 * - `checks-done`    — everything in the `whenReady` callback before `createWindow()`: the
 *                      `OFFICE_HEADLESS` dock check (the spawn below passes on the caller's
 *                      environment, so the Dock is hidden only when the caller has
 *                      `OFFICE_HEADLESS=1`), the CSP and permission handlers, `registerHandlers()`,
 *                      finding `claude` and the themes, the workspace root, registry, shipped files
 *                      and orphans, `watchApprovals`, and then the five checks. Not the whole
 *                      callback: it carries on after `createWindow()`.
 * - `window-created` — `createWindow()` returned.
 * - `ready-to-show`  — the window can be shown.
 *
 * Each phase is the moment that point was reached, not what the work listed beside it cost; the
 * cost of the work between two phases is the interval, which the script prints too.
 *
 * `ready-to-show` is the **last** of these, which settles a question this script was once used to
 * answer wrongly: boot is not work an arrival animation can cover, because all of it is over before
 * anything the animation drew could be seen. Whatever justifies a fly-in is renderer-side work after
 * this point, which this script does not measure and should not be cited about.
 *
 * These four are the only slices it measures. A narrower one can be far smaller — the #231 review
 * timed the five checks alone at 13.5 ms — so nothing printed here says how long any stretch
 * *inside* an interval takes.
 *
 * One figure is on this script's clock instead of the child's: `spawn() → ready-to-show line`,
 * which also contains `npx` and everything before the Electron process began counting. It is
 * printed apart from the phases because the two clocks do not share a zero.
 *
 * ## Warm only
 *
 * Cold is not measured and not claimed: evicting the OS file cache needs a password this script
 * does not have, and reporting the first of N runs as "cold" would be the same move this file
 * exists to correct. The load average is printed before and after, because it moves every row.
 *
 * ## Whose environment the boot gets
 *
 * The spawn below passes this process's environment on, so `OFFICE_HEADLESS` reaches the app from
 * whoever ran this script — this file never sets it, and `scripts/look.mjs` does. `main.ts` hides
 * the Dock when it is `'1'`, so the dock check inside `checks-done` does different work on
 * different runs. Its value is printed beside the load average for the same reason the load
 * average is: without it a table quoting these numbers cannot say which run it had, and `PLAN.md`
 * once said that check was "not triggered here" about a run for which no record of the environment
 * has been found. That the spawned child receives the variable is measured; that Electron passes it
 * on to the main process's `process.env` is inferred.
 *
 * Run: `node scripts/boot-time.mjs [runs]`   (default 5). Requires `npm run build` first. It boots
 * the checkout it lives in, whichever directory it is run from.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { loadavg } from 'node:os'
import { fileURLToPath } from 'node:url'

const PHASES = ['ready', 'checks-done', 'window-created', 'ready-to-show']

/**
 * Refuse rather than report nothing.
 *
 * An earlier version took `Number(argv[2])` straight, so `boot-time.mjs abc` printed
 * "NaN warm runs", every phase "never reached", and **exited 0** — a measurement tool reporting
 * a complete-looking nothing, which is precisely the failure this file was written to prevent.
 */
function runsFrom(arg) {
  if (arg === undefined) return 5
  const n = Number(arg)
  if (!Number.isInteger(n) || n < 1) {
    console.error(`boot-time: runs must be a positive integer, got ${JSON.stringify(arg)}`)
    process.exit(2)
  }
  return n
}
const RUNS = runsFrom(process.argv[2])

// The checkout this script belongs to. The build check and the boot must look at the same tree:
// with no `cwd`, `npx electron .` would boot whatever directory this was started from while the
// check below looked here, and time somebody else's build without saying so.
const ROOT = fileURLToPath(new URL('..', import.meta.url))

// `scripts/look.mjs` builds before it boots. This deliberately does not — a build inside the
// measurement would land in the first run's numbers — so it checks instead, because Electron
// pointed at a missing `dist/` says nothing on either stream (one review saw it exit, another saw
// it keep running), which from in here looks like a hang or a crash with no reason given.
if (!existsSync(new URL('../dist/main/main.js', import.meta.url))) {
  console.error('boot-time: dist/ is missing or incomplete — run `npm run build` first.')
  process.exit(2)
}

/** One boot. Resolves to {phase: ms}; rejects loudly on crash, early exit, a missing phase, or stall. */
function boot() {
  return new Promise((resolve, reject) => {
    const started = performance.now()
    const marks = {}
    // stderr is **piped, not discarded**. It used to be `'ignore'`, with no exit handler, so a
    // child that died instantly with a syntax error was indistinguishable from one that hung:
    // a full 30-second stall, `reached: nothing`, and the reason thrown away by the script.
    const child = spawn('npx', ['electron', '.'], {
      cwd: ROOT,
      env: { ...process.env, OFFICE_BOOT_TIMING: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })

    let stderr = ''
    let exited = ''
    let settled = false
    const finish = (fn, arg) => {
      if (settled) return
      settled = true
      clearTimeout(stall)
      try { process.kill(-child.pid, 'SIGKILL') } catch { /* already gone */ }
      fn(arg)
    }

    const reached = () => Object.keys(marks).join(', ') || 'nothing'
    const stall = setTimeout(() => {
      // A process the child started can hold its pipes open after the child itself is gone, and
      // then 'close' never comes. Say that it exited, not only that the clock ran out.
      const after = exited ? `; electron exited (${exited}) but its output never closed` : ''
      finish(reject, new Error(`boot did not reach ready-to-show in 30s; reached: ${reached()}${after}`))
    }, 30_000)

    child.stderr.on('data', (c) => { stderr += c })

    // A child that ends before `ready-to-show` failed; say so with its stderr rather than waiting
    // out the timeout and blaming the clock. Decided on 'close', not 'exit': Node documents that
    // stdio may still be open when 'exit' fires, and the last thing on stderr is usually the reason.
    child.on('exit', (code, signal) => { exited = signal ? `signal ${signal}` : `code ${code}` })
    child.on('close', (code, signal) => {
      const why = exited || (signal ? `signal ${signal}` : `code ${code}`)
      finish(reject, new Error(`electron exited (${why}) before ready-to-show; reached: ${reached()}\n${stderr.trim() || '(no stderr)'}`))
    })
    child.on('error', (e) => finish(reject, e))

    let buffer = ''
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const m = /^boot-timing (\S+) ([\d.]+)$/.exec(line)
        if (m) marks[m[1]] = Number(m[2])
      }
      if (marks['ready-to-show'] === undefined) return
      // All four or none: a run missing a phase would print NaN among the intervals, or a median
      // over fewer runs than the header says it took.
      const missing = PHASES.filter((p) => marks[p] === undefined)
      if (missing.length) finish(reject, new Error(`boot reached ready-to-show without: ${missing.join(', ')}`))
      else finish(resolve, { ...marks, spawned: performance.now() - started })
    })
  })
}

const load = () => loadavg().map((x) => x.toFixed(2)).join(' ')
const loadBefore = load()
const headless = process.env['OFFICE_HEADLESS']
const runs = []
for (let i = 0; i < RUNS; i++) runs.push(await boot())
const loadAfter = load()

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const f = (n) => n.toFixed(1).padStart(8)
const head = (label, width) => `  ${label.padEnd(width)}${'median'.padStart(8)}${'min'.padStart(8)}${'max'.padStart(8)}`
const row = (label, xs, width) => `  ${label.padEnd(width)}${f(median(xs))}${f(Math.min(...xs))}${f(Math.max(...xs))}`

console.log(`main-process boot, ${RUNS} warm run${RUNS === 1 ? '' : 's'} — ms on performance.now() in the Electron main process, zero at Node's process start`)
console.log(`load average before ${loadBefore}, after ${loadAfter}`)
// JSON-quoted, like the refusal in runsFrom, so the value reads as itself: `"1 "` is not the `'1'`
// main.ts checks for, `""` is set rather than unset, and a newline in it cannot print a line that
// passes for a row below.
console.log(`${headless === undefined ? 'OFFICE_HEADLESS unset' : `OFFICE_HEADLESS=${JSON.stringify(headless)}`} in the environment passed to the boot\n`)
console.log(head('phase', 16))
for (const phase of PHASES) console.log(row(phase, runs.map((r) => r[phase]), 16))

/*
 * Intervals from the per-run differences, not by subtracting one summary from another.
 *
 * A median of differences is not the difference of medians, and the two disagree on real runs.
 * Printing the intervals here means nobody has to subtract two rows of the table above to get one.
 */
console.log(`\n${head('interval', 30)}`)
for (let i = 1; i < PHASES.length; i++) {
  console.log(row(`${PHASES[i - 1]}→${PHASES[i]}`, runs.map((r) => r[PHASES[i]] - r[PHASES[i - 1]]), 30))
}

console.log(`\n${head("on this script's clock", 30)}`)
console.log(row('spawn() → ready-to-show line', runs.map((r) => r.spawned), 30))

console.log(`\n  min is an extreme-value statistic over ${RUNS} runs and the least reproducible`)
console.log(`  column here — quote the median. Warm only; see the header.`)
