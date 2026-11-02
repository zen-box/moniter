import { memo, useRef, type CSSProperties } from "react";
import { useAnimatedNumber } from "./motion";

export type GaugeTone = "ok" | "warn" | "crit" | "idle";

export function gaugeTone(value: number | null, warn = 70, crit = 90): GaugeTone {
  if (value === null || !Number.isFinite(value)) return "idle";
  return value >= crit ? "crit" : value >= warn ? "warn" : "ok";
}

const whole = (value: number) => String(Math.round(value));

/** Ring meter: the arc animates on the compositor-friendly stroke offset, never layout. */
export const RingGauge = memo(function RingGauge({
  value,
  label,
  caption,
  title,
  size = 64,
  stroke = 6,
  warn = 70,
  crit = 90,
}: {
  value: number | null;
  label: string;
  caption?: string;
  title?: string;
  size?: number;
  stroke?: number;
  warn?: number;
  crit?: number;
}) {
  const v = value === null || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, value));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const tone = gaugeTone(v, warn, crit);
  const number = useAnimatedNumber(v, whole, { fromZero: true, threshold: 8 });
  // Heartbeat jitter snaps; only real movement sweeps the arc. Each sweep
  // repaints the ring every frame, so a page of gauges must not sweep at 1 Hz.
  const previous = useRef(v);
  const snap = v !== null && previous.current !== null && Math.abs(v - previous.current) < 4;
  previous.current = v;
  return (
    <div
      className={`mp-gauge is-${tone}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v ?? undefined}
      aria-valuetext={v === null ? "—" : `${v.toFixed(1)}%`}
      title={title}
    >
      <div className="mp-gauge-ring" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
          <circle className="mp-gauge-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} />
          {v !== null && (
            <circle
              className={`mp-gauge-arc ${v < 0.5 ? "is-empty" : ""} ${snap ? "is-snap" : ""}`}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              strokeWidth={stroke}
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - v / 100)}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              style={{ "--gauge-length": circumference } as CSSProperties}
            />
          )}
        </svg>
        <span className="mp-gauge-number">
          <span ref={number} />
          {v !== null && <small>%</small>}
        </span>
      </div>
      <div className="mp-gauge-label">
        <span>{label}</span>
        {caption !== undefined && <small>{caption}</small>}
      </div>
    </div>
  );
});

/** Compact inline ring for tables. */
export const MiniRing = memo(function MiniRing({
  value,
  label,
  warn = 70,
  crit = 90,
}: {
  value: number | null;
  label: string;
  warn?: number;
  crit?: number;
}) {
  const size = 22,
    stroke = 3;
  const v = value === null || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, value));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <span className={`mp-mini-ring is-${gaugeTone(v, warn, crit)}`} role="meter" aria-label={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={v ?? undefined}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle className="mp-gauge-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} />
        {v !== null && (
          <circle className={`mp-gauge-arc ${v < 0.5 ? "is-empty" : ""}`} cx={size / 2} cy={size / 2} r={radius}
            strokeWidth={stroke} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - v / 100)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ "--gauge-length": circumference } as CSSProperties} />
        )}
      </svg>
      <b>{v === null ? "—" : `${v.toFixed(1)}%`}</b>
    </span>
  );
});
