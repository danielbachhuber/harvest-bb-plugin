import {
  definePluginApp,
  experimental_useSidebarThreadPullRequest,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { TIMER_CHANNEL } from "./harvest/channel.js";
import type { rpcContract } from "./harvest/contract.js";
import { RunningElsewhereNotice } from "./components/elsewhere-notice.js";
import { memoryScope } from "./components/picker-state.js";
import { runningScope } from "./components/running-state.js";
import { elapsedLabel } from "./components/time-format.js";
import {
  HarvestTimerPicker,
  type HarvestTimerClient,
  type HarvestTimerPickerProps,
  type PickerEntry,
} from "./components/timer-picker.js";
import { githubItemFromPullRequest, timerDefaultsForItem } from "./shared/github.js";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

type Status = {
  configured: boolean;
  user: { name: string; accountName: string } | null;
  error: "unauthenticated" | "rate_limited" | "unreachable" | "invalid_response" | null;
};

/**
 * Adapt this plugin's RPC onto the picker's transport-agnostic client.
 *
 * The picker never imports a contract, which is what lets the same component
 * source run inside Issue Sweep over its proxy methods.
 */
function usePickerClient(rpc: Rpc): HarvestTimerClient {
  return useMemo(
    () => ({
      assignments: () => rpc.call("assignments", null),
      trackedHours: (input) =>
        rpc.call("trackedHours", { externalId: input.externalId, groupId: input.groupId ?? null }),
      startTimer: (input) => rpc.call("startTimer", input),
      lastSelection: (input) => rpc.call("lastSelection", input),
      stopTimer: async (input) => {
        await rpc.call("stopTimer", input);
      },
    }),
    [rpc],
  );
}

/**
 * Track the running timer, following both this window's writes and changes
 * made anywhere else.
 *
 * The poll on the server broadcasts what it finds, which is how a timer
 * started in the Harvest Chrome extension reaches this control.
 */
function useRunningTimer(rpc: Rpc) {
  const [entry, setEntry] = useState<PickerEntry | null>(null);
  const connection = useRealtimeConnectionState();
  const wasDisconnected = useRef(false);

  const refresh = useCallback(async () => {
    const { entry: current } = await rpc.call("runningTimer", null);
    setEntry(current);
  }, [rpc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useRealtime(TIMER_CHANNEL, (payload) => {
    setEntry((payload as { entry: PickerEntry | null }).entry);
  });

  useEffect(() => {
    if (connection !== "connected") {
      wasDisconnected.current = true;
      return;
    }

    // Signals are ephemeral and never replayed, so a reconnect has to
    // reconcile or this control keeps showing pre-disconnect state.
    if (wasDisconnected.current) {
      wasDisconnected.current = false;
      void refresh();
    }
  }, [connection, refresh]);

  return { entry, setEntry, refresh };
}

/** Re-render once a second, but only while something is actually running. */
function useTick(isRunning: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isRunning) return;

    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isRunning]);

  return now;
}

function useStatus(rpc: Rpc): Status | null {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setStatus((await rpc.call("status", null)) as Status);
      } catch {
        setStatus({ configured: true, user: null, error: "unreachable" });
      }
    })();
  }, [rpc]);

  return status;
}

/**
 * The thread header control.
 *
 * The header is a 48px chrome row with 28px controls and the host clamps an
 * oversized child, so this renders exactly one inline button and puts the
 * picker in a portalled popover.
 */
function TrackTimeAction({ threadId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const client = usePickerClient(rpc);
  const status = useStatus(rpc);
  const { entry, setEntry } = useRunningTimer(rpc);
  const { pullRequest } = experimental_useSidebarThreadPullRequest(threadId);
  const [isOpen, setIsOpen] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  const isRunning = entry !== null;
  const now = useTick(isRunning);

  // What this thread is about, so a timer can be told apart from one left
  // running on something else. The host resolves the thread's branch to its
  // pull request; the reference is built the same way a panel row builds it,
  // so hours started here and hours started from a list are counted together.
  const defaults = useMemo((): HarvestTimerPickerProps["defaults"] => {
    const item = githubItemFromPullRequest(pullRequest);
    return item === null ? { notes: "" } : timerDefaultsForItem(item);
  }, [pullRequest]);

  const threadReference = defaults.externalReference ?? null;
  const scope = memoryScope("thread", threadReference?.groupId ?? null);
  const where = runningScope(entry, threadReference);

  const stop = useCallback(async () => {
    if (entry === null || isStopping) return;

    setIsStopping(true);
    try {
      await rpc.call("stopTimer", { entryId: entry.id });
      setEntry(null);
      // Closing is right when this thread's own timer was the one stopped.
      // After stopping a timer that was running elsewhere the picker below is
      // what you wanted next, so the popover stays open.
      if (where === "here") setIsOpen(false);
    } finally {
      setIsStopping(false);
    }
  }, [entry, isStopping, rpc, setEntry, where]);

  // An unconfigured plugin should not offer a control that can only fail.
  if (status !== null && !status.configured) return null;

  const label =
    entry === null
      ? "Track time"
      : where === "here"
        ? `Harvest timer running: ${entry.projectName} · ${entry.taskName}`
        : `Harvest timer running elsewhere: ${entry.projectName} · ${entry.taskName}`;

  // Amber rather than green for a timer that is not this thread's work.
  // Green here is what made a timer left running somewhere else look like
  // this thread being tracked, which is the confusion worth removing.
  const accent =
    where === "here"
      ? "text-success hover:text-success"
      : where === "elsewhere"
        ? "text-attention hover:text-attention"
        : "";

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={label}
          // An accent with chroma rather than text-primary: bb's --primary is
          // oklch(27% 0 0), a near-black neutral, so it reads as ordinary text
          // rather than as a running state. The elapsed label and the
          // accessible name carry the same information, so nothing depends on
          // colour alone.
          className={`h-7 gap-1.5 px-2 ${accent}`}
        >
          <Icon name="Clock" className="size-4" />
          {isRunning ? (
            <span className="text-xs tabular-nums">{elapsedLabel(entry, now)}</span>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="p-0"
        // An inline width rather than a utility class: the arbitrary value
        // depends on the plugin stylesheet reaching this portal, and the
        // vendored default (w-96) otherwise wins. min() keeps it inside a
        // narrow window.
        style={{ width: "min(34rem, calc(100vw - 2rem))" }}
      >
        {where === "here" && entry !== null ? (
          <div className="flex flex-col gap-3 p-3">
            <div>
              <p className="text-sm font-medium">
                {entry.projectName} · {entry.taskName}
              </p>
              {entry.notes === null ? null : (
                <p className="text-xs text-muted-foreground">{entry.notes}</p>
              )}
            </div>
            <p className="text-2xl tabular-nums">{elapsedLabel(entry, now)}</p>
            <div className="flex gap-2">
              <Button onClick={() => void stop()} disabled={isStopping}>
                {isStopping ? "Stopping…" : "Stop timer"}
              </Button>
              <Button variant="outline" onClick={() => setIsOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <div>
            {/* The switch is the ordinary picker, with the other timer named
                above it. Harvest runs one timer at a time, so starting here
                stops that one; the button is offered for when the answer is
                "stop it" rather than "move it". */}
            {where === "elsewhere" && entry !== null ? (
              <RunningElsewhereNotice
                entry={entry}
                isStopping={isStopping}
                onStop={() => void stop()}
              />
            ) : null}
            <HarvestTimerPicker
              client={client}
              defaults={defaults}
              scope={scope}
              onStarted={(started) => {
                setEntry(started);
                setIsOpen(false);
              }}
              onCancel={() => setIsOpen(false)}
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Connection status.
 *
 * A wrong account id and a wrong token both produce a 401, so naming who the
 * credentials actually belong to is the fastest way to tell them apart.
 */
function ConnectionSection() {
  const rpc = useRpc<typeof rpcContract>();
  const status = useStatus(rpc);

  if (status === null) {
    return <p className="text-sm text-muted-foreground">Checking the Harvest connection…</p>;
  }

  if (!status.configured) {
    return (
      <p className="text-sm text-muted-foreground">
        Harvest is not configured. Add an account ID and a personal access token above, then
        create the token at{" "}
        <span className="font-mono text-xs">https://id.getharvest.com/developers</span>.
      </p>
    );
  }

  if (status.error !== null) return <p className="text-sm text-destructive">{errorCopy(status.error)}</p>;

  if (status.user !== null) {
    return (
      <p className="text-sm text-muted-foreground">
        Connected as <span className="font-medium text-foreground">{status.user.name}</span> on{" "}
        <span className="font-medium text-foreground">{status.user.accountName}</span>.
      </p>
    );
  }

  return <p className="text-sm text-muted-foreground">Connected.</p>;
}

function errorCopy(error: NonNullable<Status["error"]>): string {
  switch (error) {
    case "unauthenticated":
      return "Harvest rejected these credentials. Check the account ID, then regenerate the token.";
    case "rate_limited":
      return "Harvest is rate limiting requests. Try again shortly.";
    case "invalid_response":
      return "Harvest returned something unexpected. Try again shortly.";
    default:
      return "Harvest could not be reached. Check the network, then try again.";
  }
}

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "track-time",
    title: "Track time",
    component: TrackTimeAction,
  });

  app.slots.settingsSection({
    id: "connection",
    title: "Connection",
    description: "Which Harvest account these credentials reach.",
    component: ConnectionSection,
  });
});
