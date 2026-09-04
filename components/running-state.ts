/**
 * Whose work the running timer is, as far as one surface can tell.
 *
 * Kept as a pure function so the three states are testable without driving a
 * Radix popover in jsdom, and so the rule lives in one place rather than
 * inside a className expression.
 */
import { matchesReference } from "../harvest/reference.js";
import type { ExternalReference } from "../harvest/types.js";

export type RunningScope = "idle" | "here" | "elsewhere";

export function runningScope(
  entry: { externalReference: ExternalReference | null } | null,
  threadReference: { id: string; groupId: string | null } | null,
): RunningScope {
  if (entry === null) return "idle";

  // A thread with no pull request has nothing to compare against. Claiming
  // "elsewhere" would be a guess, and the wrong one whenever the timer was
  // started from this very control, so an unknowable case keeps the older,
  // more forgiving reading.
  if (threadReference === null) return "here";

  const isHere = matchesReference(entry.externalReference, {
    externalId: threadReference.id,
    groupId: threadReference.groupId,
  });

  return isHere ? "here" : "elsewhere";
}
