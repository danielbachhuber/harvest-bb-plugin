# harvest-bb-plugin

A [bb](https://getbb.app) plugin for tracking time in [Harvest](https://www.getharvest.com/)
without leaving the app.

It adds a Track time control to the bb thread header and a pair of Harvest rows to
the command palette. Both open a picker for choosing a project and task, writing a
note, and starting a timer. A running timer is reflected back in the header with its
elapsed time.

Timers carry a Harvest `external_reference`, so a timer started here is linked to the
thing it is about and its hours are counted alongside timers started anywhere else
that uses the same reference, including the Harvest Chrome extension.

## Status

Early. Nothing is implemented yet.

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
