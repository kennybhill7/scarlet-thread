import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import test, { after, before, describe } from "node:test";

import nextConfig, {
  contentSecurityPolicy,
  contentSecurityPolicyReportOnly,
  isDevEnvironment,
  securityHeaders,
  serviceWorkerHeaders,
  SECURITY_HEADER_SOURCE,
  SERVICE_WORKER_SOURCE,
  type SecurityHeader,
} from "../next.config";

/** The bounded gate, pinned in one place and asserted both in-process and on the wire. */
const PRODUCTION_HEADER_KEYS = [
  "Content-Security-Policy",
  "Content-Security-Policy-Report-Only",
  "X-Frame-Options",
  "X-Content-Type-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "X-DNS-Prefetch-Control",
  "Strict-Transport-Security",
] as const;

/**
 * The three headers layered on /sw.js only, pinned as literals here so the
 * config cannot drift: Content-Type and Cache-Control are additive, while
 * Content-Security-Policy deliberately REPLACES the page policy on this one
 * path (Next takes last-rule-wins on a repeated key).
 */
const SERVICE_WORKER_HEADERS = [
  { key: "Content-Type", value: "application/javascript; charset=utf-8" },
  { key: "Cache-Control", value: "no-cache,no-store,must-revalidate" },
  {
    key: "Content-Security-Policy",
    value: "default-src 'self'; script-src 'self'",
  },
] as const;

async function resolveHeaderRules() {
  const { headers } = nextConfig;
  assert.ok(typeof headers === "function", "next.config must define headers()");
  return headers();
}

/** Rule 0 is the global `/:path*` gate; rule 1 is the /sw.js overlay. */
async function resolveHeaderMap() {
  const rules = await resolveHeaderRules();
  return new Map(rules[0].headers.map((header) => [header.key, header.value]));
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Directive name -> exact source tokens, so a widened source list cannot pass. */
function parseCsp(csp: string): Map<string, string[]> {
  const parsed = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(" ").filter(Boolean);
    if (tokens.length > 0) parsed.set(tokens[0], tokens.slice(1));
  }
  return parsed;
}

test("headers() emits exactly two rules: the global gate and the /sw.js overlay", async () => {
  const rules = await resolveHeaderRules();
  assert.equal(rules.length, 2, "exactly the global rule and the /sw.js rule");

  const [globalRule, serviceWorkerRule] = rules;

  // The unit suite runs with NODE_ENV unset, so the live config must be
  // serving the strict production set. Stated as an assertion, not assumed.
  assert.equal(isDevEnvironment(), false, "unit suite must run outside dev");

  assert.equal(globalRule.source, SECURITY_HEADER_SOURCE);
  assert.equal(globalRule.source, "/:path*");
  // Strict equality on the whole list: the global rule is UNCHANGED by the
  // /sw.js work — same seven headers, same values, same order.
  assert.deepEqual(globalRule.headers, securityHeaders(false));
  assert.deepEqual(
    globalRule.headers.map((header) => header.key),
    PRODUCTION_HEADER_KEYS,
  );

  assert.equal(serviceWorkerRule.source, SERVICE_WORKER_SOURCE);
  assert.equal(serviceWorkerRule.source, "/sw.js");
  assert.equal(serviceWorkerRule.headers.length, 3, "exactly three headers");
  // Strict equality against literals — a changed value, an extra header or a
  // reordered list all fail here rather than being absorbed by a substring.
  assert.deepEqual(serviceWorkerRule.headers, [
    { key: "Content-Type", value: "application/javascript; charset=utf-8" },
    { key: "Cache-Control", value: "no-cache,no-store,must-revalidate" },
    {
      key: "Content-Security-Policy",
      value: "default-src 'self'; script-src 'self'",
    },
  ]);
  // ...and the exported constant the wire suite builds its expectation from is
  // the same list, so the wire assertions cannot drift from the unit ones.
  assert.deepEqual(serviceWorkerRule.headers, serviceWorkerHeaders);
  assert.deepEqual(serviceWorkerHeaders, [...SERVICE_WORKER_HEADERS]);
});

test("the /sw.js rule is ordered last so its worker CSP wins the merge", async () => {
  const rules = await resolveHeaderRules();
  // next.js headers.md, "Header Overriding Behavior": when two rules match the
  // same path and set the same key, the LAST one wins (resolve-routes.js:543-560
  // assigns resHeaders[key] = value in rule order). Both rules match /sw.js and
  // both set Content-Security-Policy, so the ordering below is load-bearing:
  // the worker-scoped policy must be the one that survives on /sw.js.
  assert.equal(rules[0].source, SECURITY_HEADER_SOURCE);
  assert.equal(rules[1].source, SERVICE_WORKER_SOURCE);

  const globalCsp = rules[0].headers.find(
    (header) => header.key === "Content-Security-Policy",
  );
  const workerCsp = rules[1].headers.find(
    (header) => header.key === "Content-Security-Policy",
  );
  assert.ok(globalCsp);
  assert.ok(workerCsp);
  assert.equal(workerCsp.value, "default-src 'self'; script-src 'self'");
  assert.notEqual(
    workerCsp.value,
    globalCsp.value,
    "the override is intentional; if these ever match, the overlay is dead code",
  );
  // The worker policy must not smuggle in the page relaxations.
  assert.ok(!workerCsp.value.includes("'unsafe-inline'"));
  assert.ok(!workerCsp.value.includes("'unsafe-eval'"));
  assert.ok(!workerCsp.value.includes("http"));
});

test("every header entry is a clean, non-empty, single-line key/value pair", async () => {
  const rules = await resolveHeaderRules();
  for (const rule of rules) {
    for (const header of rule.headers) {
      assert.equal(typeof header.key, "string");
      assert.equal(typeof header.value, "string");
      assert.ok(header.key.length > 0, "header key must not be empty");
      assert.ok(header.value.length > 0, `${header.key} must not be empty`);
      assert.ok(!/[\n\r]/.test(header.key), `${header.key} key has a newline`);
      assert.ok(
        !/[\n\r]/.test(header.value),
        `${header.key} value has a newline`,
      );
    }
  }
});

test("header keys are unique within a rule so nothing silently overrides", async () => {
  const rules = await resolveHeaderRules();
  for (const rule of rules) {
    const keys = rule.headers.map((header) => header.key);
    // next.js headers.md:47 — a later entry with the same key wins silently.
    // Cross-RULE reuse of a key is deliberate and tested above; reuse WITHIN a
    // rule is always an accident.
    assert.equal(new Set(keys).size, keys.length, rule.source);
  }
});

test("the /sw.js rule cannot be widened into a path pattern", async () => {
  const rules = await resolveHeaderRules();
  // A literal source takes the hasParams === false branch in
  // resolve-routes.js:542, so no compileNonPath rewriting touches these values.
  // ":" or "*" here would both widen the match and switch that branch on.
  assert.ok(!rules[1].source.includes(":"));
  assert.ok(!rules[1].source.includes("*"));
});

test("the X-Powered-By banner is suppressed", () => {
  assert.equal(nextConfig.poweredByHeader, false);
});

test("the gate-0.9 mandated headers are present with their exact values", async () => {
  const byKey = await resolveHeaderMap();

  for (const key of [
    "Content-Security-Policy",
    "X-Frame-Options",
    "X-Content-Type-Options",
    "Referrer-Policy",
    "Permissions-Policy",
  ]) {
    assert.ok(byKey.has(key), `missing header ${key}`);
  }

  assert.equal(byKey.get("X-Frame-Options"), "DENY");
  assert.equal(byKey.get("X-Content-Type-Options"), "nosniff");
  assert.equal(byKey.get("Referrer-Policy"), "same-origin");
});

test("Permissions-Policy denies every feature to every origin, including self", async () => {
  const byKey = await resolveHeaderMap();
  const policy = byKey.get("Permissions-Policy") ?? "";

  const entries = policy.split(", ");
  assert.equal(entries.length, 21, "exactly the 21 reviewed features");
  for (const entry of entries) {
    // Token-exact: every entry is `feature=()` — an allowlist such as
    // `camera=(self)` or `camera=*` fails the shape check outright.
    assert.match(entry, /^[a-z-]+=\(\)$/, entry);
  }
  for (const feature of ["camera", "microphone", "geolocation", "payment"]) {
    assert.ok(entries.includes(`${feature}=()`), `${feature} must be denied`);
  }
  // next.js resolve-routes.js:546-547 runs compileNonPath over header keys and
  // values on every param-bearing route; a literal ":path" would be replaced
  // by the matched path segments. Keep this assertion.
  assert.ok(!policy.includes(":path"));
});

test("the production CSP is exactly the reviewed policy, token for token", () => {
  const parsed = parseCsp(contentSecurityPolicy(false));

  // Exact directive -> token assertions: a widened list such as
  // "connect-src 'self' https:" fails deepEqual where a substring check
  // would silently pass. "form-action" keeps the Google entry because the
  // sign-in POST 303s there and Firefox enforces form-action on redirects.
  // "upgrade-insecure-requests" is deliberately ABSENT in every mode: over
  // plain-HTTP `next start` it upgrades same-origin requests to a TLS server
  // that does not exist; HSTS + platform TLS cover deployed transport.
  const expected: Record<string, string[]> = {
    "default-src": ["'self'"],
    "base-uri": ["'none'"],
    "object-src": ["'none'"],
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'", "https://accounts.google.com"],
    "script-src": ["'self'", "'unsafe-inline'"],
    "script-src-attr": ["'none'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'"],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "media-src": ["'none'"],
  };

  assert.deepEqual(
    [...parsed.keys()].sort(),
    Object.keys(expected).sort(),
    "directive set must match exactly — nothing added, nothing missing",
  );
  for (const [directive, tokens] of Object.entries(expected)) {
    assert.deepEqual(parsed.get(directive), tokens, directive);
  }

  const csp = contentSecurityPolicy(false);
  assert.equal(countOccurrences(csp, "http://"), 0);
  assert.equal(countOccurrences(csp, "https://"), 1, "only accounts.google.com");
});

test("the production header set is exactly the reviewed eight, in order", () => {
  assert.deepEqual(
    securityHeaders(false).map((header) => header.key),
    PRODUCTION_HEADER_KEYS,
    "header key set must match exactly — nothing added, nothing missing",
  );
});

test("the Report-Only CSP mirrors the enforced policy except script-src", () => {
  const enforced = contentSecurityPolicy(false);
  const reportOnly = contentSecurityPolicyReportOnly(false);

  assert.notEqual(reportOnly, enforced, "must diverge or it reports nothing new");
  assert.ok(
    reportOnly.includes("script-src 'self'") &&
      !reportOnly.includes("script-src 'self' 'unsafe-inline'"),
    "the report-only canary is the enforced policy without the inline-script relaxation",
  );

  // Every other directive is untouched — this is a narrow canary, not a
  // second, independently-drifting policy.
  const withoutScriptSrc = (csp: string) =>
    csp
      .split("; ")
      .filter((directive) => !directive.startsWith("script-src "))
      .join("; ");
  assert.equal(withoutScriptSrc(reportOnly), withoutScriptSrc(enforced));
});

test("the Report-Only CSP is served, enforcing nothing, alongside the real CSP", async () => {
  const byKey = await resolveHeaderMap();
  assert.ok(byKey.has("Content-Security-Policy-Report-Only"));
  assert.equal(
    byKey.get("Content-Security-Policy-Report-Only"),
    contentSecurityPolicyReportOnly(false),
  );
  // The two headers are genuinely different keys — a browser never conflates
  // Content-Security-Policy with Content-Security-Policy-Report-Only, so the
  // enforced policy is unaffected by whatever the canary reports.
  assert.notEqual(
    byKey.get("Content-Security-Policy"),
    byKey.get("Content-Security-Policy-Report-Only"),
  );
});

test("the cross-origin isolation headers stay out of this bounded gate", () => {
  // COOP/CORP change how the browser treats cross-origin windows and
  // subresources. Shipping them without a real OAuth round trip and an
  // offline service-worker fetch would be a claim this gate cannot back.
  const keys = new Set(securityHeaders(false).map((header) => header.key));
  assert.equal(keys.has("Cross-Origin-Opener-Policy"), false);
  assert.equal(keys.has("Cross-Origin-Resource-Policy"), false);
});

test("the production CSP is byte-clean and has no duplicate directives", () => {
  const csp = contentSecurityPolicy(false);

  assert.ok(!/\s{2,}/.test(csp), "CSP must not contain runs of whitespace");
  assert.ok(!/[\n\r]/.test(csp), "CSP must be a single line");
  // next.js resolve-routes.js:546-547 — see the Permissions-Policy note above.
  assert.ok(!csp.includes(":path"));

  const names = csp.split(";").map((part) => part.trim().split(" ")[0]);
  // Browsers take first-wins on a duplicate directive, so a duplicate is a
  // silent policy change rather than an error.
  assert.equal(new Set(names).size, names.length);
});

test("the development CSP relaxes only what Turbopack and React dev need", () => {
  const csp = contentSecurityPolicy(true);

  assert.ok(csp.includes("'unsafe-eval'"), "React dev rebuilds stacks via eval");
  assert.ok(csp.includes("ws:"));
  assert.ok(csp.includes("wss:"));
  // upgrade-insecure-requests would rewrite ws: to wss: and break HMR.
  assert.ok(!csp.includes("upgrade-insecure-requests"));

  // Dev relaxations must not touch the clickjacking/base/form surface.
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.ok(csp.includes("object-src 'none'"));
  assert.ok(csp.includes("base-uri 'none'"));
  assert.ok(csp.includes("form-action 'self' https://accounts.google.com"));
});

test("HSTS ships in production only", () => {
  const production = securityHeaders(false);
  const development = securityHeaders(true);

  const hsts = production.find(
    (header) => header.key === "Strict-Transport-Security",
  );
  assert.ok(hsts, "production must send HSTS");
  // Exact full value, not includes(): `includeSubDomains` is deliberately
  // absent because the subdomains are not inventoried, and a substring check
  // would let it (or `preload`) reappear silently.
  assert.equal(hsts.value, "max-age=63072000");

  assert.equal(
    development.some((header) => header.key === "Strict-Transport-Security"),
    false,
    "HSTS over http://localhost would pin the host for two years",
  );
});

test("the live config picks its policy by NODE_ENV, failing closed", async () => {
  const byKey = await resolveHeaderMap();
  const csp = byKey.get("Content-Security-Policy") ?? "";

  // Biconditional: passes under `npm test` (NODE_ENV unset -> strict) and
  // still catches a regression from === "development" to !== "production".
  assert.equal(
    csp.includes("'unsafe-eval'"),
    process.env.NODE_ENV === "development",
  );
});

test("no header regresses the offline-first caching contract", async () => {
  const [globalRule, serviceWorkerRule] = await resolveHeaderRules();

  for (const header of globalRule.headers) {
    // Scoped to the GLOBAL rule: a Cache-Control here would land on every path
    // and fight lib/api/response.ts ("private, no-store") and the service
    // worker shell cache; Clear-Site-Data would erase that cache outright.
    assert.ok(!/^cache-control$/i.test(header.key), "global rule: no Cache-Control");
    assert.ok(!/^clear-site-data$/i.test(header.key));
    assert.ok(!/^cross-origin-embedder-policy$/i.test(header.key));
  }

  // The inverse for the worker SCRIPT, which is not app content: the browser
  // must revalidate /sw.js on every update check, or a stale cached worker
  // pins the app to an old build forever. This does not weaken offline-first —
  // the SW itself still caches the shell and corpus.
  const cacheControl = serviceWorkerRule.headers.find((header) =>
    /^cache-control$/i.test(header.key),
  );
  assert.ok(cacheControl, "/sw.js must pin Cache-Control");
  assert.equal(cacheControl.value, "no-cache,no-store,must-revalidate");

  for (const header of serviceWorkerRule.headers) {
    // The eraser and the isolation header stay out of the overlay too.
    assert.ok(!/^clear-site-data$/i.test(header.key));
    assert.ok(!/^cross-origin-embedder-policy$/i.test(header.key));
  }
});

test("trailing-slash requests are not allowed to fall through to an unheadered internal redirect", () => {
  // Next always compiles an internal, higher-priority "/:path+/ -> /:path+"
  // redirect for the default (non-trailingSlash) mode, and that redirect
  // returns resHeaders: null — discarding every header a matching rule
  // already set — see resolve-routes.js's "handle redirect" branch, which
  // is unconditional and upstream of this repo. skipTrailingSlashRedirect
  // removes that internal redirect entry from the compiled route list
  // entirely, so a request like GET /sign-in/ is answered directly by the
  // matching page/route (still carrying every header below) instead of
  // 308-ing through the one code path that could never carry them.
  assert.equal(nextConfig.skipTrailingSlashRedirect, true);
});

test("header/redirect/rewrite matching is case-sensitive", () => {
  // Next compiles every header/redirect/rewrite source with sensitive:false
  // unless experimental.caseSensitiveRoutes is set, so the /sw.js overlay
  // rule would otherwise also match /SW.js and /Sw.Js and hand them the
  // worker-scoped CSP meant only for the real service worker script.
  assert.equal(nextConfig.experimental?.caseSensitiveRoutes, true);
});

// ---------------------------------------------------------------------------
// Wire test — the assertions above only prove what next.config.ts *returns*.
// This suite boots the real production server and proves what actually
// reaches a client, because `headers()` is compiled into routes-manifest.json
// at build time and applied by the router — neither of which the in-process
// tests exercise. Full-value deepEqual on every response class, no substrings.
// ---------------------------------------------------------------------------

/** npm scripts run with cwd = web/; tests/corpus.test.ts relies on the same. */
const WEB_ROOT = process.cwd();
const BUILD_ID_PATH = path.join(WEB_ROOT, ".next", "BUILD_ID");
const STATIC_ROOT = path.join(WEB_ROOT, ".next", "static");
const WIRE_PORT = 3123;
const BASE_URL = `http://localhost:${WIRE_PORT}`;
const READY_TIMEOUT_MS = 30_000;

/**
 * The only sanctioned way to skip the wire suite. Its absence with no build
 * present is a FAILURE, not a skip — the whole point is that the only real
 * on-the-wire evidence must not be able to silently never run. Set this
 * explicitly (e.g. in an environment that truly cannot produce a production
 * build) to opt out on purpose, with the reason recorded in the skip message.
 */
const WIRE_SKIP_ENV_VAR = "SECURITY_HEADERS_WIRE_ALLOW_SKIP";
const buildPresent = existsSync(BUILD_ID_PATH);
const wireSkipAllowed = process.env[WIRE_SKIP_ENV_VAR] === "1";
const wireSkip: string | false =
  buildPresent || !wireSkipAllowed
    ? false
    : `no production build: .next/BUILD_ID is missing — skipped because ` +
      `${WIRE_SKIP_ENV_VAR}=1 was set explicitly (run \`npm run build\` to get real coverage)`;

/** Wire keys are compared case-insensitively; fetch lowercases them. */
function toWireMap(headers: readonly SecurityHeader[]): Record<string, string> {
  return Object.fromEntries(
    headers.map((header) => [header.key.toLowerCase(), header.value]),
  );
}

/**
 * Populated in before() from the ACTUAL resolved `next.config.ts` headers()
 * output — not from the `securityHeaders`/`serviceWorkerHeaders` exports
 * directly. If a rule is ever de-registered from headers() (a stray return,
 * a dropped array entry) while the exported constants are untouched, the
 * unit tests above would stay green — asserting only what the constants
 * contain — while this wire suite, sourced from the resolved rule list,
 * would see the real gap and fail.
 */
let expectedWireHeaders: Record<string, string> = {};
let expectedServiceWorkerWireHeaders: Record<string, string> = {};
let wireHeaderKeys: string[] = [];
let serviceWorkerWireHeaderKeys: string[] = [];

function wireHeaderMap(
  response: Response,
  keys: readonly string[] = wireHeaderKeys,
): Record<string, string | null> {
  return Object.fromEntries(
    keys.map((key) => [key.toLowerCase(), response.headers.get(key)]),
  );
}

async function isPortBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", (error: NodeJS.ErrnoException) =>
      resolve(error.code === "EADDRINUSE"),
    );
    probe.once("listening", () => probe.close(() => resolve(false)));
    probe.listen(port, "127.0.0.1");
  });
}

/** First real file under .next/static, as a URL path. Hashes change per build. */
async function findStaticAsset(root: string): Promise<string> {
  const stack = [""];
  while (stack.length > 0) {
    const relative = stack.pop() as string;
    const entries = await readdir(path.join(root, relative), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isFile()) return `/_next/static/${child}`;
      if (entry.isDirectory()) stack.push(child);
    }
  }
  throw new Error(`no files under ${root}: cannot verify a static asset`);
}

const WIRE_CASES = [
  { path: "/", status: 307, why: "proxy sends the unauthenticated root to sign-in" },
  { path: "/sign-in", status: 200, why: "rendered page" },
  { path: "/api/review", status: 401, why: "unauthenticated API call is rejected" },
  { path: "/api/definitely-not-a-route", status: 404, why: "unmatched API path" },
  // proxy.ts matches every dotless path that is not api/_next/sign-in, so an
  // unknown *page* path is redirected before the router can 404 it. Asserted
  // as 307 because that is what the server really does.
  { path: "/definitely-missing-page-404", status: 307, why: "proxy-intercepted unknown page" },
  // A dotted path is excluded by the proxy matcher, so this is the genuine
  // app-router 404 response class.
  { path: "/definitely-missing-page-404.html", status: 404, why: "app-router 404" },
  { path: "/sw.js", status: 200, why: "service worker from public/" },
  { path: "/manifest.webmanifest", status: 200, why: "PWA manifest route" },
  { path: "/bible/index.json", status: 200, why: "offline corpus index from public/" },
  // Before skipTrailingSlashRedirect, these three 308-ed through Next's
  // internal "/:path+/ -> /:path+" redirect, which returns resHeaders: null
  // and so answered with ZERO headers — the exact gap this task closes.
  { path: "/sign-in/", status: 200, why: "trailing slash: served directly, no header-dropping redirect" },
  { path: "/read/", status: 307, why: "trailing slash: proxy still redirects unauthenticated access, now with headers" },
  { path: "/api/review/", status: 401, why: "trailing slash: route handler still runs, now with headers" },
  // path-to-regexp compiles every header source with sensitive:false unless
  // experimental.caseSensitiveRoutes is set, so these case variants of the
  // real worker path must NOT be treated as the service worker.
  { path: "/SW.js", status: 404, why: "case variant of /sw.js must not get the worker CSP overlay" },
  { path: "/Sw.Js", status: 404, why: "case variant of /sw.js must not get the worker CSP overlay" },
] as const;

describe(
  "wire: every response class carries exactly the production header set",
  { skip: wireSkip },
  () => {
    let server: ChildProcess | undefined;
    let serverLog = "";
    let staticAssetPath = "";

    async function waitForReady(): Promise<void> {
      const deadline = Date.now() + READY_TIMEOUT_MS;
      let lastError = "unknown";
      while (Date.now() < deadline) {
        if (server?.exitCode !== null && server?.exitCode !== undefined) {
          throw new Error(
            `next start exited early (code ${server.exitCode}):\n${serverLog}`,
          );
        }
        try {
          await fetch(`${BASE_URL}/sign-in`, { redirect: "manual" });
          return;
        } catch (error) {
          lastError = (error as Error).message;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      throw new Error(
        `next start did not answer on ${BASE_URL} within ${READY_TIMEOUT_MS}ms ` +
          `(last error: ${lastError})\n${serverLog}`,
      );
    }

    before(async () => {
      // wireSkip only ever short-circuits this whole describe block when
      // WIRE_SKIP_ENV_VAR was set explicitly. Reaching here with no build
      // present means that opt-out was NOT given, so the missing evidence
      // must fail loudly rather than let a passing suite imply headers were
      // checked on the wire when they never ran.
      if (!buildPresent) {
        throw new Error(
          "no production build: .next/BUILD_ID is missing. The wire suite does " +
            "not skip silently — run `npm run build` first, or set " +
            `${WIRE_SKIP_ENV_VAR}=1 to explicitly accept running without this evidence.`,
        );
      }

      if (await isPortBusy(WIRE_PORT)) {
        throw new Error(
          `port ${WIRE_PORT} is already in use — stop that process and re-run; ` +
            "this test needs the port to bind its own `next start`",
        );
      }

      // Sourced from the ACTUAL resolved next.config.ts headers() output —
      // see the comment on the `let`s above for why this must not read the
      // securityHeaders()/serviceWorkerHeaders exports directly.
      const [globalRule, serviceWorkerRule] = await resolveHeaderRules();
      expectedWireHeaders = toWireMap(globalRule.headers);
      expectedServiceWorkerWireHeaders = {
        ...expectedWireHeaders,
        ...toWireMap(serviceWorkerRule.headers),
      };
      wireHeaderKeys = globalRule.headers.map((header) => header.key);
      serviceWorkerWireHeaderKeys = [
        ...new Set([
          ...wireHeaderKeys,
          ...serviceWorkerRule.headers.map((header) => header.key),
        ]),
      ];

      staticAssetPath = await findStaticAsset(STATIC_ROOT);

      // node is invoked directly rather than through npm: `shell: true` with
      // npm on Windows spawns cmd.exe, and killing the shell would orphan the
      // server. detached:false keeps the child in this process group so a
      // plain child.kill() tears down the whole tree.
      server = spawn(
        process.execPath,
        [
          path.join("node_modules", "next", "dist", "bin", "next"),
          "start",
          "-p",
          String(WIRE_PORT),
        ],
        {
          cwd: WEB_ROOT,
          detached: false,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          // The server never queries the database on any path asserted here,
          // but the module graph needs a parseable URL to boot. Supplied to
          // the child process only — no .env file is read or written.
          env: {
            ...process.env,
            DATABASE_URL:
              process.env.DATABASE_URL ??
              "postgresql://wire-test:wire-test@127.0.0.1:5432/wire-test",
          },
        },
      );

      const record = (chunk: Buffer) => {
        serverLog += chunk.toString();
      };
      server.stdout?.on("data", record);
      server.stderr?.on("data", record);
      server.once("error", (error) => {
        serverLog += `spawn error: ${error.message}\n`;
      });

      await waitForReady();
    });

    after(async () => {
      if (!server || server.exitCode !== null) return;
      const exited = new Promise<void>((resolve) =>
        server?.once("exit", () => resolve()),
      );
      server.kill();
      const grace = new Promise<void>((resolve) =>
        setTimeout(resolve, 5_000).unref(),
      );
      await Promise.race([exited, grace]);
    });

    for (const wireCase of WIRE_CASES) {
      const isServiceWorker = wireCase.path === SERVICE_WORKER_SOURCE;

      test(`${wireCase.path} -> ${wireCase.status} (${wireCase.why})`, async () => {
        const response = await fetch(`${BASE_URL}${wireCase.path}`, {
          redirect: "manual",
        });
        await response.arrayBuffer();

        assert.equal(response.status, wireCase.status, wireCase.why);

        if (isServiceWorker) {
          // The worker script is the one path that carries the overlay: the
          // seven global headers PLUS Content-Type and Cache-Control, with the
          // page CSP replaced by the worker-scoped policy. Full-value
          // deepEqual — no substrings, no partial credit.
          assert.deepEqual(
            wireHeaderMap(response, serviceWorkerWireHeaderKeys),
            expectedServiceWorkerWireHeaders,
            "/sw.js must send the global set merged with the worker overlay",
          );
        } else {
          assert.deepEqual(
            wireHeaderMap(response),
            expectedWireHeaders,
            `${wireCase.path} must send the exact production header values`,
          );
          // The overlay is route-scoped: its no-cache value must not appear on
          // any other response class.
          assert.notEqual(
            response.headers.get("cache-control"),
            "no-cache,no-store,must-revalidate",
            `${wireCase.path} must not inherit the /sw.js cache policy`,
          );
        }

        assert.equal(
          response.headers.get("x-powered-by"),
          null,
          `${wireCase.path} must not leak x-powered-by`,
        );
      });
    }

    test("a real hashed static asset carries the same header set", async () => {
      assert.ok(staticAssetPath, "before() must discover a static asset");

      const response = await fetch(`${BASE_URL}${staticAssetPath}`, {
        redirect: "manual",
      });
      await response.arrayBuffer();

      assert.equal(response.status, 200, `${staticAssetPath} must be served`);
      assert.deepEqual(
        wireHeaderMap(response),
        expectedWireHeaders,
        `${staticAssetPath} must send the exact production header values`,
      );
      assert.notEqual(
        response.headers.get("cache-control"),
        "no-cache,no-store,must-revalidate",
        "hashed assets must keep their immutable cache policy",
      );
      assert.equal(response.headers.get("x-powered-by"), null);
    });
  },
);
