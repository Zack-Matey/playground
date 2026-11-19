/**
 * Cloudflare Worker for playground.zackmatey.com. The site is a static export (out/) served by Workers static assets;
 * this script only runs for /engines/* (assets.run_worker_first in wrangler.jsonc).
 *
 * Engines (compilers, interpreters, standard libraries: ~550 MB) are too big for static assets (25 MiB per file) and
 * compress 3-5x, so scripts/cloudflare-build.mjs brotli-compresses them and they live in R2. They're sent as stored,
 * with Content-Encoding: br, so the Worker spends no CPU on them. Paths are versioned, so they're immutable.
 */
import { ENGINE_CACHE } from "../config/engines.ts";
import engines from "./engines.json";

interface Env {
  ASSETS: Fetcher;
  ENGINES: R2Bucket;
}

type Entry = { path: string; contentType: string; sha256: string };
const FILES = new Map((engines as Entry[]).map((f) => [f.path, f]));

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const file = FILES.get(url.pathname);
    if (!file || (req.method !== "GET" && req.method !== "HEAD")) return env.ASSETS.fetch(req);

    const headers = new Headers({
      "Content-Type": file.contentType,
      "Content-Encoding": "br",
      "Cache-Control": ENGINE_CACHE,
      ETag: `"${file.sha256}"`,
      Vary: "Accept-Encoding",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    if (req.headers.get("If-None-Match") === `"${file.sha256}"`) return new Response(null, { status: 304, headers });
    // Every browser accepts brotli over HTTPS; the files are only stored that way.
    if (!/\bbr\b/.test(req.headers.get("Accept-Encoding") ?? "")) return new Response("This file is only available brotli-compressed.\n", { status: 406 });

    const key = url.pathname.slice(1);
    if (req.method === "HEAD") {
      const head = await env.ENGINES.head(key);
      if (!head) return new Response("Not found", { status: 404 });
      headers.set("Content-Length", String(head.size));
      return new Response(null, { headers, encodeBody: "manual" });
    }
    const obj = await env.ENGINES.get(key);
    if (!obj) return new Response("Not found", { status: 404 });
    headers.set("Content-Length", String(obj.size));
    return new Response(obj.body, { headers, encodeBody: "manual" });
  },
} satisfies ExportedHandler<Env>;
