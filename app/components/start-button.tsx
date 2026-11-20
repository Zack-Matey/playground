"use client";
import Link from "next/link";
import { useState } from "react";
import { kodeMono } from "app/lib/fonts";
import { LANGUAGES } from "app/lib/languages";

// Stable languages only.
const CHOICES = LANGUAGES.filter((l) => !l.experimental).map((l) => ({ id: l.id, name: l.name }));
const label = (name: string) => `start with ${name}`;

declare global {
  interface Window {
    __startLang?: number;
  }
}

/** Runs during HTML parsing, before first paint: picks the language and rewrites the static button so it never flashes Python. */
const PICK = `(function(){var c=${JSON.stringify(CHOICES)},i=Math.floor(Math.random()*c.length),a=document.getElementById("start-lang");window.__startLang=i;if(a){a.href="/"+c[i].id;a.textContent="start with "+c[i].name}})()`;

export function StartButton() {
  // Hydration reads the inline script's pick (the DOM already shows it); a client-side navigation picks fresh.
  const [lang] = useState(() => {
    if (typeof window === "undefined") return CHOICES.find((l) => l.id === "python") ?? CHOICES[0];
    return CHOICES[window.__startLang ?? Math.floor(Math.random() * CHOICES.length)];
  });
  return (
    <>
      <Link id="start-lang" href={`/${lang.id}`} className={`${kodeMono.className} btn-primary px-5 py-2.5 font-semibold`} suppressHydrationWarning>
        {label(lang.name)}
      </Link>
      <script dangerouslySetInnerHTML={{ __html: PICK }} suppressHydrationWarning />
    </>
  );
}
