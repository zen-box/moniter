import type { ServerNode } from "../lib";

export type Language = "zh" | "en";
export const words = (language: Language, zh: string, en: string) =>
  language === "zh" ? zh : en;
export const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
export const percent = (value: number | null) =>
  value === null ? "—" : `${value.toFixed(1)}%`;
export const ratio = (used: unknown, total: unknown): number | null => {
  const u = number(used),
    t = number(total);
  return u !== null && t !== null && t > 0 ? (u / t) * 100 : null;
};
export function bytes(value: unknown, rate = false): string {
  const v = number(value);
  if (v === null || v < 0) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  const i =
    v === 0
      ? 0
      : Math.min(
          units.length - 1,
          Math.max(0, Math.floor(Math.log(v) / Math.log(1024))),
        );
  return `${(v / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}${rate ? "/s" : ""}`;
}
export function duration(
  seconds: number | null | undefined,
  language: Language,
): string {
  if (
    seconds === null ||
    seconds === undefined ||
    seconds < 0 ||
    !Number.isFinite(seconds)
  )
    return "—";
  if (seconds < 60)
    return language === "zh"
      ? `${Math.floor(seconds)} 秒`
      : `${Math.floor(seconds)}s`;
  const days = Math.floor(seconds / 86400),
    hours = Math.floor((seconds % 86400) / 3600),
    minutes = Math.floor((seconds % 3600) / 60);
  if (language === "zh")
    return days
      ? `${days} 天 ${hours} 小时`
      : hours
        ? `${hours} 小时 ${minutes} 分钟`
        : `${minutes} 分钟`;
  return days
    ? `${days}d ${hours}h`
    : hours
      ? `${hours}h ${minutes}m`
      : `${minutes}m`;
}
export function dateTime(
  value: number | undefined,
  language: Language,
): string {
  return value && value > 0
    ? new Date(value).toLocaleString(language === "zh" ? "zh-CN" : "en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}
export function cycle(value: string, language: Language): string {
  const labels: Record<string, [string, string]> = {
    monthly: ["月", "month"],
    quarterly: ["季度", "quarter"],
    semi_annually: ["半年", "6 months"],
    annually: ["年", "year"],
    biennially: ["两年", "2 years"],
    triennially: ["三年", "3 years"],
    lifetime: ["永久", "lifetime"],
    free: ["免费", "free"],
  };
  return labels[value]?.[language === "zh" ? 0 : 1] || "—";
}
export function price(node: ServerNode, language: Language): string {
  if (node.billing_cycle === "free") return words(language, "免费", "Free");
  return `${node.billing_currency || ""}${Number(node.billing_price || 0).toFixed(2)} / ${cycle(node.billing_cycle, language)}`;
}
export function renewal(node: ServerNode, language: Language): string {
  if (node.billing_cycle === "free") return words(language, "免费", "Free");
  if (node.billing_cycle === "lifetime")
    return words(language, "永久", "Lifetime");
  if (!node.renewal_date) return "—";
  const target = new Date(
    `${node.renewal_date.slice(0, 10)}T00:00:00`,
  ).getTime();
  if (!Number.isFinite(target)) return "—";
  const days = Math.round(
    (target - new Date(new Date().toDateString()).getTime()) / 86400000,
  );
  return days < 0
    ? words(language, `逾期 ${-days} 天`, `${-days} days overdue`)
    : words(language, `${days} 天`, `${days} days`);
}
export function latency(value: unknown): number | null {
  const ms = number(value);
  return ms !== null && ms > 0 && ms < 999 ? ms : null;
}
export function averageLatency(node: ServerNode): number | null {
  if (!node.monitor_enabled || node.status !== "online") return null;
  const values = [node.latency_ct, node.latency_cu, node.latency_cm]
    .map(latency)
    .filter((v): v is number => v !== null);
  return values.length
    ? values.reduce((sum, v) => sum + v, 0) / values.length
    : null;
}
export function countryName(code: string, language: Language): string {
  try { return new Intl.DisplayNames([language === "zh" ? "zh-CN" : "en"],{type:"region"}).of(code.toUpperCase()) || code; }
  catch { return code || "—"; }
}
export function regionName(node: ServerNode, language: Language): string {
  if (language === "en" && node.region_name_en) return node.region_name_en;
  if (language === "zh" && node.region_name) return node.region_name;
  try {
    return (
      new Intl.DisplayNames(language === "zh" ? ["zh-CN"] : ["en"], {
        type: "region",
      }).of(node.region.toUpperCase()) || node.region
    );
  } catch {
    return node.region_name || node.region || "—";
  }
}
