import type { ScriptHeadTag, SiteConfig, StenoPlugin } from "@steno/steno";

/** Known analytics services with a hardcoded script/domain table. */
export type AnalyticsService = "goatcounter" | "umami" | "plausible";

/** Options accepted by this plugin. Exactly one of the two forms below must be set. */
export interface PluginAnalyticsOptions {
  /**
   * Form A (with `id`): use a known service's hosted script and domains.
   * Mutually exclusive with `selfHostedUrl`.
   */
  service?: AnalyticsService;
  /** Service-specific site identifier. Required when `service` is set. */
  id?: string;
  /**
   * Form B: point at a self-hosted analytics instance instead of a known
   * service. The script src and CSP sources are derived entirely from this
   * URL's own origin, using GoatCounter's self-hosted `count.js`/`count`
   * convention — the only one of the three services whose snippet doesn't
   * need a separate `id` (see README "Self-hosted instances"). Mutually
   * exclusive with `service`/`id`.
   */
  selfHostedUrl?: string;
}

/** CSP source contributions keyed by directive name (e.g. `"script-src"`). */
export type CspContributions = Record<string, string[]>;

/**
 * A `ScriptHeadTag` widened with the `data-*` attributes GoatCounter,
 * Umami, and Plausible's snippets rely on. `ScriptHeadTag` itself has no
 * field for arbitrary attributes (see README "Head-injection approach" for
 * why we still go through `config.head` instead of `transformHtml`).
 */
export type AnalyticsScriptTag = ScriptHeadTag & Record<string, string | boolean | undefined>;

/** The resolved head tag plus the CSP sources it requires. */
export interface ResolvedAnalytics {
  scriptTag: AnalyticsScriptTag;
  cspContributions: CspContributions;
}

/**
 * Resolves this plugin's options into the script tag to inject and the CSP
 * sources it needs, without touching a `SiteConfig`. Exported so tests (and
 * other tooling) can exercise the resolution logic directly.
 *
 * @throws {Error} if both or neither of `service`/`selfHostedUrl` are set,
 * if `service` is set without `id`, or if `selfHostedUrl` isn't a valid URL.
 */
export function resolveAnalytics(options: PluginAnalyticsOptions): ResolvedAnalytics {
  const { service, id, selfHostedUrl } = options;

  if (service && selfHostedUrl) {
    throw new Error(
      "plugin-analytics: set either `service` (with `id`) or `selfHostedUrl`, not both.",
    );
  }
  if (!service && !selfHostedUrl) {
    throw new Error(
      "plugin-analytics: set either `service` (with `id`) or `selfHostedUrl`.",
    );
  }

  if (selfHostedUrl) {
    return resolveSelfHosted(selfHostedUrl);
  }

  if (!id) {
    throw new Error(`plugin-analytics: \`id\` is required when \`service\` is "${service}".`);
  }
  return resolveService(service!, id);
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    throw new Error(`plugin-analytics: \`selfHostedUrl\` is not a valid URL: "${url}"`);
  }
}

/** GoatCounter's self-hosted convention: no separate `id`, the URL is the identity. */
function resolveSelfHosted(selfHostedUrl: string): ResolvedAnalytics {
  const origin = originOf(selfHostedUrl);
  return {
    scriptTag: {
      tag: "script",
      key: "plugin-analytics",
      src: `${origin}/count.js`,
      async: true,
      "data-goatcounter": `${origin}/count`,
    },
    cspContributions: {
      "script-src": [origin],
      "connect-src": [origin],
    },
  };
}

function resolveService(service: AnalyticsService, id: string): ResolvedAnalytics {
  switch (service) {
    case "goatcounter":
      return {
        scriptTag: {
          tag: "script",
          key: "plugin-analytics",
          src: "https://gc.zgo.at/count.js",
          async: true,
          "data-goatcounter": `https://${id}.goatcounter.com/count`,
        },
        cspContributions: {
          "script-src": ["gc.zgo.at"],
          "connect-src": [`${id}.goatcounter.com/count`],
        },
      };

    case "umami":
      return {
        scriptTag: {
          tag: "script",
          key: "plugin-analytics",
          src: "https://cloud.umami.is/script.js",
          async: true,
          defer: true,
          "data-website-id": id,
        },
        cspContributions: {
          "script-src": ["cloud.umami.is"],
          "connect-src": ["*.umami.dev", "cloud.umami.is"],
        },
      };

    case "plausible":
      return {
        scriptTag: {
          tag: "script",
          key: "plugin-analytics",
          src: "https://plausible.io/js/script.js",
          defer: true,
          "data-domain": id,
        },
        cspContributions: {
          "script-src": ["plausible.io"],
          "connect-src": ["plausible.io"],
        },
      };

    default:
      throw new Error(`plugin-analytics: unknown \`service\`: "${service}"`);
  }
}

/**
 * Merges `contributions` additively into `config.globals.__cspContributions`,
 * per the cross-plugin contract `plugin-csp` reads during its own
 * `beforeBuild`. Never overwrites another plugin's prior contribution for a
 * directive — always appends. Exported so tests can exercise the merge
 * without constructing a full `SiteConfig`.
 */
export function mergeCspContributions(
  config: SiteConfig,
  contributions: CspContributions,
): void {
  const globals = (config.globals ??= {});
  const existing = (globals.__cspContributions as CspContributions | undefined) ?? {};
  for (const [directive, sources] of Object.entries(contributions)) {
    existing[directive] = [...(existing[directive] ?? []), ...sources];
  }
  globals.__cspContributions = existing;
}

/**
 * Creates the plugin-analytics plugin.
 *
 * Registered in a site's config.yml, **before** `plugin-csp` in the
 * `plugins:` list (see README "Ordering with plugin-csp" — plugin-csp reads
 * `config.globals.__cspContributions` in its own `beforeBuild`, so it only
 * sees this plugin's contribution if this plugin's `beforeBuild` already ran):
 *
 * ```yaml
 * plugins:
 *   - package: jsr:@you/plugin-analytics
 *     options:
 *       service: goatcounter
 *       id: ametrine
 *   - package: jsr:@you/plugin-csp
 * ```
 */
export default function pluginAnalytics(
  options: PluginAnalyticsOptions = {},
): StenoPlugin {
  return {
    name: "plugin-analytics",

    // Runs once before the build starts. Validates options, appends the
    // service's <script> tag to config.head, and declares this plugin's
    // required CSP sources into config.globals.__cspContributions for
    // plugin-csp to consume in its own beforeBuild.
    beforeBuild(config) {
      const { scriptTag, cspContributions } = resolveAnalytics(options);

      config.head ??= [];
      config.head.push(scriptTag);

      mergeCspContributions(config, cspContributions);
    },
  };
}
