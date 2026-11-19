"use client";

import { kodeMono } from "app/lib/fonts";
import { useRunning } from "app/lib/running";
import { useTypewriter } from "./use-typewriter";

/**
 * The mark: an accent square with a play button (the same square as zackmatey.com's, pressed play). While a program
 * runs anywhere on the page, the triangle shrinks away and a ring spins in its place.
 */
export function LogoMark({ className = "", running = false }: { className?: string; running?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" className={`logo-mark ${running ? "running" : ""} ${className}`} aria-hidden>
      <rect width="32" height="32" fill="var(--color-accent-500)" />
      <path className="logo-play" d="M12 9.2 L23.2 16 L12 22.8 Z" fill="#111010" stroke="#111010" strokeWidth="1.6" strokeLinejoin="round" />
      <circle className="logo-busy" cx="16" cy="16" r="6.5" fill="none" stroke="#111010" strokeWidth="2.6" strokeDasharray="28 13" strokeLinecap="round" />
    </svg>
  );
}

/** The wordmark, typed out on load with a blinking cursor, as on zackmatey.com. */
export function Logo() {
  const running = useRunning();
  const { text, animating } = useTypewriter("playground", "");
  return (
    <span className={`${kodeMono.className} inline-flex items-center gap-3 text-3xl sm:text-4xl font-semibold tracking-tighter`} aria-label="playground">
      <LogoMark running={running} className="w-8 h-8 shrink-0" />
      <span aria-hidden className="whitespace-pre min-w-[10.5ch]">
        {text}
        <span className={`font-light text-accent-500 ${animating ? "" : "type-cursor-blink"}`}>_</span>
      </span>
    </span>
  );
}
