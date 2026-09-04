# harvest-bb-plugin

A [bb](https://getbb.app) plugin for tracking time in [Harvest](https://www.getharvest.com/)
without leaving the app.

## What it adds

A Track time control in the bb thread header. It shows a clock when idle and
the running timer's elapsed time when one is going, and opens a picker for
choosing a project and task, writing a note, and starting a timer. A running
timer can be stopped from the same control.

The control distinguishes a timer running for this thread from one left running
somewhere else. When bb can resolve the thread's branch to a pull request, the
timer is this thread's work only if it carries that pull request's reference;
anything else is amber and named "running elsewhere", and its popover offers to
stop it above a picker prefilled for this thread. A thread with no pull request
has nothing to compare against, so any running timer reads as its own.

The plugin also exposes a generic RPC surface (`assignments`, `runningTimer`,
`trackedHours`, `startTimer`, `stopTimer`, `lastSelection`) that knows nothing
about any particular tool, so another bb plugin can start timers through it.
The Issue Sweep plugin uses this to put a clock on each GitHub issue row.

Timers started here carry the same `external_reference` convention the Harvest
Chrome extension uses for GitHub, so hours tracked in either tool add up to one
total rather than splitting in two.

## Configuration

The plugin authenticates against the Harvest API v2 with a personal access token.
Create one at [id.getharvest.com/developers](https://id.getharvest.com/developers),
then set both values:

```sh
bb plugin config harvest set accountId <your-harvest-account-id>
bb plugin config harvest set accessToken <your-personal-access-token>
bb plugin reload harvest
```

The token is stored as a bb secret setting, outside this repository.

## Install

```sh
bb plugin install git:https://github.com/danielbachhuber/harvest-bb-plugin.git@main
```

## How often it calls the Harvest API

Harvest's general rate limit is **100 requests per 15 seconds**. Everything
below sits far under that; the numbers matter more for latency and for
understanding what the plugin does while you are not looking.

Nothing is requested at all until both credentials are set. An unconfigured
plugin reports `needs-configuration` and makes no network calls.

### On a timer

| What | Interval | Requests | Endpoint |
| --- | --- | --- | --- |
| `poll-timer` | every minute | 1 | `GET /v2/time_entries?is_running=true` |
| `refresh-assignments` | hourly, on the hour | 1, plus 1 per extra page | `GET /v2/users/me/project_assignments` |

For an account whose assignments fit one page, that is **61 requests an hour at
rest**, against a ceiling of 24,000 an hour.

The minute poll is the price of noticing timers started outside bb. The Harvest
web app and the Chrome extension write to the same account, so the plugin
cannot treat its own writes as the only source of truth. Anything it observes
is broadcast on a realtime channel, which is how the thread-header control
updates without polling of its own.

Schedules only run while the plugin is loaded. Disable it and the requests stop.

### Per interaction

| Action | Requests | Notes |
| --- | --- | --- |
| `status` | 2 | `GET /v2/users/me` and `GET /v2/company`, in parallel. Not cached. |
| `assignments` | 0 or 1 | Served from storage; only fetches on a cold cache. |
| `runningTimer` | 1 | |
| `trackedHours` | 1, plus 1 per extra page | `GET /v2/time_entries?external_reference_id=…` |
| `startTimer` | 2, or 3 on the first call after a load | One `GET /v2/time_entries` narrowed to the day, project and task, to find an entry to resume; then either `PATCH /v2/time_entries/{id}/restart` or `POST /v2/time_entries`. On the first call after a load, one extra `GET /v2/company` to read the account's timer style, which is then held in memory. |
| `stopTimer` | 1 | `PATCH /v2/time_entries/{id}/stop` |
| `lastSelection` | 0 | Plugin storage only. |

### What that means for a consuming plugin

The pattern in the *Using it from your own bb plugin* section costs **3 requests
per listing load**: `available()` is `status` (2) and `runningReference()` is
`runningTimer` (1). A panel that refreshes on every navigation pays that each
time, and those requests are in front of your data.

If that latency matters, cache the availability answer for the lifetime of your
panel rather than re-reading it per refresh. It changes only when credentials
change, which is rare, while the running timer changes often.

Opening the picker costs **1 request** in the common case: `assignments` is
served from storage, `lastSelection` touches no network, and only
`trackedHours` goes out.

### Resuming rather than duplicating

Starting a timer first looks for the day's existing entry for the same
project, task and external reference, and restarts that when it finds one.
Harvest's own convention is a single entry per project, task and day, so
posting a new entry on every start scatters one day's work across duplicates
that have to be merged by hand.

The lookup is deliberately forgiving: if it fails, the timer still starts as a
new entry. A duplicate is a much better outcome than refusing to start.

### Retries

A 429 is retried twice, three attempts in total, honouring Harvest's
`Retry-After` header when present and widening the delay when it is not. After
that it surfaces as `rate_limited`, kept distinct from an authentication
failure so a busy Harvest never tells you to regenerate a working token.

Note that the Reports API has a much tighter budget, **100 requests per 15
minutes**. This plugin never touches it: hour totals come from `time_entries`
rather than a report.

## Using it from your own bb plugin

Any bb plugin can start Harvest timers through this one. It keeps the
credentials and makes every Harvest request; your plugin supplies a button and
says what the timer is for.

This is necessary rather than merely tidy: bb plugins cannot render each
other's React components, because every cross-plugin opener in the SDK
(`useBbNavigate().openThreadPanel`, `experimental_useAppPanel().openFixedTab`)
is scoped to the calling plugin's own registrations. So a consumer bundles the
picker source into its own app bundle and reaches the Harvest plugin's data
over RPC.

### Add the dependency

```sh
npm install --save-exact zod@4.5.4
npm install github:danielbachhuber/harvest-bb-plugin
```

Pin `zod` to the exact version this package uses. Two different zod copies in
one type graph make `z.ZodType` mutually unassignable, which surfaces as
`TS2589: Type instantiation is excessively deep` on an unrelated line and
collapses inference everywhere downstream. The failure never mentions zod.

### 1. Forward four methods from your server

`bridge.ts` is the transport. It degrades every read to an empty answer, so
your plugin stays fully usable on a machine where this plugin is missing,
disabled, or unconfigured. The write propagates its failure instead, because a
write that quietly does nothing leaves the user believing time is being
tracked.

```ts
import { createHarvestBridge } from "bb-plugin-harvest/bridge";

export default function plugin(bb: BbPluginApi) {
  const harvest = createHarvestBridge(bb);

  bb.rpc.register(rpcContract, {
    harvestAssignments: () => harvest.assignments(),
    harvestTrackedHours: (input) => harvest.trackedHours(input),
    harvestLastSelection: (input) => harvest.lastSelection(input),
    harvestStartTimer: (input) => harvest.startTimer(input),

    async listRows() {
      return {
        rows: /* ... */,
        // Whether to draw the control at all, and which row is running.
        harvest: (await harvest.available())
          ? { available: true, running: await harvest.runningReference() }
          : { available: false, running: null },
      };
    },
  });
}
```

Read `available()` before drawing anything. It is false when this plugin is
absent, holds no credentials, or holds credentials Harvest rejects, and true
when Harvest is merely rate limiting or briefly unreachable, which is worth
offering anyway.

### 2. Adapt your RPC onto the picker's client

The picker takes an injected client instead of calling `useRpc` itself, which
is what lets one component serve any plugin over its own transport.

```tsx
import { HarvestTimerPicker, type HarvestTimerClient } from "bb-plugin-harvest/picker";

function useHarvestClient(rpc): HarvestTimerClient {
  return useMemo(
    () => ({
      assignments: () => rpc.call("harvestAssignments", null),
      trackedHours: (input) =>
        rpc.call("harvestTrackedHours", {
          externalId: input.externalId,
          groupId: input.groupId ?? null,
        }),
      startTimer: (input) => rpc.call("harvestStartTimer", input),
      lastSelection: (input) => rpc.call("harvestLastSelection", input),
    }),
    [rpc],
  );
}
```

### 3. Render it

Put it in a portalled popover, not inline; it is a form.

```tsx
<HarvestTimerPicker
  client={client}
  defaults={{ notes: "#42: Fix the flaky test", externalReference }}
  onStarted={() => reload()}
  onCancel={() => setOpen(false)}
/>
```

`defaults.notes` prefills the note and is also the label in the "has 0:25
tracked to it" footnote. `externalReference` is optional; omit it for work that
is not about a specific external thing.

### The external reference, and why it matters

A timer's `externalReference` is what links it to the thing it is about, and
what makes hours accumulate against that thing across every tool that uses the
same reference.

If your plugin is about GitHub, use the supplied builder rather than inventing
a convention:

```ts
import { timerDefaultsForItem } from "bb-plugin-harvest/github";

const { notes, externalReference } = timerDefaultsForItem({
  repo: "octocat/acme-widgets",
  number: 42,
  title: "Fix the flaky test",
  url: "https://github.com/octocat/acme-widgets/issues/42",
});
```

It mirrors the convention the Harvest Chrome extension uses: the bare issue
number as `id`, the repository as `groupId`, the owner as `accountId`. Matching
it exactly means a timer started in the browser and one started in bb carry the
same reference, so `trackedHours` returns one total instead of each tool
silently reporting half the work. Issues and pull requests share one number
space per repository, so the same builder serves both.

For anything other than GitHub, build the reference yourself. Note that
Harvest's own `external_reference_id` filter matches on `id` alone, across every
service, so pass `groupId` to `trackedHours` and this plugin narrows the total
after the fetch. Without it, every repository's `#42` is summed together.

### What is exported

| Subpath | Contents |
| --- | --- |
| `bb-plugin-harvest/picker` | `HarvestTimerPicker`, `HarvestTimerClient`, `PickerEntry`, `PickerExternalReference` |
| `bb-plugin-harvest/bridge` | `createHarvestBridge`, `HarvestBridge`, `RunningReference` |
| `bb-plugin-harvest/github` | `timerDefaultsForItem` |
| `bb-plugin-harvest/picker-state` | `resolveSelection`, `tasksFor`, `withProject` |
| `bb-plugin-harvest/time-format` | `formatHours`, `elapsedLabel` |

### Two limits worth knowing

**The running timer is not pushed to you.** `bb.realtime` signals are scoped to
the plugin that publishes them, so your plugin cannot subscribe to this one's
broadcast. Read `runningReference()` with your own data and refresh after
starting a timer. Only this plugin's own thread-header control follows the
timer live.

**Starting a timer stops the running one.** Harvest permits one running timer
per user. That is Harvest's behavior, not this plugin's, and the previous entry
keeps the time it accumulated.

## License

MIT
