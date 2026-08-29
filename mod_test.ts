import { assertEquals, assertThrows } from "@std/assert";
import type { SiteConfig } from "@steno/steno";
import createPlugin, { mergeCspContributions, resolveAnalytics } from "./mod.ts";

function siteConfig(overrides: Partial<SiteConfig> = {}): SiteConfig {
  return {
    title: "Test site",
    description: "",
    author: "",
    ...overrides,
  };
}

Deno.test("plugin-analytics: has a stable name", () => {
  const plugin = createPlugin({ service: "goatcounter", id: "ametrine" });
  assertEquals(plugin.name, "plugin-analytics");
});

// --- resolveAnalytics: goatcounter ---

Deno.test("resolveAnalytics: goatcounter produces the expected script tag", () => {
  const { scriptTag } = resolveAnalytics({ service: "goatcounter", id: "ametrine" });
  assertEquals(scriptTag.tag, "script");
  assertEquals(scriptTag.src, "https://gc.zgo.at/count.js");
  assertEquals(scriptTag.async, true);
  assertEquals(scriptTag.defer, undefined);
  assertEquals(scriptTag["data-goatcounter"], "https://ametrine.goatcounter.com/count");
});

Deno.test("resolveAnalytics: goatcounter produces the expected CSP contribution", () => {
  const { cspContributions } = resolveAnalytics({ service: "goatcounter", id: "ametrine" });
  assertEquals(cspContributions["script-src"], ["gc.zgo.at"]);
  assertEquals(cspContributions["connect-src"], ["ametrine.goatcounter.com/count"]);
});

// --- resolveAnalytics: umami ---

Deno.test("resolveAnalytics: umami produces the expected script tag", () => {
  const { scriptTag } = resolveAnalytics({ service: "umami", id: "site-123" });
  assertEquals(scriptTag.tag, "script");
  assertEquals(scriptTag.src, "https://cloud.umami.is/script.js");
  assertEquals(scriptTag.async, true);
  assertEquals(scriptTag.defer, true);
  assertEquals(scriptTag["data-website-id"], "site-123");
});

Deno.test("resolveAnalytics: umami produces the expected CSP contribution", () => {
  const { cspContributions } = resolveAnalytics({ service: "umami", id: "site-123" });
  assertEquals(cspContributions["script-src"], ["cloud.umami.is"]);
  assertEquals(cspContributions["connect-src"], ["*.umami.dev", "cloud.umami.is"]);
});

// --- resolveAnalytics: plausible ---

Deno.test("resolveAnalytics: plausible produces the expected script tag", () => {
  const { scriptTag } = resolveAnalytics({ service: "plausible", id: "example.com" });
  assertEquals(scriptTag.tag, "script");
  assertEquals(scriptTag.src, "https://plausible.io/js/script.js");
  assertEquals(scriptTag.defer, true);
  assertEquals(scriptTag.async, undefined);
  assertEquals(scriptTag["data-domain"], "example.com");
});

Deno.test("resolveAnalytics: plausible produces the expected CSP contribution", () => {
  const { cspContributions } = resolveAnalytics({ service: "plausible", id: "example.com" });
  assertEquals(cspContributions["script-src"], ["plausible.io"]);
  assertEquals(cspContributions["connect-src"], ["plausible.io"]);
});

// --- resolveAnalytics: self-hosted ---

Deno.test("resolveAnalytics: selfHostedUrl derives script src and CSP from the origin", () => {
  const { scriptTag, cspContributions } = resolveAnalytics({
    selfHostedUrl: "https://analytics.example.com",
  });
  assertEquals(scriptTag.src, "https://analytics.example.com/count.js");
  assertEquals(scriptTag["data-goatcounter"], "https://analytics.example.com/count");
  assertEquals(cspContributions["script-src"], ["https://analytics.example.com"]);
  assertEquals(cspContributions["connect-src"], ["https://analytics.example.com"]);
});

Deno.test("resolveAnalytics: selfHostedUrl strips path/query down to the origin", () => {
  const { cspContributions } = resolveAnalytics({
    selfHostedUrl: "https://analytics.example.com/some/path?x=1",
  });
  assertEquals(cspContributions["script-src"], ["https://analytics.example.com"]);
});

Deno.test("resolveAnalytics: throws on an invalid selfHostedUrl", () => {
  assertThrows(
    () => resolveAnalytics({ selfHostedUrl: "not a url" }),
    Error,
    "not a valid URL",
  );
});

// --- resolveAnalytics: validation ---

Deno.test("resolveAnalytics: throws when both service and selfHostedUrl are set", () => {
  assertThrows(
    () =>
      resolveAnalytics({
        service: "goatcounter",
        id: "ametrine",
        selfHostedUrl: "https://analytics.example.com",
      }),
    Error,
    "not both",
  );
});

Deno.test("resolveAnalytics: throws when neither service nor selfHostedUrl are set", () => {
  assertThrows(() => resolveAnalytics({}), Error, "set either");
});

Deno.test("resolveAnalytics: throws when service is set without id", () => {
  assertThrows(
    () => resolveAnalytics({ service: "umami" }),
    Error,
    "`id` is required",
  );
});

// --- mergeCspContributions ---

Deno.test("mergeCspContributions: adds new directives to empty globals", () => {
  const config = siteConfig();
  mergeCspContributions(config, { "script-src": ["gc.zgo.at"] });
  assertEquals(
    (config.globals?.__cspContributions as Record<string, string[]>)["script-src"],
    ["gc.zgo.at"],
  );
});

Deno.test("mergeCspContributions: appends to an existing directive without clobbering another plugin's contribution", () => {
  const config = siteConfig({
    globals: {
      __cspContributions: {
        "script-src": ["other-plugin.example.com"],
        "img-src": ["images.example.com"],
      },
    },
  });

  mergeCspContributions(config, {
    "script-src": ["gc.zgo.at"],
    "connect-src": ["ametrine.goatcounter.com/count"],
  });

  const merged = config.globals?.__cspContributions as Record<string, string[]>;
  assertEquals(merged["script-src"], ["other-plugin.example.com", "gc.zgo.at"]);
  assertEquals(merged["connect-src"], ["ametrine.goatcounter.com/count"]);
  assertEquals(merged["img-src"], ["images.example.com"]); // untouched
});

// --- beforeBuild integration ---

Deno.test("plugin-analytics: beforeBuild appends to config.head without replacing existing entries", async () => {
  const plugin = createPlugin({ service: "plausible", id: "example.com" });
  const config = siteConfig({
    head: [{ tag: "link", rel: "icon", href: "/favicon.ico" }],
  });

  await plugin.beforeBuild?.(config);

  assertEquals(config.head?.length, 2);
  assertEquals(config.head?.[0], { tag: "link", rel: "icon", href: "/favicon.ico" });
  assertEquals(config.head?.[1].tag, "script");
  assertEquals((config.head?.[1] as Record<string, unknown>).src, "https://plausible.io/js/script.js");
});

Deno.test("plugin-analytics: beforeBuild merges CSP contributions additively", async () => {
  const plugin = createPlugin({ service: "goatcounter", id: "ametrine" });
  const config = siteConfig({
    globals: {
      __cspContributions: { "script-src": ["fonts.example.com"] },
    },
  });

  await plugin.beforeBuild?.(config);

  const merged = config.globals?.__cspContributions as Record<string, string[]>;
  assertEquals(merged["script-src"], ["fonts.example.com", "gc.zgo.at"]);
  assertEquals(merged["connect-src"], ["ametrine.goatcounter.com/count"]);
});

Deno.test("plugin-analytics: beforeBuild throws when options are invalid", () => {
  const plugin = createPlugin({});
  const config = siteConfig();
  assertThrows(() => plugin.beforeBuild?.(config) as unknown as void, Error, "set either");
});
