# @steno/plugin-analytics

Analytics plugin for [Steno](https://github.com/steno/steno) that injects a privacy-respecting
analytics snippet (GoatCounter, Umami, Plausible, or a self-hosted GoatCounter-style instance) from
config, and declares the exact script/connect domains it needs so [@steno/plugin-csp](../plugin-csp)
can allow them.

This is for a site that wants one of these three analytics services wired up without hand-writing
the `<script>` tag, and without a Content-Security-Policy having to separately duplicate that same
domain list.

## Installation

```yaml
# content/.steno/config.yml
plugins:
  - jsr:@steno/plugin-analytics
```

## Options

```yaml
plugins:
  - package: jsr:@steno/plugin-analytics
    options:
      service: goatcounter
      id: my-site
  - package: jsr:@steno/plugin-csp # after plugin-analytics, see below
```

| Option          | Type                                                    | Default     | Description                                                                                    |
| --------------- | -------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| `service`       | `"goatcounter" \| "umami" \| "plausible" \| undefined` | `undefined` | Picks the known-domain snippet + CSP source table. Requires `id`. Mutually exclusive with `selfHostedUrl`. |
| `id`            | `string \| undefined`                                    | `undefined` | Service-specific site identifier (GoatCounter subdomain, Umami website ID, Plausible domain). Required when `service` is set. |
| `selfHostedUrl` | `string \| undefined`                                    | `undefined` | Self-hosted instance. Mutually exclusive with `service`/`id` — see "Self-hosted instances" below.  |

Exactly one of `service`+`id` or `selfHostedUrl` must be set; both or neither fails `beforeBuild`
validation with a clear message rather than silently picking one.

## How it works

1. `beforeBuild` validates that exactly one of `service`+`id` or `selfHostedUrl` is set, throwing
   immediately otherwise rather than failing silently later in the build.
2. Appends a script tag for the chosen service to `config.head` (never replaces an existing `head`
   array — always pushes onto it, so other head-managing plugins compose normally).
3. Merges this plugin's required CSP sources into `config.globals.__cspContributions`, additively,
   per the cross-plugin contract below.

### Known domains per service

| Service         | Script src                | Connect src                    |
| --------------- | -------------------------- | -------------------------------- |
| `goatcounter`   | `gc.zgo.at`                | `<id>.goatcounter.com/count`    |
| `umami`         | `cloud.umami.is`           | `*.umami.dev`, `cloud.umami.is` |
| `plausible`     | `plausible.io`             | `plausible.io`                  |
| `selfHostedUrl` | origin of `selfHostedUrl` | origin of `selfHostedUrl`       |

### Self-hosted instances

`selfHostedUrl` doesn't take a paired `service` — a self-hosted deployment typically needs its own
branch per service (`.../count.js` for GoatCounter, `.../script.js` for Umami and Plausible, each
keyed off a still-required `id`), but this plugin's `selfHostedUrl` form has no `id` field at all. Of
the three, only GoatCounter's snippet doesn't need a separate `id` — the URL itself (`<url>/count`)
*is* the tracking identity — so a bare `selfHostedUrl` resolves to a self-hosted GoatCounter-compatible
endpoint:

```yaml
plugins:
  - package: jsr:@steno/plugin-analytics
    options:
      selfHostedUrl: https://analytics.example.com
```

produces `<script async data-goatcounter="https://analytics.example.com/count" src="https://analytics.example.com/count.js">`
and contributes `https://analytics.example.com` to both `script-src` and `connect-src`. Self-hosting
Umami or Plausible instead isn't supported by this option today — reach for a raw `head` entry in your
own site config if you need that.

### Head-injection approach

Steno's `ScriptHeadTag` (see [types.ts](https://github.com/stenopress/steno/blob/main/src/types.ts))
has fields for `src`, `async`, `defer`, `type`, `content`, etc., but no field for arbitrary `data-*`
attributes — and all three services' snippets need one (`data-goatcounter`, `data-website-id`,
`data-domain`). Rather than fall back to `transformHtml` string surgery, `resolveAnalytics()` returns
an `AnalyticsScriptTag` (`ScriptHeadTag & Record<string, string | boolean | undefined>`), and
`beforeBuild` pushes that directly onto `config.head`. This still composes with other head-managing
plugins (dedupe by `key`, ordering, etc.) exactly like a normal `ScriptHeadTag` would, which raw
string surgery would not.

### Cross-plugin contract with plugin-csp

`StenoPlugin` has no dedicated "declare my CSP needs" hook, so this plugin contributes its required
CSP sources by pushing into `config.globals.__cspContributions` during its own `beforeBuild`. The
merge is always additive — it never overwrites `existing[directive]`, since `@steno/plugin-csp` or
other plugins may contribute to the same directive. See `mergeCspContributions()` in `mod.ts`.

**Ordering matters**: a site using both plugins must declare `@steno/plugin-analytics` **before**
`@steno/plugin-csp` in its `plugins:` list, since hooks of the same name run in declaration order.

## Test

```sh
deno task test
```

## Learn more

- [Steno plugin development guide](https://github.com/stenopress/steno/blob/main/docs/plugins.md)
- [@steno/plugin-csp](../plugin-csp/README.md) — consumes this plugin's declared CSP sources; must be declared after this one in `plugins:`

## License

MIT
