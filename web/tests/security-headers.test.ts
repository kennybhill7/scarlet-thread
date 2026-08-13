import assert from "node:assert/strict";
import test from "node:test";

import nextConfig, {
  contentSecurityPolicy,
  securityHeaders,
  SECURITY_HEADER_SOURCE,
} from "../next.config";

async function resolveHeaderRules() {
  const { headers } = nextConfig;
  assert.ok(typeof headers === "function", "next.config must define headers()");
  return headers();
}

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

test("headers() emits exactly one rule covering every path", async () => {
  const rules = await resolveHeaderRules();
  assert.equal(rules.length, 1);

  const [rule] = rules;
  assert.equal(rule.source, SECURITY_HEADER_SOURCE);
  assert.equal(rule.source, "/:path*");
  assert.ok(Array.isArray(rule.headers));
  assert.ok(rule.headers.length > 0);
});

test("every header entry is a clean, non-empty, single-line key/value pair", async () => {
  const rules = await resolveHeaderRules();
  for (const header of rules[0].headers) {
    assert.equal(typeof header.key, "string");
    assert.equal(typeof header.value, "string");
    assert.ok(header.key.length > 0, "header key must not be empty");
    assert.ok(header.value.length > 0, `${header.key} must not be empty`);
    assert.ok(!/[\n\r]/.test(header.key), `${header.key} key has a newline`);
    assert.ok(!/[\n\r]/.test(header.value), `${header.key} value has a newline`);
  }
});

test("header keys are unique so no rule silently overrides another", async () => {
  const rules = await resolveHeaderRules();
  const keys = rules[0].headers.map((header) => header.key);
  // next.js headers.md:47 — a later entry with the same key wins silently.
  assert.equal(new Set(keys).size, keys.length);
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

test("the production header set is exactly the reviewed nine, in order", () => {
  assert.deepEqual(
    securityHeaders(false).map((header) => header.key),
    [
      "Content-Security-Policy",
      "X-Frame-Options",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Cross-Origin-Opener-Policy",
      "Cross-Origin-Resource-Policy",
      "X-DNS-Prefetch-Control",
      "Strict-Transport-Security",
    ],
    "header key set must match exactly — nothing added, nothing missing",
  );
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
  assert.ok(hsts.value.includes("max-age=63072000"));
  assert.ok(hsts.value.includes("includeSubDomains"));

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
  const rules = await resolveHeaderRules();
  for (const header of rules[0].headers) {
    // Cache-Control here would fight lib/api/response.ts ("private, no-store")
    // and the service worker shell cache; Clear-Site-Data would erase it.
    assert.ok(!/^cache-control$/i.test(header.key));
    assert.ok(!/^clear-site-data$/i.test(header.key));
    assert.ok(!/^cross-origin-embedder-policy$/i.test(header.key));
  }
});
