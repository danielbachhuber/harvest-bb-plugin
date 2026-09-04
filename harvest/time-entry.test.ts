import { describe, expect, test } from "vitest";

import { findDayEntry, fromApiEntry, pickRunningEntry } from "./time-entry.js";

function raw(overrides: Record<string, unknown> = {}) {
  return {
    id: 636709355,
    hours: 0.4166666667,
    notes: "#5515: Audit areas",
    is_running: true,
    timer_started_at: "2026-09-02T10:00:00Z",
    project: { id: 11, name: "Internal" },
    task: { id: 22, name: "Development" },
    external_reference: { id: "5515", group_id: "psi-product" },
    ...overrides,
  };
}

describe("fromApiEntry", () => {
  test("maps a running entry onto the plugin shape", () => {
    expect(fromApiEntry(raw())).toEqual({
      id: 636709355,
      projectName: "Internal",
      taskName: "Development",
      notes: "#5515: Audit areas",
      hours: 0.4166666667,
      timerStartedAt: "2026-09-02T10:00:00Z",
      externalReference: {
        id: "5515",
        groupId: "psi-product",
        accountId: null,
        permalink: null,
      },
    });
  });

  test("reads a stopped entry as having no timer start", () => {
    const entry = fromApiEntry(raw({ is_running: false, timer_started_at: null }));
    expect(entry?.timerStartedAt).toBeNull();
  });

  test("ignores a timer start on an entry that is not running", () => {
    // Harvest keeps timer_started_at on stopped entries, and treating it as
    // live would show a stopped timer counting up forever.
    const entry = fromApiEntry(raw({ is_running: false }));
    expect(entry?.timerStartedAt).toBeNull();
  });

  test("reads absent hours as zero", () => {
    const entry = fromApiEntry(raw({ hours: null }));
    expect(entry?.hours).toBe(0);
  });

  test("reads an empty note as absent", () => {
    const entry = fromApiEntry(raw({ notes: "" }));
    expect(entry?.notes).toBeNull();
  });

  test("reads an unlinked entry as having no reference", () => {
    const entry = fromApiEntry(raw({ external_reference: null }));
    expect(entry?.externalReference).toBeNull();
  });

  test("rejects an entry with no id", () => {
    expect(fromApiEntry(raw({ id: null }))).toBeNull();
  });

  test("rejects a non-object", () => {
    expect(fromApiEntry(null)).toBeNull();
    expect(fromApiEntry("nope")).toBeNull();
  });
});

describe("pickRunningEntry", () => {
  test("finds the running entry among stopped ones", () => {
    const entries = [
      raw({ id: 1, is_running: false, timer_started_at: null }),
      raw({ id: 2 }),
    ];
    expect(pickRunningEntry(entries)?.id).toBe(2);
  });

  test("reads no running timer as null", () => {
    const entries = [raw({ id: 1, is_running: false, timer_started_at: null })];
    expect(pickRunningEntry(entries)).toBeNull();
  });

  test("reads an empty list as null", () => {
    expect(pickRunningEntry([])).toBeNull();
  });

  test("prefers the most recently started when Harvest reports several", () => {
    // Harvest allows one running timer per user, but a stale read during a
    // switch can show two, and the newer one is the truthful answer.
    const entries = [
      raw({ id: 1, timer_started_at: "2026-09-02T09:00:00Z" }),
      raw({ id: 2, timer_started_at: "2026-09-02T11:00:00Z" }),
      raw({ id: 3, timer_started_at: "2026-09-02T10:00:00Z" }),
    ];
    expect(pickRunningEntry(entries)?.id).toBe(2);
  });
});

describe("findDayEntry", () => {
  const stopped = (overrides: Record<string, unknown> = {}) =>
    fromApiEntry(raw({ is_running: false, timer_started_at: null, ...overrides }))!;

  const reference = { externalId: "5851", groupId: "psi-product" };

  test("finds the day's entry for the same thing, so the day keeps one entry", () => {
    // Harvest's own convention is one entry per project, task and day. Posting
    // a second scatters a day's work across duplicates.
    const entry = stopped({ id: 41, external_reference: { id: "5851", group_id: "psi-product" } });
    expect(findDayEntry([entry], reference)?.id).toBe(41);
  });

  test("ignores an entry for a different item", () => {
    const entry = stopped({ id: 41, external_reference: { id: "9999", group_id: "psi-product" } });
    expect(findDayEntry([entry], reference)).toBeNull();
  });

  test("ignores the same number in another repository", () => {
    const entry = stopped({ id: 41, external_reference: { id: "5851", group_id: "other-repo" } });
    expect(findDayEntry([entry], reference)).toBeNull();
  });

  test("returns an entry that is already running, rather than hiding it", () => {
    // The caller has to know: a running match means there is nothing to do.
    // Reporting null here made the caller post a duplicate for work already
    // being tracked.
    const entry = fromApiEntry(
      raw({ id: 41, is_running: true, external_reference: { id: "5851", group_id: "psi-product" } }),
    )!;
    expect(findDayEntry([entry], reference)?.id).toBe(41);
  });

  test("prefers a running entry over a larger stopped one", () => {
    // Whatever is running is the authoritative answer for right now.
    const linked = { id: "5851", group_id: "psi-product" };
    const bigger = stopped({ id: 41, hours: 3, external_reference: linked });
    const running = fromApiEntry(
      raw({ id: 42, hours: 0.1, is_running: true, external_reference: linked }),
    )!;
    expect(findDayEntry([bigger, running], reference)?.id).toBe(42);
  });

  test("matches an unlinked entry when there is nothing to link to", () => {
    // A timer started from the thread header has no reference, and the same
    // project, task and day is still the same bucket of work.
    const entry = stopped({ id: 41, external_reference: null });
    expect(findDayEntry([entry], null)?.id).toBe(41);
  });

  test("does not resume a linked entry for unlinked work", () => {
    const entry = stopped({ id: 41, external_reference: { id: "5851", group_id: "psi-product" } });
    expect(findDayEntry([entry], null)).toBeNull();
  });

  test("prefers the entry with the most time when a day has several", () => {
    // Duplicates happen (a timer started in another tool, a manual entry).
    // The one carrying the day's work is the one to resume.
    const linked = { id: "5851", group_id: "psi-product" };
    const slight = stopped({ id: 41, hours: 0.25, external_reference: linked });
    const substantial = stopped({ id: 42, hours: 1.5, external_reference: linked });
    expect(findDayEntry([slight, substantial], reference)?.id).toBe(42);
  });

  test("reads an empty day as nothing to resume", () => {
    expect(findDayEntry([], reference)).toBeNull();
  });
});
