"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { SITE } from "app/lib/site";

function ThemeCycle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <span className="inline-block w-16" />;
  const next = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  return (
    <button type="button" onClick={() => setTheme(next)} className="hover:text-accent-500 cursor-pointer" aria-label={`Theme: ${theme}. Switch to ${next}.`}>
      theme: {theme}
    </button>
  );
}

export function Footer() {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-4 mt-24 mb-10 pt-6 border-t border-neutral-200 dark:border-neutral-800 text-xs text-neutral-500">
      <span>
        © {new Date().getFullYear()} Zack Matey. Code runs on your device, in WebAssembly.
      </span>
      <nav aria-label="Footer" className="flex flex-wrap gap-4">
        <Link href="/about" className="hover:text-accent-500">
          how it works
        </Link>
        <a href={SITE.source} className="hover:text-accent-500">
          source (AGPL-3.0)
        </a>
        <a href="https://zackmatey.com" className="hover:text-accent-500">
          zackmatey.com
        </a>
        <ThemeCycle />
      </nav>
    </footer>
  );
}
