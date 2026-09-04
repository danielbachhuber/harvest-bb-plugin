/**
 * The per-row Harvest control.
 *
 * Exported as `bb-plugin-harvest/clock` for list surfaces: one small chip
 * beside a row's other metadata controls, opening the picker in a portalled
 * popover.
 *
 * A running timer is a solid fill plus the accessible name. Colour alone did
 * not read as a state: a tint on a 14px outline glyph beside a grey copy
 * control looks like a slightly different icon. The fill does read, and the
 * elapsed time lives in the popover rather than the row, where a per-second
 * numeral is noise in a dense list.
 *
 * The fill is set inline from `--success`. bb ships no solid `bg-success`
 * utility, and the plugin Tailwind pass emits default-theme utilities only, so
 * a class would silently do nothing. It is still the theme's colour rather
 * than a hardcoded one, and `text-background` inverts with the theme so the
 * glyph reads against the fill in both. `--primary` is not an option at all:
 * it is `oklch(27% 0 0)`, a near-black neutral with no chroma.
 *
 * Resting matches `text-muted-foreground/70`, which is what bb's own copy
 * control uses. At full `text-muted-foreground` it renders a step darker than
 * its neighbour and reads as a different class of control.
 */
import { useEffect, useState } from "react";

import { Button } from "./ui/button.js";
import { Icon } from "./ui/icon.js";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.js";

import { memoryScope } from "./picker-state.js";
import { elapsedLabel } from "./time-format.js";
import { HarvestTimerPicker, type HarvestTimerClient } from "./timer-picker.js";
import { timerDefaultsForItem, type GitHubItem } from "../shared/github.js";

/**
 * The running timer, when it is the one for this row.
 *
 * The caller owns the matching, because only it knows how its rows map onto a
 * reference. Passing the whole entry rather than a boolean is what lets the
 * popover offer a stop instead of a start form that does nothing.
 */
export interface RunningRowTimer {
  entryId: number;
  /** Absent on a listing that predates the field; the fill still applies. */
  startedAt: string | null;
  projectName: string;
  taskName: string;
}

export interface HarvestRowClockProps {
  row: GitHubItem;
  /** The running timer when it belongs to this row, otherwise null. */
  running: RunningRowTimer | null;
  client: HarvestTimerClient;
  /**
   * Names the kind of work this list is, so it remembers its own project and
   * task rather than sharing one memory with every other list.
   */
  surface?: string;
  /**
   * The task this list is usually about, seeded until the surface has its own
   * history. A Reviews list wants "Code Review".
   */
  preferredTaskName?: string;
  /**
   * Called after a timer starts or stops, so the caller can re-read the
   * listing that told it which row was running.
   */
  onChanged: () => void;
}

/** Re-render once a second, but only while something is actually running. */
function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;

    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  return now;
}

/**
 * What the popover shows while this row's timer is running.
 *
 * Exported for tests: Radix opens on pointerdown, which jsdom does not
 * synthesize, so this cannot be reached by clicking the trigger.
 */
export function RunningPanel({
  running,
  client,
  onChanged,
  onClose,
}: {
  running: RunningRowTimer;
  client: HarvestTimerClient;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [isStopping, setIsStopping] = useState(false);
  const now = useTick(running.startedAt !== null);
  const elapsed =
    running.startedAt === null
      ? null
      : elapsedLabel({ hours: 0, timerStartedAt: running.startedAt }, now);

  const stop = async () => {
    if (isStopping) return;

    setIsStopping(true);
    try {
      await client.stopTimer({ entryId: running.entryId });
      onChanged();
      onClose();
    } finally {
      setIsStopping(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div>
        <p className="text-xs text-muted-foreground">Tracking now</p>
        <p className="text-sm font-medium">
          {running.projectName} · {running.taskName}
        </p>
      </div>
      {elapsed === null ? null : <p className="text-2xl tabular-nums">{elapsed}</p>}
      <div className="flex gap-2">
        <Button onClick={() => void stop()} disabled={isStopping}>
          {isStopping ? "Stopping…" : "Stop timer"}
        </Button>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

export function HarvestRowClock({
  row,
  running,
  client,
  surface,
  preferredTaskName,
  onChanged,
}: HarvestRowClockProps) {
  const [isOpen, setIsOpen] = useState(false);
  const defaults = timerDefaultsForItem(row);
  const scope = memoryScope(surface, defaults.externalReference.groupId);

  const isRunning = running !== null;

  // A row already carries a title link, a copy control, a status picker and a
  // thread action, so this has to say which item it belongs to.
  const label = isRunning
    ? `Harvest timer running for #${row.number}`
    : `Track time for #${row.number}`;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          aria-label={label}
          className={
            isRunning
              ? "size-4 rounded text-background hover:text-background"
              : "size-4 text-muted-foreground/70 hover:text-foreground"
          }
          style={isRunning ? { backgroundColor: "var(--success)" } : undefined}
        >
          <Icon name="Clock" className="size-3.5" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="p-0"
        style={{ width: "min(34rem, calc(100vw - 2rem))" }}
      >
        {running === null ? (
          <HarvestTimerPicker
            client={client}
            defaults={defaults}
            scope={scope}
            preferredTaskName={preferredTaskName}
            onStarted={() => {
              setIsOpen(false);
              onChanged();
            }}
            onCancel={() => setIsOpen(false)}
          />
        ) : (
          <RunningPanel
            running={running}
            client={client}
            onChanged={onChanged}
            onClose={() => setIsOpen(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
