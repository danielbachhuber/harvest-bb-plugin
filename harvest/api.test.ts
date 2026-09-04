import { describe, expect, test, vi } from "vitest";

import { createHarvestApi, HarvestError } from "./api.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function api(fetchImpl: typeof fetch, sleep = vi.fn(async () => {})) {
  return {
    client: createHarvestApi({
      accountId: "123456",
      accessToken: "tok",
      fetch: fetchImpl,
      sleep,
    }),
    sleep,
  };
}

describe("request headers", () => {
  test("sends the token, the account, and a user agent", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 1 }));
    await api(fetchImpl as unknown as typeof fetch).client.me();

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tok");
    expect(headers["harvest-account-id"]).toBe("123456");
    // Harvest rejects requests with no user agent, and the failure message
    // does not say so.
    expect(headers["user-agent"]).toContain("bb-plugin-harvest");
  });

  test("requests the v2 endpoint on the documented host", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 1 }));
    await api(fetchImpl as unknown as typeof fetch).client.me();

    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://api.harvestapp.com/v2/users/me");
  });
});

describe("error mapping", () => {
  test("maps 401 to an unauthenticated error", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "nope" }, 401));
    await expect(api(fetchImpl as unknown as typeof fetch).client.me()).rejects.toMatchObject({
      kind: "unauthenticated",
    });
  });

  test("maps 403 to an unauthenticated error", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 403));
    await expect(api(fetchImpl as unknown as typeof fetch).client.me()).rejects.toMatchObject({
      kind: "unauthenticated",
    });
  });

  test("maps a server error to unreachable", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
    await expect(api(fetchImpl as unknown as typeof fetch).client.me()).rejects.toMatchObject({
      kind: "unreachable",
    });
  });

  test("maps a network failure to unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("network down");
    });
    await expect(api(fetchImpl as unknown as typeof fetch).client.me()).rejects.toMatchObject({
      kind: "unreachable",
    });
  });

  test("maps unparseable JSON to an invalid response", async () => {
    const fetchImpl = vi.fn(async () => new Response("not json", { status: 200 }));
    await expect(api(fetchImpl as unknown as typeof fetch).client.me()).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  test("throws HarvestError so callers can narrow on it", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 401));
    await expect(api(fetchImpl as unknown as typeof fetch).client.me()).rejects.toBeInstanceOf(
      HarvestError,
    );
  });
});

describe("rate limiting", () => {
  test("retries after a 429 and returns the eventual success", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({ id: 7 }));

    const { client, sleep } = api(fetchImpl as unknown as typeof fetch);
    await expect(client.me()).resolves.toEqual({ id: 7 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  test("waits the interval Harvest asks for in retry-after", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("{}", { status: 429, headers: { "retry-after": "3" } }),
      )
      .mockResolvedValueOnce(jsonResponse({}));

    const { client, sleep } = api(fetchImpl as unknown as typeof fetch);
    await client.me();
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  test("gives up after repeated rate limiting rather than retrying forever", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 429));
    const { client } = api(fetchImpl as unknown as typeof fetch);

    await expect(client.me()).rejects.toMatchObject({ kind: "rate_limited" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("pagination", () => {
  test("follows links.next and concatenates every page", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          project_assignments: [{ id: 1 }],
          links: { next: "https://api.harvestapp.com/v2/users/me/project_assignments?page=2" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ project_assignments: [{ id: 2 }], links: { next: null } }),
      );

    const { client } = api(fetchImpl as unknown as typeof fetch);
    await expect(client.projectAssignments()).resolves.toEqual([{ id: 1 }, { id: 2 }]);
  });

  test("stops at a single page when there is no next link", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ project_assignments: [{ id: 1 }], links: { next: null } }),
    );

    const { client } = api(fetchImpl as unknown as typeof fetch);
    await client.projectAssignments();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("writes", () => {
  test("posts a start-timer body as JSON", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 9 }));
    const { client } = api(fetchImpl as unknown as typeof fetch);

    await client.startTimer({ project_id: 11, task_id: 22 });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.harvestapp.com/v2/time_entries");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ project_id: 11, task_id: 22 });
  });

  test("patches the stop endpoint for one entry", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 9 }));
    const { client } = api(fetchImpl as unknown as typeof fetch);

    await client.stopTimer(9);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.harvestapp.com/v2/time_entries/9/stop");
    expect(init.method).toBe("PATCH");
  });

  test("filters running entries server-side rather than fetching everything", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ time_entries: [], links: { next: null } }));
    const { client } = api(fetchImpl as unknown as typeof fetch);

    await client.runningEntries();

    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toContain("is_running=true");
  });

  test("filters entries by external reference id", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ time_entries: [], links: { next: null } }));
    const { client } = api(fetchImpl as unknown as typeof fetch);

    await client.entriesForExternalId("5515");

    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toContain("external_reference_id=5515");
  });
});
