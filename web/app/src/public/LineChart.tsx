/*
 * Minimal SVG time-series chart for the public pages. Paths are recomputed only
 * when data or size change; pointer tracking re-renders the hover layer alone,
 * so the crosshair follows the pointer at frame rate even with many series.
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";

export type LinePoint = { ts: number; [key: string]: number | null };
export type LineSeries = { key: string; name: string; color: string };

type Props = {
  series: LineSeries[];
  points: LinePoint[];
  domain: [number, number];
  percent?: boolean;
  binary?: boolean;
  area?: boolean;
  formatTick: (value: number) => string;
  formatValue: (value: number) => string;
  formatTime: (ts: number) => string;
  formatFullTime: (ts: number) => string;
  revealKey?: string;
};

const PAD = { top: 12, right: 14, bottom: 26, left: 52 };

function niceTicks(max: number, binary: boolean): number[] {
  if (!(max > 0)) return [0, 1];
  const unit = binary ? Math.pow(1024, Math.max(0, Math.floor(Math.log(max) / Math.log(1024)))) : 1;
  const scaled = max / unit;
  const raw = scaled / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  const top = Math.ceil(scaled / step) * step;
  const ticks: number[] = [];
  for (let index = 0; index * step <= top + step / 2; index++) ticks.push(index * step * unit);
  return ticks;
}

const TIME_STEPS = [60, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800, 604800];

function timeTicks(start: number, end: number, width: number): number[] {
  const wanted = Math.max(2, Math.min(7, Math.floor(width / 105)));
  const step = TIME_STEPS.find((s) => (end - start) / s <= wanted) ?? TIME_STEPS[TIME_STEPS.length - 1];
  // Align ticks to local wall-clock boundaries (UTC = local + offset).
  const offset = new Date().getTimezoneOffset() * 60;
  const ticks: number[] = [];
  for (let ts = Math.ceil((start - offset) / step) * step + offset; ts <= end; ts += step) ticks.push(ts);
  return ticks;
}

function nearest(points: LinePoint[], ts: number): number {
  let low = 0,
    high = points.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (points[mid].ts < ts) low = mid + 1;
    else high = mid;
  }
  if (low > 0 && Math.abs(points[low - 1].ts - ts) < Math.abs(points[low].ts - ts)) low--;
  return low;
}

function useSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width),
        height = Math.round(entry.contentRect.height);
      setSize((previous) => (previous.width === width && previous.height === height ? previous : { width, height }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}

type Geometry = ReturnType<typeof buildGeometry>;

function buildGeometry(props: Props, width: number, height: number) {
  const { series, points, domain, percent, binary, area } = props;
  const innerWidth = Math.max(10, width - PAD.left - PAD.right);
  const innerHeight = Math.max(10, height - PAD.top - PAD.bottom);
  const [start, end] = domain;
  const span = Math.max(1, end - start);
  const visible = points.filter((point) => point.ts >= start && point.ts <= end);
  let max = 0;
  for (const point of visible)
    for (const s of series) {
      const value = point[s.key];
      if (typeof value === "number" && value > max) max = value;
    }
  const ticks = percent ? [0, 25, 50, 75, 100] : niceTicks(max, !!binary);
  const top = ticks[ticks.length - 1] || 1;
  const baseline = PAD.top + innerHeight;
  const x = (ts: number) => PAD.left + ((ts - start) / span) * innerWidth;
  const y = (value: number) => baseline - (Math.min(Math.max(value, 0), top) / top) * innerHeight;
  const lines = series.map((s) => {
    let path = "",
      fill = "",
      run: string[] = [],
      firstX = 0,
      lastX = 0;
    const close = () => {
      if (!run.length) return;
      path += `M${run.join("L")}`;
      if (area) fill += `M${run.join("L")}L${lastX.toFixed(1)},${baseline}L${firstX.toFixed(1)},${baseline}Z`;
      run = [];
    };
    for (const point of visible) {
      const value = point[s.key];
      if (typeof value !== "number") {
        close();
        continue;
      }
      const px = x(point.ts);
      if (!run.length) firstX = px;
      lastX = px;
      run.push(`${px.toFixed(1)},${y(value).toFixed(1)}`);
    }
    close();
    return { ...s, path, fill };
  });
  return { innerWidth, innerHeight, ticks, x, y, lines, visible, times: timeTicks(start, end, innerWidth) };
}

const Plot = memo(function Plot({
  geometry,
  width,
  height,
  area,
  formatTick,
  formatTime,
  revealKey,
}: {
  geometry: Geometry;
  width: number;
  height: number;
  area?: boolean;
  formatTick: (value: number) => string;
  formatTime: (ts: number) => string;
  revealKey?: string;
}) {
  const gradient = useMemo(() => `lc${Math.random().toString(36).slice(2, 9)}`, []);
  return (
    <svg className="mp-line-svg" width={width} height={height} aria-hidden="true">
      {area && (
        <defs>
          {geometry.lines.map((line) => (
            <linearGradient key={line.key} id={`${gradient}-${line.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={line.color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={line.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
      )}
      <g className="mp-line-grid">
        {geometry.ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={PAD.left + geometry.innerWidth} y1={geometry.y(tick)} y2={geometry.y(tick)} />
            <text x={PAD.left - 9} y={geometry.y(tick)} dy="0.32em" textAnchor="end">
              {formatTick(tick)}
            </text>
          </g>
        ))}
        {geometry.times.map((ts) => (
          <text key={ts} x={geometry.x(ts)} y={height - 7} textAnchor="middle">
            {formatTime(ts)}
          </text>
        ))}
      </g>
      <g className="mp-line-series" key={revealKey}>
        {geometry.lines.map((line) => (
          <g key={line.key}>
            {area && line.fill && <path d={line.fill} fill={`url(#${gradient}-${line.key})`} />}
            <path d={line.path} fill="none" stroke={line.color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
          </g>
        ))}
      </g>
    </svg>
  );
});

export const LineChart = memo(function LineChart(props: Props) {
  const { ref, width, height } = useSize();
  const geometry = useMemo(
    () => buildGeometry(props, width, height),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- formatters do not affect geometry
    [props.series, props.points, props.domain, props.percent, props.binary, props.area, width, height],
  );
  const [hover, setHover] = useState<number | null>(null);
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const visible = geometry.visible;
  const point = hover !== null && hover < visible.length ? visible[hover] : null;
  const rows = point
    ? props.series.filter((s) => typeof point[s.key] === "number").map((s) => ({ ...s, value: point[s.key] as number }))
    : [];
  const hoverX = point ? geometry.x(point.ts) : 0;
  const flip = hoverX > width * 0.6;
  return (
    <div
      ref={ref}
      className="mp-line-chart"
      onPointerMove={(event) => {
        if (!visible.length) return;
        const left = event.currentTarget.getBoundingClientRect().left;
        const clientX = event.clientX;
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
          const ratio = (clientX - left - PAD.left) / geometry.innerWidth;
          if (ratio < -0.03 || ratio > 1.03) return setHover(null);
          setHover(nearest(visible, props.domain[0] + ratio * (props.domain[1] - props.domain[0])));
        });
      }}
      onPointerLeave={() => {
        cancelAnimationFrame(frame.current);
        setHover(null);
      }}
    >
      {width > 0 && height > 0 && (
        <Plot
          geometry={geometry}
          width={width}
          height={height}
          area={props.area}
          formatTick={props.formatTick}
          formatTime={props.formatTime}
          revealKey={props.revealKey}
        />
      )}
      {point && rows.length > 0 && (
        <div className="mp-line-hover" aria-hidden="true">
          <span className="mp-line-crosshair" style={{ left: hoverX, top: PAD.top, height: geometry.innerHeight }} />
          {rows.map((row) => (
            <i key={row.key} className="mp-line-dot" style={{ left: hoverX, top: geometry.y(row.value), background: row.color }} />
          ))}
          <div className={`mp-line-tooltip ${flip ? "is-left" : ""}`} style={{ left: flip ? hoverX - 14 : hoverX + 14 }}>
            <small>{props.formatFullTime(point.ts)}</small>
            {rows.map((row) => (
              <div key={row.key}>
                <i style={{ background: row.color }} />
                <span>{row.name}</span>
                <strong>{props.formatValue(row.value)}</strong>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
