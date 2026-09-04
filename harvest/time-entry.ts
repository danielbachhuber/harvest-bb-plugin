import { fromApiReference, matchesReference } from "./reference.js";
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

/**
 * The day's entry for this work, if there is one.
 *
 * Harvest's own convention is a single entry per project, task and day, which
 * a timer resumes rather than replaces. Posting a new entry on every start
 * scatters one day's work across duplicates that have to be merged by hand.
 *
 * A running match is returned rather than skipped, because the caller has to
 * be able to tell "already tracking this" from "nothing here yet". Reporting
 * null for a running entry made the caller post a duplicate for work that was
 * already being tracked.
 *
 * `entries` is expected to be already narrowed to one project, task and day;
 * this decides only whether an entry is about the same thing.
 */
export function findDayEntry(
  entries: TimeEntry[],
  query: { externalId: string; groupId?: string | null } | null,
): TimeEntry | null {
  const candidates = entries.filter((entry) => {
    // Unlinked work matches only unlinked entries, and vice versa: one project
    // and task can cover both a specific issue and general work.
    if (query === null) return entry.externalReference === null;
    return matchesReference(entry.externalReference, query);
  });

  if (candidates.length === 0) return null;

  // Whatever is running is the authoritative answer for right now. Failing
  // that, the entry carrying the most time is the day's real one.
  const running = candidates.find((entry) => entry.timerStartedAt !== null);
  if (running !== undefined) return running;

  return candidates.reduce((most, entry) => (entry.hours > most.hours ? entry : most));
}
