import { toApiReference } from "./reference.js";
import type { ExternalReference } from "./types.js";

export interface StartTimerInput {
  projectId: number;
  taskId: number;
  notes: string;
  externalReference?: ExternalReference;
}

/**
 * The calendar day to log against, in the user's own timezone.
 *
 * Deriving this from UTC logs late-evening work to tomorrow, which is a
 * mistake nobody catches until they read a timesheet.
 */
export function spentDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/** A wall-clock start time in the twelve-hour form Harvest accepts. */
export function startedTimeLabel(now: Date): string {
  const hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const suffix = hours < 12 ? "am" : "pm";
  const twelveHour = hours % 12 === 0 ? 12 : hours % 12;

  return `${twelveHour}:${minutes}${suffix}`;
}

/**
 * The `POST /v2/time_entries` body that starts a running timer.
 *
 * An account tracks time either by duration or by start and end time, and the
 * body differs. On a duration account the timer runs precisely because `hours`
 * is absent; supplying it creates a finished zero-hour entry and the request
 * still returns 201, so the mistake is invisible. On a timestamp account
 * `started_time` is required and `ended_time` must stay absent for the same
 * reason.
 */
export function startEntryBody(
  input: StartTimerInput,
  options: { wantsTimestampTimers: boolean; now: Date },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    project_id: input.projectId,
    task_id: input.taskId,
    spent_date: spentDate(options.now),
    notes: input.notes,
  };

  if (options.wantsTimestampTimers) {
    body.started_time = startedTimeLabel(options.now);
  }

  if (input.externalReference !== undefined) {
    body.external_reference = toApiReference(input.externalReference);
  }

  return body;
}
