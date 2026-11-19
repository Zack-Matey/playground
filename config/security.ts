/**
 * Security headers, shared by next.config.ts (dev server) and scripts/cloudflare-build.mjs, which writes them into
 * Cloudflare's _headers file for the static deploy. One source, so the two can't drift apart.
 *
 * The CSP is the sandbox's outer wall. User code runs inside WebAssembly engines in Web Workers, and the page may only
 * connect to this origin, so a program can't send anything anywhere. 'wasm-unsafe-eval' lets WebAssembly compile; it
 * does not allow JS eval (JavaScript snippets run in QuickJS, itself compiled to wasm). 'unsafe-inline' scripts are
 * needed for Next's inline bootstrap without per-request nonces, which a static site can't have.
 *
 * COOP + COEP make the page cross-origin isolated, which enables SharedArrayBuffer. The Rust compiler is a
 * multi-threaded wasm module and needs it; it also lets programs sleep without spinning.
 */
export function contentSecurityPolicy(dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

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
