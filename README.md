# harvest-bb-plugin

A [bb](https://getbb.app) plugin for tracking time in [Harvest](https://www.getharvest.com/)
without leaving the app.

## What it adds

A Track time control in the bb thread header. It shows a clock when idle and
the running timer's elapsed time when one is going, and opens a picker for
choosing a project and task, writing a note, and starting a timer. A running
timer can be stopped from the same control.

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

## License

MIT
