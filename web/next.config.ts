import type { NextConfig } from "next";

export type SecurityHeader = { key: string; value: string };

/** Every browser feature this app does not use, denied to every origin. */
const PERMISSIONS_POLICY = [
  "accelerometer",
  "autoplay",
  "browsing-topics",
  "camera",
  "display-capture",
  "encrypted-media",
  "fullscreen",
  "geolocation",
  "gyroscope",
  "idle-detection",
  "local-fonts",
  "magnetometer",
  "microphone",
  "midi",
  "payment",
  "picture-in-picture",
  "publickey-credentials-get",
  "screen-wake-lock",
  "serial",
  "usb",
  "xr-spatial-tracking",
]
  .map((feature) => `${feature}=()`)
  .join(", ");

/**
 * Dev-only relaxations. Fail closed: anything other than "development" —
 * including an unset or unexpected NODE_ENV — gets the strict policy.
 */
export function isDevEnvironment(): boolean {
  return process.env.NODE_ENV === "development";
}

export function contentSecurityPolicy(isDev: boolean): string {
  const directives = [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    // The sign-in POST is same-origin but 303s to Google; Firefox checks
    // form-action against redirect targets, Chrome historically does not.
    "form-action 'self' https://accounts.google.com",
    // No nonce: the App Router SSR bootstrap emits inline flight-payload
    // scripts, and a nonce would force dynamic rendering on every route.
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data:${isDev ? " blob:" : ""}`,
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    `worker-src 'self'${isDev ? " blob:" : ""}`,
    "manifest-src 'self'",
    "media-src 'none'",
  ];
  // No upgrade-insecure-requests in any mode: over plain-HTTP `next start` it
  // upgrades same-origin asset and service-worker requests to an HTTPS server
  // that does not exist; deployed transport is already forced by HSTS and the
  // platform TLS redirect.
  return directives.join("; ");
}

/**
 * Observe-only companion to the enforced policy above: identical directives
 * except script-src drops 'unsafe-inline'. Nothing here blocks a request —
 * report-only violations are logged by the browser (and, once a collector
 * exists, POSTed to a report-to/report-uri endpoint) instead of silently
 * breaking the page. This is deliberately the one relaxation the enforced
 * policy's own comment already tracks as temporary (the RSC flight-payload
 * bootstrap), so every load's reports establish a baseline; a violation
 * outside that known shape — including one on the credential-gated sign-in
 * page — is a signal something in the CSP is wrong before it is ever
 * mistakenly carried into the enforced policy.
 */
export function contentSecurityPolicyReportOnly(isDev: boolean): string {
  return contentSecurityPolicy(isDev).replace(
    "script-src 'self' 'unsafe-inline'",
    "script-src 'self'",
  );
}

/**
 * The eight headers below are the bounded gate: each one is verifiable from
 * this repo alone, on the wire, with no external evidence required.
 *
 * Deliberately NOT included:
 * - Cross-Origin-Opener-Policy / Cross-Origin-Resource-Policy. Both change
 *   how the browser treats cross-origin windows and subresources, so honest
 *   sign-off needs browser-level evidence — a real OAuth popup/redirect round
 *   trip and an offline service-worker fetch — that this gate does not have.
 * - `includeSubDomains` on HSTS. Subdomains are not inventoried, and the
 *   directive would pin every future one for two years.
 *
 * The live Google OAuth round trip remains a SEPARATELY LABELED,
 * credential-gated acceptance receipt. This gate does not claim it: nothing
 * here exercises accounts.google.com, so nothing here may be read as evidence
 * that the sign-in flow works end to end.
 */
export function securityHeaders(isDev: boolean): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(isDev) },
    {
      key: "Content-Security-Policy-Report-Only",
      value: contentSecurityPolicyReportOnly(isDev),
    },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "same-origin" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    { key: "X-DNS-Prefetch-Control", value: "off" },
  ];
  // Omitted in dev: inert over http://localhost, but would pin localhost for
  // two years the moment anyone runs `next dev --experimental-https`.
  if (!isDev) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000",
    });
  }
  return headers;
}

/** Matches "/" and every nested path: pages, /api/*, /bible/*, /sw.js, /_next/*. */
export const SECURITY_HEADER_SOURCE = "/:path*";

/** The service worker script itself, served from public/sw.js. */
export const SERVICE_WORKER_SOURCE = "/sw.js";

/**
 * Layered on top of the global rule for /sw.js only. Next checks every header
 * rule in order and merges the matches (headers.md, "Header Overriding
 * Behavior": a later rule setting the same key wins), so /sw.js receives the
 * global set with these three applied last — Content-Type and Cache-Control are
 * additive, and Content-Security-Policy REPLACES the page policy with the
 * worker-scoped one, which is the intent: the CSP delivered with a worker
 * script governs that worker's execution context, not a document.
 *
 * no-cache on the worker script governs SW update propagation and does not
 * conflict with the offline-first app-content contract: the service worker
 * itself caches content, while the browser must always revalidate the worker
 * script so a new build's SW is picked up instead of a stale cached copy.
 */
export const serviceWorkerHeaders: SecurityHeader[] = [
  { key: "Content-Type", value: "application/javascript; charset=utf-8" },
  { key: "Cache-Control", value: "no-cache,no-store,must-revalidate" },
  {
    key: "Content-Security-Policy",
    value: "default-src 'self'; script-src 'self'",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  skipTrailingSlashRedirect: true,
  experimental: {
    // Next compiles every header/redirect/rewrite source with sensitive:false
    // unless this is set, so "/sw.js" would otherwise also match "/SW.js" and
    // "/Sw.Js" and hand them the worker-scoped CSP overlay meant for the real
    // service worker script only.
    caseSensitiveRoutes: true,
  },
  async headers() {
    return [
      {
        source: SECURITY_HEADER_SOURCE,
        headers: securityHeaders(isDevEnvironment()),
      },
      {
        source: SERVICE_WORKER_SOURCE,
        headers: serviceWorkerHeaders,
      },
    ];
  },
};

export default nextConfig;
