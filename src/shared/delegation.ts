/**
 * The delegation tool, by name.
 *
 * One fact, in one place, because it is load-bearing in four of them: the lint that enforces
 * "only the manager may delegate", the choreography that walks an employee into the manager's
 * office, the voice digest that decides a dispatch is worth mentioning, and the transcript card
 * that renders it as a handoff rather than as a tool call.
 *
 * Those four used to name the tool independently — the lint accepted both spellings while the
 * other three hard-coded `Task`. That combination fails in the worst available way: the day the
 * CLI settles on the other name, the lint keeps passing and the floor goes quiet, so the office
 * carries on looking correct while it has stopped depicting the one event the whole product is
 * built around. A rename should break everything at once or nothing at all.
 */

/** Both spellings. Renamed Task → Agent in the harness; the CLI still emits Task. */
const DELEGATION_TOOLS = new Set(['Agent', 'Task'])

export function isDelegationTool(name: string): boolean {
  return DELEGATION_TOOLS.has(name)
}

// `DELEGATION_TOOL_NAMES` was here, "for error messages that have to list them". No error
// message lists them. `DELEGATION_TOOLS` is the live one, and `isDelegationTool` is how it is
// asked.

/**
 * Whether a dispatch's `tool_result` is a launch receipt rather than an answer.
 *
 * `run_in_background` defaults to **true**, so a dispatch's result arrives within milliseconds
 * saying the agent was launched — not what it found. Treating that as completion is what made
 * the floor walk an employee to their desk and immediately walk them back to report, while the
 * agent was still working; the real ending arrives later as `task_notification`.
 *
 * String matching, which is not something to be pleased about — but the alternative is treating
 * every dispatch result as a real one, and this fails in the safe direction: a launch we fail to
 * recognise looks like a fast completion (today's behaviour), while a real result can never be
 * mistaken for a launch, because a subagent's answer does not contain this sentence.
 */
export function isAsyncLaunch(resultText: string): boolean {
  return resultText.includes('Async agent launched')
}
