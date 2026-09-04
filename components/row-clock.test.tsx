// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  stopTimer: vi.fn(async () => {}),
  lastSelection: vi.fn(async () => null),
};

const RUNNING = {
  entryId: 900,
  startedAt: new Date(Date.now() - 74 * 60_000).toISOString(),
  projectName: "Internal",
  taskName: "Development",
};

function renderClock(isRunning: boolean, extra: Record<string, unknown> = {}) {
  return render(
    <HarvestRowClock
      row={ROW}
      running={isRunning ? RUNNING : null}
      client={CLIENT}
      onChanged={vi.fn()}
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
  test("stays an icon, with no numeral in the row", async () => {
    // A per-second numeral in a dense list is noise. The fill says running;
    // the elapsed time belongs in the popover.
    const { container } = renderClock(true);
    await screen.findByRole("button");
    expect(container.textContent).not.toMatch(/\d:\d\d/);
  });

  test("fills solid, so the state is shape as well as colour", () => {
    // bb ships no solid `bg-success` utility, and the plugin Tailwind pass
    // emits default-theme utilities only, so the variable is set inline. It is
    // still the theme's colour, not a hardcoded one.
    renderClock(true);
    expect(screen.getByRole("button").style.backgroundColor).toBe("var(--success)");
  });

  test("reads against that fill in either theme", () => {
    // --background inverts with the theme; white would fail on dark mode's
    // lighter --success.
    renderClock(true);
    expect(screen.getByRole("button").className).toContain("text-background");
  });

  test("has no fill when resting", () => {
    renderClock(false);
    expect(screen.getByRole("button").style.backgroundColor).toBe("");
  });

  test("fills the same way when the start time is unknown", () => {
    // The listing may predate the field; the fill does not depend on it.
    renderClock(true, { running: { ...RUNNING, startedAt: null } });
    expect(screen.getByRole("button").style.backgroundColor).toBe("var(--success)");
  });

  test("stays quiet on a row that is not running", () => {
    const { container } = renderClock(false);
    expect(container.textContent).not.toMatch(/\d:\d\d/);
  });

  test("says so in its accessible name, not by colour alone", () => {
    renderClock(true);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Harvest timer running for #42",
    );
  });

  test("uses the success accent, which actually has chroma", () => {
    // bb's --primary is oklch(27% 0 0), a near-black neutral, so it would make
    // a running timer look like ordinary text. The accent now carries the
    // fill rather than the glyph, which is why this reads the style.
    renderClock(true);
    expect(screen.getByRole("button").style.backgroundColor).toBe("var(--success)");
  });

  test("drops the resting muted weight", () => {
    renderClock(true);
    expect(screen.getByRole("button").className).not.toContain("text-muted-foreground/70");
  });
});


describe("the popover on a running row", () => {
  // Radix opens on pointerdown, which jsdom does not synthesize, so the panel
  // is rendered directly rather than driven through the trigger.
  test("offers a stop, not a start form that does nothing", async () => {
    // The server no-ops when this work is already tracked, so a Start button
    // here silently did nothing and the popover was lying about the state.
    const { RunningPanel } = await import("./row-clock.js");
    render(
      <RunningPanel
        running={RUNNING}
        client={CLIENT}
        onChanged={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /stop timer/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /start timer/i })).toBeNull();
  });

  test("names what is being tracked and for how long", async () => {
    const { RunningPanel } = await import("./row-clock.js");
    const { container } = render(
      <RunningPanel
        running={RUNNING}
        client={CLIENT}
        onChanged={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(container.textContent).toContain("Internal");
    expect(container.textContent).toContain("Development");
    expect(container.textContent).toContain("1:14");
  });

  test("stops the entry it was given", async () => {
    const stopTimer = vi.fn(async () => {});
    const onChanged = vi.fn();
    const { RunningPanel } = await import("./row-clock.js");
    render(
      <RunningPanel
        running={RUNNING}
        client={{ ...CLIENT, stopTimer }}
        onChanged={onChanged}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /stop timer/i }));

    await waitFor(() => expect(stopTimer).toHaveBeenCalledWith({ entryId: 900 }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  test("does not stop twice when the button is clicked twice", async () => {
    let release = () => {};
    const stopTimer = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const { RunningPanel } = await import("./row-clock.js");
    render(
      <RunningPanel
        running={RUNNING}
        client={{ ...CLIENT, stopTimer }}
        onChanged={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: /stop timer/i });
    fireEvent.click(button);
    fireEvent.click(button);
    release();

    await waitFor(() => expect(stopTimer).toHaveBeenCalledTimes(1));
  });
});
