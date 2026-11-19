import type { NextConfig } from "next";
import { ENGINE_CACHE } from "./config/engines";
import { securityHeaders } from "./config/security";

const dev = process.env.NODE_ENV !== "production";
// EXPORT=1 builds the static site for Cloudflare (scripts/cloudflare-build.mjs): plain HTML/JS in out/, no server.
const staticExport = process.env.EXPORT === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: staticExport ? "export" : undefined,
  poweredByHeader: false,
  // Lets a dev server and a production build coexist without overwriting each other's output.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  images: { unoptimized: true },
  // Headers only apply with a Node server; the static export gets the same ones through Cloudflare's _headers file.
  ...(staticExport
    ? {}
    : {
        async headers() {
          return [
            { source: "/:path*", headers: securityHeaders(dev) },
            { source: "/engines/:path*", headers: [{ key: "Cache-Control", value: ENGINE_CACHE }] },
            // The service worker must always be revalidated, or users could be stuck on an old version.
            { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }] },
          ];
        },
      }),
};

export default nextConfig;
