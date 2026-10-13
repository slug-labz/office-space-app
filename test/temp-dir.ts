/**
 * A temporary directory that is gone when the test that made it is.
 *
 * Every fixture directory in this suite used to be a bare `mkdtemp`, and most were never removed.
 * On 2026-09-17 the shared temp dir held about 2.2 GiB named `office-*`, sixty-six 20 MB model
 * downloads among them, and one full `npm test` added about 412 entries and 33 MB — the user's
 * counts, repeated here rather than re-taken.
 *
 * So the call that makes a directory also registers its removal, on the test that asked for it,
 * and there is no way to get one without the other. A helper that makes directories for its
 * callers takes their test context and passes it on, rather than handing back a cleanup every
 * caller would have to remember. `temp-dir.test.ts` checks the removal happens, and holds this as
 * the only file under `test/` that calls `mkdtemp`.
 *
 * `force`, because some tests remove their directory themselves. `maxRetries`, because a child
 * process a test started can still be writing into the directory as the test ends; Node retries
 * the removal on EBUSY, ENOTEMPTY and EPERM instead of failing on the first.
 *
 * The removal runs after the test's own `finally` blocks, so a directory a test locked and then
 * unlocked is removable by then. One a test leaves locked is not — measured on Node 22.16, a
 * `0o000` directory with a file in it, or a `0o555` one, fails the removal with EACCES, which
 * fails the test. That is a test that skipped its own restore, and worth hearing about.
 *
 * It also runs before any `after` hook registered later. node:test runs a test's `after` hooks in
 * the order they were registered — measured on Node 22.16: the body, its `finally`, then each
 * hook in turn, and the same when the test fails — and this one is registered by the call that
 * makes the directory. So a `t.after(() => watcher.close())` added after `tempDir` runs once the
 * directory is already gone. Teardown that has to come first, such as closing a watcher or
 * stopping a child still writing into the directory, belongs in the test's own `finally`.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'

export async function tempDir(t: TestContext, prefix: string): Promise<string> {
  // The removal is registered before the directory exists. A call with no test to hang it on —
  // `workspace()` in a branch written before this helper, which typecheck refuses and tsx runs
  // anyway — then throws before it has made anything, instead of just after.
  let dir: string | null = null
  t.after(() => (dir === null ? undefined : rm(dir, { recursive: true, force: true, maxRetries: 3 })))
  dir = await mkdtemp(join(tmpdir(), prefix))
  return dir
}
