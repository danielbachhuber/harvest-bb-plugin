import { fromApiReference } from "./reference.js";
import type { TimeEntry } from "./types.js";

/**
 * Read a Harvest time entry into the plugin's shape.
 *
 * `timer_started_at` is retained on stopped entries, so it is only carried
 * through when `is_running` agrees. Without that check a stopped entry would
 * render as a timer counting up forever.
 */
export function fromApiEntry(raw: unknown): TimeEntry | null {
  if (raw === null || typeof raw !== "object") return null;

  const source = raw as Record<string, unknown>;
  const id = source.id;
  if (typeof id !== "number" || !Number.isFinite(id)) return null;

  const isRunning = source.is_running === true;
  const startedAt = typeof source.timer_started_at === "string" ? source.timer_started_at : null;

  return {
    id,
    projectName: nameOf(source.project),
    taskName: nameOf(source.task),
    notes: typeof source.notes === "string" && source.notes !== "" ? source.notes : null,
    hours: typeof source.hours === "number" && Number.isFinite(source.hours) ? source.hours : 0,
    timerStartedAt: isRunning ? startedAt : null,
    externalReference: fromApiReference(source.external_reference ?? null),
  };
}

/**
 * The one timer currently running, if any.
 *
 * Harvest allows a single running timer per user, but a read taken while the
 * user switches timers can show two. The most recently started one is the
 * truthful answer.
 */
export function pickRunningEntry(entries: unknown[]): TimeEntry | null {
  const running = entries
    .map(fromApiEntry)
    .filter((entry): entry is TimeEntry => entry !== null && entry.timerStartedAt !== null);

  if (running.length === 0) return null;

  return running.reduce((latest, entry) =>
    startedMs(entry) > startedMs(latest) ? entry : latest,
  );
}

function startedMs(entry: TimeEntry): number {
  const parsed = Date.parse(entry.timerStartedAt ?? "");
  return Number.isNaN(parsed) ? 0 : parsed;
}

function nameOf(value: unknown): string {
  if (value === null || typeof value !== "object") return "";
  const name = (value as Record<string, unknown>).name;
  return typeof name === "string" ? name : "";
}
