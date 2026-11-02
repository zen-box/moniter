import { memo, useMemo } from "react";
import { Maximize2, ChartNoAxesCombined } from "lucide-react";
import { bytes, words, type Language } from "./format";
import { LineChart } from "./LineChart";
import type { ChartPoint, HistoryRange } from "./useNodeHistory";

export type Series = { key: string; name: string; color: string };
export type ChartSpec = {
  id: string;
  title: string;
  unit: string;
  series: Series[];
  percent?: boolean;
  rate?: boolean;
};
export const palette = [
  "#4385ed",
  "#12a77d",
  "#a879dc",
  "#eaa546",
  "#e56f8c",
  "#31a6bd",
  "#7e83d9",
  "#a5ab43",
  "#a9715c",
  "#db75bd",
  "#59a0e5",
  "#77b190",
];

export function metricSpecs(l: Language): ChartSpec[] {
  return [
    { id: "cpu", title: words(l, "CPU 使用率", "CPU usage"), unit: "%", percent: true, series: [{ key: "cpu", name: "CPU", color: palette[0] }] },
    { id: "memory", title: words(l, "内存使用率", "Memory usage"), unit: "%", percent: true, series: [{ key: "memory", name: words(l, "内存", "Memory"), color: palette[2] }] },
    {
      id: "network",
      title: words(l, "网络吞吐", "Network throughput"),
      unit: "B/s",
      rate: true,
      series: [
        { key: "netOut", name: words(l, "上传", "Upload"), color: palette[0] },
        { key: "netIn", name: words(l, "下载", "Download"), color: palette[1] },
      ],
    },
    { id: "disk", title: words(l, "磁盘使用率", "Disk usage"), unit: "%", percent: true, series: [{ key: "disk", name: words(l, "磁盘", "Disk"), color: palette[3] }] },
    {
      id: "load",
      title: words(l, "系统负载", "System load"),
      unit: "",
      series: [
        { key: "load1", name: words(l, "1 分钟", "1 min"), color: palette[0] },
        { key: "load5", name: words(l, "5 分钟", "5 min"), color: palette[2] },
        { key: "load15", name: words(l, "15 分钟", "15 min"), color: palette[3] },
      ],
    },
    {
      id: "connections",
      title: words(l, "网络连接", "Connections"),
      unit: "",
      series: [
        { key: "tcp", name: "TCP", color: palette[1] },
        { key: "udp", name: "UDP", color: palette[0] },
      ],
    },
    { id: "processes", title: words(l, "进程数", "Processes"), unit: "", series: [{ key: "processes", name: words(l, "进程", "Processes"), color: palette[2] }] },
  ];
}

const timeFormats = new Map<string, Intl.DateTimeFormat>();
function timeFormat(language: Language, kind: "day" | "clock" | "full") {
  const key = `${language}:${kind}`;
  let format = timeFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(
      language === "zh" ? "zh-CN" : "en-US",
      kind === "day"
        ? { month: "numeric", day: "numeric" }
        : kind === "clock"
          ? { hour: "2-digit", minute: "2-digit", hour12: false }
          : { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false },
    );
    timeFormats.set(key, format);
  }
  return format;
}

function compact(value: number) {
  if (Math.abs(value) >= 1000) return `${Number((value / 1000).toFixed(1))}k`;
  if (Math.abs(value) < 10 && value % 1) return String(Number(value.toFixed(2)));
  return String(Number(value.toFixed(1)));
}

export function chartFormatters(spec: ChartSpec, language: Language, range: HistoryRange) {
  const long = range === "7d" || range === "30d";
  return {
    formatTick: (value: number) =>
      spec.percent ? `${Math.round(value)}%` : spec.rate ? bytes(value).replace(".0 ", " ") : compact(value),
    formatValue: (value: number) =>
      spec.rate
        ? bytes(value, true)
        : spec.percent
          ? `${value.toFixed(1)}%`
          : spec.unit === "ms"
            ? `${value.toFixed(1)} ms`
            : spec.id === "load"
              ? value.toFixed(2)
              : Math.round(value).toLocaleString(language === "zh" ? "zh-CN" : "en-US"),
    formatTime: (ts: number) => timeFormat(language, long ? "day" : "clock").format(ts * 1000),
    formatFullTime: (ts: number) => timeFormat(language, "full").format(ts * 1000),
  };
}

export const MetricChart = memo(function MetricChart({
  spec,
  points,
  domain,
  language: l,
  range,
  loading = false,
  large = false,
  onExpand,
}: {
  spec: ChartSpec;
  points: ChartPoint[];
  domain: [number, number];
  language: Language;
  range: HistoryRange;
  loading?: boolean;
  large?: boolean;
  onExpand?: (spec: ChartSpec) => void;
}) {
  const formatters = useMemo(() => chartFormatters(spec, l, range), [spec, l, range]);
  const hasData = useMemo(
    () => points.some((p) => p.ts >= domain[0] && spec.series.some((s) => typeof p[s.key] === "number")),
    [points, domain, spec],
  );
  return (
    <section
      className={`mp-chart-panel ${large ? "mp-chart-large" : ""} ${loading ? "is-loading" : ""}`}
      style={{ "--chart-tone": spec.series[0]?.color || palette[0] } as React.CSSProperties}
    >
      <header className="mp-chart-heading">
        <div>
          <i />
          <h3>{spec.title}</h3>
          {spec.unit && <span>{spec.unit}</span>}
        </div>
        {onExpand && (
          <button
            type="button"
            className="mp-icon-button"
            aria-label={words(l, `放大${spec.title}`, `Expand ${spec.title}`)}
            onClick={() => onExpand(spec)}
          >
            <Maximize2 size={14} />
          </button>
        )}
      </header>
      {spec.series.length > 1 && (
        <div className="mp-chart-legend">
          {spec.series.map((s) => (
            <span key={s.key}>
              <i style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <div className="mp-chart-canvas" aria-label={spec.title}>
        {hasData ? (
          <LineChart
            series={spec.series}
            points={points}
            domain={domain}
            percent={spec.percent}
            binary={spec.rate}
            area={spec.series.length === 1}
            revealKey={range}
            {...formatters}
          />
        ) : loading ? (
          <div className="mp-chart-skeleton" role="status" aria-label={words(l, "正在加载历史记录", "Loading history")} />
        ) : (
          <div className="mp-chart-empty">
            <ChartNoAxesCombined size={24} />
            <span>{words(l, "所选时段暂无数据", "No data in this period")}</span>
          </div>
        )}
      </div>
    </section>
  );
});
