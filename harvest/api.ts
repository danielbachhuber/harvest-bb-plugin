const API_HOST = "https://api.harvestapp.com";
const USER_AGENT = "bb-plugin-harvest (https://github.com/danielbachhuber/harvest-bb-plugin)";
const MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_MS = 1_000;

export type HarvestErrorKind =
  | "unauthenticated"
  | "rate_limited"
  | "unreachable"
  | "invalid_response";

/**
 * A Harvest failure the plugin knows how to talk about.
 *
 * The kinds are distinct because the right response differs: reconnect for
 * `unauthenticated`, wait for `rate_limited`, retry later for `unreachable`.
 * Telling a user to reconnect when Harvest is merely busy sends them to
 * regenerate a token that was fine.
 */
export class HarvestError extends Error {
  readonly kind: HarvestErrorKind;
  readonly status: number | null;

  constructor(kind: HarvestErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "HarvestError";
    this.kind = kind;
    this.status = status;
  }
}

export interface HarvestApiOptions {
  accountId: string;
  accessToken: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface HarvestApi {
  me(): Promise<unknown>;
  company(): Promise<unknown>;
  projectAssignments(): Promise<unknown[]>;
  runningEntries(): Promise<unknown[]>;
  entriesForExternalId(externalId: string): Promise<unknown[]>;
  entriesForDay(input: { date: string; projectId: number; taskId: number }): Promise<unknown[]>;
  startTimer(body: Record<string, unknown>): Promise<unknown>;
  stopTimer(entryId: number): Promise<unknown>;
  restartTimer(entryId: number): Promise<unknown>;
}

export function createHarvestApi(options: HarvestApiOptions): HarvestApi {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;

  const headers = {
    accept: "application/json",
    authorization: `Bearer ${options.accessToken}`,
    "harvest-account-id": options.accountId,
    // Harvest rejects requests without a user agent, and says so only
    // obliquely, so this is not optional politeness.
    "user-agent": USER_AGENT,
  };

  async function request(url: string, init: RequestInit = {}): Promise<unknown> {
    let lastRateLimit: HarvestError | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const response = await send(url, init);

      if (response.status === 429) {
        lastRateLimit = new HarvestError("rate_limited", "Harvest is rate limiting.", 429);
        if (attempt < MAX_ATTEMPTS) {
          await sleep(retryAfterMs(response, attempt));
          continue;
        }
        throw lastRateLimit;
      }

      if (response.status === 401 || response.status === 403) {
        throw new HarvestError(
          "unauthenticated",
          "Harvest rejected the credentials.",
          response.status,
        );
      }

      if (!response.ok) {
        throw new HarvestError(
          "unreachable",
          `Harvest returned ${response.status}.`,
          response.status,
        );
      }

      return await parse(response);
    }

    throw lastRateLimit ?? new HarvestError("unreachable", "Harvest could not be reached.");
  }

  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await doFetch(url, { ...init, headers: { ...headers, ...init.headers } });
    } catch (cause) {
      throw new HarvestError("unreachable", "Harvest could not be reached.", null);
    }
  }

  async function parse(response: Response): Promise<unknown> {
    const text = await response.text();
    if (text === "") return {};

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new HarvestError("invalid_response", "Harvest returned a malformed response.");
    }
  }

  /** Walk `links.next` until it runs out, collecting one keyed collection. */
  async function paged(firstUrl: string, key: string): Promise<unknown[]> {
    const collected: unknown[] = [];
    let url: string | null = firstUrl;

    while (url !== null) {
      const payload = (await request(url)) as Record<string, unknown>;
      const page = payload[key];
      if (Array.isArray(page)) collected.push(...page);

      const links = payload.links as Record<string, unknown> | undefined;
      const next = links?.next;
      url = typeof next === "string" && next !== "" ? next : null;
    }

    return collected;
  }

  return {
    me: () => request(`${API_HOST}/v2/users/me`),
    company: () => request(`${API_HOST}/v2/company`),
    projectAssignments: () =>
      paged(`${API_HOST}/v2/users/me/project_assignments`, "project_assignments"),
    runningEntries: () => paged(`${API_HOST}/v2/time_entries?is_running=true`, "time_entries"),
    entriesForExternalId: (externalId) =>
      paged(
        `${API_HOST}/v2/time_entries?external_reference_id=${encodeURIComponent(externalId)}`,
        "time_entries",
      ),
    entriesForDay: ({ date, projectId, taskId }) =>
      paged(
        `${API_HOST}/v2/time_entries?from=${date}&to=${date}` +
          `&project_id=${projectId}&task_id=${taskId}`,
        "time_entries",
      ),
    startTimer: (body) =>
      request(`${API_HOST}/v2/time_entries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    stopTimer: (entryId) =>
      request(`${API_HOST}/v2/time_entries/${entryId}/stop`, { method: "PATCH" }),
    restartTimer: (entryId) =>
      request(`${API_HOST}/v2/time_entries/${entryId}/restart`, { method: "PATCH" }),
  };
}

/** Honor Harvest's own retry hint, falling back to a widening delay. */
function retryAfterMs(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header !== null) {
    const seconds = Number.parseInt(header, 10);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  }

  return DEFAULT_RETRY_MS * attempt;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
