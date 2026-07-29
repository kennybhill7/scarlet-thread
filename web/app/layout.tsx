import type { Metadata, Viewport } from "next";
import { Archivo, Archivo_Narrow, Fraunces, Inter, Spectral } from "next/font/google";
import { ServiceWorkerRegistration } from "@/components/shell/ServiceWorkerRegistration";
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
  title: "Bible Brain",
  description: "Read the Bible front to back, and build the connections yourself.",
  applicationName: "Bible Brain",
  appleWebApp: {
    capable: true,
    title: "Bible Brain",
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
      data-reading="parchment"
      className={`${fraunces.variable} ${spectral.variable} ${inter.variable} ${archivo.variable} ${archivoNarrow.variable}`}
    >
      <body>
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
