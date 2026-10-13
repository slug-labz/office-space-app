/**
 * The boot timer refuses to report nothing.
 *
 * `scripts/boot-time.mjs` is the command behind PLAN.md V4's boot figures, and its first version
 * could print a complete-looking nothing. The review of #231 found, by running it: a run count of
 * `abc` printed "NaN warm runs" and exited 0; a child that died at once looked the same as one
 * that hung, because stderr was discarded and nothing listened for the child ending; and the one
 * interval it quoted could not be derived from its own table. Each is pinned below, along with
 * the refusal to average a boot that skipped a phase.
 *
 * None of this starts Electron. The script spawns `npx electron .`, so each test puts a shell
 * script named `npx` first on PATH that prints what a boot prints, or dies the way a boot can —
 * which is exactly the part of the script under test, and none of the app.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { tempDir } from './temp-dir.js'

const SCRIPT = fileURLToPath(new URL('../scripts/boot-time.mjs', import.meta.url))

/** The stand-in for `npx` is a POSIX shell script. */
const NO_SH = process.platform === 'win32' ? 'the stand-in for npx is a POSIX shell script' : false

/**
 * A copy of the script in a directory of its own, so both its `../dist/main/main.js` check and
 * the `npx` it spawns belong to the test. `npx` is the stand-in's body, or null for none at all.
 */
async function aCopy(t: TestContext, npx: string | null, built = true): Promise<string> {
  const root = await tempDir(t, 'office-boot-time-')
  await mkdir(join(root, 'scripts'))
  await copyFile(SCRIPT, join(root, 'scripts', 'boot-time.mjs'))
  if (built) {
    await mkdir(join(root, 'dist', 'main'), { recursive: true })
    await writeFile(join(root, 'dist', 'main', 'main.js'), '')
  }
  if (npx !== null) {
    await mkdir(join(root, 'bin'))
    await writeFile(join(root, 'bin', 'npx'), `#!/bin/sh\n${npx}\n`)
    await chmod(join(root, 'bin', 'npx'), 0o755)
  }
  return root
}

function run(root: string, args: string[] = [], env: Record<string, string | undefined> = {}): { code: number | null; stdout: string; stderr: string; ms: number } {
  const started = performance.now()
  // `undefined` deletes rather than being stringified to "undefined": the test that wants
  // OFFICE_HEADLESS absent has to be able to say so, whatever the runner's own environment holds.
  const childEnv: NodeJS.ProcessEnv = { ...process.env, PATH: `${join(root, 'bin')}:${process.env['PATH'] ?? ''}`, BOOT_COUNT: join(root, 'count'), ...env }
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete childEnv[k]
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'boot-time.mjs'), ...args], {
    cwd: root,
    env: childEnv,
    encoding: 'utf8',
    timeout: 45_000,
  })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, ms: performance.now() - started }
}

test('a run count that is not a positive integer is refused, not measured as nothing', async (t) => {
  const root = await aCopy(t, null)
  for (const bad of ['abc', '0', '-1', '2.5', '']) {
    const r = run(root, [bad])
    assert.equal(r.code, 2, `runs=${JSON.stringify(bad)} exited ${r.code}\n${r.stdout}${r.stderr}`)
    assert.match(r.stderr, /runs must be a positive integer/)
    assert.equal(r.stdout, '', `runs=${JSON.stringify(bad)} printed something that reads like a result`)
  }
})

test('with nothing built it says so, rather than waiting out a boot that cannot happen', async (t) => {
  const root = await aCopy(t, 'exit 0', false)
  const r = run(root, ['1'])
  assert.equal(r.code, 2, r.stdout + r.stderr)
  assert.match(r.stderr, /dist\/ is missing/)
})

test('a boot that dies early fails at once, with its own stderr as the reason', { skip: NO_SH }, async (t) => {
  // The reason is written a moment after the exit, by a process that outlives the one exiting, so
  // it is still on its way when 'exit' fires. Deciding on 'exit' loses it; deciding on 'close'
  // waits for it. Written without that delay, this passed against both — 20 of 20 in the #231 review.
  const root = await aCopy(t, [
    'echo "boot-timing ready 12.00"',
    '(sleep 0.3; echo "Error: Cannot find module ./gone.js" >&2) &',
    'exit 3',
  ].join('\n'))
  const r = run(root, ['1'])
  assert.notEqual(r.code, 0, r.stdout)
  assert.match(r.stderr, /electron exited \(code 3\) before ready-to-show; reached: ready/)
  assert.match(r.stderr, /Cannot find module \.\/gone\.js/, 'the reason the child gave is in the report')
  assert.ok(r.ms < 10_000, `took ${Math.round(r.ms)} ms — it waited out the 30 s stall instead of hearing the exit`)
})

test('a boot that reaches ready-to-show without every phase is refused, not averaged', { skip: NO_SH }, async (t) => {
  const root = await aCopy(t, [
    'echo "boot-timing ready 12.00"',
    'echo "boot-timing window-created 40.00"',
    'echo "boot-timing ready-to-show 55.00"',
    'exec sleep 30',
  ].join('\n'))
  const r = run(root, ['1'])
  assert.notEqual(r.code, 0, r.stdout)
  assert.match(r.stderr, /reached ready-to-show without: checks-done/)
})

test("the boot inherits the caller's OFFICE_HEADLESS, and the run says which it had", { skip: NO_SH }, async (t) => {
  // The dock check inside `checks-done` acts only when the app sees OFFICE_HEADLESS=1, and this
  // script never sets it — it passes the caller's environment on. A run that does not print which
  // it had cannot be quoted about that check later. PLAN.md's boot table once called the check "not
  // triggered here" about a run for which no record of the environment has been found.
  const npx = [
    'echo "OFFICE_HEADLESS=[${OFFICE_HEADLESS-<unset>}]" > seen',
    'echo "boot-timing ready 10.00"',
    'echo "boot-timing checks-done 20.00"',
    'echo "boot-timing window-created 30.00"',
    'echo "boot-timing ready-to-show 40.00"',
    'exec sleep 30',
  ].join('\n')
  // The stand-in writes `seen` in its own cwd, which is the copy's root: the script spawns the
  // boot with `cwd: ROOT`, so what that file holds is what the boot itself was handed.
  const seen = (root: string) => readFile(join(root, 'seen'), 'utf8')

  // Each value is here for a way of printing it wrongly: '0' is what `=== '1'` would call unset, ''
  // is what a truthiness check would, and a newline is how an unquoted value could print a line that
  // passes for a row of the table.
  const cases = [
    ['1', 'OFFICE_HEADLESS="1"'],
    ['0', 'OFFICE_HEADLESS="0"'],
    ['', 'OFFICE_HEADLESS=""'],
    ['1\n  ready 0.0', 'OFFICE_HEADLESS="1\\n  ready 0.0"'],
    [undefined, 'OFFICE_HEADLESS unset'],
  ] as const
  for (const [value, printed] of cases) {
    const label = value === undefined ? 'unset' : JSON.stringify(value)
    const root = await aCopy(t, npx)
    const r = run(root, ['1'], { OFFICE_HEADLESS: value })
    assert.equal(r.code, 0, `${label}: ${r.stderr}`)
    assert.ok(r.stdout.split('\n').includes(`${printed} in the environment passed to the boot`), `${label} was printed as:\n${r.stdout}`)
    assert.equal(await seen(root), `OFFICE_HEADLESS=[${value ?? '<unset>'}]\n`, `${label}: the boot was not handed what the caller had`)
  }
})

test('an interval is the median of per-run differences, not one median minus another', { skip: NO_SH }, async (t) => {
  // Three boots whose ready→checks-done gaps are 10, 40 and 5 ms, so the median gap is 10. The
  // medians of the two phases are 20 and 35: subtracting them gives 15, a gap no run had.
  const root = await aCopy(t, [
    'n=$(cat "$BOOT_COUNT" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$BOOT_COUNT"',
    'case "$n" in 1) r=10; c=20;; 2) r=20; c=60;; *) r=30; c=35;; esac',
    'echo "boot-timing ready $r"',
    'echo "boot-timing checks-done $c"',
    'echo "boot-timing window-created $((c + 10))"',
    'echo "boot-timing ready-to-show $((c + 20))"',
    'exec sleep 30',
  ].join('\n'))
  const r = run(root, ['3'])
  assert.equal(r.code, 0, r.stderr)
  const row = (label: string) => r.stdout.split('\n').find((l) => l.trimStart().startsWith(label)) ?? ''
  assert.match(row('ready '), /\s20\.0\s+10\.0\s+30\.0$/)
  assert.match(row('checks-done '), /\s35\.0\s+20\.0\s+60\.0$/)
  assert.match(row('ready→checks-done'), /\s10\.0\s+5\.0\s+40\.0$/, 'the median of the gaps, not 35 − 20')
})
