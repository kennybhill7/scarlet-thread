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

export function securityHeaders(isDev: boolean): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(isDev) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "same-origin" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
  ];
  // Omitted in dev: inert over http://localhost, but would pin localhost for
  // two years the moment anyone runs `next dev --experimental-https`.
  if (!isDev) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    });
  }
  return headers;
}

/** Matches "/" and every nested path: pages, /api/*, /bible/*, /sw.js, /_next/*. */
export const SECURITY_HEADER_SOURCE = "/:path*";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: SECURITY_HEADER_SOURCE,
        headers: securityHeaders(isDevEnvironment()),
      },
    ];
  },
};

export default nextConfig;
