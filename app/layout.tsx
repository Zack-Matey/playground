import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Providers } from "./providers";
import { Header } from "./components/header";
import { Footer } from "./components/footer";
import { ServiceWorker } from "./components/sw-register";
import { SITE, WIDE } from "./lib/site";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name}: run code in your browser`, template: `%s | ${SITE.name}` },
  description: SITE.description,
  openGraph: { title: SITE.name, description: SITE.description, url: SITE.url, siteName: SITE.name, locale: "en_US", type: "website" },
  icons: { icon: "/favicon.svg", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: SITE.name, statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#111010" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="antialiased min-h-screen flex flex-col items-center">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 btn-primary px-3 py-2 text-sm">
          Skip to content
        </a>
        <Providers>
          <ServiceWorker />
          <div className={WIDE}>
            <Header />
          </div>
          <div id="main" className={`${WIDE} flex-1 flex flex-col`}>
            {children}
          </div>
          <div className={WIDE}>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
