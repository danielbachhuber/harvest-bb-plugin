import { describe, expect, test } from "vitest";

import { fromApiEntry, pickRunningEntry } from "./time-entry.js";

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
