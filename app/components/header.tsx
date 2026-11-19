"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { kodeMono } from "app/lib/fonts";
import { isLang } from "app/lib/languages";
import { Logo } from "./logo";

const NAV = [
  { href: "/python", label: "run", match: (p: string) => isLang(p.split("/")[1] ?? "") },
  { href: "/about", label: "about", match: (p: string) => p === "/about" },
];

export function Header() {
  const pathname = usePathname();
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-7 mb-8">
      <Link href="/" aria-label="playground home">
        <Logo />
      </Link>
      <nav aria-label="Main" className={`${kodeMono.className} flex flex-wrap items-center gap-1 text-base`}>
        {NAV.map((n) => {
          const active = n.match(pathname);
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active ? "page" : undefined}
              className={`px-4 py-2 font-semibold ${active ? "bg-accent-500 text-white" : "hover:text-accent-500"}`}
            >
              {n.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
