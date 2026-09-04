/**
 * The realtime channel both plugins' frontends watch for timer changes.
 *
 * This lives in its own value-only module because `app.tsx` needs the string
 * at runtime, and importing it from the contract would pull zod and the SDK's
 * contract helper into the frontend bundle.
 */
export const TIMER_CHANNEL = "harvest:timer";
