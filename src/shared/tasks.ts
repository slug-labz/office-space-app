/**
 * Reading a project's task list.
 *
 * `CLAUDE.md` says every dispatched task carries a VERIFY condition and that the harness checks
 * it — that a task is done when the check passes, not when somebody says it is. Until now there
 * was no harness, so the office's second standing order was prose. This is the half that reads
 * what has to be checked.
 *
 * The format is the one `projects/_TEMPLATE/TASKS.md` ships: markdown tables under `## In
 * progress`, `## Queued` and `## Done`, with a VERIFY column written the way a person writes
 * it — a command in backticks and some prose around it.
 *
 * ## Two things kept apart
 *
 * The **condition** is what a person wrote: "`npm test` exits 0". The **command** is the part
 * a machine can run. They are different, and a condition with no runnable command in it is a
 * real state that has to be reported rather than treated as passing or failing — an office
 * that silently ignores the tasks it cannot check would be worse than one with no harness,
 * because it would look like it had one.
 *
 * ## Hand-edited, so forgiving
 *
 * These files are written by people and by agents, and will be malformed. A row that cannot be
 * read is counted and reported, never dropped: a task list that quietly loses a row is a task
 * list that says work is finished when it is not.
 */

export type TaskState = 'in-progress' | 'queued' | 'done'

export interface Task {
  /** The number in the first column, as written. Not assumed unique. */
  readonly ref: string
  readonly title: string
  /** Which employee owns it. Matches a name on the floor when it is one of the staff. */
  readonly owner: string
  /** The VERIFY column, verbatim — what a person wrote. */
  readonly condition: string
  /**
   * The runnable part, pulled from the first backticked span.
   *
   * Null when the condition names no command. That is a task nobody can check automatically,
   * and saying so is the point — it must not read as passing.
   */
  readonly command: string | null
  readonly state: TaskState
}

export interface TaskList {
  readonly tasks: readonly Task[]
  /** Rows that looked like tasks and could not be read. Counted, never silently dropped. */
  readonly unreadable: number
  /**
   * Headings that hold what looks like a task table and are not one of ours.
   *
   * Rows outside a recognised section are skipped, and the reason is good: `TASKS.md` holds prose
   * and other tables, and counting every table row in the document as a lost task would be noise.
   *
   * But there is a gap between *a row in some other table* and **somebody's task list under a
   * heading we do not know**. Measured: a file of three hundred `| 1 | … | … | … |` rows under
   * `## Backlog` produced *"0 tasks · none outstanding"* and *"No tasks written down yet."* — the
   * office reporting a full file as an empty one, which is the fourth standing order on the
   * surface that answers "what is left to do".
   *
   * So the narrow case is named rather than guessed at. A row is only counted here if it is under
   * an unrecognised `##` heading, has four or more cells, and **starts with a number** — the ref
   * column the convention uses. A configuration table under `## Settings` does not qualify, which
   * is the false positive worth avoiding.
   *
   * The headings themselves, not a count, because the fix is to rename one and a number does not
   * say which.
   */
  readonly unrecognised: readonly string[]
}

const HEADINGS: Readonly<Record<string, TaskState>> = {
  'in progress': 'in-progress',
  queued: 'queued',
  done: 'done',
}

/** Split a markdown table row into trimmed cells. */
function cells(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) return []
  return trimmed
    .slice(1, trimmed.endsWith('|') ? -1 : undefined)
    .split('|')
    .map((c) => c.trim())
}

/** True for the `|---|---|` rule under a table's header. */
function isRule(row: readonly string[]): boolean {
  return row.length > 0 && row.every((c) => /^:?-{2,}:?$/.test(c))
}

/**
 * A VERIFY written as an outcome rather than a check — *"PASS — I read the file and it looks
 * right"*.
 *
 * `CLAUDE.md` names this as the thing its second standing order exists to refuse, and until now
 * nothing noticed it: a verdict with a backticked span in it reads as a command, and one without
 * reads as an honest *uncheckable*. The session log for 2026-08-19 records finding exactly this
 * in `projects/random/TASKS.md`, by hand.
 *
 * **Only a verdict word at the start.** Measured on 2026-09-24 (`PLAN.md` §4c) against 85 VERIFY
 * cells — 74 real, from 62 task files, plus 12 invented verdicts: it caught 10 of the 13 verdicts,
 * the only real one among them, and flagged none of the other 72. What it misses is a verdict
 * with no verdict word — *"The tests pass"* — and that miss is chosen. A hosted model caught
 * those three and flagged six honest cells doing it, and a warning that fires on honest cells is
 * one somebody stops reading. Widening this list changes those numbers, so measure before you do.
 *
 * Advisory, and deliberately nothing more. It does not change what runs or which of the six
 * outcomes a task is in; it says what the cell is, so the person who wrote it can fix it.
 */
export function isVerdict(condition: string): boolean {
  return /^\s*[*_]*(pass|fail|ok|done|verified|confirmed|complete|works)\b/i.test(condition)
}

/**
 * The runnable part of a VERIFY condition.
 *
 * The first backticked span, because that is how the convention writes it and how people write
 * it anyway. Anything else in the cell is the human explanation and is kept as the condition.
 */
export function commandIn(condition: string): string | null {
  const match = /`([^`]+)`/.exec(condition)
  const command = match?.[1]?.trim()
  if (!command) return null
  // A path is not a command, and this one had never been caught because nothing ran the harness
  // against a real project until 2026-08-20. `coming-soon` task 1 reads:
  //
  //     `site/index.html` exists; `grep -Ei '...' site/index.html` returns no matches
  //
  // The first backticked span is a **file**. The office took it as the command, the policy
  // declined it — correctly, nothing authorises running an HTML file — and the task reported
  // `not-run`, which reads as *the workspace would not let us*. The truth is *that was never a
  // command*, and the two are different facts the fourth standing order says not to merge.
  return isBarePath(command) ? null : command
}

/**
 * A single token naming a file rather than a program.
 *
 * Deliberately narrow. `./build.sh`, `/usr/bin/true` and `$SHELL` are invocations and stay
 * commands; `npm test` has a space and never reaches here. What this catches is the shape people
 * actually write when they mean *"this file should exist"* — `site/index.html`, `dist/app.js` —
 * which is a claim about the filesystem written in the column that runs programs.
 */
function isBarePath(command: string): boolean {
  if (/\s/.test(command)) return false
  if (/^[.~/$]/.test(command)) return false
  const last = command.split('/').pop() ?? ''
  return /\.[a-z0-9]+$/i.test(last)
}

/**
 * A test run whose files the office could not look for, and why.
 *
 * The runner still runs them, or does not, as it decides. This says only that nothing looked, so
 * that a pass is not read as a pass that did.
 */
export interface Unchecked {
  /** The run's runner, or `null` for `unread`, which is text holding `--test` rather than a run. */
  readonly runner: 'tsx' | 'node' | null
  /**
   * - `moves`: the command has a `cd`, `pushd` or `popd` in it, as a word or inside quoted text,
   *   once quotes and backslashes are off (`\cd`, `'cd'`, `eval "cd app"`), or GNU `env -C`. The
   *   office does not work out which folder that leaves the runner in.
   * - `workspace`: npm is told to use a workspace: by an option (`npx -w app`, `--w=app`,
   *   `--workspaces`), or by a word anywhere in the command that names `npm_config_workspace` or
   *   `npm_config_workspaces` (`export npm_config_workspace=app;`). That can start the runner in
   *   the workspace's own folder.
   * - `prefix`: a word before the runner in its command that is not known to start it in the same
   *   folder with the words written after it: `pnpm`, `xargs`, `find`, `docker`, or a program that
   *   does not run it at all.
   * - `taken`: `npm exec` takes this option for itself, because no `--` came before it.
   * - `quoted`: the runner is inside text a shell runs as a command, `sh -c "node --test a"`, which
   *   is not read.
   * - `rewritten`: a word the shell or the runner may read as something other than what is written,
   *   a brace in it that is not a plain list (`{a..c}`, `{a}`), or an unquoted brace in an option.
   * - `flag`: an option this does not know: npm's, before the runner, or the runner's own, with a
   *   word after it that may be its value, or `--test=…`.
   * - `excluded`: a file in the `node_modules` folder of the folder the runner starts in, which the
   *   runner leaves out (`inModules`).
   * - `unread`: `--test` is in the command outside every run read here, and `node` or `tsx` is in
   *   the command too, anywhere and in any case. In quoted text nothing is known to run
   *   (`echo "node --test done"`), in `"$(…)"` or backticks, in a comment, in words after one that
   *   stopped the reading, in a script's own arguments, or on a line this could not split.
   */
  readonly reason:
    | 'moves'
    | 'workspace'
    | 'prefix'
    | 'taken'
    | 'quoted'
    | 'rewritten'
    | 'flag'
    | 'excluded'
    | 'unread'
  /** What in the command made it so, as written: `cd`, `-w`, `pnpm`, `"$FILE"`, `--foo`, text. */
  readonly word: string
}

/** A test runner a VERIFY command calls, and the test files it hands that runner. */
export interface TestRun {
  /** `tsx` or `node`; `null` only for an `unread` entry, which is text holding `--test`, not a run. */
  readonly runner: 'tsx' | 'node' | null
  /**
   * The files to look for, as the runner receives them: relative to the folder the command runs
   * in, unless absolute. Empty when `unchecked` is set, so a caller that reads only this never
   * looks for a word it could not place.
   */
  readonly files: readonly string[]
  /** Why this run's files could not be read, or `null` when they could. */
  readonly unchecked: Unchecked | null
}

/**
 * Options that take a value: every one `node --help` prints with `=...` (Node 22.16.0), and
 * `--print`, which it prints with ` [...]`, and tsx 4.23.12's `--tsconfig` (`tsx --help`).
 * Written as its own word, one of these takes the next word.
 * Measured on 2026-09-17: `node --test --test-reporter spec a.test.mjs` printed the spec reporter's
 * output and did not run a test file named `spec` that was there.
 */
const VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--allow-fs-read', '--allow-fs-write', '--build-snapshot-config', '-C', '--conditions',
  '--cpu-prof-dir', '--cpu-prof-interval', '--cpu-prof-name', '--debug-port', '--diagnostic-dir',
  '--disable-proto', '--disable-warning', '--dns-result-order', '-e', '--env-file',
  '--env-file-if-exists', '--eval', '--experimental-config-file', '--experimental-default-type',
  '--experimental-loader', '--experimental-sea-config', '--experimental-test-isolation',
  '--heap-prof-dir', '--heap-prof-interval', '--heap-prof-name', '--heapsnapshot-near-heap-limit',
  '--heapsnapshot-signal', '--icu-data-dir', '--import', '--input-type', '--inspect-port',
  '--inspect-publish-uid', '--loader', '--localstorage-file', '--max-http-header-size',
  '--network-family-autoselection-attempt-timeout', '--openssl-config', '-p', '--print', '-r',
  '--redirect-warnings', '--report-dir', '--report-directory', '--report-filename',
  '--report-signal', '--require', '--run', '--secure-heap', '--secure-heap-min', '--snapshot-blob',
  '--test-concurrency', '--test-coverage-branches', '--test-coverage-exclude',
  '--test-coverage-functions', '--test-coverage-include', '--test-coverage-lines',
  '--test-name-pattern', '--test-reporter', '--test-reporter-destination', '--test-shard',
  '--test-skip-pattern', '--test-timeout', '--title', '--tls-cipher-list', '--tls-keylog',
  '--trace-event-categories', '--trace-event-file-pattern', '--trace-require-module',
  '--tsconfig', '--unhandled-rejections', '--use-largepages', '--v8-pool-size', '--watch-path',
])

/**
 * Options that take no value: every other one `node --help` prints (Node 22.16.0), counting the
 * three that take one only after `=` (`--inspect`, `--inspect-brk`, `--inspect-wait`), and tsx's
 * `--no-cache`. Node also reads `--no-` before any of these, and `_` for `-` in a long option
 * (measured: `--no-test-only`, and `--test_reporter spec`).
 */
const BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  '--abort-on-uncaught-exception', '--allow-addons', '--allow-child-process', '--allow-wasi',
  '--allow-worker', '--build-snapshot', '-c', '--check', '--completion-bash', '--cpu-prof',
  '--disable-sigusr1', '--disable-wasm-trap-handler', '--disallow-code-generation-from-strings',
  '--enable-etw-stack-walking', '--enable-fips', '--enable-network-family-autoselection',
  '--enable-source-maps', '--entry-url', '--experimental-async-context-frame',
  '--experimental-default-config-file', '--experimental-eventsource',
  '--experimental-import-meta-resolve', '--experimental-network-inspection',
  '--experimental-permission', '--experimental-print-required-tla', '--experimental-strip-types',
  '--experimental-test-coverage', '--experimental-test-module-mocks',
  '--experimental-transform-types', '--experimental-vm-modules', '--experimental-wasm-modules',
  '--experimental-webstorage', '--expose-gc', '--force-context-aware', '--force-fips',
  '--force-node-api-uncaught-exceptions-policy', '--frozen-intrinsics', '-h', '--heap-prof',
  '--help', '--huge-max-old-generation-size', '-i', '--insecure-http-parser', '--inspect',
  '--inspect-brk', '--inspect-wait', '--interactive', '--interpreted-frames-native-stack',
  '--jitless', '--no-addons', '--no-cache', '--no-deprecation', '--no-experimental-detect-module',
  '--no-experimental-fetch', '--no-experimental-global-customevent',
  '--no-experimental-global-navigator', '--no-experimental-global-webcrypto',
  '--no-experimental-repl-await', '--no-experimental-require-module', '--no-experimental-sqlite',
  '--no-experimental-websocket', '--no-extra-info-on-fatal-exception',
  '--no-force-async-hooks-checks', '--no-global-search-paths', '--no-network-family-autoselection',
  '--no-warnings', '--node-memory-debug', '--openssl-legacy-provider', '--openssl-shared-config',
  '--pending-deprecation', '--permission', '--preserve-symlinks', '--preserve-symlinks-main',
  '--prof', '--prof-process', '--report-compact', '--report-exclude-env',
  '--report-exclude-network', '--report-on-fatalerror', '--report-on-signal',
  '--report-uncaught-exception', '--test', '--test-force-exit', '--test-only',
  '--test-update-snapshots', '--throw-deprecation', '--tls-max-v1.2', '--tls-max-v1.3',
  '--tls-min-v1.0', '--tls-min-v1.1', '--tls-min-v1.2', '--tls-min-v1.3', '--trace-atomics-wait',
  '--trace-deprecation', '--trace-env', '--trace-env-js-stack', '--trace-env-native-stack',
  '--trace-exit', '--trace-promises', '--trace-sigint', '--trace-sync-io', '--trace-tls',
  '--trace-uncaught', '--trace-warnings', '--track-heap-objects', '--use-bundled-ca',
  '--use-openssl-ca', '--use-system-ca', '-v', '--v8-options', '--version', '--watch',
  '--watch-preserve-output', '--zero-fill-buffers',
])

/**
 * Whether a runner option takes a value, by its name alone (`--test-reporter`, not
 * `--test-reporter=spec`). `null` for one this does not know: a V8 option, one a later Node added,
 * a typo. Nothing is known about the word after that.
 */
export function flagKind(flag: string): 'value' | 'boolean' | null {
  const name = flag.startsWith('--') ? flag.replace(/_/g, '-') : flag
  if (VALUE_FLAGS.has(name)) return 'value'
  if (BOOLEAN_FLAGS.has(name)) return 'boolean'
  return name.startsWith('--no-') && BOOLEAN_FLAGS.has(`--${name.slice(5)}`) ? 'boolean' : null
}

/**
 * A glob. The shell or the runner expands it, and what it matched is not written down. The runner
 * reads every file it is given as a pattern, extended ones too: measured on 2026-09-17,
 * `node --test 'x+(y).test.mjs'` ran no test though a file of that name was there, and exited 0.
 *
 * A brace is not one: a brace list names its files whether or not they are there (`braceList`).
 */
const GLOB = /[*?[\]]|[+@!]\(/

/**
 * The most words a brace list may spread into here, so that a word written to be large cannot make
 * the office spend its time on it. A word that would spread into more is left unread (`rewritten`).
 */
const BRACE_WORDS = 64

/** Words that change directory, so a runner after one may not start where the command did. */
const MOVES: ReadonlySet<string> = new Set(['cd', 'pushd', 'popd'])

/**
 * `tsx` or `node`: bare, by path, or with an npm version (`tsx@4.23.12`), in any case. macOS's disk
 * finds a program whatever case its name is written in: measured on 2026-09-17, `Node --test a
 * missing` and `TSX --test a missing` each ran `a` and exited 0.
 */
const RUNNER = /^(?:.*\/)?(tsx|node)(?:@[^/\s]+)?$/i

/**
 * `--test`, or `--test=…`, as a word of its own: the character on each side of it is not a letter,
 * a digit, `_` or `-`, or there is none. So `--test-name-pattern`, `--tests`, `--testing` and
 * `--test_only` are other words, and `--test` in `"--test"`, `--foo=--test`, `$(--test` and
 * `` `--test` `` is this one. Matched in each of a word's `readings`, where quotes and backslashes
 * are already off.
 */
const TEST_WORD = /(?<![\w-])--test(?![\w-])/

/**
 * `node` or `tsx` anywhere, even inside a longer word, in any case: in `/usr/bin/node`,
 * `tsx@4.23.12`, `$NODE`, `nodejs`, `node22`, `${NODE_BIN}`, `ELECTRON_RUN_AS_NODE`, `nodemon` and
 * `node_modules`. Measured on 2026-09-17: `nodejs`, `node22` and `node-22` (links to Node 22.16.0),
 * `$NODE_BIN` and `ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron` each ran a test file and
 * skipped a missing one, and exited 0. A command that names neither is some other program's, and
 * its `--test` is said nothing about: `cargo test --test integration`.
 */
const RUNNER_WORD = /node|tsx/i

/** What separates words in text a shell may run: blanks, `;`, `&`, `|`, parentheses, `<`, `>` and backticks. */
const SEPARATORS = /[\s;&|()<>`]+/

/** A name npm reads its workspace setting from, when the environment has it. */
const WORKSPACE_VARIABLE = /(?<!\w)npm_config_workspaces?(?!\w)/i

/** A word the shell takes as a variable assignment when it comes before the command's name. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/**
 * GNU env's `-C dir` and `--chdir=dir`, which its manual says change directory; not measured, as the
 * env macOS ships has neither (measured: "illegal option -- C").
 */
const CHDIR = /^(?:-C|--chdir(?:=|$))/

/**
 * Shells that run the word after `-c` as a command, in any case, as a program is found (`RUNNER`).
 * Measured on 2026-09-17: `sh`, `bash`, `dash` and `ksh` each ran `node --test a missing` given as
 * `-c` text, after `+o posix` and `--norc` too, and exited 0.
 */
const SHELLS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])

/**
 * The npm options that leave `npx`, and `npm exec` or `npm x`, starting the runner in the folder the
 * command is in and handing it the words written after it. Keyed by the name npm reads: leading
 * dashes off, the part before any `=`, and a short name expanded (`NPM_SHORT`).
 *
 * Read from npm 10.9.2, the version Node 22.16.0 bundles (the `version` in its
 * `lib/node_modules/npm/package.json`): `bin/npx-cli.js`, `@npmcli/config`'s definitions and
 * shorthands, and nopt 8.0.0. Measured on 2026-09-17 with that npm, each option here left the
 * runner under the test runner: `npx --yes node --test a b` ran `a` under it, and so did `-y`,
 * `--no-install`, `--offline`, `--prefer-offline`, `--ignore-scripts`, `--quiet`, `-q`,
 * `--cache x`, `--prefix <dir>`, `-C <dir>`, `--package tsx`, `npx -p tsx`, `--loglevel=warn`,
 * `--package=tsx` and `--yes=true`.
 *
 * - `boolean`: takes no value, or `=true` or `=false`, which nopt reads as its value. nopt leaves
 *   any other value after `=` as a word of its own, and that word becomes the program (read).
 * - `switch`: takes no value, and none after `=`: `--quiet` and `-q` are npm's `--loglevel warn`,
 *   and `npx` leaves a value written after them as a word of its own (read in `bin/npx-cli.js`).
 * - `value`: takes the text after `=`, or the next word. A next word that starts with `-` is not
 *   passed over: `npx` does not take one as the value of `--prefix` or `--loglevel`, and nopt
 *   does (read), so the two disagree about what follows.
 *
 * An option that is not here, after the name is read that way, is never passed over, whatever it
 * looks like: its run is not read (`flag`). `npx` takes the word after an option it does not know
 * as that option's value, and npm then takes the runner's options: `npx --foo node --test a b` and
 * `npx --no node --test a b` each ran `a` as a plain script, with `b` as its argument (measured).
 * So did `npx -yq node --test a b`, whose `-yq` nopt reads as `-y -q` and `npx` does not, and
 * `npx --offl node --test a b`, an abbreviation of `--offline` that nopt expands and `npx` does not
 * (both measured). An abbreviation is not expanded here either, and is an option this does not know.
 */
type NpmOption = 'boolean' | 'switch' | 'value'

const NPM_OPTIONS: ReadonlyMap<string, NpmOption> = new Map<string, NpmOption>([
  ['yes', 'boolean'],
  ['offline', 'boolean'],
  ['prefer-offline', 'boolean'],
  ['ignore-scripts', 'boolean'],
  ['no-install', 'switch'],
  ['quiet', 'switch'],
  ['q', 'switch'],
  ['package', 'value'],
  ['prefix', 'value'],
  ['cache', 'value'],
  ['loglevel', 'value'],
])

/**
 * npm's short names for the options read here, from `@npmcli/config`'s shorthands in npm 10.9.2:
 * `-C` is `--prefix`, `-w` `--workspace`, `-ws` `--workspaces`, `-c` `--call`. `npx` reads `-p` as
 * `--package` (`bin/npx-cli.js`), and `npm` as `--parseable`, which is not listed. npm's other short
 * names are left as written, and so are options this does not know.
 */
const NPM_SHORT: ReadonlyMap<string, string> = new Map<string, string>([
  ['y', 'yes'],
  ['C', 'prefix'],
  ['w', 'workspace'],
  ['ws', 'workspaces'],
  ['c', 'call'],
])

/**
 * The test runs a VERIFY command makes with `tsx --test` or `node --test`, and the files each names.
 *
 * Both runners run the files they are given that exist, skip a missing one without a word, and
 * exit 0 if the rest pass; each fails only when none of its files exist. Measured on 2026-09-17
 * with Node 22.16.0 and tsx 4.23.12, `tsx --test a b` with `b` missing printed `# tests 1`,
 * `# pass 1`, exited 0 and never named `b`; `node --test a b` on Node 24.3.0 exited 0 the same way.
 * So the harness reads which files a run names, and `verify.ts` checks that they are there. Pure, so
 * the renderer can reach the same answer.
 *
 * The command is split as the shell splits it (`commandsIn`): quotes keep a word together, `$'…'`
 * too with its backslashes, and so does a `$(…)`, `${…}` or backtick inside double quotes, and a
 * `${…}` outside them, with quotes of its own; a newline, `;`, `&`, `|` or a parenthesis ends a
 * command; a redirection goes with its target and with a descriptor written against it (`2>&1`) and
 * the command goes on after it; and a `#` that starts a word starts a comment. A quote that never
 * closes is a syntax error, and the shell runs none of the line (measured: exit 2, and an `echo`
 * before the quote printed nothing). So a line this cannot split has no runs, only the `unread` note
 * below, which `runVerify` keeps after an exit 0 alone: a line the shell refused cannot give one,
 * and one the shell reads another way can (measured: `node --test a missing; cat <<EOF`, then a line
 * `it's` and a line `EOF`, ran `a` and exited 0; the office does not read a here-document).
 *
 * **A run is read only when nothing before its runner could move it or change its words.** Every
 * word before `tsx` or `node` in its command has to be one known to start it in the same folder,
 * handing it the words written after it:
 *
 * - variable assignments, `FOO=1 node …`;
 * - `env`, `time`, `nice`, `command` and `exec`, with the options `WRAPPERS` lists;
 * - `npx`, and `npm exec` or `npm x`, with the options `NPM_OPTIONS` lists.
 *
 * Anything else there leaves the run unread, with that word as the reason: `pnpm`, `yarn`,
 * `xargs`, `find … -exec`, `docker`, `ssh`, an option not listed, or a program that never runs
 * what follows. Measured on 2026-09-17: `pnpm --filter app exec`, `pnpm -r exec`, `pnpm -C app
 * exec` and `pnpm --dir app exec` (pnpm 11.22.0) before `node --test test/a.test.mjs
 * test/b.test.mjs` ran both files in `app/` and exited 0, and `find test -name a.test.mjs -exec
 * node --test {} +` and `echo test/a.test.mjs | xargs node --test` each ran the file and exited 0.
 * Read as written, each named files that are not in the folder the command starts in, or `+`.
 *
 * Then the run's words are read the way the runner reads them:
 *
 * - **An option that takes a value takes the next word**, `--test-reporter spec`, and one that
 *   takes none leaves it (`flagKind`).
 * - **A word before `--test` is a script**, and the words after it are its own arguments:
 *   `node scripts/check.mjs --test unit` is not a test run. Nor is `node -- --test a`, whose `--`
 *   makes `--test` the script (measured: a module named `--test` was not found, exit 1).
 * - **After `--test`, the first word that is not an option is a file, and so is every word after
 *   it**, a flag or a `--` too, except a glob (`GLOB`), which is left to whatever expands it.
 *   The options end at the first file, as they end at a script. Measured: `node --test none.test.mjs
 *   --test-reporter=spec` could not find `none.test.mjs, --test-reporter=spec` (exit 1, on Node
 *   22.16.0 and 24.3.0), and `node --test x.test.mjs --test-reporter spec` printed TAP and ran a
 *   test file named `spec`. A bare `-` is a file too: `node --test - a.test.mjs` ran `a` and exited
 *   0 (measured), so the runner skipped `-` as it skips a missing file.
 * - **A brace list is its files** (`braceList`): `test/{a,never}.test.mjs` is `test/a.test.mjs` and
 *   `test/never.test.mjs`, each looked for. The shell spreads it whatever is there, and so does the
 *   runner's own pattern reading when it is quoted: measured on 2026-09-17, `node --test
 *   test/{a,never}.test.mjs` and `node --test 'test/{a,never}.test.mjs'` each ran `a` and exited 0,
 *   and `node --test 'test/{never,nope}.test.mjs'` could not find it (exit 1), so the runner does not
 *   take a brace for a glob. A brace that is not part of a plain list (`{a..c}`, `{a}`, a list in a
 *   list, an empty choice) leaves the run unread (`rewritten`), and so does an unquoted brace in an
 *   option or its value, which the shell may make into more words.
 * - **A file in `node_modules` leaves the run unread** (`excluded`, `inModules`): the runner leaves
 *   it out without a word.
 * - **Only `--test` itself starts a test run.** `--test=true` does start the runner, but the process
 *   it runs each file in skips it: measured on Node 22.16.0, `node --test=true fails.test.mjs`
 *   printed `# pass 1` and exited 0 for a file whose one test throws. So a run with `--test=…` in it
 *   is not read.
 * - **A word is read with its quotes taken off**: `"test/a.test.ts"` is `test/a.test.ts`, and
 *   `'$HOME'` is `$HOME`.
 *
 * `npm exec` takes every option before its first `--` for itself, after the runner too, and drops
 * that `--`; `npx` hands everything after the runner on. Both measured with npm 10.9.2:
 * `npm exec tsx --test a b` ran `a` as a script, `npm exec tsx -- --test a b` ran it under the
 * test runner, and `npx tsx -- --test a` looked for a module named `--test`. A second `--` before
 * the runner is npm's program, and nothing ran: `npx -- -- node --test a missing` and
 * `npm exec -- -- node --test a missing` each exited 1 with no test run (measured).
 *
 * A run that cannot be read that way still comes back, with no files and `unchecked` saying why, so
 * a caller never calls a word missing that it could not place:
 *
 * - **Any `cd`, `pushd` or `popd`, or GNU `env -C`**: a word that is one, or that holds one in
 *   quoted text, in any of its `readings`. Measured on 2026-09-17: `\cd app`,
 *   `'cd' app`, `"cd" app`, `c\d app`, `$'cd' app` and `eval "cd app"`, each before `&& node --test
 *   test/a.test.mjs test/b.test.mjs`, ran both files in `app/`. Even a `cd` that is only an
 *   argument counts, which can only cost a check, never fail one. A run's own reason, below, is said
 *   before this one.
 * - **npm told to use a workspace**, by `-w`, `--workspace`, `--workspaces` or a word that names
 *   `npm_config_workspace` (`workspaceSetting`), measured to run in the workspace's folder
 *   (`npmStart`).
 * - **A word before the runner that is not known to leave it alone**, as above; or an option
 *   `npm exec` takes for itself.
 * - **A runner inside text a shell runs**: the word after `sh -c` or `bash -c`, the words after
 *   `eval`, or `npx -c '…'`, `npm exec --call='…'` and `npx --c='…'` when `npmStart` reaches them.
 *   Nothing is read inside it, and what it holds is found by reading it as a command, with its own
 *   notes. A `sh -c` that `npx` or `npm exec` starts is not known to be a shell (`Start.npm`), and
 *   is a word before the runner like any other.
 * - **A word the shell may change**, anywhere in the run: a `$` or a backtick outside single
 *   quotes, a backslash it takes off, or a leading `~`. What it becomes, or how many words, is not
 *   written down. So is **a file with a backslash in it**, which the runner reads as `/`.
 * - **An option this does not know, written without `=` and followed by a word**: that word may be
 *   its value or a file. Node refuses an option it does not know (measured, exit 9), but the Node
 *   running a VERIFY is whichever one the person has, and a later one may know it.
 *
 * **Then everything else that holds `--test` is said too** (`unread`): any word, redirection
 * target or comment that no run read, when `node` or `tsx` is anywhere in the command, even inside
 * a longer word (`RUNNER_WORD`). The rules above find the runs they know how to read, and each new
 * spelling so far has found one they did not know; this is what keeps such a spelling from passing
 * with nothing said. The split leaves no text out: every character of the command is in a word, a
 * target, a comment or what separates them, so a `--test` anywhere in it is in something this
 * reads. A word a run read, from its runner to the end of its command, and text a shell runs that
 * was read as a command (whose own words go through the same rule) are the only words that do not
 * count. Each is matched in all of its `readings`. Measured on 2026-09-17, each of these ran a test
 * file and skipped a missing one it named, and exited 0: `[ "$(node --test a missing …)" = 0 ]`,
 * ``echo `node --test a missing` ``, `nohup npx -c 'node --test a missing'`,
 * `npx -w app -c 'node --test …'`, ``[ `printf 1 #count` -gt 0 ] && node --test a missing``, whose
 * run the split takes for a comment, and `node $'--te\x73t' a missing`. Without `node` or `tsx` in
 * the command nothing is said: `cargo test --test integration` is some other runner's.
 *
 * What this does not catch: a glob that matches nothing (`node --test 'none*.mjs'` exits 0 with
 * `# tests 0`, measured), a runner other than these two (`npm test`, which in this repository runs
 * `tsx --test` on a glob, `node --run`, `vitest`), a runner named in a command where neither `node`
 * nor `tsx` appears (`R=nod; ${R}e --test a`), a `--test` that none of its `readings` shows
 * (`--te$x`, `--te{s,}t`), a folder or workspace set outside the command (an `.npmrc`, the
 * environment the office runs in), and a file that is there but tests something else. #268 reads
 * PLAN.md's ticked lines with an earlier copy of these rules, and is to import this instead.
 */
export function testRuns(command: string): TestRun[] {
  return runsOf(command, readings(command).some((text) => RUNNER_WORD.test(text)))
}

/** `testRuns`, with whether `node` or `tsx` is named in the whole VERIFY, however deep this text is in it. */
function runsOf(command: string, named: boolean): TestRun[] {
  const line = commandsIn(command)
  if (line === null) return named && holdsTest(command) ? [unreadAt('--test')] : []
  const words = line.commands.flat()
  const moves = words.find(moving)
  const setting = workspaceSetting(words)
  const found = line.commands.map((each) => runsIn(each, setting, named))
  const runs = found
    .flatMap(({ runs }) => runs)
    .map((run) =>
      moves === undefined || run.unchecked !== null ? run : notChecked(run.runner, { reason: 'moves', word: moves }),
    )
  if (!named) return runs
  const unread = [
    ...line.commands.flatMap((each, c) => each.filter((_, i) => !found[c]!.placed.has(i))),
    ...line.targets,
    ...line.comments,
  ].filter(holdsTest)
  return [...runs, ...[...new Set(unread)].map(unreadAt)]
}

/** Whether `text` holds `--test` as a word, in any of its `readings`. */
function holdsTest(text: string): boolean {
  return readings(text).some((each) => TEST_WORD.test(each))
}

function notChecked(runner: TestRun['runner'], why: Omit<Unchecked, 'runner'>): TestRun {
  return { runner, files: [], unchecked: { runner, ...why } }
}

/** The note for `--test` in `word`, which no run read. */
function unreadAt(word: string): TestRun {
  return notChecked(null, { reason: 'unread', word })
}

/**
 * A word with every quote and backslash taken off, and a line continuation, and a `$` that opens a
 * quote (`$'cd'`): what the shell reads, near enough to find a name in however it was quoted.
 */
function loose(word: string): string {
  return word.replace(/\\\n/g, '').replace(/\$(?=['"])/g, '').replace(/['"\\]/g, '')
}

/**
 * The ways the shell may leave `text`, near enough to find a name in: `loose`, and `loose` after
 * every backslash escape `$'…'` knows is read as a character (`ESCAPE`), wherever it is; and each of
 * those with its brace lists spread (`braceList`). Reading too many ways can only find a name where
 * the shell has none, which costs a note; reading too few can hide one. `$'--te\x73t'` is `--test`,
 * and `--tes{t,t}` is `--test --test` (both measured with `/bin/sh` on 2026-09-17), and neither
 * shows it to `loose` alone.
 */
function readings(text: string): string[] {
  return [loose(text), loose(text.replace(ESCAPES, escaped))].flatMap((each) => [each, ...(braceList(each) ?? [])])
}

/**
 * A backslash escape as `$'…'` reads it: a letter, `\\`, a quote or `?`, one to three octal digits,
 * `x` and one or two hex digits, `u` and one to four, `U` and one to eight, or `c` and a character
 * other than the quote that closes the text (measured: `$'a\c'x` printed `a\x`). Any other character
 * after the backslash is kept with it (measured: `$'\q'` is `\q`), and so is an `x`, `u` or `U` with
 * no digit after it (measured: `$'\x'` is `\x`).
 */
const ESCAPE = String.raw`\\(?:[0-7]{1,3}|x[0-9A-Fa-f]{1,2}|u[0-9A-Fa-f]{1,4}|U[0-9A-Fa-f]{1,8}|c[^']|[\s\S]?)`
const ESCAPES = new RegExp(ESCAPE, 'g')
const ESCAPE_AT = new RegExp(`^${ESCAPE}`)

/** What a backslash before these stands for in `$'…'`. */
const ANSI_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['a', '\x07'],
  ['b', '\b'],
  ['e', '\x1b'],
  ['E', '\x1b'],
  ['f', '\f'],
  ['n', '\n'],
  ['r', '\r'],
  ['t', '\t'],
  ['v', '\v'],
  ['\\', '\\'],
  ["'", "'"],
  ['"', '"'],
  ['?', '?'],
])

/**
 * The character an escape `ESCAPE` matched stands for in `$'…'`, or the escape as written when it
 * stands for itself.
 *
 * Measured with bash 3.2, macOS's `/bin/sh`, on 2026-09-17: `\x73`, `\163`, `\cA`, `\e`, `\E`, `\?`,
 * `\"` and the letters were read as characters, `\1633` as `s3`, and a `\c` at the end as `\`. That
 * bash leaves `\u` and `\U` as written, and a later bash reads them as a character; they are read
 * here as a character, which can only show a name the shell may not have. A NUL, which ends bash's
 * word, is kept.
 */
function escaped(escape: string): string {
  const kind = escape[1] ?? ''
  const rest = escape.slice(2)
  if (/[0-7]/.test(kind)) return String.fromCharCode(parseInt(escape.slice(1), 8) & 0xff)
  if (kind === 'x' || kind === 'u' || kind === 'U') {
    const code = parseInt(rest, 16)
    return rest !== '' && code <= 0x10ffff ? String.fromCodePoint(code) : escape
  }
  if (kind === 'c') return rest === '' ? '\\' : String.fromCharCode(rest.charCodeAt(0) & 0x1f)
  return ANSI_ESCAPES.get(kind) ?? escape
}

/**
 * The words a brace list in `word` stands for, `a{b,c}d` as `abd` and `acd`; `[word]` when it has
 * no brace; and `null` when a brace in it is not part of such a list, or the words would be more
 * than `BRACE_WORDS`.
 *
 * Only a plain list is spread: two or more choices, none empty, with no brace in any. Measured with
 * `/bin/sh` on 2026-09-17: `test/{a,never}.test.mjs` was `test/a.test.mjs test/never.test.mjs`,
 * `{a,b}{c,d}` four words, and `{a,'b c'}` `a` and `b c`; `{a}`, `{}` and `{a,b` were as written;
 * and `{a..c}`, `{a,{b,c}}` and `x{a,}` were spread in ways this does not follow. Read after the
 * quotes are off, because the runner spreads a list the shell leaves: `{'a,b'}` was `{a,b}` as
 * written, and `node --test 'test/{a,never}.test.mjs'` ran `test/a.test.mjs` (both measured).
 */
function braceList(word: string): string[] | null {
  if (!/[{}]/.test(word)) return [word]
  let words = ['']
  for (const [i, part] of word.split(/\{([^{}]*)\}/).entries()) {
    // Between the braces at odd places, around them at even ones.
    const choices = i % 2 === 1 ? part.split(',') : [part]
    if (i % 2 === 0 ? /[{}]/.test(part) : choices.length < 2 || choices.includes('')) return null
    words = words.flatMap((before) => choices.map((choice) => before + choice))
    if (words.length > BRACE_WORDS) return null
  }
  return words
}

/** Whether `word` is a `cd`, `pushd` or `popd`, or holds one in text a shell may run. */
function moving(word: string): boolean {
  return readings(word).some((text) => text.split(SEPARATORS).some((part) => MOVES.has(part)))
}

/** A command line as the shell splits it. */
interface Line {
  /** Simple commands, each a list of words as written. */
  readonly commands: readonly (readonly string[])[]
  /** The words redirections point at, as written: the shell expands them, and no command is given them. */
  readonly targets: readonly string[]
  /**
   * The comments, each from its `#` to the end of its line. The shell runs none of it, and it is still
   * read for `--test` (`runsOf`): text the split takes for a comment may be text the shell runs,
   * measured with ``[ `printf 1 #count` -gt 0 ] && node --test a missing``.
   */
  readonly comments: readonly string[]
}

/**
 * A command line as the shell splits it, or `null` when a quote never closes and the shell would run
 * none of it.
 *
 * Quotes and escapes stay inside their word, and so does a `${…}`. A redirection's target is kept
 * apart, with a descriptor written against it (`2>&1`) dropped, where `2 >&1` would leave `2` a word,
 * and the command goes on after it. A `#` that starts a word ends the line it is on, and what it
 * ends is kept as a comment.
 *
 * `$'…'` closes at a quote no backslash is before, as bash reads it: measured, `node --test a
 * missing; echo $'it\'s'` ran `a` and exited 0. A `$` opens one only when it is not the second of a
 * pair: `$$` is the shell's process id, so the quote after it is a plain one. Measured with
 * `/bin/sh` on 2026-09-17: `$$'\'` printed the process id and a backslash, `$$$'a\x41'` the process
 * id and `aA`, and `\$$'a\x41'` printed `$aA`.
 */
function commandsIn(line: string): Line | null {
  const commands: string[][] = [[]]
  const targets: string[] = []
  const comments: string[] = []
  let word: string | null = null
  let target = false
  // How many `$` the word ends with, none of them escaped.
  let dollars = 0

  const endWord = (): void => {
    if (word === null) return
    if (target) targets.push(word)
    else commands[commands.length - 1]!.push(word)
    target = false
    word = null
  }

  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    const opens = dollars % 2 === 1
    const before = dollars
    dollars = 0
    if (c === "'" || c === '"') {
      const close = closing(line, i, opens && c === "'")
      if (close < 0) return null
      word = (word ?? '') + line.slice(i, close + 1)
      i = close
    } else if (c === '{' && opens) {
      const close = inner(line, i)
      if (close < 0) return null
      word = (word ?? '') + line.slice(i, close + 1)
      i = close
    } else if (c === '\\') {
      word = (word ?? '') + line.slice(i, i + 2)
      i++
    } else if (c === '#' && word === null) {
      const end = line.indexOf('\n', i)
      comments.push(line.slice(i, end < 0 ? line.length : end))
      if (end < 0) break
      i = end - 1
    } else if (c === '\n' || ';&|()'.includes(c)) {
      endWord()
      target = false
      commands.push([])
    } else if (/\s/.test(c)) {
      endWord()
    } else if (c === '<' || c === '>') {
      if (word !== null && /^\d+$/.test(word)) word = null
      else endWord()
      while (/[<>&|]/.test(line[i + 1] ?? '')) i++
      target = true
    } else {
      word = (word ?? '') + c
      if (c === '$') dollars = before + 1
    }
  }
  endWord()
  return { commands: commands.filter((words) => words.length > 0), targets, comments }
}

/**
 * Where the quote at `open` closes, or -1 when it never does. A backslash keeps the next character
 * in double quotes, and in `$'…'` when `ansi` says the quote is one.
 *
 * In double quotes a `$(…)`, a `${…}` or a backtick holds text with quotes of its own, and a quote
 * there does not close the one at `open` (`inner`). Measured with `/bin/sh` on 2026-09-17, each of
 * these was one word: `"$(echo "a #")"`, `"${x:-"a b"}"`, ``"`echo "a #"`"``, `"$(echo 'x"y')"` and
 * `"$(echo "$(echo "a b")")"`. Here any `$` before `(` or `{` opens one, the second of a pair too,
 * though it then expands as the process id: `"$$(echo "; node --test x; ")"` was one word, and
 * printed the process id and the rest as written.
 */
function closing(line: string, open: number, ansi: boolean): number {
  const quote = line[open]
  let dollar = false
  for (let i = open + 1; i < line.length; i++) {
    const c = line[i]!
    const opens = dollar
    dollar = false
    if ((quote === '"' || ansi) && c === '\\') i++
    else if (c === quote) return i
    else if (quote === '"' && (c === '`' || (opens && (c === '(' || c === '{')))) {
      i = inner(line, i)
      if (i < 0) return -1
    } else dollar = c === '$'
  }
  return -1
}

/**
 * Where the text that starts at `open` ends, or -1 when it never does: the backtick after one at
 * `open`, or the `)` or `}` that closes a `(` or `{` after `$`. Quotes, and text of the same kinds,
 * are passed over inside it. As in double quotes, any `$` opens one, and any `$` before a quote
 * makes it `$'…'`. A `(` inside a `$(…)` is closed before it, and a `{` inside a `${…}` is not: bash
 * 3.2 closes that at its first `}`.
 *
 * Measured with `/bin/sh` on 2026-09-17: `"$(echo "a)")"` printed `a)`, `"$((1+(2)))"` printed `3`,
 * `"$( (echo a); echo "b; node --test …; c" )"` printed `a` and then its text, and
 * `"$(echo $$'a\'b')"` printed `a'b`; `"${HOME:+{a} b}"` printed `{a b}`,
 * `"${HOME:+${HOME:+x}y}"` printed `xy`, and `"${HOME:+{a} "b; node --test …; c"}"` ran that
 * `node --test`; `"${x:-'a}"` was a quote that never closes (exit 2).
 */
function inner(line: string, open: number): number {
  const kind = line[open]
  if (kind === '`') {
    for (let i = open + 1; i < line.length; i++) {
      if (line[i] === '\\') i++
      else if (line[i] === '`') return i
    }
    return -1
  }
  const close = kind === '(' ? ')' : '}'
  let depth = 1
  let dollar = false
  for (let i = open + 1; i < line.length; i++) {
    const c = line[i]!
    const opens = dollar
    dollar = false
    if (c === '\\') i++
    else if (c === "'" || c === '"') {
      i = closing(line, i, opens && c === "'")
      if (i < 0) return -1
    } else if (c === '`' || (opens && (c === '(' || c === '{'))) {
      i = inner(line, i)
      if (i < 0) return -1
    } else if (c === '(' && kind === '(') depth++
    else if (c === close && --depth === 0) return i
    else dollar = c === '$'
  }
  return -1
}

/**
 * A word as its program receives it, when all the shell does is take quotes off.
 *
 * `null` when the shell may do more: expand a `$` or a backtick outside single quotes, take off a
 * backslash outside quotes or one inside double quotes before `$`, a backtick, `"`, `\` or a
 * newline, or expand a leading `~`. Inside single quotes every character is as written, and so is a
 * backslash inside double quotes before any other character. Measured with `/bin/sh` on 2026-09-17:
 * `'$HOME'` reached `printf` as `$HOME`, and `"a\b"` as `a\b`.
 */
function plain(word: string): string | null {
  if (word.startsWith('~')) return null
  let out = ''
  let quote: string | null = null
  for (let i = 0; i < word.length; i++) {
    const c = word[i]!
    if (quote === "'") {
      if (c === "'") quote = null
      else out += c
    } else if (c === '$' || c === '`') {
      return null
    } else if (c === '\\') {
      if (quote === null || '$`"\\\n'.includes(word[i + 1] ?? '')) return null
      out += c
    } else if (c === quote) {
      quote = null
    } else if (quote === null && (c === "'" || c === '"')) {
      quote = c
    } else {
      out += c
    }
  }
  return quote === null ? out : null
}

/**
 * Text a shell will run as a command, as that shell receives it: quotes and escapes taken off, and
 * what the outer shell would expand left as written. Only ever searched for runners.
 *
 * `$'…'` is read with every escape `ESCAPE` knows (`escaped`), and `$"…"` as a double quote; the `$`
 * of either is not part of the text, and a `$` that is the second of a pair opens neither.
 */
function unquote(word: string): string {
  let out = ''
  let quote: string | null = null
  let dollars = 0
  for (let i = 0; i < word.length; i++) {
    const c = word[i]!
    const opens = dollars % 2 === 1
    const before = dollars
    dollars = 0
    if (quote === "'" || quote === "$'") {
      if (c === "'") quote = null
      else if (quote === "$'" && c === '\\') {
        const escape = ESCAPE_AT.exec(word.slice(i))![0]
        out += escaped(escape)
        i += escape.length - 1
      } else out += c
    } else if (c === '\\' && (quote === null || '$`"\\\n'.includes(word[i + 1] ?? ''))) {
      if (word[i + 1] !== '\n') out += word[i + 1] ?? ''
      i++
    } else if (quote === null && opens && (c === "'" || c === '"')) {
      out = out.slice(0, -1)
      quote = c === "'" ? "$'" : c
    } else if (c === quote) {
      quote = null
    } else if (quote === null && (c === "'" || c === '"')) {
      quote = c
    } else {
      out += c
      if (c === '$' && quote === null) dollars = before + 1
    }
  }
  return out
}

/** Text a shell runs as a command, as written, and which words of its command hold it. */
interface ShellText {
  readonly text: string
  /** The first word that holds it. */
  readonly from: number
  /** The word after the last that holds it. */
  readonly to: number
}

/** The word at `at` as the text a shell runs, or `null` when there is no word there. */
function textAt(words: readonly string[], at: number): ShellText | null {
  const text = words[at]
  return text === undefined ? null : { text, from: at, to: at + 1 }
}

/** A simple command's own program, found past the words that start it unchanged. */
interface Start {
  /** Where the program's word is: the runner's, when this is a run. */
  readonly at: number
  /** Why the words from `at` on cannot be read as written, when a word before them says so. */
  readonly why: Omit<Unchecked, 'runner'> | null
  /**
   * The program is one `npx` or `npm exec` starts. npm looks for it in its own bins and installs a
   * package of that name when it is not there (read in libnpmexec's `lib/index.js`), so a `sh`
   * there is not known to be the shell: measured, `npx sh -c '…'` asked the registry for `sh`.
   */
  readonly npm: boolean
  /** `npm exec` before any `--`, which takes the options after its program for itself. */
  readonly npmTakes: boolean
  /** Text a word before `at` hands on to be read as a command: `npx -c '…'`. */
  readonly text: ShellText | null
}

function started(at: number, why: Omit<Unchecked, 'runner'> | null = null, text: ShellText | null = null): Start {
  return { at, why, npm: false, npmTakes: false, text }
}

type Wrapper = (words: readonly string[], next: number) => number | Start

/**
 * Programs that start the command after them in the same folder with the words written after it,
 * each with where that command's word is. Every form here was measured on 2026-09-17 (macOS, whose
 * `/bin/sh`, the shell a VERIFY runs in, is bash 3.2) to print the folder it started in and every
 * word after the script: `env`, `/usr/bin/env`, `env -i`, `env -`, `env -u NAME`, `env -uNAME`,
 * `env --`, `env NAME=value`, `time`, `time -p`, `/usr/bin/time -p`, `nice`, `nice -n 5`,
 * `nice -n5`, `nice -5`, `/usr/bin/nice -n 5`, `command` and `exec`; and `nice -15` ran the runner
 * the same way. Any other option of theirs is where the walk stops, and is not known to do the same:
 * `env -S` split its text into new words, and macOS's env refused `--unset=NAME`.
 */
const WRAPPERS: ReadonlyMap<string, Wrapper> = new Map<string, Wrapper>([
  ['env', afterEnv],
  ['time', (words, next) => (plain(words[next] ?? '') === '-p' ? next + 1 : next)],
  ['nice', afterNice],
])

/** Where `env`'s command is, past the options and assignments that leave its folder and words be. */
function afterEnv(words: readonly string[], next: number): number | Start {
  for (let i = next; i < words.length; i++) {
    const raw = words[i]!
    const word = plain(raw)
    if (word === null) return started(i, { reason: 'rewritten', word: raw })
    if (CHDIR.test(word)) return started(i, { reason: 'moves', word: raw })
    if (word === '-S' || word === '--split-string') {
      return started(i, { reason: 'prefix', word: raw }, textAt(words, i + 1))
    }
    if (word === '--') return i + 1
    if (word === '-u') {
      const name = words[++i]
      if (name !== undefined && plain(name) === null) return started(i, { reason: 'rewritten', word: name })
    } else if (!(word === '-i' || word === '-' || /^-u./.test(word) || ASSIGNMENT.test(word))) {
      return i
    }
  }
  return words.length
}

/** Where `nice`'s command is, past `-n` and its value, `-n5` or `-5`. */
function afterNice(words: readonly string[], next: number): number | Start {
  const word = plain(words[next] ?? '')
  if (word === '-n') {
    const value = words[next + 1]
    return value !== undefined && plain(value) === null
      ? started(next + 1, { reason: 'rewritten', word: value })
      : next + 2
  }
  return word !== null && /^-n?\d+$/.test(word) ? next + 1 : next
}

/**
 * Where a simple command's program is, past variable assignments and the words in `WRAPPERS`. A
 * program `npx` or `npm` is read by `npmStart`, unless `setting` names npm's workspace setting
 * somewhere in the command.
 */
function startOf(words: readonly string[], setting: string | null): Start {
  let i = 0
  while (i < words.length && ASSIGNMENT.test(words[i]!)) i++
  while (i < words.length) {
    const raw = words[i]!
    const word = plain(raw)
    if (word === null) return started(i, { reason: 'rewritten', word: raw })
    const name = word.slice(word.lastIndexOf('/') + 1)
    const npm = name.toLowerCase()
    if (npm === 'npx' || npm === 'npm') {
      return setting === null
        ? npmStart(words, i + 1, npm === 'npx')
        : started(i, { reason: 'workspace', word: setting })
    }
    const wrapper = word === 'command' || word === 'exec' ? (_: unknown, after: number) => after : WRAPPERS.get(name)
    if (wrapper === undefined) return started(i)
    const after = wrapper(words, i + 1)
    if (typeof after !== 'number') return after
    i = after
  }
  return started(i)
}

/**
 * The first of `words` that names npm's workspace setting as a variable, with the name as it reads
 * there, or `null`.
 *
 * Any word that names `npm_config_workspace` or `npm_config_workspaces`, in any case, counts,
 * wherever it is in the command and whatever its value looks like: an assignment, an `export`, an
 * `env NAME=value`, text in quotes. The office does not follow the shell's variables, so it does not
 * know which of them reach npm. Two assignments are passed over, each measured to leave npm where
 * it starts: `npm_config_workspace=` with nothing after it, which npm ignores (read:
 * `@npmcli/config` skips an empty variable), and `npm_config_workspaces=false`.
 *
 * Measured on 2026-09-17 with npm 10.9.2, from a folder whose `package.json` lists the workspace
 * `app`: `npx -c pwd` printed `app`'s folder after `npm_config_workspace=app`,
 * `NPM_CONFIG_WORKSPACE=app`, `npm_config_workspaces=true` and `env npm_config_workspace=app`, and
 * `npx node --test test/a.test.mjs test/b.test.mjs` ran both of `app`'s files after
 * `export npm_config_workspace=app;` and after `npm_config_workspace=$(echo app)`. It stayed in the
 * folder it started in after `npm_config_workspace=`, `npm_config_workspaces=false` and
 * `export npm_config_workspaces=false;`.
 */
function workspaceSetting(words: readonly string[]): string | null {
  for (const read of words.flatMap(readings)) {
    const name = WORKSPACE_VARIABLE.exec(read)?.[0]
    if (name === undefined) continue
    const assigned = /^(npm_config_workspaces?)=(.*)$/is.exec(read)
    const stays =
      assigned !== null &&
      (assigned[1]!.toLowerCase() === 'npm_config_workspace' ? assigned[2] === '' : assigned[2] === 'false')
    if (!stays) return name
  }
  return null
}

/** An npm option's name as npm reads it: leading dashes off, and a short name expanded. */
function npmName(option: string, npx: boolean): string {
  const name = option.replace(/^-+/, '')
  return npx && name === 'p' ? 'package' : (NPM_SHORT.get(name) ?? name)
}

/**
 * Where the program after `npx`, or after `npm … exec`, is.
 *
 * Measured on 2026-09-17 with npm 10.9.2, `npx <option> -c pwd` from a workspace root printed the
 * workspace's folder after `-w app`, `-w=app`, `--workspace app`, `--workspace=app`, `-ws`,
 * `--workspaces` and `--workspaces=true`, and `npx <option> node --test` ran the workspace's files
 * after `--w=app` and `---w=app`, as `npm --w=app exec --` did: npm reads an option's name with
 * every leading dash off, and its short names expanded. It printed the folder it started in after
 * `--workspaces=false`, `--prefix sub` and `-C sub`. After `-w=` npm stopped with "No workspaces
 * found". `npx -c` and `npm exec --call` hand their text to a shell (read: `lib/commands/exec.js`),
 * and so does `npx --c='…'` (measured: it ran `node --test` in its text).
 */
function npmStart(words: readonly string[], from: number, npx: boolean): Start {
  let exec = npx
  let ended = false
  for (let i = from; i < words.length; i++) {
    const raw = words[i]!
    const eq = raw.indexOf('=')
    const head = plain(eq < 0 ? raw : raw.slice(0, eq))
    if (head === null) return started(i, { reason: 'rewritten', word: raw })

    if (ended || !head.startsWith('-') || head === '-') {
      const word = plain(raw)
      if (word === null) return started(i, { reason: 'rewritten', word: raw })
      if (exec) return { at: i, why: null, npm: true, npmTakes: !npx && !ended, text: null }
      if (word !== 'exec' && word !== 'x') return started(i)
      exec = true
      continue
    }
    if (eq < 0 && head === '--') {
      ended = true
      continue
    }

    const name = npmName(head, npx)
    if (name === 'call') {
      const text = eq < 0 ? textAt(words, i + 1) : { text: raw.slice(eq + 1), from: i, to: i + 1 }
      return started(words.length, null, text)
    }
    const value = eq < 0 ? null : plain(raw.slice(eq + 1))
    if (eq >= 0 && value === null) return started(i, { reason: 'rewritten', word: raw })

    if (name === 'workspace') {
      if (value !== null) return started(i, { reason: value === '' ? 'prefix' : 'workspace', word: raw })
      const next = words[i + 1]
      if (next !== undefined && plain(next) === null) return started(i + 1, { reason: 'rewritten', word: next })
      return started(i + 1, { reason: 'workspace', word: raw })
    }
    if (name === 'workspaces') {
      if (value === 'false') continue
      return started(i, { reason: value === null || value === 'true' ? 'workspace' : 'prefix', word: raw })
    }

    const kind = NPM_OPTIONS.get(name)
    if (kind === 'value') {
      if (value !== null) continue
      const next = words[i + 1]
      const read = next === undefined ? '' : plain(next)
      if (read === null) return started(i + 1, { reason: 'rewritten', word: next! })
      if (read.startsWith('-')) return started(i, { reason: 'flag', word: raw })
      i++
      continue
    }
    const known =
      kind === 'switch'
        ? value === null
        : kind === 'boolean' && (value === null || value === 'true' || value === 'false')
    if (!known) return started(i, { reason: 'flag', word: raw })
  }
  return started(words.length)
}

/**
 * The text a shell runs as a command when `words[at]` starts one, as written: the word after
 * `sh -c`, `bash -lc` or `bash -o pipefail -c`, or the words after `eval`. `null` for anything else.
 */
function shellText(words: readonly string[], at: number): ShellText | null {
  const word = plain(words[at] ?? '')
  if (word === 'eval') {
    return at + 1 < words.length ? { text: words.slice(at + 1).join(' '), from: at + 1, to: words.length } : null
  }
  if (word === null || !SHELLS.has(word.slice(word.lastIndexOf('/') + 1).toLowerCase())) return null
  let call = false
  for (let i = at + 1; i < words.length; i++) {
    const option = plain(words[i]!)
    if (option === null) return call ? textAt(words, i) : null
    if (/^[-+]o$/.test(option)) i++
    else if (/^-[A-Za-z]*c[A-Za-z]*$/.test(option)) call = true
    else if (option !== '--' && !/^(?:[-+][A-Za-z]+|--[a-z-]+)$/.test(option)) return call ? textAt(words, i) : null
  }
  return null
}

/** The runs in one simple command, and which of its words they read. */
interface Found {
  readonly runs: readonly TestRun[]
  /** Where the words a run read are: from its runner on, or the text a shell runs. */
  readonly placed: ReadonlySet<number>
}

const NOTHING: Found = { runs: [], placed: new Set() }

/** The word indices from `from` up to `to`. */
function span(from: number, to: number): ReadonlySet<number> {
  return new Set(Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k))
}

/** `tsx` or `node` when `word` names one of them as a program, or `null`. */
function runnerOf(word: string | undefined): TestRun['runner'] {
  const name = RUNNER.exec(plain(word ?? '') ?? '')?.[1]?.toLowerCase()
  return name === 'tsx' || name === 'node' ? name : null
}

/** The test run one simple command makes: its runner's, or those in text it hands a shell. */
function runsIn(words: readonly string[], setting: string | null, named: boolean): Found {
  const start = startOf(words, setting)
  let why = start.why
  let from = start.at + 1
  if (why === null) {
    const text = start.text ?? (start.npm ? null : shellText(words, start.at))
    if (text !== null) return runsInText(text, { reason: 'quoted', word: text.text }, named)
    const runner = runnerOf(words[start.at])
    if (runner !== null) {
      const runs = readRunner(runner, words.slice(start.at + 1), start.npmTakes)
      return runs.length === 0 ? NOTHING : { runs, placed: span(start.at, words.length) }
    }
    if (start.at >= words.length) return NOTHING
    why = { reason: 'prefix', word: words[start.at]! }
    // The program itself may be a shell, when npm started it.
    from = start.at
  } else if (start.text !== null) {
    return runsInText(start.text, why, named)
  }

  // Something before here is not known to start what follows unchanged. A runner after it, or in
  // text a shell after it runs, is still a run, and nothing in it is read.
  for (let i = from; i < words.length; i++) {
    const text = shellText(words, i)
    const found = text === null ? NOTHING : runsInText(text, why, named)
    if (found.runs.length > 0) return found
    const runner = runnerOf(words[i])
    if (runner !== null && readRun(words.slice(i + 1)) !== null) {
      return { runs: [notChecked(runner, why)], placed: span(i, words.length) }
    }
  }
  return NOTHING
}

/**
 * The runs in text a shell runs as a command, none of them read, for `why`. What the text holds is
 * read as a command of its own, so `--test` in it that no run there read is said as such.
 */
function runsInText(text: ShellText, why: Omit<Unchecked, 'runner'>, named: boolean): Found {
  const runs = runsOf(unquote(text.text), named).map((run) =>
    run.unchecked?.reason === 'unread' ? run : notChecked(run.runner, why),
  )
  return { runs, placed: span(text.from, text.to) }
}

/**
 * The run a runner makes of the words after it, when they make a test run.
 *
 * After `npm exec` with no `--` yet, npm takes every option before the first `--` and drops that
 * `--`, so the runner is handed what is left.
 */
function readRunner(runner: 'tsx' | 'node', after: readonly string[], npmTakes: boolean): TestRun[] {
  let args = after
  let taken: Omit<Unchecked, 'runner'> | null = null
  if (npmTakes) {
    const end = after.findIndex((arg) => plain(arg) === '--')
    const word = (end < 0 ? after : after.slice(0, end)).find((arg) => {
      const read = plain(arg)
      return read === null || (read.startsWith('-') && read !== '-')
    })
    if (word !== undefined) taken = { reason: plain(word) === null ? 'rewritten' : 'taken', word }
    if (end >= 0) args = [...after.slice(0, end), ...after.slice(end + 1)]
  }
  const read = readRun(args)
  if (read === null) return []
  const why = taken ?? read.unchecked
  return [why === null ? { runner, files: read.files, unchecked: null } : notChecked(runner, why)]
}

/**
 * What a runner makes of the words after it: the files a test run names, why they cannot be read,
 * or `null` when it is not a test run.
 */
function readRun(
  args: readonly string[],
): { readonly files: string[]; readonly unchecked: Omit<Unchecked, 'runner'> | null } | null {
  let test = false
  let options = true
  let unsure: Omit<Unchecked, 'runner'> | null = null
  const files: string[] = []

  for (let i = 0; i < args.length; i++) {
    const word = plain(args[i]!)
    if (word === null) {
      unsure ??= { reason: 'rewritten', word: args[i]! }
      continue
    }

    if (options && word.startsWith('-') && word !== '-') {
      if (word === '--') {
        options = false
        if (test) continue
      } else {
        if (word === '--test') {
          test = true
          continue
        }
        // The shell may spread it into more words than are written, and the next may then be a file.
        if (spreads(args[i]!)) unsure ??= { reason: 'rewritten', word: args[i]! }
        const flag = word.split('=')[0]!
        // `--test=…` starts the runner, and the process each file runs in skips the file (see
        // `testRuns`), so nothing here says what ran.
        if (flag === '--test') unsure ??= { reason: 'flag', word: args[i]! }
        if (word.includes('=')) continue
        const kind = flagKind(flag)
        if (kind === 'value') {
          i++
          const value = args[i]
          if (value !== undefined && (plain(value) === null || spreads(value))) {
            unsure ??= { reason: 'rewritten', word: value }
          }
        } else if (kind === null && i + 1 < args.length) {
          unsure ??= { reason: 'flag', word: args[i]! }
        }
        continue
      }
    }

    // A word before `--test` is the script, and the rest is its own. Unless an earlier word could
    // not be read, when this one might have been that word's value and `--test` the runner's.
    if (!test) {
      const later = args.slice(i + 1).some((arg) => plain(arg) === '--test')
      return unsure !== null && later ? { files: [], unchecked: unsure } : null
    }
    // The first file ends the options: every word after it is a file to the runner, a flag too.
    options = false
    // The runner reads a backslash in a file as `/` (measured: `node --test 'a\b.test.mjs'` ran
    // `a/b.test.mjs`, on Node 22.16.0 and 24.3.0), so the word as written is not where it looks.
    const each = word.includes('\\') ? null : braceList(word)
    if (each === null) unsure ??= { reason: 'rewritten', word: args[i]! }
    for (const file of each ?? []) {
      if (inModules(file)) unsure ??= { reason: 'excluded', word: args[i]! }
      else if (!GLOB.test(file)) files.push(file)
    }
  }

  if (!test) return null
  return unsure === null ? { files: [...new Set(files)], unchecked: null } : { files: [], unchecked: unsure }
}

/**
 * Whether the shell may spread `word`, a word `plain` can read, into more words than are written: it
 * has a brace outside quotes (`braceList`). Inside quotes the shell leaves one alone, and an option
 * or its value is not a pattern the runner spreads.
 */
function spreads(word: string): boolean {
  return /[{}]/.test(word.replace(/'[^']*'|"[^"]*"/g, ''))
}

/**
 * Whether the runner leaves `file` out, as it leaves a file in the `node_modules` folder of the
 * folder it starts in, however the path is written.
 *
 * Measured on 2026-09-17 with Node 22.16.0 and 24.3.0, and with tsx 4.23.12: `node --test
 * pass.test.mjs node_modules/fails.test.mjs` exited 0 with `# tests 1`, though the second file is
 * there and its test throws. So did `./node_modules/…`, `node_modules/pkg/test/x.test.mjs`,
 * `.//node_modules/…`, `node_modules//…`, `a/../node_modules/…`, `node_modules/pkg/../…`,
 * `node_modules/` and `node_modules/.`. None of these was left out, and each run failed:
 * `sub/node_modules/…`, an absolute path, `NODE_MODULES/…`, `../<folder>/node_modules/…`,
 * `node_modules/../test/…` and `node_modules/./../test/…`, whose file ran, and `node_modules/pkg/..`
 * and `./node_modules`, which name the folder itself.
 *
 * Read in Node 22.16.0's own source, which its binary holds: the runner finds its files with
 * `new Glob(patterns, { cwd, exclude: (name) => name === 'node_modules' })`, and the glob reads each
 * pattern with minimatch at `optimizationLevel: 2`, then passes over a folder whose path from `cwd`
 * is excluded. So, as here: a `.` or empty part between two others drops out, a part before `..`
 * goes with it, and a path whose first part is then `node_modules`, with anything after it, is left
 * out. A path that comes to the folder itself (`node_modules/pkg/../..`) is not caught here, as `.`
 * is not (see `notThere` in `verify.ts`).
 */
function inModules(file: string): boolean {
  const parts = file.split('/')
  if (parts[0] === '') return false
  const walked: string[] = []
  parts.forEach((part, i) => {
    if ((part === '.' || part === '') && i > 0 && i < parts.length - 1) return
    const last = walked[walked.length - 1]
    if (part === '..' && last !== undefined && last !== '..' && last !== '.') walked.pop()
    else walked.push(part)
  })
  if (walked[0] === '.') walked.shift()
  return walked[0] === 'node_modules' && walked.length > 1
}

/** The template's own placeholder row, which is not a task anybody meant to write. */
function isPlaceholder(row: readonly string[]): boolean {
  return row.every((c) => c === '' || c === '...' || c === '…')
}

/**
 * Parse a `TASKS.md`.
 *
 * Never throws. A file with no tables is a project that has not written any tasks down, which
 * is a real answer and not an error.
 */
export function parseTasks(markdown: string): TaskList {
  const tasks: Task[] = []
  let unreadable = 0
  const unrecognised = new Set<string>()
  let state: TaskState | null = null
  let heading = ''

  for (const line of markdown.split('\n')) {
    const found = /^##\s+(.+?)\s*$/.exec(line)
    if (found) {
      heading = found[1]!
      state = HEADINGS[heading.toLowerCase()] ?? null
      continue
    }

    // Rows outside a section we recognise belong to some other table and are not ours to read —
    // **unless they look exactly like ours**, in which case the heading is the thing that is
    // wrong and saying nothing would report a full file as an empty one. See `unrecognised`.
    if (state === null) {
      if (heading !== '' && looksLikeTask(cells(line))) unrecognised.add(heading)
      continue
    }

    const row = cells(line)
    if (row.length === 0 || isRule(row)) continue

    // The header row of the table itself.
    if (row[0]?.toLowerCase() === '#') continue
    if (isPlaceholder(row)) continue

    // Ref, task, owner, verify. Anything shorter is a row we cannot read as a task — which is
    // reported rather than skipped, because a task list that loses rows says work is finished
    // when it is not.
    if (row.length < 4) {
      unreadable++
      continue
    }

    const [ref = '', title = '', owner = '', condition = ''] = row
    if (!title) {
      unreadable++
      continue
    }

    tasks.push({ ref, title, owner, condition, command: commandIn(condition), state })
  }

  return { tasks, unreadable, unrecognised: [...unrecognised] }
}

/**
 * A row that is almost certainly a task, under a heading that is not ours.
 *
 * Four cells and a numeric ref, which is what the convention in `projects/_TEMPLATE/TASKS.md`
 * writes. Deliberately narrow: a table of settings or of file sizes under some other heading has
 * four cells too, and flagging those would make this warning noise — and a warning that is noise
 * is one somebody turns off.
 */
function looksLikeTask(row: readonly string[]): boolean {
  if (row.length < 4 || isRule(row)) return false

  const ref = row[0]?.trim() ?? ''
  if (!/^\d+$/.test(ref)) return false

  // And a backticked VERIFY, which is the column this convention is built on — CLAUDE.md:
  // *"VERIFY is a command, not a verdict. Write what should be run, in backticks."*
  //
  // Four cells and a number is not enough on its own, and an existing test is the evidence:
  // `| 1 | not a task | x | y |` under `## Notes` is structurally identical to a task row.
  // Requiring the backticks makes a settings table or a numbered list of notes impossible to
  // mistake for a task list.
  //
  // **The cost is a miss, deliberately.** The template allows a VERIFY in plain words —
  // *reviewed by eye* — for a task no command can settle, and a table of only those under a
  // wrong heading is not flagged. A miss is the safe failure here: the alternative is a warning
  // that fires on ordinary tables, and a warning that is noise is one somebody stops reading.
  return /`[^`]+`/.test(row[3] ?? '')
}

/**
 * How a task stands, in one word.
 *
 * Six, not two. A task that nobody authorised the office to check and a task whose VERIFY names
 * nothing runnable are both *unsettled*, and calling either of them "failed" or "passed" is a
 * lie in one direction or the other.
 */
export type TaskOutcome = 'passed' | 'failed' | 'refused' | 'not-run' | 'uncheckable' | 'done'

/**
 * The least of a check that the outcome depends on.
 *
 * Deliberately structural: the harness's own `TaskCheck` satisfies it, and stating it here
 * rather than importing that type is what lets the renderer work out the same answer without
 * reaching into the main process — which it cannot do, because that half touches the disk.
 */
export interface Checked {
  readonly task: Pick<Task, 'owner' | 'command' | 'state'>
  readonly verdict: { readonly state: 'allowed' | 'denied' | 'unlisted' }
  /**
   * `null` when nothing was run at all.
   *
   * `error` is set when the command could not be *started* — a name this machine does not have,
   * a permission that stopped the spawn. `verify.ts` carries it precisely so that "we could not
   * run the check" stays distinguishable from "the check failed".
   */
  readonly result: { readonly passed: boolean; readonly error?: string | null } | null
}

export function outcomeOf(check: Checked): TaskOutcome {
  if (check.task.state === 'done') return 'done'
  if (check.task.command === null) return 'uncheckable'
  if (check.verdict.state === 'denied') return 'refused'
  if (check.result === null) return 'not-run'

  /*
   * A command that could not be started is `not-run`, not `failed`.
   *
   * It used to be `failed`, because a failed spawn leaves `passed: false` like any other bad
   * exit — so a VERIFY naming a command this machine does not have was reported as the task's
   * work being wrong. `verify.ts` says why that matters in its own words: "an office that
   * conflated them would report broken plumbing as broken code."
   *
   * No seventh outcome was needed, which is the part worth noticing. `not-run` already means
   * *nothing was run — because it could not be, or was not permitted to be*, and a spawn that
   * never started is the first of those exactly. The union was right; the routing into it was
   * not.
   */
  if (check.result.error) return 'not-run'

  return check.result.passed ? 'passed' : 'failed'
}

/**
 * Did anything actually run?
 *
 * Three of the six outcomes mean **no command executed**: `refused` (the gate said no),
 * `uncheckable` (the task carries nothing to run), and `not-run` (nothing has been tried, or the
 * spawn failed). The other three all mean something happened or is settled.
 *
 * That split is the second standing order stated as a predicate — a claim is checked by running
 * a command rather than by believing an agent, so *"nothing ran"* is the one condition under
 * which an outcome on screen is not evidence of anything. `failed` is not in this set and must
 * not be: a failure is a check that **did** happen and said no, which is the most informative
 * outcome there is.
 *
 * The three reasons are genuinely different and this deliberately does not rank them — see
 * {@link whyNothingRan}, which is where the difference is kept. Merging them here and calling
 * the result "blocked" would put two facts about two different people behind one word.
 */
export function nothingRan(outcome: TaskOutcome): boolean {
  return outcome === 'refused' || outcome === 'uncheckable' || outcome === 'not-run'
}

/**
 * Who the unverified work is waiting on, in one sentence, or `null` when something did run.
 *
 * `PLAN.md` asks for a prop reading "blocked tasks", and there is no blocked state — the word
 * covers two conditions waiting on two different people. `refused` waits on **the user**, who
 * can allow the command. `uncheckable` waits on **whoever wrote the task**, because there is
 * nothing to allow. `not-run` waits on nobody and simply has not happened yet.
 *
 * A bin can say *that* nothing ran. It cannot say which of those three, and drawing three
 * distinguishable heaps of paper would be inventing a vocabulary nobody reading it has been
 * taught. So the shape carries the fact and this carries the reason.
 */
export function whyNothingRan(outcome: TaskOutcome): string | null {
  switch (outcome) {
    case 'refused':
      return 'Waiting on you — the command was not allowed.'
    case 'uncheckable':
      return 'Waiting on whoever wrote the task — it names nothing to run.'
    case 'not-run':
      return 'Not checked yet.'
    default:
      return null
  }
}

/**
 * Why a check that ran has not passed, when a test file its VERIFY names is not there.
 *
 * `null` when nothing is missing. The output a person sees under this is the runner's own, and a
 * runner that skipped a file prints a pass, so this is the sentence that says otherwise.
 *
 * The folder is named because it is where a person looks next: the office runs every VERIFY from
 * the workspace root (`harness.ts` passes it as `cwd`), not from the project's folder. The runner
 * is named only after an exit 0; a run that failed or timed out has not passed on its own account.
 *
 * Neither sentence says what the runner did with the file, because nothing here knows. The files
 * are looked for after the run, so a VERIFY that writes a test, runs it and deletes it lands here
 * with a file that did run (see `runVerify`), and the command's exit 0 may be another program's
 * (`node --test a missing; echo done`). What is known is the runner's rule, measured with Node
 * 22.16.0 and 24.3.0 and tsx 4.23.12: it exits 0 when some of its files are missing and the others
 * pass. So an exit 0 does not show that the file was tested, and that is all the second one says.
 */
export function missingTestsLine(result: {
  readonly command: string
  readonly missing: readonly string[]
  readonly exitCode: number | null
  readonly timedOut: boolean
}): string | null {
  const { missing } = result
  if (missing.length === 0) return null

  const one = missing.length === 1
  const where =
    `${listed(missing.map((file) => `\`${file}\``))} ${one ? 'is' : 'are'} not in the workspace folder, ` +
    `where VERIFY commands run, so this check cannot count ${one ? 'it' : 'them'} as tested.`
  if (result.exitCode !== 0 || result.timedOut) return where

  const runners = [
    ...new Set(
      testRuns(result.command)
        .filter((run) => run.files.some((file) => missing.includes(file)))
        .map((run) => `\`${run.runner} --test\``),
    ),
  ]
  const solo = runners.length === 1
  return (
    `${where} ${listed(runners)} ${solo ? 'exits' : 'exit'} 0 when some of the files ${solo ? 'it is' : 'they are'} ` +
    `given are missing and the others pass, so the command's exit 0 does not show that ` +
    `${one ? 'this file was' : 'these files were'} tested.`
  )
}

/**
 * What a person reads when a run's test files were not looked for, or `null` when none went unread.
 *
 * The outcome does not change for it: a pass is still the runner's exit 0. This says that nothing
 * looked for the files, and why, so that a pass is not read as one that did. It never says a file
 * was skipped, nor that the runner was given one: it names the files by where the command writes
 * them, after `node --test`, because some of these reasons are that the runner may never see them.
 *
 * `unread` is not about a run, and says only where `--test` is: nothing may have run there at all
 * (`echo "node --test done"`), so it says neither that anything ran nor that anything was skipped.
 */
export function uncheckedTestsLine(unchecked: readonly Unchecked[]): string | null {
  const said = new Set(unchecked.map(sentence))
  return said.size === 0 ? null : [...said].join(' ')
}

function sentence({ runner, reason, word }: Unchecked): string {
  if (reason === 'unread') {
    const where = /^--test(?:=|$)/.test(loose(word))
      ? `\`${word}\` appears where the office did not read a test run`
      : `\`--test\` appears in \`${word}\`, which the office did not read as a test run`
    return `${where}, so it did not look for any test files that go with it.`
  }
  return (
    `The office did not look for the files this command names after \`${runner} --test\`: ` +
    `${BECAUSE[reason](word)}.`
  )
}

const BECAUSE: Readonly<Record<Exclude<Unchecked['reason'], 'unread'>, (word: string) => string>> = {
  moves: (word) =>
    `the command has \`${word}\` in it, and the office does not work out which folder that leaves the runner in`,
  workspace: (word) =>
    `\`${word}\` names an npm workspace setting, which can start the runner in an npm workspace's own folder ` +
    'rather than the workspace folder, where the office looks for them',
  prefix: (word) =>
    `\`${word}\` comes before the runner, and the office does not know whether that starts the runner in the ` +
    'workspace folder with the words written after it',
  taken: (word) =>
    `\`npm exec\` takes \`${word}\` for itself, as it takes every option before a \`--\`, so the runner is not ` +
    'given it',
  quoted: (word) =>
    `the runner is inside \`${word}\`, which a shell runs as a command, and the office does not read inside it`,
  rewritten: (word) =>
    `the shell or the runner may read \`${word}\` as something other than what is written, and the office ` +
    'does not work out what',
  flag: (word) => `the office does not know how \`${word}\` is read, so it cannot tell what the words after it are`,
  // The runner's rule, as measured, and not what it did this time: which Node ran is not known here.
  excluded: (word) =>
    `\`${word}\` names a file in the \`node_modules\` folder of the folder the runner starts in, and the test ` +
    'runner in Node 22.16.0 and 24.3.0 leaves out every file there without a word',
}

/** `a`, `a and b`, `a, b and c`. */
function listed(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * Which of two outcomes a person should be told about first.
 *
 * A failure outranks everything: it is the one that means something is wrong now. Refused and
 * unchecked outrank passed, because "we do not know" must not be swallowed by "some of it is
 * fine" — an employee with one green task and one nobody has run is not an employee whose work
 * is verified.
 */
const SEVERITY: Readonly<Record<TaskOutcome, number>> = {
  failed: 5,
  refused: 4,
  'not-run': 3,
  uncheckable: 2,
  passed: 1,
  done: 0,
}

export function worse(a: TaskOutcome, b: TaskOutcome): TaskOutcome {
  return SEVERITY[a] >= SEVERITY[b] ? a : b
}

/**
 * What each employee's outstanding work amounts to, one word each.
 *
 * Finished tasks are left out: the floor is about what is outstanding, and a person whose only
 * remaining task passed should read as passed rather than as whatever they did last week.
 * Owners that are not on the floor simply do not appear — a task owned by `user` is real work
 * and nobody on the floor is doing it.
 */
export function outcomesByOwner(checks: readonly Checked[]): Map<string, TaskOutcome> {
  const byOwner = new Map<string, TaskOutcome>()

  for (const check of checks) {
    const owner = check.task.owner.trim()
    if (!owner || check.task.state === 'done') continue

    const outcome = outcomeOf(check)
    const already = byOwner.get(owner)
    byOwner.set(owner, already === undefined ? outcome : worse(already, outcome))
  }

  return byOwner
}

/** Tasks that can actually be checked. The rest are reported as uncheckable, not as passing. */
export function checkable(tasks: readonly Task[]): Task[] {
  return tasks.filter((t) => t.command !== null && t.state !== 'done')
}
