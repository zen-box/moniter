import { useId } from "react";
import { Button, Spinner } from "@heroui/react";
import { Maximize2, ChartNoAxesCombined } from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { bytes, words, type Language } from "./format";
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
    {
      id: "cpu",
      title: words(l, "CPU 使用率", "CPU usage"),
      unit: "%",
      percent: true,
      series: [{ key: "cpu", name: "CPU", color: palette[0] }],
    },
    {
      id: "memory",
      title: words(l, "内存使用率", "Memory usage"),
      unit: "%",
      percent: true,
      series: [
        { key: "memory", name: words(l, "内存", "Memory"), color: palette[2] },
      ],
    },
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
    {
      id: "disk",
      title: words(l, "磁盘使用率", "Disk usage"),
      unit: "%",
      percent: true,
      series: [
        { key: "disk", name: words(l, "磁盘", "Disk"), color: palette[3] },
      ],
    },
    {
      id: "load",
      title: words(l, "系统负载", "System load"),
      unit: "",
      series: [
        { key: "load1", name: words(l, "1 分钟", "1 min"), color: palette[0] },
        { key: "load5", name: words(l, "5 分钟", "5 min"), color: palette[2] },
        {
          key: "load15",
          name: words(l, "15 分钟", "15 min"),
          color: palette[3],
        },
      ],
    },
    {
      id: "connections",
      title: words(l, "网络连接", "Connections"),
      unit: words(l, "个", "connections"),
      series: [
        { key: "tcp", name: "TCP", color: palette[1] },
        { key: "udp", name: "UDP", color: palette[0] },
      ],
    },
    {
      id: "processes",
      title: words(l, "进程数", "Processes"),
      unit: words(l, "个", "processes"),
      series: [
        {
          key: "processes",
          name: words(l, "进程", "Processes"),
          color: palette[2],
        },
      ],
    },
  ];
}

function tickValue(value: number, rate?: boolean) {
  if (rate) return bytes(value, true).replace(/\.0 /, " ").replace(" ", "");
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return Number(value.toFixed(2)).toString();
}

export function MetricChart({
  spec,
  points,
  language: l,
  range,
  loading = false,
  large = false,
  onExpand,
}: {
  spec: ChartSpec;
  points: ChartPoint[];
  language: Language;
  range: HistoryRange;
  loading?: boolean;
  large?: boolean;
  onExpand?: () => void;
}) {
  const unique = useId().replace(/:/g, "");
  const hasData = points.some((p) =>
    spec.series.some((s) => typeof p[s.key] === "number"),
  );
  const shortTime = (v: number) =>
    new Date(v * 1000).toLocaleString(
      l === "zh" ? "zh-CN" : "en-US",
      range === "7d" || range === "30d"
        ? { month: "numeric", day: "numeric" }
        : { hour: "2-digit", minute: "2-digit", hour12: false },
    );
  return (
    <section
      className={`mp-chart-panel ${large ? "mp-chart-large" : ""}`}
      style={
        {
          "--chart-tone": spec.series[0]?.color || palette[0],
        } as React.CSSProperties
      }
    >
      <header className="mp-chart-heading">
        <div>
          <i />
          <h3>{spec.title}</h3>
          <span>{spec.rate ? "B/s" : spec.unit}</span>
        </div>
        <div>
          {loading && (
            <Spinner size="sm" aria-label={words(l, "加载中", "Loading")} />
          )}
          {onExpand && (
            <Button
              isIconOnly
              size="sm"
              variant="light"
              aria-label={words(l, `放大${spec.title}`, `Expand ${spec.title}`)}
              onPress={onExpand}
            >
              <Maximize2 size={14} />
            </Button>
          )}
        </div>
      </header>
      <div className="mp-chart-legend">
        {spec.series.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      <div className="mp-chart-canvas" aria-label={spec.title}>
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={points}
              margin={{
                top: 10,
                right: 15,
                bottom: 1,
                left: spec.rate ? 8 : 0,
              }}
            >
              <defs>
                {spec.series.map((s, i) => (
                  <linearGradient
                    key={s.key}
                    id={`${unique}-${i}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.17} />
                    <stop
                      offset="100%"
                      stopColor={s.color}
                      stopOpacity={0.005}
                    />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid
                vertical={false}
                stroke="var(--line)"
                strokeDasharray="3 4"
                strokeOpacity={0.65}
              />
              <XAxis
                type="number"
                dataKey="ts"
                domain={["dataMin", "dataMax"]}
                tickFormatter={shortTime}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--muted)", fontSize: 10 }}
                minTickGap={36}
                tickMargin={12}
              />
              <YAxis
                domain={spec.percent ? [0, 100] : [0, "auto"]}
                tickFormatter={(v) => tickValue(v, spec.rate)}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--muted)", fontSize: 10 }}
                width={spec.rate ? 70 : 44}
                tickCount={5}
                allowDecimals={
                  !spec.percent &&
                  !["connections", "processes"].includes(spec.id)
                }
              />
              <Tooltip
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <div className="mp-chart-tooltip">
                      <small>
                        {new Date(Number(label) * 1000).toLocaleString(
                          l === "zh" ? "zh-CN" : "en-US",
                        )}
                      </small>
                      {payload
                        .filter(
                          (p) => p.value !== null && p.value !== undefined,
                        )
                        .map((p) => (
                          <div key={String(p.dataKey)}>
                            <i style={{ background: p.color }} />
                            <span>{p.name}</span>
                            <strong>
                              {spec.rate
                                ? bytes(Number(p.value), true)
                                : `${Number(p.value).toFixed(spec.percent || spec.id === "latency" || spec.id === "carriers" || spec.id === "load" ? 1 : 0)}${spec.unit === "%" ? "%" : spec.unit ? ` ${spec.unit}` : ""}`}
                            </strong>
                          </div>
                        ))}
                    </div>
                  ) : null
                }
                cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }}
              />
              {spec.series.map((s, i) =>
                spec.series.length === 1 ? (
                  <Area
                    key={s.key}
                    type="linear"
                    dataKey={s.key}
                    name={s.name}
                    stroke={s.color}
                    strokeWidth={1.8}
                    fill={`url(#${unique}-${i})`}
                    dot={points.length < 3 ? { r: 3, strokeWidth: 0 } : false}
                    activeDot={{
                      r: 4,
                      strokeWidth: 2,
                      stroke: "var(--surface)",
                    }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ) : (
                  <Line
                    key={s.key}
                    type="linear"
                    dataKey={s.key}
                    name={s.name}
                    stroke={s.color}
                    strokeWidth={1.8}
                    dot={points.length < 3 ? { r: 3, strokeWidth: 0 } : false}
                    activeDot={{
                      r: 4,
                      strokeWidth: 2,
                      stroke: "var(--surface)",
                    }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ),
              )}
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="mp-chart-empty">
            {loading ? (
              <Spinner size="sm" />
            ) : (
              <ChartNoAxesCombined size={25} />
            )}
            <span>
              {words(
                l,
                loading ? "正在加载历史记录" : "所选时段暂无数据",
                loading ? "Loading history" : "No data in this period",
              )}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
