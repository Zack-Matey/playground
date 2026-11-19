"use client";
/** Whether a program is running somewhere on the page; the logo animates while it is. */
import { useSyncExternalStore } from "react";

let running = false;
const subs = new Set<() => void>();
export function setRunning(v: boolean) {
  if (v === running) return;
  running = v;
  subs.forEach((f) => f());
}
export const useRunning = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => running,
    () => false,
  );
