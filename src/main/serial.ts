/**
 * One at a time, in the order they were asked for.
 *
 * Written for the session registry, which is where the need showed up. `saveRegistry` writes the
 * whole file from whatever the caller's state holds *when it reads it*, so two overlapping calls
 * raced on content: each captured its own view, and whichever finished last won. A conversation
 * updated by the slower caller was replaced by a state that predated it — silently, because both
 * writes succeeded.
 *
 * Unique temp files stop two writers destroying each other's scratch file. They do not stop the
 * older answer landing second, because that is a question about the caller's state rather than
 * about files.
 *
 * ## Why a chain and not a lock
 *
 * There is nothing to lock. The main process is single-threaded, so the hazard is not two writers
 * in the same instant — it is a write that began before another finished, reading state that has
 * since moved. Chaining the *starts* is exactly the fix: each task begins only once the one
 * before it has ended, so a task that reads a variable reads it late rather than early.
 *
 * That is also why the task is a function rather than a value. Passing `saveRegistry(root,
 * sessions)` would evaluate `sessions` at queue time, which is the bug this exists to prevent;
 * passing `() => saveRegistry(root, sessions)` reads it when its turn comes.
 */

export interface Serial {
  /**
   * Run `task` after everything already queued, and resolve with **whatever it returns**.
   *
   * Generic rather than `Promise<void>`, and the first version was not. A queue that swallows
   * the return value forces every caller with an answer to smuggle it out through a mutable
   * closure variable and a sentinel for "the task never ran" — which is what `ledger.ts` did,
   * in the file that records what the office actually did. The value belongs to the caller;
   * dropping it here only moves the problem.
   */
  <T>(task: () => Promise<T>): Promise<T>
}

/**
 * A fresh queue.
 *
 * A failure is reported to the caller that asked for it and **not** to the ones behind it: the
 * queue continues, because one failed write is not a reason to stop writing. Swallowing it
 * instead of rethrowing would be the fourth standing order — the caller is the only one who can
 * say that the thing it asked for did not happen.
 */
export function serial(): Serial {
  let tail: Promise<unknown> = Promise.resolve()

  return <T>(task: () => Promise<T>): Promise<T> => {
    // Both arms, so a rejection behind us does not skip our turn — `then(onOk)` alone would
    // leave the chain rejected and every later task would inherit a failure it had no part in.
    const run = tail.then(task, task)
    // The tail carries no value and swallows failures: it exists to sequence, and a caller's
    // rejection is that caller's to hear. `run` keeps it.
    tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}
