import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { createHarvestApi, HarvestError, type HarvestApi } from "./harvest/api.js";
import { normalizeAssignments } from "./harvest/assignments.js";
import { TIMER_CHANNEL } from "./harvest/channel.js";
import { rpcContract } from "./harvest/contract.js";
import { startEntryBody } from "./harvest/entry.js";
import { sumHoursForReference } from "./harvest/reference.js";
import { fromApiEntry, pickRunningEntry } from "./harvest/time-entry.js";
import type { ProjectOption, Selection, TimeEntry } from "./harvest/types.js";

export { rpcContract } from "./harvest/contract.js";

const ASSIGNMENTS_KEY = "assignments";
const RUNNING_KEY = "running";
const SELECTION_PREFIX = "selection:";
const LATEST_SELECTION_KEY = `${SELECTION_PREFIX}__latest__`;

export interface PluginDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

/**
 * The plugin factory, with its I/O injected so every behavior below is
 * testable without a network.
 */
export function createPlugin(deps: PluginDeps = {}) {
  const now = deps.now ?? (() => new Date());

  return async function plugin(bb: BbPluginApi) {
    const settings = bb.settings.define({
      accountId: { type: "string", label: "Harvest account ID" },
      accessToken: { type: "string", label: "Personal access token", secret: true },
    });

    // Read once here only to decide the load-time status. Handlers re-read, so
    // configuring the plugin takes effect without a reload.
    const initial = await settings.get();
    if (!initial.accountId || !initial.accessToken) {
      bb.status.needsConfiguration(
        "Set accountId and accessToken with `bb plugin config harvest set <key> <value>`. " +
          "Create a token at https://id.getharvest.com/developers.",
      );
    }

    /**
     * The company's timer style, which decides how a start request is built.
     * It effectively never changes, so one read per load is enough.
     */
    let timestampTimers: boolean | null = null;

    async function api(): Promise<HarvestApi | null> {
      const { accountId, accessToken } = await settings.get();
      if (!accountId || !accessToken) return null;

      return createHarvestApi({
        accountId,
        accessToken,
        fetch: deps.fetch,
        sleep: deps.sleep,
      });
    }

    async function wantsTimestampTimers(client: HarvestApi): Promise<boolean> {
      if (timestampTimers !== null) return timestampTimers;

      const company = (await client.company()) as Record<string, unknown>;
      timestampTimers = company.wants_timestamp_timers === true;
      return timestampTimers;
    }

    /**
     * Store the running timer and announce it.
     *
     * An observed change (the poll, a read) announces only when the timer
     * actually differs: the poll runs every minute, most minutes are
     * uneventful, and publishing regardless would wake every open surface for
     * nothing.
     *
     * A deliberate write announces unconditionally. Suppressing a stop because
     * this process never happened to observe the timer running would leave
     * every other open surface showing a timer that is gone.
     */
    async function reconcileRunning(
      entry: TimeEntry | null,
      options: { announce?: boolean } = {},
    ): Promise<TimeEntry | null> {
      const previous = (await bb.storage.kv.get<TimeEntry | null>(RUNNING_KEY)) ?? null;
      const changed = signature(previous) !== signature(entry);

      if (changed) await bb.storage.kv.set(RUNNING_KEY, entry);
      if (changed || options.announce === true) {
        bb.realtime.publish(TIMER_CHANNEL, { entry });
      }

      return entry;
    }

    async function fetchRunning(client: HarvestApi): Promise<TimeEntry | null> {
      return pickRunningEntry(await client.runningEntries());
    }

    async function refreshAssignments(client: HarvestApi): Promise<ProjectOption[]> {
      const projects = normalizeAssignments(await client.projectAssignments());
      await bb.storage.kv.set(ASSIGNMENTS_KEY, projects);
      return projects;
    }

    async function rememberSelection(scope: string | null, selection: Selection): Promise<void> {
      if (selection === null) return;

      await bb.storage.kv.set(LATEST_SELECTION_KEY, selection);
      if (scope !== null && scope !== "") {
        await bb.storage.kv.set(`${SELECTION_PREFIX}${scope}`, selection);
      }
    }

    bb.rpc.register(rpcContract, {
      async status() {
        const client = await api();
        if (client === null) return { configured: false, user: null, error: null };

        try {
          const [me, company] = await Promise.all([client.me(), client.company()]);
          const user = me as Record<string, unknown>;
          const account = company as Record<string, unknown>;

          return {
            configured: true,
            user: {
              name: [user.first_name, user.last_name].filter(Boolean).join(" "),
              accountName: typeof account.name === "string" ? account.name : "",
            },
            error: null,
          };
        } catch (error) {
          return { configured: true, user: null, error: kindOf(error) };
        }
      },

      async assignments() {
        const cached = await bb.storage.kv.get<ProjectOption[]>(ASSIGNMENTS_KEY);
        if (cached !== undefined && cached !== null) return { projects: cached };

        const client = await api();
        if (client === null) return { projects: [] };

        try {
          return { projects: await refreshAssignments(client) };
        } catch (error) {
          // The picker should open and say it has nothing rather than break the
          // surface that hosts it.
          bb.log.warn(`Could not load Harvest assignments: ${messageOf(error)}`);
          return { projects: [] };
        }
      },

      async runningTimer() {
        const client = await api();
        if (client === null) return { entry: null };

        try {
          return { entry: await reconcileRunning(await fetchRunning(client)) };
        } catch (error) {
          bb.log.warn(`Could not read the running Harvest timer: ${messageOf(error)}`);
          return { entry: null };
        }
      },

      async trackedHours({ externalId, groupId }) {
        const client = await api();
        if (client === null) return { hours: 0 };

        try {
          const raw = await client.entriesForExternalId(externalId);
          const entries = raw
            .map(fromApiEntry)
            .filter((entry): entry is TimeEntry => entry !== null);

          return { hours: sumHoursForReference(entries, { externalId, groupId }) };
        } catch (error) {
          bb.log.warn(`Could not total Harvest hours for ${externalId}: ${messageOf(error)}`);
          return { hours: 0 };
        }
      },

      async startTimer(input) {
        const client = await api();
        if (client === null) throw new Error("Harvest is not configured.");

        const body = startEntryBody(input, {
          wantsTimestampTimers: await wantsTimestampTimers(client),
          now: now(),
        });

        const entry = fromApiEntry(await client.startTimer(body));
        await reconcileRunning(entry, { announce: true });
        await rememberSelection(input.externalReference?.groupId ?? null, {
          projectId: input.projectId,
          taskId: input.taskId,
        });

        return { entry };
      },

      async stopTimer({ entryId }) {
        const client = await api();
        if (client === null) throw new Error("Harvest is not configured.");

        await client.stopTimer(entryId);
        await reconcileRunning(null, { announce: true });

        return null;
      },

      async lastSelection({ scope }) {
        if (scope !== null && scope !== "") {
          const scoped = await bb.storage.kv.get<Selection>(`${SELECTION_PREFIX}${scope}`);
          if (scoped !== undefined && scoped !== null) return { ...scoped, exact: true };
        }

        // A scope with no history, and the thread header with no reference at
        // all, both fall back to whatever was picked most recently. That is a
        // starting point rather than a decision, so it is not exact: a surface
        // preferring a particular task may replace the task.
        const latest = await bb.storage.kv.get<Selection>(LATEST_SELECTION_KEY);
        return latest === undefined || latest === null ? null : { ...latest, exact: false };
      },
    });

    bb.background.schedule("refresh-assignments", "0 * * * *", async () => {
      const client = await api();
      if (client === null) return;

      await refreshAssignments(client);
    });

    /**
     * Notice timers started outside bb.
     *
     * The Harvest Chrome extension writes to the same account, so bb cannot
     * treat its own writes as the only source of truth.
     */
    bb.background.schedule("poll-timer", "* * * * *", async () => {
      const client = await api();
      if (client === null) return;

      await reconcileRunning(await fetchRunning(client));
    });

    settings.onChange(() => {
      // A new account may have a different timer style and a different set of
      // projects, so nothing cached survives a credential change.
      timestampTimers = null;
      void bb.storage.kv.delete(ASSIGNMENTS_KEY);
    });
  };
}

/** Two running-timer reads are the same event when the id and start agree. */
function signature(entry: TimeEntry | null): string {
  if (entry === null) return "none";
  return `${entry.id}@${entry.timerStartedAt ?? ""}`;
}

function kindOf(error: unknown): "unauthenticated" | "rate_limited" | "unreachable" | "invalid_response" {
  return error instanceof HarvestError ? error.kind : "unreachable";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default createPlugin();
