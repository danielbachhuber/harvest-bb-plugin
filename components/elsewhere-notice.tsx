/**
 * The banner shown when a Harvest timer is running on something other than
 * what this surface is about.
 *
 * A separate component rather than markup inside the header: Radix opens on
 * pointerdown, which jsdom does not synthesize, so anything inside the
 * popover is unreachable from a click in a test. Exporting it keeps the copy
 * and the stop behavior covered.
 *
 * It deliberately does not offer to start anything. The switch is the picker
 * rendered beneath it, so starting time on this thread is the same two
 * controls it always is, and stopping the other timer is not a precondition:
 * Harvest runs one timer at a time and starting a second stops the first.
 */
import { useEffect, useState } from "react";

import { Button } from "./ui/button.js";

import { elapsedLabel } from "./time-format.js";
import type { PickerEntry } from "./timer-picker.js";

export interface RunningElsewhereNoticeProps {
  entry: PickerEntry;
  isStopping: boolean;
  onStop: () => void;
}

/** Re-render once a second, so the elapsed time is not frozen at open. */
function useTick(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return now;
}

export function RunningElsewhereNotice({
  entry,
  isStopping,
  onStop,
}: RunningElsewhereNoticeProps) {
  const now = useTick();

  return (
    <div className="flex flex-col gap-2 border-b border-border bg-attention/10 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium text-attention">Timer running elsewhere</p>
        <p className="text-sm tabular-nums text-attention">{elapsedLabel(entry, now)}</p>
      </div>

      <div>
        <p className="text-sm font-medium">
          {entry.projectName} · {entry.taskName}
        </p>
        {/* Without the notes this reads as half the account and says nothing
            about which piece of work is being tracked. */}
        {entry.notes === null || entry.notes === "" ? null : (
          <p className="text-xs text-muted-foreground">{entry.notes}</p>
        )}
      </div>

      <div>
        <Button variant="outline" size="sm" onClick={onStop} disabled={isStopping}>
          {isStopping ? "Stopping…" : "Stop that timer"}
        </Button>
      </div>
    </div>
  );
}
