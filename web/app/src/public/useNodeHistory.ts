import { useEffect, useMemo, useState } from "react";
import { API, type ServerNode } from "../lib";
import { latency, number, ratio } from "./format";

export const ranges = {
  "1h": { hours: 1, bucket: 60 },
  "6h": { hours: 6, bucket: 120 },
  "24h": { hours: 24, bucket: 300 },
  "7d": { hours: 168, bucket: 1800 },
  "30d": { hours: 720, bucket: 7200 },
};
export type HistoryRange = keyof typeof ranges;
export type ChartPoint = { ts: number; [key: string]: number | null };
type RawMetric = Record<string, unknown> & { ts: number };
export type TargetHistory = {
  target_id: number;
  name: string;
  host: string;
  carrier: string;
  region: string;
  deleted?: boolean;
  points: { ts: number; ms: number | null; timeouts: number; total: number }[];
};

export function toChartPoint(p: RawMetric): ChartPoint {
  const inRate = number(p.net_in_kb),
    outRate = number(p.net_out_kb);
  return {
    ts: p.ts,
    cpu: number(p.cpu),
    memory: ratio(p.mem_used_mb, p.mem_total_mb),
    disk: ratio(p.disk_used_bytes, p.disk_total_bytes),
    netIn: inRate === null ? null : inRate * 1024,
    netOut: outRate === null ? null : outRate * 1024,
    tcp: number(p.tcp_conns),
    udp: number(p.udp_conns),
    processes: number(p.processes),
    load1: number(p.load1),
    load5: number(p.load5),
    load15: number(p.load15),
    ct: latency(p.lat_ct),
    cu: latency(p.lat_cu),
    cm: latency(p.lat_cm),
  };
}

export function withGaps(points: ChartPoint[], maxGap: number): ChartPoint[] {
  const sorted = [...points].sort((a, b) => a.ts - b.ts);
  const result: ChartPoint[] = [];
  sorted.forEach((point, index) => {
    const previous = sorted[index - 1];
    if (previous && point.ts - previous.ts > maxGap) {
      const gap: ChartPoint = { ts: previous.ts + 1 };
      new Set([...Object.keys(previous), ...Object.keys(point)]).forEach(
        (key) => {
          if (key !== "ts") gap[key] = null;
        },
      );
      result.push(gap);
    }
    result.push(point);
  });
  return result;
}

export function useNodeHistory(node: ServerNode, range: HistoryRange) {
  const [history, setHistory] = useState<ChartPoint[]>([]);
  const [samples, setSamples] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: number;
    const { hours, bucket } = ranges[range];
    setLoading(true);
    const load = async () => {
      try {
        const rows = await API(
          `/api/v1/metrics/${encodeURIComponent(node.id)}?hours=${hours}&bucket=${bucket}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          setHistory(
            (Array.isArray(rows) ? rows : [])
              .filter((p) => number(p.ts) !== null)
              .map(toChartPoint),
          );
          setError(false);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          timer = window.setTimeout(load, 60000);
        }
      }
    };
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [node.id, range, revision]);
  useEffect(() => {
    if (node.status !== "online" || !node.last_seen) return;
    const ts = Math.floor(node.last_seen / 1000);
    const point = toChartPoint({
      ts,
      cpu: node.current_cpu,
      mem_used_mb: node.mem_used_mb,
      mem_total_mb: node.mem_total_mb,
      disk_used_bytes: node.disk_used_bytes,
      disk_total_bytes: node.disk_total_bytes,
      net_in_kb: node.net_in_speed_kb,
      net_out_kb: node.net_out_speed_kb,
      tcp_conns: node.tcp_conns,
      udp_conns: node.udp_conns,
      processes: node.processes,
      load1: node.load1,
      load5: node.load5,
      load15: node.load15,
      lat_ct: node.latency_ct,
      lat_cu: node.latency_cu,
      lat_cm: node.latency_cm,
    });
    setSamples((previous) =>
      previous.some((p) => p.ts === ts)
        ? previous
        : [...previous, point]
            .filter((p) => p.ts >= Date.now() / 1000 - 3600)
            .slice(-720),
    );
  }, [node]);
  const points = useMemo(() => {
    const { hours, bucket } = ranges[range];
    const latest = history[history.length - 1]?.ts || 0;
    const start = Date.now() / 1000 - hours * 3600;
    const live = samples.filter((p) => p.ts > latest && p.ts >= start);
    return withGaps(
      [...history.filter((p) => p.ts >= start), ...live],
      bucket * 2.5,
    );
  }, [history, samples, range]);
  return { points, loading, error, reload: () => setRevision((n) => n + 1) };
}

export function useTargetHistory(
  nodeId: string,
  range: HistoryRange,
  enabled: boolean,
) {
  const [targets, setTargets] = useState<TargetHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: number;
    const { hours, bucket } = ranges[range];
    setLoading(true);
    const load = async () => {
      try {
        const rows = await API(
          `/api/v1/target_metrics/${encodeURIComponent(nodeId)}?hours=${hours}&bucket=${bucket}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          setTargets(Array.isArray(rows) ? rows : []);
          setError(false);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          timer = window.setTimeout(load, 60000);
        }
      }
    };
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [nodeId, range, enabled, revision]);
  return { targets, loading, error, reload: () => setRevision((n) => n + 1) };
}
