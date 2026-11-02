import {englishMessage} from "./messages";

export type ServerNode = {
  id: string;
  name: string;
  region: string;
  region_name: string;
  region_name_en?: string;
  provider: string;
  ipv4?: string;
  ipv6?: string;
  public_ip?: boolean;
  ipv4_override?: string;
  ipv6_override?: string;
  agent_version?: string;
  tags?: string;
  status: "online" | "offline";
  last_seen?: number;
  billing_price: number;
  billing_currency: string;
  billing_currency_code?: string;
  billing_cycle: string;
  renewal_date: string;
  traffic_limit_gb: number;
  traffic_used_gb?: number;
  traffic_used_bytes?: number;
  current_cpu?: number;
  mem_used_mb?: number;
  mem_total_mb?: number;
  swap_used_mb?: number;
  swap_total_mb?: number;
  disk_used_bytes?: number;
  disk_total_bytes?: number;
  net_in_speed_kb?: number;
  net_out_speed_kb?: number;
  total_rx_bytes?: number;
  total_tx_bytes?: number;
  traffic_type?: string;
  traffic_reset_day?: number;
  uptime_secs?: number;
  os_name?: string;
  kernel_ver?: string;
  arch?: string;
  virtualization?: string;
  gpu?: string;
  cpu_model?: string;
  cpu_cores?: number;
  load1?: number;
  load5?: number;
  load15?: number;
  processes?: number;
  tcp_conns?: number;
  udp_conns?: number;
  latency_ct?: number;
  latency_cu?: number;
  latency_cm?: number;
  latency_intl?: number;
  routes?: Record<
    string,
    {
      name?: string;
      line?: string;
      as?: string;
      as_num?: string;
      status?: string;
      ping?: number;
    }
  > | null;
  targets?: Array<{
    id: number;
    name: string;
    host: string;
    carrier: string;
    region: string;
    ms: number;
  }>;
  monitor_enabled?: boolean;
  monitor_mode?: string;
  monitor_targets?: string;
  route_enabled?: boolean;
  alert_enabled?: boolean;
  alert_offline?: boolean;
  alert_cpu?: boolean;
  alert_traffic?: boolean;
  alert_rules?: Partial<Record<"memory"|"disk"|"load"|"loss"|"billing",boolean>>;
};

export type Target = {
  id: number;
  name: string;
  host: string;
  port: number;
  carrier: string;
  region: string;
  enabled: boolean;
};
export type CostNode = {
  name: string;
  provider: string;
  price: number;
  currency: string;
  currency_code: string;
  cycle: string;
  renewal_date: string;
};

export const API = async (path: string, init: RequestInit = {}) => {
  const english = localStorage.getItem("aegis_lang") === "en";
  const url = new URL(path, location.origin);
  if (url.origin !== location.origin) throw new Error(english ? "Invalid API origin" : "接口地址无效");
  const headers = new Headers(init.headers);
  const token = localStorage.getItem("aegis_admin_token");
  if (token && url.pathname.startsWith("/api/v1/admin/")) headers.set("Authorization", `Bearer ${token}`);
  if (
    init.body &&
    !(init.body instanceof FormData) &&
    !headers.has("Content-Type")
  )
    headers.set("Content-Type", "application/json");
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, path.endsWith("/themes/github") ? 130000 : path.endsWith("/alerts/test") ? 60000 : 20000);
  try {
    const response = await fetch(url.pathname + url.search, { ...init, headers, signal: controller.signal });
    if (response.status === 401 && url.pathname.startsWith("/api/v1/admin/")) {
      localStorage.removeItem("aegis_admin_token");
      location.href = "/admin/login";
      throw new Error(english ? "Please sign in again" : "登录已失效，请重新登录");
    }
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.message ? (english ? englishMessage(data.message) : data.message) : (english ? `Request failed (HTTP ${response.status})` : `请求失败（HTTP ${response.status}）`));
    }
    const data = await response.json();
    if (english && data && typeof data.message === "string") data.message = englishMessage(data.message);
    return data;
  } catch (error) {
    if (timedOut) throw new Error(english ? "Request timed out. Please retry." : "请求超时，请重试");
    if (error instanceof TypeError) throw new Error(english ? "Cannot connect. Check your connection and retry." : "无法连接服务，请检查网络后重试");
    throw error;
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abort);
  }
};

export const requestError = (error: unknown) => error instanceof Error ? error.message :
  (localStorage.getItem("aegis_lang") === "en" ? "Operation failed. Please retry." : "操作失败，请重试");

export async function copyText(text:string) {
  if(navigator.clipboard && window.isSecureContext) {await navigator.clipboard.writeText(text);return;}
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({length:selection.rangeCount}, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const input=document.createElement("textarea");input.value=text;input.style.cssText="position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  (focused?.closest('[role="dialog"]') || document.body).append(input);input.focus({preventScroll:true});input.select();
  try {if(!document.execCommand("copy"))throw new Error(localStorage.getItem("aegis_lang")==="en"?"Copy failed. Select and copy the text manually.":"复制失败，请选中文本手动复制");}
  finally {
    input.remove();
    focused?.focus({preventScroll:true});
    if (selection) {selection.removeAllRanges();ranges.forEach(range => selection.addRange(range));}
  }
}

export const flag = (code: string) =>
  `/assets/flags/${/^[a-z]{2}$/i.test(code) ? code.toLowerCase() : "unknown"}.svg`;
export const money = (value: number) => `$${Number(value || 0).toFixed(2)}`;
export const cycleLabel: Record<string, string> = {
  monthly: "月付",
  quarterly: "季付",
  semi_annually: "半年付",
  annually: "年付",
  biennially: "两年付",
  triennially: "三年付",
  lifetime: "永久",
  free: "免费",
};
export const billingCyclesEn: Record<string, string> = {
  monthly: "Monthly", quarterly: "Quarterly", semi_annually: "Semiannually",
  annually: "Annually", biennially: "Every two years", triennially: "Every three years",
  lifetime: "Lifetime", free: "Free",
};
export const monthlyCost = (n: CostNode) => {
  const rates: Record<string, number> = {
    USD: 1,
    CNY: 0.138,
    EUR: 1.08,
    GBP: 1.27,
    JPY: 0.0067,
    HKD: 0.128,
    SGD: 0.74,
    AUD: 0.65,
    CAD: 0.73,
    RUB: 0.011,
  };
  const value = Number(n.price || 0) * (rates[n.currency_code] || 1);
  return (
    (
      {
        monthly: value,
        quarterly: value / 3,
        semi_annually: value / 6,
        annually: value / 12,
        biennially: value / 24,
        triennially: value / 36,
        lifetime: 0,
        free: 0,
      } as Record<string, number>
    )[n.cycle] ?? value
  );
};
