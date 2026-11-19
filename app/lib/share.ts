/**
 * Share links put the code (and stdin) in the URL fragment, deflated and base64url-encoded. Browsers never send the
 * fragment to a server, so a shared snippet only ever exists in the link itself.
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";

export type Shared = { code: string; stdin?: string };

const b64url = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export function encodeShare(s: Shared): string {
  return "code=" + b64url(deflateSync(strToU8(JSON.stringify(s.stdin ? s : { code: s.code })), { level: 9 }));
}

export function decodeShare(hash: string): Shared | null {
  const m = /(?:^#?|&)code=([A-Za-z0-9_-]+)/.exec(hash);
  if (!m) return null;
  try {
    const v = JSON.parse(strFromU8(inflateSync(unb64url(m[1]))));
    return typeof v?.code === "string" ? { code: v.code, stdin: typeof v.stdin === "string" ? v.stdin : undefined } : null;
  } catch {
    return null;
  }
}
