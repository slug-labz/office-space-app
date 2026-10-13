/**
 * What a stranger sees the first time, and what to do about it.
 *
 * The failure this exists to prevent is specific and it is the one that loses a user in the
 * first ten seconds: **an office that is empty for a reason nobody states.** No `claude` on the
 * PATH, no agents in `.claude/agents/`, an untrusted workspace whose allow list Claude Code has
 * quietly dropped — all three render as a room with desks and nobody at them, and all three look
 * identical to "this app is broken".
 *
 * So the office says which one it is, and what the next step is. That is the whole feature.
 *
 * ## The distinction everything here turns on
 *
 * **Blocked** and **empty** are different, and conflating them is worse than saying nothing.
 * No `claude` binary means literally nothing in this app can work; the room is not empty, it is
 * unpowered. No projects yet means somebody has just arrived and has not started anything, which
 * is a perfectly good state to be in and must not be dressed up as a fault. One gets a panel
 * across the floor; the other gets a sentence and a button.
 *
 * Pure, so the ordering and the wording can be tested without a window.
 */

/*
 * The only import in this file, and the rule it may not break.
 *
 * This module had none, and the property that mattered was never the count — the docstring above
 * says it: *"pure, so the ordering and the wording can be tested without a window"*. Dependency-
 * free was the means; testable-without-a-window is the end. So: **this file may import pure
 * shared modules and nothing else.** Anything reaching for `window`, `electron` or the filesystem
 * breaks what the absence was protecting; `gate.ts` is pure and costs it nothing.
 *
 * `gate.ts` owns the six states of the approval gate, and the sentence and the remedy for each,
 * because the distinction between its "no gate" answers is the whole reason that module exists —
 * restating it here as a ternary is exactly how it would collapse back into one.
 */
import { gateLede, gateRemedy, type GateState } from './gate.js'

export type Severity =
  /** Nothing works until this is fixed. */
  | 'blocked'
  /** Works, but something a person should know is quietly not true. */
  | 'warning'
  /** Nothing is wrong. There is just nothing here yet, and here is how to start. */
  | 'empty'

export interface Step {
  readonly id: string
  readonly severity: Severity
  readonly title: string
  readonly detail: string
  /** A command to run in a terminal, shown verbatim. Null when the next step is in the app. */
  readonly command: string | null
  /** An action id from `shared/actions.ts`, when the next step is something the app can do. */
  readonly action: string | null
}

/** Everything the diagnosis needs. Assembled by the caller from the snapshot it already has. */
export interface FirstRunState {
  /** The absolute path we resolved, or null when nothing was found. */
  readonly claudePath: string | null
  /** Why it was not found, verbatim from the resolver. Shown rather than paraphrased. */
  readonly claudeProblem: string | null
  readonly staffCount: number
  readonly projectCount: number
  /** False when `projects/_TEMPLATE` is missing, so "start a project" cannot be offered. */
  readonly canCreateProject: boolean
  /**
   * Whether the office has a template of its own to copy in.
   *
   * Separate from `canCreateProject`, and the separation is the point. That one is false in two
   * situations that want different sentences: this workspace has no template *and the office has
   * one to give*, or no template exists anywhere, which is a broken build. Offering a button in
   * the second is exactly the failure-after-the-click this panel refuses to produce.
   */
  readonly canAddTemplate: boolean
  /**
   * The workspace's own instruction file: `'present' | 'absent' | 'unreadable'`.
   *
   * A string rather than a boolean because there are three answers and two of them are not "yes".
   * A `CLAUDE.md` that exists and will not open is a different problem from one that was never
   * written, and only one of them is fixed by writing a file.
   */
  readonly instructions: 'present' | 'absent' | 'unreadable'
  /**
   * What the approval gate is doing, as `shared/gate.ts` decides it.
   *
   * Carried whole rather than as a boolean: four of its six states mean "no gate" and each is
   * fixed differently, and another means the office could not tell — which must never be
   * rendered as any of them.
   */
  readonly gate: GateState
  /**
   * Whether the workspace's own permission rules are in force.
   *
   * False in an untrusted workspace, where Claude Code drops `permissions.allow` on the floor and
   * keeps `permissions.deny`. Nothing the allow list names runs without asking — including the
   * commands every VERIFY condition is made of, which from inside the app is indistinguishable
   * from an allowlist that does not work.
   */
  readonly permissionsInForce: boolean
  /**
   * The installed app bundle, when macOS still has it flagged `com.apple.quarantine`.
   *
   * Null in every other case, and the cases are not alike: off macOS the flag is not a thing
   * that exists, run from a clone there is no bundle of ours to be flagged, and on a Mac where
   * the check could not run we do not know. `main/quarantine.ts` keeps those apart and hands
   * over a path only when it has actually seen the flag — so null here means "nothing to say",
   * never "we looked and it is fine".
   */
  readonly quarantinedApp: string | null
  /** Directories and files discovery could not read. Never the same as absent. */
  readonly unreadable: readonly string[]
  /**
   * Everything else the office noticed, as one line each.
   *
   * The app had two surfaces telling somebody what was wrong with their workspace: this panel,
   * and a banner along the bottom of the floor that printed the whole of the first problem. They
   * overlapped — the untrusted warning appeared in both, in different words — and neither was
   * complete, because the panel knew about three specific conditions and the banner knew about
   * every problem discovery had ever reported.
   *
   * One surface. The conditions this module understands get a proper step with a next action;
   * anything else arrives here and gets a row, which is better than a row in a second place.
   */
  readonly problems: readonly string[]
}

/**
 * The steps, worst first.
 *
 * Empty when there is genuinely nothing to say, which is the common case after the first day
 * and is why this returns a list rather than a panel: a clean office shows nothing at all.
 */
export function diagnose(state: FirstRunState): readonly Step[] {
  const steps: Step[] = []

  if (state.claudePath === null) {
    steps.push({
      id: 'no-claude',
      severity: 'blocked',
      title: 'The office cannot find the claude command',
      // The resolver's own account of where it looked, not a summary of it. "Not found" is
      // useless; "looked in these six places" is something a person can act on.
      detail:
        state.claudeProblem ??
        'Office Space runs the claude you already have installed. Without it there is nothing to run.',
      command: 'npm install -g @anthropic-ai/claude-code',
      action: null,
    })
  }

  // Only worth saying once there is something to run it with. Told to somebody who has no
  // `claude` at all, "your permissions are not in force" is noise stacked on a blocker.
  if (state.claudePath !== null && !state.permissionsInForce) {
    steps.push({
      id: 'untrusted',
      severity: 'warning',
      // Not *"nothing here may run a command"*, which is what this said and is false — the
      // detail below has always contradicted it, and `trust.ts` records correcting the same
      // overstatement in its own message: Claude Code does not sandbox an untrusted workspace,
      // it stops honouring the list. What stops is the office's checking.
      //
      // And not *"drops a workspace's permission rules"*, nor checks that come back *"not
      // allowed"*: Claude Code ignores the allow rules and keeps the deny rules (measured against
      // 2.1.266 on 2026-09-16), and the harness does the same, so a check comes back not checked,
      // or refused where a deny rule covers it. A person can still run one by hand.
      title: 'This workspace is not trusted, so the office verifies nothing here on its own',
      detail:
        'Claude Code ignores a workspace’s allow rules until you trust it, though it still ' +
        'applies its deny rules. The staff can still read and write files, but every VERIFY ' +
        'condition is a command, so the office runs none of them on its own: checks come back ' +
        'not checked, or refused where a deny rule covers them, rather than passing or failing. ' +
        'Run claude once in this directory and accept the prompt.',
      command: 'claude',
      action: null,
    })
  }

  for (const path of state.unreadable) {
    steps.push({
      id: `unreadable:${path}`,
      severity: 'warning',
      title: 'Something here could not be read',
      // The fourth standing order, at the moment it costs the most. A directory that cannot be
      // read is not an empty one, and a first-run screen that quietly counted it as zero would
      // teach a stranger that the office is empty when it is not.
      detail: `${path} exists and could not be read, so whatever is in it is not on the floor. This is not the same as it being empty.`,
      command: null,
      action: null,
    })
  }

  /**
   * Below the two warnings above it, and deliberately.
   *
   * Both of those mean something is *not true on screen*: an allowlist that is not in force, a
   * directory whose contents are not on the floor. This one means the app is working and one
   * piece of macOS bookkeeping was never finished — real, worth a line, and the least urgent
   * thing in this list precisely because the person reading it is already inside.
   *
   * Never blocked, whatever it costs a downloader. A blocker takes the floor over, and taking
   * the floor over to discuss the launch of an app that has plainly launched would be the
   * office lying about its own state to make a point about signing.
   */
  if (state.quarantinedApp !== null) {
    steps.push({
      id: 'quarantined',
      severity: 'warning',
      title: 'macOS still has this app marked as downloaded',
      detail:
        `Anything that arrives through a browser is marked com.apple.quarantine, and macOS lifts ` +
        `that mark by itself only for apps signed by Apple — a $99/year membership this project ` +
        `has deliberately not bought, which is why it may have told you the app was damaged. It ` +
        `is not. You are past it for now, but the mark is still on the app, so the next update ` +
        `meets the same wall. This clears it for good, and touches nothing else.`,
      // The path we actually found, not the one the install card assumes. Somebody who put the
      // app somewhere other than /Applications would otherwise be handed a command that
      // succeeds against a bundle that is not theirs and changes nothing.
      command: `xattr -cr "${state.quarantinedApp}"`,
      action: null,
    })
  }

  // After the three conditions this module understands, and before the two "nothing here yet"
  // rows — a problem the office reported is more urgent than an empty room and less urgent than
  // a missing binary.
  for (const [index, problem] of state.problems.entries()) {
    steps.push({
      id: `problem:${index}`,
      severity: 'warning',
      title: 'The office noticed something',
      detail: problem,
      command: null,
      action: null,
    })
  }

  if (state.staffCount === 0) {
    /**
     * Zero staff because there are none, or zero staff because we could not look.
     *
     * `unreadable` is on this state for exactly this reason -- "never the same as absent" -- and
     * this step did not consult it. A workspace whose `.claude/agents/` cannot be opened was
     * told "nobody works here yet" and offered a Hire button, with seven employees sitting in
     * that directory. Following that advice writes an eighth file nobody can read and leaves
     * the actual fault in place.
     *
     * The warnings below already listed every unreadable file, and that is not enough: this is
     * the headline, it is the step carrying the action, and it stated the one thing standing
     * order 4 exists to prevent.
     */
    // Written out rather than imported: the constants live in `main/roster.ts`, and shared code
    // must not reach into main. Separators normalised so a Windows path matches the same way.
    const cannotRead = state.unreadable.some((path) => path.replace(/\\/g, '/').includes('.claude/agents'))
    if (cannotRead) {
      steps.push({
        id: 'staff-unreadable',
        severity: 'blocked',
        title: 'The staff could not be read, so the office cannot answer you',
        detail:
          'There may be employees in .claude/agents/ — this office could not open it to find out, so it has nobody to act as the manager. Check the permissions on that directory. Whatever is in there has not been changed.',
        command: null,
        action: null,
      })
    } else {
    steps.push({
      id: 'no-staff',
      /**
       * Blocked, not empty — and the distinction is the whole of somebody's first minute.
       *
       * This said `empty`, and `showFirstRun` deliberately keeps the panel shut for a workspace
       * that is merely empty: nothing is wrong, there is just nothing here yet. That reasoning
       * is right for an office with staff and no projects. It is wrong here, because **no staff
       * means no manager, and no manager means nothing can run at all** — `openSession` throws
       * on it.
       *
       * What a stranger actually met: a beautifully drawn empty room, a composer inviting them
       * to "Ask the manager for something…", a header reading `the manager · idle`, and two red
       * blocks in the transcript, one of which was a raw IPC error with an absolute temp path.
       * The one screen that explains all of it stayed behind a small link in the status bar.
       *
       * An office that cannot answer you is blocked whatever the reason, and a blocker opens
       * itself.
       */
      severity: 'blocked',
      title: 'Nobody works here yet, so there is no manager to answer you',
      detail:
        'An employee is a markdown file in .claude/agents/ — a name, a sentence about what they are for, and their prompt. The office needs at least one with a Task tool to act as the manager. Write one by hand or let the office write it for you, and a desk appears.',
      command: null,
      action: 'hire',
    })
    }
  }

  /*
   * Whether the approval gate is actually there.
   *
   * `blocked`, and this is the one place that severity is used for something the office will
   * happily keep running through. The office genuinely works without standing instructions; it
   * does **not** work as advertised without this, because `acceptEdits` plus unapproved Bash is
   * the exact configuration the whole approval story exists to prevent. A person who believes
   * they have a gate and does not is worse off than one who knows they have none.
   *
   * Both halves are shipped files somebody may edit, and `reconcile.ts` will not restore either —
   * correctly, by the same rule that stops a deleted skill coming back. So this can be
   * permanently absent by design, and what the office sees then is an empty approvals directory:
   * indistinguishable from a working gate nobody has triggered.
   */
  const gateSays = gateLede(state.gate)
  if (gateSays !== null) {
    steps.push({
      id: `gate-${state.gate.state}`,
      // Could-not-tell is not the same alarm. It is a thing to go and look at, not a statement
      // that commands are running unapproved — see `gateState`, which checks it before anything
      // else for this reason.
      severity: state.gate.state === 'unreadable' ? 'warning' : 'blocked',
      title:
        state.gate.state === 'unreadable'
          ? 'Whether commands are being approved is unknown'
          : 'Commands are running without the approval gate',
      // The remedy comes from `gate.ts` too, by state, so a new state cannot borrow another's.
      detail: `${gateSays} ${gateRemedy(state.gate)}`,
      command: null,
      action: null,
    })
  }

  /*
   * The instruction file, which is the one part of a `.claude/` workspace this panel said nothing
   * about.
   *
   * Not cosmetic, and not hypothetical: the build manifest did not carry `CLAUDE.md`, so no
   * installed office ever received one. Every agent in every packaged workspace ran with no
   * standing instructions, the floor drew, the manager answered, and nothing anywhere said so. A
   * workspace with no instruction file is not broken in a way anybody can see.
   *
   * `warning` rather than `blocked`: the office genuinely does run without it, and calling a
   * working office broken is how a panel earns being closed unread. Not `empty` either — that
   * severity means *nothing is wrong, there is just nothing here yet*, and this absence has a
   * consequence. `warning`'s own definition is the exact fit: works, but something a person
   * should know is quietly not true.
   */
  if (state.instructions === 'unreadable') {
    steps.push({
      id: 'instructions-unreadable',
      severity: 'warning',
      title: 'The instruction file is there and could not be read',
      detail:
        'CLAUDE.md sits at the root of this workspace and every agent reads it before doing ' +
        'anything. This office could not open it, so it cannot tell you what it says — and ' +
        'neither, probably, can they. Check the permissions on that file. Nothing in it has ' +
        'been changed.',
      command: null,
      action: null,
    })
  } else if (state.instructions === 'absent') {
    steps.push({
      id: 'no-instructions',
      severity: 'warning',
      title: 'This workspace has no standing instructions',
      detail:
        'CLAUDE.md sits at the root of a workspace, and every agent Claude Code starts here ' +
        'reads it first. There is none, so everyone works from their own prompt alone — which ' +
        'runs, and is why nothing else here says anything is wrong. Write one at ' +
        'CLAUDE.md and it applies to the whole office from the next turn.',
      command: null,
      action: null,
    })
  }

  if (state.projectCount === 0) {
    /**
     * The twin of the staff case above, and it said two false things rather than one.
     *
     * A `projects/` directory that cannot be opened produced "No projects yet" *and* "that
     * template is missing, so the office cannot start one for you ... or re-clone" -- because
     * `canCreateProject` is false for the same reason the count is zero, and neither is evidence
     * about what is on disk. Re-cloning does not fix a permissions bit; it tells somebody their
     * work is gone when it is sitting exactly where they left it.
     *
     * Matched on the path ending rather than containing, because a workspace can perfectly well
     * live under a directory with "projects" in its name.
     */
    const cannotRead = state.unreadable.some((path) => /(^|\/)projects$/.test(path.replace(/\\/g, '/')))
    if (cannotRead) {
      steps.push({
        id: 'projects-unreadable',
        severity: 'warning',
        title: 'The projects directory could not be read',
        detail:
          'There may be projects in projects/ — this office could not open it to find out, so none of them are listed and it cannot start a new one either. Check the permissions on that directory. Nothing in it has been changed.',
        command: null,
        action: null,
      })
    } else {
    steps.push({
      id: 'no-projects',
      severity: 'empty',
      title: 'No projects yet',
      /*
       * "Re-clone" was wrong advice for the person most likely to read it.
       *
       * The template is missing exactly where `OFFICE_WORKSPACE` points the office at a
       * repository somebody already has — which is a supported way to run it, not a broken
       * install. Telling them to re-clone their own repository is advice about a different
       * situation, and the dead end it left was the product's own pitch failing at step one.
       *
       * The office has the template; it simply does not write into a directory you chose
       * without being asked. So it asks.
       */
      detail: state.canCreateProject
        ? 'A project is a directory under projects/ with a plan, a progress log and a task list. The office copies the template to start one.'
        : state.canAddTemplate
          ? 'A project is a directory under projects/ with a plan, a progress log and a task list, copied from projects/_TEMPLATE. This workspace has no template — the office does not put files into a directory you chose without asking. It can add one now.'
          : 'A project is a directory under projects/ copied from projects/_TEMPLATE — and that template is missing, so the office cannot start one for you. This build does not carry one either, so there is nothing to copy in. Create the directory by hand, or re-clone.',
      command: null,
      action: state.canCreateProject ? 'new-project' : state.canAddTemplate ? 'add-template' : null,
    })
    }
  }

  /**
   * Worst first, and enforced rather than hoped for.
   *
   * The order used to be whatever order the pushes happened to be in, and it read correctly for
   * as long as the pushes stayed sorted by accident. The moment `no-staff` became a blocker it
   * stopped: a blocker sat below two warnings, and `summarise` — which answers with
   * `steps[0].title` — would have named a warning as the worst thing.
   *
   * A stable sort, so within one severity the push order still carries its meaning: a missing
   * binary before an untrusted workspace, because the first makes the second irrelevant.
   */
  const rank: Record<Severity, number> = { blocked: 0, warning: 1, empty: 2 }
  return [...steps].sort((a, b) => rank[a.severity] - rank[b.severity])
}

/**
 * Whether the first-run panel should be on screen, given what was found and who asked.
 *
 * This lived inside `showFirstRun` in `app.ts` as three early returns among the DOM writes, and
 * that is where it stayed wrong. `app.ts` runs top-level side effects and needs a `window.office`
 * to load at all, so nothing in the suite could reach the decision — the branch below that opens
 * on a forced press was broken, shipped, and reported by the user as "the button does nothing",
 * and re-breaking it afterwards still turned every test green. A decision no test can address is
 * a decision that gets to be wrong indefinitely.
 *
 * Three outcomes, not two, because "do not open" splits: an empty diagnosis actively **shuts** a
 * panel that may be open from a previous state, while a merely-uninteresting one **leaves** it
 * exactly as it is. Collapsing those loses the difference between answering and not being asked.
 */
export type FirstRunVerdict =
  /** Draw it. */
  | 'open'
  /** Nothing to report: close it if it is open. */
  | 'shut'
  /** Not worth interrupting for: leave whatever is on screen alone. */
  | 'leave'

export function firstRunVerdict(input: {
  readonly steps: readonly Step[]
  /** Somebody pressed the control that opens this, rather than the app deciding to show it. */
  readonly force: boolean
  /** They have closed it once already this session. */
  readonly dismissed: boolean
}): FirstRunVerdict {
  const { steps, force, dismissed } = input

  // Nothing wrong, and nobody asked. A forced open falls through deliberately: a control that
  // answers a press by doing nothing is indistinguishable from a broken one, and "everything is
  // fine" is an answer worth a panel when it is the answer somebody asked for.
  if (steps.length === 0 && !force) return 'shut'

  // A blocker opens itself and keeps opening itself: an office that cannot run anything is not a
  // state somebody should be able to dismiss and then wonder about. Everything else waits.
  if (force || isBlocked(steps)) return 'open'

  if (dismissed) return 'leave'

  // Nothing is wrong — there is just nothing here yet. Worth one line in the status bar, not a
  // panel across somebody's first look at the office.
  if (steps.every((step) => step.severity === 'empty')) return 'leave'

  return 'open'
}

/**
 * Whether the office is unusable rather than merely new.
 *
 * Decides between a panel across the floor and a line at the bottom of it. Only a `blocked` step
 * earns the takeover: interrupting somebody's first look at the office to tell them they have
 * not started a project yet would be the app treating its own onboarding as more important than
 * the thing it is onboarding them to.
 */
export function isBlocked(steps: readonly Step[]): boolean {
  return steps.some((step) => step.severity === 'blocked')
}

/** The one-line version, for the status bar. Null when there is nothing to say. */
export function summarise(steps: readonly Step[]): string | null {
  if (steps.length === 0) return null
  const blocked = steps.filter((s) => s.severity === 'blocked').length
  if (blocked > 0) return steps[0]?.title ?? null
  const warnings = steps.filter((s) => s.severity === 'warning').length
  if (warnings > 0) return warnings === 1 ? '1 thing to know' : `${warnings} things to know`
  return 'getting started'
}
