// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { HarvestRowClock } from "./row-clock.js";

afterEach(cleanup);

const ROW = {
  repo: "octocat/acme-widgets",
  number: 42,
  title: "Fix the flaky test",
  url: "https://github.com/octocat/acme-widgets/issues/42",
};

const CLIENT = {
  assignments: vi.fn(async () => ({ projects: [] })),
  trackedHours: vi.fn(async () => ({ hours: 0 })),
  startTimer: vi.fn(async () => ({ entry: null })),
  lastSelection: vi.fn(async () => null),
};

function renderClock(isRunning: boolean, extra: Record<string, unknown> = {}) {
  return render(
    <HarvestRowClock
      row={ROW}
      isRunning={isRunning}
      client={CLIENT}
      onStarted={vi.fn()}
      {...extra}
    />,
  );
}

describe("resting", () => {
  test("names the item, since a row carries several controls", () => {
    renderClock(false);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe("Track time for #42");
  });

  test("matches the muted weight of the copy control beside it", () => {
    // At full muted-foreground it renders darker than CopyLink's /70 and reads
    // as a different kind of control.
    renderClock(false);
    expect(screen.getByRole("button").className).toContain("text-muted-foreground/70");
  });

  test("is not tinted as running", () => {
    renderClock(false);
    expect(screen.getByRole("button").className).not.toContain("text-success");
  });
});

describe("running", () => {
  test("says so in its accessible name, not by colour alone", () => {
    renderClock(true);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Harvest timer running for #42",
    );
  });

  test("uses the success accent, which actually has chroma", () => {
    // bb's --primary is oklch(27% 0 0), a near-black neutral, so tinting with
    // it makes a running timer look like ordinary text.
    renderClock(true);
    expect(screen.getByRole("button").className).toContain("text-success");
  });

  test("drops the resting muted weight", () => {
    renderClock(true);
    expect(screen.getByRole("button").className).not.toContain("text-muted-foreground/70");
  });
});

