import type { Metadata, Viewport } from "next";
import { Archivo, Archivo_Narrow, Fraunces, Inter, Spectral } from "next/font/google";
import { ServiceWorkerRegistration } from "@/components/shell/ServiceWorkerRegistration";
import { getThemeBootstrapScript } from "@/lib/theme";
import "./globals.css";

/*
 * Fonts are self-hosted by next/font rather than linked from the Google Fonts CDN.
 * The mockup used a <link> to fonts.googleapis.com, which would have meant no type
 * on a plane or in a basement — unacceptable for an app whose whole promise is that
 * it works offline at 6am.
 */

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const spectral = Spectral({
  variable: "--font-spectral",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const archivoNarrow = Archivo_Narrow({
  variable: "--font-archivo-narrow",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Scarlet Thread",
  description: "Read the Bible front to back, and build the connections yourself.",
  applicationName: "Scarlet Thread",
  appleWebApp: {
    capable: true,
    title: "Scarlet Thread",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  // A study journal has no business in a search index, and the app is auth-gated
  // regardless. Belt and braces.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0d1420",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // Real default for no-JS / before the bootstrap script below runs.
      // THEMESYSTEM-001: previously a no-op (nothing in globals.css targeted
      // this string); "parchment" is now a real CSS variant. The blocking
      // script overwrites this synchronously before <body> paints, so a
      // JS-enabled visitor with a stored "midnight" or "system" preference
      // never sees this default flash.
      data-reading="parchment"
      className={`${fraunces.variable} ${spectral.variable} ${inter.variable} ${archivo.variable} ${archivoNarrow.variable}`}
    >
      <head>
        {/*
         * Applies the persisted reading-theme preference to <html> BEFORE
         * first paint. Un-`async`/un-`defer`, so the browser blocks on it
         * while still parsing <head> — it always runs before <body> is
         * parsed, let alone painted. Permitted under this app's CSP
         * (next.config.ts: script-src 'self' 'unsafe-inline'; read-only
         * here). Source text lives in lib/theme.ts#getThemeBootstrapScript
         * so tests/theme.test.ts can assert its exact shape without a DOM.
         */}
        <script dangerouslySetInnerHTML={{ __html: getThemeBootstrapScript() }} />
      </head>
      <body>
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
