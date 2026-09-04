import { describe, expect, test } from "vitest";

import { spentDate, startEntryBody, startedTimeLabel } from "./entry.js";

const reference = {
  id: "5515",
  groupId: "psi-product",
  accountId: "danielbachhuber",
  permalink: "https://github.com/danielbachhuber/psi-product/issues/5515",
};

const input = { projectId: 11, taskId: 22, notes: "#5515: Audit areas" };

describe("spentDate", () => {
  test("uses the local calendar day, not the UTC one", () => {
    // Late local evening is already the next day in UTC, and logging time to
    // tomorrow is the kind of error nobody notices until payroll.
    expect(spentDate(new Date(2026, 8, 2, 23, 30))).toBe("2026-09-02");
  });

  test("pads single-digit months and days", () => {
    expect(spentDate(new Date(2026, 0, 5, 9, 0))).toBe("2026-01-05");
  });
});

describe("startedTimeLabel", () => {
  test("renders morning times with am", () => {
    expect(startedTimeLabel(new Date(2026, 8, 2, 10, 25))).toBe("10:25am");
  });

  test("renders afternoon times with pm on a twelve-hour clock", () => {
    expect(startedTimeLabel(new Date(2026, 8, 2, 13, 5))).toBe("1:05pm");
  });

  test("renders midnight as twelve am", () => {
    expect(startedTimeLabel(new Date(2026, 8, 2, 0, 0))).toBe("12:00am");
  });

  test("renders noon as twelve pm", () => {
    expect(startedTimeLabel(new Date(2026, 8, 2, 12, 0))).toBe("12:00pm");
  });
});

describe("startEntryBody", () => {
  const now = new Date(2026, 8, 2, 10, 25);

  test("omits hours on a duration account, which is what starts the timer", () => {
    // Sending hours creates a finished entry instead of a running timer, and
    // the request still succeeds, so nothing surfaces the mistake.
    const body = startEntryBody(input, { wantsTimestampTimers: false, now });
    expect(body).not.toHaveProperty("hours");
  });

  test("builds the duration body without a start time", () => {
    expect(startEntryBody(input, { wantsTimestampTimers: false, now })).toEqual({
      project_id: 11,
      task_id: 22,
      spent_date: "2026-09-02",
      notes: "#5515: Audit areas",
    });
  });

  test("adds a start time on a timestamp account", () => {
    expect(startEntryBody(input, { wantsTimestampTimers: true, now })).toEqual({
      project_id: 11,
      task_id: 22,
      spent_date: "2026-09-02",
      notes: "#5515: Audit areas",
      started_time: "10:25am",
    });
  });

  test("never sends an end time, which would stop the timer immediately", () => {
    const body = startEntryBody(input, { wantsTimestampTimers: true, now });
    expect(body).not.toHaveProperty("ended_time");
  });

  test("nests the external reference when one is supplied", () => {
    const body = startEntryBody({ ...input, externalReference: reference }, {
      wantsTimestampTimers: false,
      now,
    });
    expect(body.external_reference).toEqual({
      id: "5515",
      group_id: "psi-product",
      account_id: "danielbachhuber",
      permalink: "https://github.com/danielbachhuber/psi-product/issues/5515",
    });
  });

  test("omits the external reference when there is nothing to link to", () => {
    const body = startEntryBody(input, { wantsTimestampTimers: false, now });
    expect(body).not.toHaveProperty("external_reference");
  });
});
