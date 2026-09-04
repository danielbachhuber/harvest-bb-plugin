import { describe, expect, test } from "vitest";

import { runningScope } from "./running-state.js";

const HERE = { id: "5845", groupId: "acme-widgets", accountId: "acme", permalink: null };
const ELSEWHERE = { id: "3213", groupId: "acme-widgets", accountId: "acme", permalink: null };

describe("runningScope", () => {
  test("is idle when nothing is running", () => {
    expect(runningScope(null, HERE)).toBe("idle");
  });

  test("is here when the running timer carries this thread's reference", () => {
    expect(runningScope({ externalReference: HERE }, HERE)).toBe("here");
  });

  test("is elsewhere when the running timer is about something else", () => {
    // The whole point: a timer left running on another issue should not read
    // as though this thread's work is being tracked.
    expect(runningScope({ externalReference: ELSEWHERE }, HERE)).toBe("elsewhere");
  });

  test("is elsewhere when the running timer carries no reference at all", () => {
    // A thread that knows what it is about can say that an unattributed timer
    // is not it.
    expect(runningScope({ externalReference: null }, HERE)).toBe("elsewhere");
  });

  test("separates the same number in two repositories", () => {
    expect(
      runningScope({ externalReference: { ...HERE, groupId: "acme-docs" } }, HERE),
    ).toBe("elsewhere");
  });

  test("is here when the thread has no reference, because it cannot say otherwise", () => {
    // A thread with no pull request has nothing to compare against, and the
    // header is the only surface that timer could have been started from. A
    // confident "elsewhere" here would be a guess, and the wrong one whenever
    // the timer was started from this very control.
    expect(runningScope({ externalReference: ELSEWHERE }, null)).toBe("here");
    expect(runningScope({ externalReference: null }, null)).toBe("here");
  });
});
