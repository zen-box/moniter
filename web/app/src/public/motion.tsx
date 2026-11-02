import { useLayoutEffect, useRef } from "react";

export const prefersReducedMotion = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/*
 * Animated numbers write straight to their text node. One shared frame loop
 * drives every tween and stops as soon as nothing is moving, so a page full of
 * live gauges never re-renders React per frame.
 */
type Tween = {
  el: HTMLElement;
  from: number;
  to: number;
  start: number;
  duration: number;
  format: (value: number) => string;
};
const tweens = new Map<HTMLElement, Tween>();
let frame = 0;
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

function tick(now: number) {
  for (const tween of tweens.values()) {
    const progress = Math.min(1, (now - tween.start) / tween.duration);
    tween.el.textContent = tween.format(
      tween.from + (tween.to - tween.from) * ease(progress),
    );
    if (progress >= 1) tweens.delete(tween.el);
  }
  frame = tweens.size ? requestAnimationFrame(tick) : 0;
}

/**
 * Bind the returned ref to an element with no React children. Values roll on
 * first appearance and on jumps of at least `threshold`; the small changes
 * that arrive every second snap, so live pages do no per-frame text layout.
 */
export function useAnimatedNumber(
  value: number | null,
  format: (value: number) => string,
  { duration = 650, fromZero = false, threshold = Infinity }: { duration?: number; fromZero?: boolean; threshold?: number } = {},
) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const running = tweens.get(el);
    tweens.delete(el);
    if (value === null || !Number.isFinite(value)) {
      el.textContent = "—";
      shown.current = null;
      return;
    }
    const from = running
      ? running.from + (running.to - running.from) * ease(Math.min(1, (performance.now() - running.start) / running.duration))
      : shown.current ?? (fromZero ? 0 : null);
    const first = shown.current === null;
    shown.current = value;
    if (from === null || prefersReducedMotion() || document.hidden || format(from) === format(value) ||
      (!first && !running && Math.abs(value - from) < threshold)) {
      el.textContent = format(value);
      return;
    }
    el.textContent = format(from);
    tweens.set(el, { el, from, to: value, start: performance.now(), duration, format });
    if (!frame) frame = requestAnimationFrame(tick);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps -- formats are pure per caller
  return ref;
}

export function AnimatedNumber({
  value,
  format,
  fromZero = true,
  threshold,
  className,
}: {
  value: number | null;
  format: (value: number) => string;
  fromZero?: boolean;
  threshold?: number;
  className?: string;
}) {
  const ref = useAnimatedNumber(value, format, { fromZero, threshold });
  return <span ref={ref} className={className} />;
}
