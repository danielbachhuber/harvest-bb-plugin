/**
 * The per-row Harvest control.
 *
 * Exported as `bb-plugin-harvest/clock` for list surfaces: one small clock
 * beside a row's other metadata controls, opening the picker in a portalled
 * popover.
 *
 * Colour choices, both learned the hard way:
 *
 * Resting matches `text-muted-foreground/70`, which is what bb's own copy
 * control uses. At full `text-muted-foreground` it renders a step darker than
 * its neighbour and reads as a different class of control.
 *
 * Running uses `text-success`, not `text-primary`. bb's `--primary` is
 * `oklch(27% 0 0)` — a near-black neutral with no chroma — so tinting with it
 * produces something darker than ordinary muted text and not recognisably
 * "active". `--success` is `oklch(70% .15 155)` and actually reads as a state.
 * The accessible name carries the same information, so the state is never
 * conveyed by colour alone.
 */
import { useState } from "react";

import { Button } from "./ui/button.js";
import { Icon } from "./ui/icon.js";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.js";

import { memoryScope } from "./picker-state.js";
import { HarvestTimerPicker, type HarvestTimerClient } from "./timer-picker.js";
import { timerDefaultsForItem, type GitHubItem } from "../shared/github.js";

export interface HarvestRowClockProps {
  row: GitHubItem;
  /** Whether the running timer is the one for this row. */
  isRunning: boolean;
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
  /** Called after a timer starts, so the caller can re-read its listing. */
  onStarted: () => void;
}

export function HarvestRowClock({
  row,
  isRunning,
  client,
  surface,
  preferredTaskName,
  onStarted,
}: HarvestRowClockProps) {
  const [isOpen, setIsOpen] = useState(false);
  const defaults = timerDefaultsForItem(row);
  const group = defaults.externalReference.groupId;
  const scope = memoryScope(surface, group);

  // A row already carries a title link, a copy control, a status picker and a
  // thread action, so this has to say which item it belongs to.
  const label = isRunning
    ? `Harvest timer running for #${row.number}`
    : `Track time for #${row.number}`;

  const tone = isRunning
    ? "text-success hover:text-success"
    : "text-muted-foreground/70 hover:text-foreground";

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} className={`size-4 ${tone}`}>
          <Icon name="Clock" className="size-3.5" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[26rem] p-0">
        <HarvestTimerPicker
          client={client}
          defaults={defaults}
          scope={scope}
          preferredTaskName={preferredTaskName}
          onStarted={() => {
            setIsOpen(false);
            onStarted();
          }}
          onCancel={() => setIsOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
