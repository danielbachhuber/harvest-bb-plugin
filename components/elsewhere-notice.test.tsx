// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { RunningElsewhereNotice } from "./elsewhere-notice.js";

afterEach(cleanup);

const ENTRY = {
  id: 900,
  projectName: "Internal",
  taskName: "Development",
  notes: "#3213: Retire the legacy importer",
  hours: 0.25,
  timerStartedAt: new Date(Date.now() - 25 * 60_000).toISOString(),
  externalReference: { id: "3213", groupId: "acme-widgets", accountId: "acme", permalink: null },
};

describe("RunningElsewhereNotice", () => {
  test("names the work the timer is actually on", () => {
    // Without the notes, "Internal · Development" is true of half the account
    // and says nothing about which thing is being tracked.
    render(<RunningElsewhereNotice entry={ENTRY} isStopping={false} onStop={vi.fn()} />);
    expect(screen.getByText(/Retire the legacy importer/)).toBeTruthy();
    expect(screen.getByText(/Internal/)).toBeTruthy();
  });

  test("says the timer is running elsewhere", () => {
    render(<RunningElsewhereNotice entry={ENTRY} isStopping={false} onStop={vi.fn()} />);
    expect(screen.getByText(/elsewhere/i)).toBeTruthy();
  });

  test("shows how long it has been running", () => {
    render(<RunningElsewhereNotice entry={ENTRY} isStopping={false} onStop={vi.fn()} />);
    expect(screen.getByText("0:25")).toBeTruthy();
  });

  test("offers to stop it without leaving the popover", () => {
    const onStop = vi.fn();
    render(<RunningElsewhereNotice entry={ENTRY} isStopping={false} onStop={onStop} />);
    screen.getByRole("button", { name: /stop/i }).click();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  test("cannot be asked to stop twice while a stop is in flight", () => {
    render(<RunningElsewhereNotice entry={ENTRY} isStopping onStop={vi.fn()} />);
    expect(screen.getByRole("button", { name: /stopping/i }).getAttribute("disabled")).not.toBeNull();
  });

  test("gets by without notes", () => {
    render(
      <RunningElsewhereNotice entry={{ ...ENTRY, notes: null }} isStopping={false} onStop={vi.fn()} />,
    );
    expect(screen.getByText(/Internal/)).toBeTruthy();
  });
});
