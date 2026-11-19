"use client";

import { useEffect, useState } from "react";

const TYPE_MS = 90; // per character typed
const DELETE_MS = 70; // per character deleted; a little quicker than typing, like a real backspace
const SETTLE_MS = 150; // how long the target must hold still before we start moving toward it

/**
 * Animates `text` toward `target` one character at a time: deletes until what's shown is a prefix of the target,
 * then types the rest. So "zackmatey.com/resume" → "zackmatey.com/about" only rewrites "resume".
 *
 * Target changes are debounced by SETTLE_MS, and since each step just compares against the latest goal, a change
 * mid-animation retargets from wherever the text currently is instead of restarting. Users who prefer reduced
 * motion get the target immediately.
 */
export function useTypewriter(target: string, initial = "") {
  const [text, setText] = useState(initial);
  const [goal, setGoal] = useState(target);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (target === goal) return;
    const t = setTimeout(() => setGoal(target), SETTLE_MS);
    return () => clearTimeout(t);
  }, [target, goal]);

  useEffect(() => {
    if (text === goal) return;
    if (reduced) return setText(goal);
    const deleting = !goal.startsWith(text);
    const t = setTimeout(() => setText(deleting ? text.slice(0, -1) : goal.slice(0, text.length + 1)), deleting ? DELETE_MS : TYPE_MS);
    return () => clearTimeout(t);
  }, [text, goal, reduced]);

  return { text, animating: text !== target };
}
