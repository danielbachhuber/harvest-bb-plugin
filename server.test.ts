import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, test, vi } from "vitest";

import { createPlugin } from "./server.js";

const CREDENTIALS = { accountId: "123456", accessToken: "tok" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ME = { first_name: "Daniel", last_name: "Bachhuber" };
const COMPANY = { name: "New_ Public", wants_timestamp_timers: false };

function assignmentsPayload() {
  return {
    project_assignments: [
      {
        is_active: true,
        project: { id: 11, name: "Internal", code: "INT" },
        client: { id: 5, name: "New_ Public" },
        task_assignments: [{ is_active: true, task: { id: 22, name: "Development" } }],
      },
    ],
    links: { next: null },
  };
}

function runningEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 900,
    hours: 0.25,
    notes: "#5515: Audit areas",
    is_running: true,
    timer_started_at: "2026-09-02T10:00:00Z",
    project: { id: 11, name: "Internal" },
    task: { id: 22, name: "Development" },
    external_reference: { id: "5515", group_id: "psi-product" },
    ...overrides,
  };
}

/**
 * Route by method and exact path, so a test declares only the endpoints it
 * cares about and an unexpected call fails loudly instead of returning
 * something plausible.
 *
 * Matching has to be exact rather than a substring: `/v2/users/me` is a prefix
 * of `/v2/users/me/project_assignments`, so a substring match answers the
 * assignments request with the current user and the failure looks like a
 * normalization bug.
 */
function routedFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const target = new URL(url);
    const path = `${target.pathname}${target.search}`;

    for (const [pattern, body] of Object.entries(routes)) {
      const separator = pattern.indexOf(" ");
      const routeMethod = pattern.slice(0, separator);
      const routePath = pattern.slice(separator + 1);
      if (routeMethod === method && routePath === path) return jsonResponse(body);
    }

    throw new Error(`unexpected ${method} ${path}`);
  });
}

function host(
  routes: Record<string, unknown>,
  settings: Record<string, string> = CREDENTIALS,
  now = new Date(2026, 8, 2, 10, 25),
) {
  const fetchImpl = routedFetch(routes);
  const created = createFakePluginHost({ pluginId: "harvest", settings });
  const plugin = createPlugin({
    fetch: fetchImpl as unknown as typeof fetch,
    sleep: async () => {},
    now: () => now,
  });

  return { ...created, plugin, fetchImpl };
}

const READ_ROUTES = {
  "GET /v2/users/me": ME,
  "GET /v2/company": COMPANY,
  "GET /v2/users/me/project_assignments": assignmentsPayload(),
  "GET /v2/time_entries?is_running=true": { time_entries: [], links: { next: null } },
};

describe("configuration", () => {
  test("reports needing configuration when no credentials are stored", async () => {
    const { bb, harness, plugin } = host({}, {});
    await plugin(bb);

    expect(harness.needsConfigurationMessages.join(" ")).toContain("bb plugin config harvest");
  });

  test("reports needing configuration when only the account id is stored", async () => {
    const { bb, harness, plugin } = host({}, { accountId: "123456" });
    await plugin(bb);

    expect(harness.needsConfigurationMessages).toHaveLength(1);
  });

  test("loads cleanly when both credentials are stored", async () => {
    const { bb, harness, plugin } = host(READ_ROUTES);
    await plugin(bb);

    expect(harness.needsConfigurationMessages).toHaveLength(0);
  });

  test("makes no network call while unconfigured", async () => {
    // An unconfigured plugin that still calls Harvest would produce a stream
    // of 401s in the log and tell the user nothing useful.
    const { bb, plugin, fetchImpl } = host({}, {});
    await plugin(bb);

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("status", () => {
  test("reports who the credentials belong to", async () => {
    const { bb, harness, plugin } = host(READ_ROUTES);
    await plugin(bb);

    await expect(harness.behavior.callRpc("status", null)).resolves.toEqual({
      configured: true,
      user: { name: "Daniel Bachhuber", accountName: "New_ Public" },
      error: null,
    });
  });

  test("reports unconfigured without inventing an error", async () => {
    const { bb, harness, plugin } = host({}, {});
    await plugin(bb);

    await expect(harness.behavior.callRpc("status", null)).resolves.toEqual({
      configured: false,
      user: null,
      error: null,
    });
  });

  test("distinguishes a rejected token from an unreachable Harvest", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 401));
    const { bb, harness } = createFakePluginHost({ pluginId: "harvest", settings: CREDENTIALS });
    await createPlugin({ fetch: fetchImpl as unknown as typeof fetch })(bb);

    await expect(harness.behavior.callRpc("status", null)).resolves.toMatchObject({
      configured: true,
      error: "unauthenticated",
    });
  });
});

describe("assignments", () => {
  test("returns the normalized project list", async () => {
    const { bb, harness, plugin } = host(READ_ROUTES);
    await plugin(bb);

    await expect(harness.behavior.callRpc("assignments", null)).resolves.toEqual({
      projects: [
        {
          id: 11,
          name: "Internal",
          code: "INT",
          clientName: "New_ Public",
          tasks: [{ id: 22, name: "Development" }],
        },
      ],
    });
  });

  test("serves a second call from cache instead of refetching", async () => {
    const { bb, harness, plugin, fetchImpl } = host(READ_ROUTES);
    await plugin(bb);

    await harness.behavior.callRpc("assignments", null);
    const afterFirst = fetchImpl.mock.calls.length;
    await harness.behavior.callRpc("assignments", null);

    expect(fetchImpl.mock.calls.length).toBe(afterFirst);
  });

  test("returns an empty list rather than failing when Harvest is unreachable", async () => {
    // The picker should still open and say it has nothing, rather than the
    // whole panel erroring.
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
    const { bb, harness } = createFakePluginHost({ pluginId: "harvest", settings: CREDENTIALS });
    await createPlugin({ fetch: fetchImpl as unknown as typeof fetch, sleep: async () => {} })(bb);

    await expect(harness.behavior.callRpc("assignments", null)).resolves.toEqual({ projects: [] });
  });
});

describe("running timer", () => {
  test("reports no running timer when Harvest has none", async () => {
    const { bb, harness, plugin } = host(READ_ROUTES);
    await plugin(bb);

    await expect(harness.behavior.callRpc("runningTimer", null)).resolves.toEqual({ entry: null });
  });

  test("reports the running timer", async () => {
    const { bb, harness, plugin } = host({
      ...READ_ROUTES,
      "GET /v2/time_entries?is_running=true": {
        time_entries: [runningEntry()],
        links: { next: null },
      },
    });
    await plugin(bb);

    await expect(harness.behavior.callRpc("runningTimer", null)).resolves.toMatchObject({
      entry: { id: 900, projectName: "Internal", taskName: "Development" },
    });
  });
});

describe("starting a timer", () => {
  const routes = {
    ...READ_ROUTES,
    "POST /v2/time_entries": runningEntry(),
  };

  test("returns the started entry", async () => {
    const { bb, harness, plugin } = host(routes);
    await plugin(bb);

    await expect(
      harness.behavior.callRpc("startTimer", { projectId: 11, taskId: 22, notes: "note" }),
    ).resolves.toMatchObject({ entry: { id: 900 } });
  });

  test("posts a body with no hours, so Harvest starts a timer", async () => {
    const { bb, harness, plugin, fetchImpl } = host(routes);
    await plugin(bb);

    await harness.behavior.callRpc("startTimer", { projectId: 11, taskId: 22, notes: "note" });

    const post = fetchImpl.mock.calls.find(
      (call) => ((call as unknown as [string, RequestInit])[1] ?? {}).method === "POST",
    ) as unknown as [string, RequestInit];
    const body = JSON.parse(post[1].body as string);
    expect(body).not.toHaveProperty("hours");
    expect(body).toMatchObject({ project_id: 11, task_id: 22, notes: "note" });
  });

  test("announces the change so every open surface updates", async () => {
    const { bb, harness, plugin } = host(routes);
    await plugin(bb);

    await harness.behavior.callRpc("startTimer", { projectId: 11, taskId: 22, notes: "note" });

    expect(harness.realtimeSignals.map((signal) => signal.channel)).toContain("harvest:timer");
  });

  test("remembers the selection for the reference's group", async () => {
    const { bb, harness, plugin } = host(routes);
    await plugin(bb);

    await harness.behavior.callRpc("startTimer", {
      projectId: 11,
      taskId: 22,
      notes: "note",
      externalReference: {
        id: "5515",
        groupId: "psi-product",
        accountId: "danielbachhuber",
        permalink: "https://example.com",
      },
    });

    await expect(
      harness.behavior.callRpc("lastSelection", { scope: "psi-product" }),
    ).resolves.toEqual({ projectId: 11, taskId: 22 });
  });

  test("does not leak one repository's selection into another", async () => {
    const { bb, harness, plugin } = host(routes);
    await plugin(bb);

    await harness.behavior.callRpc("startTimer", {
      projectId: 11,
      taskId: 22,
      notes: "note",
      externalReference: { id: "1", groupId: "repo-a", accountId: null, permalink: null },
    });

    await expect(harness.behavior.callRpc("lastSelection", { scope: "repo-b" })).resolves.toEqual({
      projectId: 11,
      taskId: 22,
    });
  });
});

describe("lastSelection", () => {
  test("reports nothing remembered before the first timer", async () => {
    const { bb, harness, plugin } = host(READ_ROUTES);
    await plugin(bb);

    await expect(harness.behavior.callRpc("lastSelection", { scope: null })).resolves.toBeNull();
  });
});

describe("stopping a timer", () => {
  test("announces the change", async () => {
    const { bb, harness, plugin } = host({
      ...READ_ROUTES,
      "PATCH /v2/time_entries/900/stop": runningEntry({ is_running: false }),
    });
    await plugin(bb);

    await harness.behavior.callRpc("stopTimer", { entryId: 900 });

    expect(harness.realtimeSignals.map((signal) => signal.channel)).toContain("harvest:timer");
  });
});

describe("tracked hours", () => {
  test("sums the entries linked to one reference", async () => {
    const { bb, harness, plugin } = host({
      ...READ_ROUTES,
      "GET /v2/time_entries?external_reference_id=5515": {
        time_entries: [
          runningEntry({ id: 1, hours: 0.25, is_running: false, timer_started_at: null }),
          runningEntry({ id: 2, hours: 0.1666666667, is_running: false, timer_started_at: null }),
        ],
        links: { next: null },
      },
    });
    await plugin(bb);

    const result = (await harness.behavior.callRpc("trackedHours", {
      externalId: "5515",
      groupId: "psi-product",
    })) as { hours: number };

    expect(result.hours).toBeCloseTo(0.4166666667);
  });

  test("excludes the same issue number from another repository", async () => {
    // Harvest can only filter on the reference id, so two repositories using
    // the same issue number would otherwise be summed together.
    const { bb, harness, plugin } = host({
      ...READ_ROUTES,
      "GET /v2/time_entries?external_reference_id=5515": {
        time_entries: [
          runningEntry({ id: 1, hours: 2, external_reference: { id: "5515", group_id: "other" } }),
        ],
        links: { next: null },
      },
    });
    await plugin(bb);

    await expect(
      harness.behavior.callRpc("trackedHours", { externalId: "5515", groupId: "psi-product" }),
    ).resolves.toEqual({ hours: 0 });
  });

  test("reports zero rather than failing when Harvest is unreachable", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
    const { bb, harness } = createFakePluginHost({ pluginId: "harvest", settings: CREDENTIALS });
    await createPlugin({ fetch: fetchImpl as unknown as typeof fetch, sleep: async () => {} })(bb);

    await expect(
      harness.behavior.callRpc("trackedHours", { externalId: "5515" }),
    ).resolves.toEqual({ hours: 0 });
  });
});

describe("scheduled work", () => {
  test("registers a refresh and a poll", async () => {
    const { bb, harness, plugin } = host(READ_ROUTES);
    await plugin(bb);

    expect(harness.registrations.schedules.map((schedule) => schedule.name).sort()).toEqual([
      "poll-timer",
      "refresh-assignments",
    ]);
  });

  test("refreshing assignments replaces the cache", async () => {
    const { bb, harness, plugin, fetchImpl } = host(READ_ROUTES);
    await plugin(bb);

    await harness.behavior.callRpc("assignments", null);
    await harness.behavior.runSchedule("refresh-assignments");
    const afterRefresh = fetchImpl.mock.calls.length;
    await harness.behavior.callRpc("assignments", null);

    // The refresh warmed the cache, so the read after it costs no request.
    expect(fetchImpl.mock.calls.length).toBe(afterRefresh);
  });

  test("polling announces a timer that started outside bb", async () => {
    // The user starts timers from the Harvest Chrome extension too, so bb
    // cannot treat its own writes as the only source of truth.
    const { bb, harness, plugin } = host({
      ...READ_ROUTES,
      "GET /v2/time_entries?is_running=true": {
        time_entries: [runningEntry()],
        links: { next: null },
      },
    });
    await plugin(bb);

    await harness.behavior.runSchedule("poll-timer");

    expect(harness.realtimeSignals.map((signal) => signal.channel)).toContain("harvest:timer");
  });

  test("polling stays quiet when nothing changed", async () => {
    const { bb, harness, plugin } = host(READ_ROUTES);
    await plugin(bb);

    await harness.behavior.runSchedule("poll-timer");
    await harness.behavior.runSchedule("poll-timer");

    expect(harness.realtimeSignals).toHaveLength(0);
  });
});
