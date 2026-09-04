// @vitest-environment jsdom
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

// The thunk matters: app.tsx binds the plugin runtime at module load, so the
// test runtime has to be installed before the import happens.
const app = await loadPluginApp(() => import("./app"));

const RUNNING = {
  id: 900,
  projectName: "Internal",
  taskName: "Development",
  notes: "#5515: Audit areas",
  hours: 0.25,
  timerStartedAt: new Date(Date.now() - 25 * 60_000).toISOString(),
  externalReference: { id: "5515", groupId: "psi-product", accountId: null, permalink: null },
};

const IDLE_RPC = {
  status: () => ({ configured: true, user: null, error: null }),
  runningTimer: () => ({ entry: null }),
  assignments: () => ({ projects: [] }),
  trackedHours: () => ({ hours: 0 }),
  lastSelection: () => null,
};

let cleanups: (() => void)[] = [];

afterEach(() => {
  for (const dispose of cleanups) dispose();
  cleanups = [];
});

function renderHeader(rpc: Record<string, unknown>) {
  const registration = app.threadHeaderActions[0];
  if (registration === undefined) throw new Error("no thread header action registered");

  const slot = renderSlot(
    registration,
    { threadId: "thr_1", projectId: "proj_1", isCompactViewport: false },
    { rpc: rpc as never },
  );
  cleanups.push(() => slot.lifecycle.unmount());
  return slot;
}

function renderSettings(rpc: Record<string, unknown>) {
  const registration = app.settingsSections[0];
  if (registration === undefined) throw new Error("no settings section registered");

  const slot = renderSlot(registration, {}, { rpc: rpc as never });
  cleanups.push(() => slot.lifecycle.unmount());
  return slot;
}

describe("registrations", () => {
  test("registers exactly one thread header action", () => {
    // The header clamps its controls, so more than one would be clipped.
    expect(app.threadHeaderActions).toHaveLength(1);
  });

  test("names the header action for the host wrapper region", () => {
    expect(app.threadHeaderActions[0]?.title).toBe("Track time");
  });

  test("registers a settings section for checking the connection", () => {
    expect(app.settingsSections).toHaveLength(1);
  });

  test("registers no nav panel", () => {
    // A sidebar entry was explicitly ruled out; this keeps it ruled out.
    expect(app.navPanels).toHaveLength(0);
  });
});

describe("the header control", () => {
  test("offers a button that names itself, since it renders as an icon", async () => {
    renderHeader(IDLE_RPC);
    expect(await screen.findByRole("button", { name: /track time/i })).toBeTruthy();
  });

  test("asks Harvest what is running when it mounts", async () => {
    const slot = renderHeader(IDLE_RPC);
    await waitFor(() =>
      expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain("runningTimer"),
    );
  });

  test("shows no elapsed time while nothing is running", async () => {
    const { container } = renderHeader(IDLE_RPC);
    await screen.findByRole("button", { name: /track time/i });
    expect(container.textContent).not.toMatch(/\d:\d\d/);
  });

  test("shows the elapsed time of a running timer", async () => {
    const { container } = renderHeader({ ...IDLE_RPC, runningTimer: () => ({ entry: RUNNING }) });
    await waitFor(() => expect(container.textContent).toContain("0:25"));
  });

  test("tints a running timer with an accent that has chroma", async () => {
    // bb's --primary is oklch(27% 0 0), so tinting with it makes a running
    // timer look like ordinary dark text.
    renderHeader({ ...IDLE_RPC, runningTimer: () => ({ entry: RUNNING }) });
    const button = await screen.findByRole("button", { name: /internal/i });
    expect(button.className).toContain("text-success");
  });

  test("leaves an idle control untinted", async () => {
    renderHeader(IDLE_RPC);
    const button = await screen.findByRole("button", { name: /track time/i });
    expect(button.className).not.toContain("text-success");
  });

  test("names the running project and task in the button, not just a clock", async () => {
    renderHeader({ ...IDLE_RPC, runningTimer: () => ({ entry: RUNNING }) });
    expect(
      await screen.findByRole("button", { name: /internal.*development/i }),
    ).toBeTruthy();
  });

  test("picks up a timer started somewhere else", async () => {
    // The Chrome extension and other bb windows write to the same account, so
    // the header has to follow the broadcast rather than only its own writes.
    const slot = renderHeader(IDLE_RPC);
    await screen.findByRole("button", { name: /track time/i });

    await slot.behavior.emitRealtime("harvest:timer", { entry: RUNNING });

    await waitFor(() => expect(slot.container.textContent).toContain("0:25"));
  });

  test("clears the elapsed time when a timer stops elsewhere", async () => {
    const slot = renderHeader({ ...IDLE_RPC, runningTimer: () => ({ entry: RUNNING }) });
    await waitFor(() => expect(slot.container.textContent).toContain("0:25"));

    await slot.behavior.emitRealtime("harvest:timer", { entry: null });

    await waitFor(() => expect(slot.container.textContent).not.toContain("0:25"));
  });

  test("re-reads the timer after the connection comes back", async () => {
    // Realtime signals are ephemeral and never replayed, so a reconnect has
    // to reconcile or the header keeps showing pre-disconnect state.
    const slot = renderHeader(IDLE_RPC);
    await screen.findByRole("button", { name: /track time/i });
    const before = slot.inspection.rpcCalls.filter((call) => call.method === "runningTimer").length;

    await slot.behavior.setRealtimeConnectionState("reconnecting");
    await slot.behavior.setRealtimeConnectionState("connected");

    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.filter((call) => call.method === "runningTimer").length,
      ).toBeGreaterThan(before),
    );
  });

  test("stays quiet when Harvest is not configured", async () => {
    const rpc = {
      ...IDLE_RPC,
      status: () => ({ configured: false, user: null, error: null }),
    };
    renderHeader(rpc);

    // Nothing to track time against yet, so the header should not offer a
    // control that can only fail.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /track time/i })).toBeNull(),
    );
  });
});

describe("the settings section", () => {
  test("reports who the stored credentials belong to", async () => {
    renderSettings({
      ...IDLE_RPC,
      status: () => ({
        configured: true,
        user: { name: "Daniel Bachhuber", accountName: "New_ Public" },
        error: null,
      }),
    });

    expect(await screen.findByText(/Daniel Bachhuber/)).toBeTruthy();
    expect(screen.getByText(/New_ Public/)).toBeTruthy();
  });

  test("says the credentials are missing rather than showing an error", async () => {
    renderSettings({
      ...IDLE_RPC,
      status: () => ({ configured: false, user: null, error: null }),
    });

    expect(await screen.findByText(/not configured/i)).toBeTruthy();
  });

  test("distinguishes a rejected token from an unreachable Harvest", async () => {
    renderSettings({
      ...IDLE_RPC,
      status: () => ({ configured: true, user: null, error: "unauthenticated" }),
    });

    expect(await screen.findByText(/rejected/i)).toBeTruthy();
  });

  test("says Harvest is unreachable when it cannot be reached", async () => {
    renderSettings({
      ...IDLE_RPC,
      status: () => ({ configured: true, user: null, error: "unreachable" }),
    });

    expect(await screen.findByText(/could not be reached/i)).toBeTruthy();
  });
});
