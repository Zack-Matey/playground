/**
 * Security headers, shared by next.config.ts (dev server) and scripts/cloudflare-build.mjs, which writes them into
 * Cloudflare's _headers file for the static deploy. One source, so the two can't drift apart.
 *
 * The CSP is the sandbox's outer wall. User code runs inside WebAssembly engines in Web Workers, and the page may only
 * connect to this origin, so a program can't send anything anywhere. 'wasm-unsafe-eval' lets WebAssembly compile; it
 * does not allow JS eval (JavaScript snippets run in QuickJS, itself compiled to wasm). 'unsafe-inline' scripts are
 * needed for Next's inline bootstrap without per-request nonces, which a static site can't have.
 *
 * The one third party is Cloudflare Web Analytics, which Cloudflare injects into the pages of the zone (as on
 * zackmatey.com); its script sends Cross-Origin-Resource-Policy: cross-origin, so COEP lets it load. Only pages may
 * use it: scripts under /_next/static/ (which include the runner workers, whose CSP comes from their own response)
 * also get WORKER_CSP, and a browser enforces every policy it's sent, so code running a program can still reach
 * nothing but this origin.
 *
 * COOP + COEP make the page cross-origin isolated, which enables SharedArrayBuffer. The Rust compiler is a
 * multi-threaded wasm module and needs it; it also lets programs sleep without spinning.
 */
const CF_ANALYTICS_SCRIPT = "https://static.cloudflareinsights.com";
const CF_ANALYTICS_BEACON = "https://cloudflareinsights.com";

export function contentSecurityPolicy(dev: boolean, { analytics = true } = {}): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${analytics ? ` ${CF_ANALYTICS_SCRIPT}` : ""}${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${analytics ? ` ${CF_ANALYTICS_BEACON}` : ""}${dev ? " ws:" : ""}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** The extra policy for /_next/static/* (scripts and the runner workers): the page policy without analytics. */
export const workerSecurityHeaders = (dev: boolean) => [{ key: "Content-Security-Policy", value: contentSecurityPolicy(dev, { analytics: false }) }];

export function securityHeaders(dev: boolean): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(dev) },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
    ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
  ];
}
