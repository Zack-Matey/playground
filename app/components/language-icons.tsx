import { SiC, SiCplusplus, SiGo, SiJavascript, SiOpenjdk, SiPython, SiRust, SiTypescript, SiWebassembly } from "react-icons/si";
import type { IconType } from "react-icons";
import { LANG_BY_ID, type LangId } from "app/lib/languages";

export const LANG_ICONS: Record<LangId, IconType> = {
  python: SiPython,
  javascript: SiJavascript,
  typescript: SiTypescript,
  c: SiC,
  cpp: SiCplusplus,
  go: SiGo,
  rust: SiRust,
  java: SiOpenjdk,
};

/** A language's logo in its brand color (Rust's and C's marks are tuned for contrast in each theme). */
export function LangIcon({ lang, size = 18, className = "", mono = false }: { lang: LangId; size?: number; className?: string; mono?: boolean }) {
  const Icon = LANG_ICONS[lang];
  const tuned = lang === "rust" ? "text-[#b7410e] dark:text-[#DEA584]" : lang === "c" ? "text-[#5c6bc0] dark:text-[#A8B9CC]" : "";
  return (
    <Icon
      size={size}
      aria-hidden
      className={`shrink-0 ${mono ? "" : tuned} ${className}`}
      style={mono || tuned ? undefined : { color: LANG_BY_ID[lang].color }}
    />
  );
}

export function WasmIcon({ size = 18, className = "" }: { size?: number; className?: string }) {
  return <SiWebassembly size={size} aria-hidden className={`shrink-0 text-[#654FF0] ${className}`} />;
}
