import Link from "next/link";
import { kodeMono } from "app/lib/fonts";

export default function NotFound() {
  return (
    <main className="text-center py-16 flex flex-col gap-4 items-center">
      <h1 className={`${kodeMono.className} text-2xl font-semibold`}>404: segmentation fault (core not dumped)</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Nothing here. Try{" "}
        <Link href="/" className="underline decoration-accent-500 underline-offset-2">
          the languages
        </Link>
        .
      </p>
    </main>
  );
}
