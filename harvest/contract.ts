import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export { TIMER_CHANNEL } from "./channel.js";

/**
 * The plugin's data plane.
 *
 * Deliberately generic: nothing here knows about GitHub. Callers build their
 * own notes and external references, which is what lets Issue Sweep, and later
 * anything else, reuse this without a new method per consumer.
 */

export const ExternalReferenceSchema = z.strictObject({
  id: z.string().min(1),
  groupId: z.string().nullable(),
  accountId: z.string().nullable(),
  permalink: z.string().nullable(),
});

export const TimeEntrySchema = z.object({
  id: z.number().int(),
  projectName: z.string(),
  taskName: z.string(),
  notes: z.string().nullable(),
  hours: z.number(),
  timerStartedAt: z.string().nullable(),
  externalReference: ExternalReferenceSchema.nullable(),
});

export const RunningTimerSchema = z.object({ entry: TimeEntrySchema.nullable() });

export const StatusSchema = z.object({
  /** Both credentials are present. Says nothing about whether they work. */
  configured: z.boolean(),
  user: z.object({ name: z.string(), accountName: z.string() }).nullable(),
  error: z.enum(["unauthenticated", "rate_limited", "unreachable", "invalid_response"]).nullable(),
});

export const AssignmentsSchema = z.object({
  projects: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      code: z.string().nullable(),
      clientName: z.string().nullable(),
      tasks: z.array(z.object({ id: z.number().int(), name: z.string() })),
    }),
  ),
});

export const SelectionSchema = z
  .object({ projectId: z.number().int(), taskId: z.number().int() })
  .nullable();

export const TrackedHoursInput = z.strictObject({
  externalId: z.string().min(1),
  groupId: z.string().nullish(),
});

export const StartTimerInput = z.strictObject({
  projectId: z.number().int(),
  taskId: z.number().int(),
  notes: z.string(),
  externalReference: ExternalReferenceSchema.optional(),
});

export const rpcContract = defineRpcContract({
  status: { input: z.null(), output: StatusSchema },
  assignments: { input: z.null(), output: AssignmentsSchema },
  runningTimer: { input: z.null(), output: RunningTimerSchema },
  trackedHours: { input: TrackedHoursInput, output: z.object({ hours: z.number() }) },
  startTimer: { input: StartTimerInput, output: RunningTimerSchema },
  stopTimer: { input: z.strictObject({ entryId: z.number().int() }), output: z.null() },
  /**
   * The project and task last committed to for a scope, so the picker opens
   * pre-filled. There is no matching write method: `startTimer` records the
   * selection, because that is the only moment a selection is known to be one
   * the user actually went through with.
   */
  lastSelection: { input: z.strictObject({ scope: z.string().nullable() }), output: SelectionSchema },
});
