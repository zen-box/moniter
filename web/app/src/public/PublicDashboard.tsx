import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Globe2,
  LayoutGrid,
  List,
  Monitor,
  Moon,
  RefreshCw,
  Search,
  Server,
  Sun,
  Wifi,
} from "lucide-react";
import { flag, type ServerNode } from "../lib";
import { useLiveNodes, type LiveConnection } from "./useLiveNodes";
import {
  averageLatency,
  bytes,
  countryName,
  duration,
  latency,
  number,
  price,
  ratio,
  regionName,
  renewal,
  renewalDays,
  words,
  type Language,
} from "./format";
import { MiniRing, RingGauge } from "./Gauge";
import { AnimatedNumber, prefersReducedMotion } from "./motion";
import { Segmented, SearchField, Tabs, Tag } from "./ui";

const loadDetail = () => import("./NodeDetailPage");
const NodeDetailPage = lazy(() => loadDetail().then((module) => ({ default: module.NodeDetailPage })));

type Props = {
  siteName: string;
  language: Language;
  setLanguage: (value: Language) => void;
  theme: string;
  setTheme: (value: string) => void;
  initialNodes: ServerNode[];
  renderMap: (nodes: ServerNode[], onSelect: (node: ServerNode) => void) => ReactNode;
};

function routeNode() {
  const match = location.hash.match(/^#\/nodes\/([^/?]+)/);
  try {
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export function NodeStatus({
  node,
  language,
  detailed = false,
}: {
  node: ServerNode;
  language: Language;
  detailed?: boolean;
}) {
  const online = node.status === "online";
  return (
    <span className={`mp-status ${online ? "is-online" : "is-offline"}`}>
      <i />
      {words(language, online ? "在线" : "离线", online ? "Online" : "Offline")}
      {detailed && !online && !!node.last_seen && (
        <span> · {duration(Math.max(0, Date.now() - node.last_seen) / 1000, language)}</span>
      )}
    </span>
  );
}

const latencyTone = (value: unknown) => {
  const ms = latency(value);
  if (number(value) === 999) return "is-poor";
  if (ms === null) return "";
  return ms < 100 ? "is-good" : ms < 200 ? "is-fair" : "is-poor";
};

const formatRate = (value: number) => bytes(value, true);
const formatWhole = (value: number) => String(Math.round(value));

// Cards receive a fresh object every second; only these fields affect output.
const CARD_FIELDS: (keyof ServerNode)[] = [
  "name", "region", "region_name", "region_name_en", "provider", "status", "cpu_cores", "mem_total_mb", "os_name",
  "arch", "current_cpu", "mem_used_mb", "disk_used_bytes", "disk_total_bytes", "load1", "net_in_speed_kb",
  "net_out_speed_kb", "traffic_used_bytes", "traffic_limit_gb", "monitor_enabled", "latency_ct", "latency_cu",
  "latency_cm", "tags", "billing_price", "billing_currency", "billing_cycle", "renewal_date", "uptime_secs",
];
const sameCard = (a: CardProps, b: CardProps) =>
  a.language === b.language &&
  a.index === b.index &&
  a.onOpen === b.onOpen &&
  CARD_FIELDS.every((key) => a.node[key] === b.node[key]) &&
  (a.node.status === "online" || a.node.last_seen === b.node.last_seen);

type CardProps = { node: ServerNode; language: Language; index: number; onOpen: (id: string) => void };

const NodeCard = memo(function NodeCard({ node: n, language: l, index, onOpen }: CardProps) {
  const online = n.status === "online";
  const windows = /windows/i.test(n.os_name || "");
  const cpu = online ? number(n.current_cpu) : null;
  const mem = online ? ratio(n.mem_used_mb, n.mem_total_mb) : null;
  const disk = online ? ratio(n.disk_used_bytes, n.disk_total_bytes) : null;
  const limit = number(n.traffic_limit_gb);
  const used = number(n.traffic_used_bytes);
  const share = limit && limit > 0 && used !== null ? Math.min(1, used / (limit * 1024 ** 3)) : 0;
  const days = renewalDays(n);
  const tags = (n.tags || "").split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  const gib = (mb?: number) => (mb ? mb * 1024 ** 2 : null);
  const latencyText = (v: unknown) =>
    !n.monitor_enabled
      ? words(l, "未启用", "Off")
      : !online
        ? "—"
        : number(v) === 999
          ? words(l, "超时", "Timeout")
          : latency(v) === null
            ? "—"
            : `${latency(v)!.toFixed(0)} ms`;
  return (
    <article
      className={`mp-node ${online ? "" : "is-offline"}`}
      style={{ "--i": Math.min(index, 11) } as CSSProperties}
      tabIndex={0}
      role="link"
      aria-label={n.name}
      onPointerEnter={() => void loadDetail()}
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest("button,a,input")) onOpen(n.id);
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpen(n.id);
        }
      }}
    >
      <div className="mp-node-head">
        <img className="mp-flag" src={flag(n.region)} alt="" loading="lazy" decoding="async" />
        <div className="mp-node-identity">
          <strong title={n.name}>{n.name}</strong>
          <span>{[regionName(n, l), n.provider].filter(Boolean).join(" · ")}</span>
        </div>
        <NodeStatus node={n} language={l} />
      </div>
      <div className="mp-node-meta" title={n.cpu_model}>
        {n.cpu_cores ? `${n.cpu_cores} ${words(l, "核", "vCPU")}` : "CPU —"}
        <b>·</b>
        {n.mem_total_mb ? bytes(n.mem_total_mb * 1024 ** 2) : "RAM —"}
        <b>·</b>
        <span>{n.os_name || n.arch || words(l, "等待系统信息", "Awaiting system info")}</span>
      </div>
      <div className="mp-gauges">
        <RingGauge
          value={cpu}
          label="CPU"
          caption={online && !windows && number(n.load1) !== null ? `${words(l, "负载", "Load")} ${n.load1!.toFixed(2)}` : online && n.cpu_cores ? `${n.cpu_cores} ${words(l, "核", "cores")}` : "—"}
        />
        <RingGauge
          value={mem}
          label={words(l, "内存", "Memory")}
          caption={online && n.mem_total_mb ? `${bytes(gib(n.mem_used_mb)).replace(" ", "")} / ${bytes(gib(n.mem_total_mb)).replace(" ", "")}` : "—"}
        />
        <RingGauge
          value={disk}
          label={words(l, "磁盘", "Disk")}
          warn={80}
          crit={92}
          caption={online && n.disk_total_bytes ? `${bytes(n.disk_used_bytes).replace(" ", "")} / ${bytes(n.disk_total_bytes).replace(" ", "")}` : "—"}
        />
      </div>
      <div className="mp-node-speeds">
        <div className="is-up">
          <ArrowUp size={13} />
          <span>{words(l, "上传", "Upload")}</span>
          <strong>{online ? bytes((number(n.net_out_speed_kb) ?? 0) * 1024, true) : "—"}</strong>
        </div>
        <div className="is-down">
          <ArrowDown size={13} />
          <span>{words(l, "下载", "Download")}</span>
          <strong>{online ? bytes((number(n.net_in_speed_kb) ?? 0) * 1024, true) : "—"}</strong>
        </div>
      </div>
      <div className="mp-traffic">
        <div>
          <span>{words(l, "本期流量", "Cycle traffic")}</span>
          <strong>
            {bytes(used)}
            <small> / {limit && limit > 0 ? bytes(limit * 1024 ** 3) : words(l, "未设限额", "No quota")}</small>
          </strong>
        </div>
        <div className={`mp-bar ${share >= 0.9 ? "is-crit" : share >= 0.75 ? "is-warn" : ""}`}>
          <i style={{ transform: `scaleX(${share})` }} />
        </div>
      </div>
      <div className="mp-node-latency" title={words(l, "上海电信、联通、移动 TCP 80 端口基准", "TCP port 80 reference endpoints on the three Shanghai carrier networks")}>
        {[
          [words(l, "电信", "CT"), n.latency_ct],
          [words(l, "联通", "CU"), n.latency_cu],
          [words(l, "移动", "CM"), n.latency_cm],
        ].map(([label, v]) => (
          <div key={String(label)} className={online && n.monitor_enabled ? latencyTone(v) : ""}>
            <span>{label}</span>
            <strong>{latencyText(v)}</strong>
          </div>
        ))}
      </div>
      {!!tags.length && (
        <div className="mp-node-tags">
          {tags.slice(0, 3).map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
          {tags.length > 3 && <small>+{tags.length - 3}</small>}
        </div>
      )}
      <div className="mp-node-footer">
        <div>
          <strong>{price(n, l)}</strong>
          <span>
            {online ? `${words(l, "已运行", "Up")} ${duration(n.uptime_secs, l)}` : <NodeStatus node={n} language={l} detailed />}
          </span>
        </div>
        <div className={`mp-node-expiry ${days !== null && days < 0 ? "is-overdue" : days !== null && days <= 7 ? "is-soon" : ""}`}>
          <span>{words(l, "到期", "Renewal")}</span>
          <strong>
            {renewal(n, l)}
            <ChevronRight size={14} />
          </strong>
        </div>
      </div>
    </article>
  );
}, sameCard);

const NodeRow = memo(function NodeRow({ node: n, language: l, onOpen }: CardProps) {
  const online = n.status === "online";
  const average = averageLatency(n);
  return (
    <tr onClick={() => onOpen(n.id)} onPointerEnter={() => void loadDetail()}>
      <td>
        <button className="mp-list-identity" type="button" onClick={(event) => { event.stopPropagation(); onOpen(n.id); }}>
          <img className="mp-flag" src={flag(n.region)} alt="" loading="lazy" decoding="async" />
          <span>
            <strong>{n.name}</strong>
            <small>{regionName(n, l)} · {n.provider}</small>
            <NodeStatus node={n} language={l} detailed />
          </span>
        </button>
      </td>
      <td><MiniRing value={online ? number(n.current_cpu) : null} label="CPU" /></td>
      <td><MiniRing value={online ? ratio(n.mem_used_mb, n.mem_total_mb) : null} label={words(l, "内存", "Memory")} /></td>
      <td><MiniRing value={online ? ratio(n.disk_used_bytes, n.disk_total_bytes) : null} label={words(l, "磁盘", "Disk")} warn={80} crit={92} /></td>
      <td>
        <span className="mp-text-blue">↑ {online ? bytes((number(n.net_out_speed_kb) ?? 0) * 1024, true) : "—"}</span>
        <small className="mp-text-success">↓ {online ? bytes((number(n.net_in_speed_kb) ?? 0) * 1024, true) : "—"}</small>
      </td>
      <td>{bytes(n.traffic_used_bytes)}</td>
      <td className={latencyTone(average)}>{average === null ? "—" : `${average.toFixed(0)} ms`}</td>
      <td>
        {price(n, l)}
        <small>{renewal(n, l)}</small>
      </td>
      <td aria-hidden="true"><ChevronRight size={16} /></td>
    </tr>
  );
}, sameCard);

function LiveBadge({ connection, language: l }: { connection: LiveConnection; language: Language }) {
  const label = {
    live: words(l, "实时", "Live"),
    connecting: words(l, "连接中", "Connecting"),
    reconnecting: words(l, "重连中", "Reconnecting"),
    paused: words(l, "已暂停", "Paused"),
  }[connection];
  return (
    <span className={`mp-live is-${connection}`} role="status" title={label}>
      <i />
      <span>{label}</span>
    </span>
  );
}

let savedScroll = 0;
let openedFromList = false;

export function PublicDashboard({
  siteName,
  language: l,
  setLanguage,
  theme,
  setTheme,
  initialNodes,
  renderMap,
}: Props) {
  const { nodes, loaded, error, refreshing, connection, refresh: load } = useLiveNodes(initialNodes);
  const [nodeId, setNodeId] = useState(routeNode);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [region, setRegion] = useState("all");
  const [status, setStatus] = useState<"all" | "online" | "offline">("all");
  const [view, setView] = useState<"cards" | "list">(() =>
    localStorage.getItem("moniter_public_view") === "list" ? "list" : "cards",
  );
  const [tab, setTab] = useState<"nodes" | "map">("nodes");
  const restore = useRef(false);
  useEffect(() => {
    // The list restores its own scroll position when returning from a node.
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    let current = routeNode();
    const change = () => {
      const next = routeNode();
      if (next && !current) savedScroll = window.scrollY;
      restore.current = !next && !!current;
      current = next;
      setNodeId(next);
      if (next) window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useLayoutEffect(() => {
    if (!nodeId && restore.current) {
      restore.current = false;
      window.scrollTo({ top: savedScroll });
    }
  }, [nodeId]);
  useEffect(() => {
    // Warm the detail view so opening a node never shows a loading state.
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const handle = idle ? idle(() => void loadDetail()) : window.setTimeout(() => void loadDetail(), 1500);
    return () => {
      if (!idle) window.clearTimeout(handle);
    };
  }, []);
  const openNode = useCallback((id: string) => {
    openedFromList = true;
    location.hash = `/nodes/${encodeURIComponent(id)}`;
  }, []);
  const openNodeObject = useCallback((node: ServerNode) => openNode(node.id), [openNode]);
  const back = useCallback(() => {
    // Step back through history when the list opened this node, so the
    // browser's back button and ours stay in sync; deep links go to the list.
    if (openedFromList) {
      openedFromList = false;
      history.back();
    } else location.hash = "/";
  }, []);
  const changeTheme = (value: string) => {
    const apply = () => flushSync(() => setTheme(value));
    const transition = (document as Document & { startViewTransition?: (callback: () => void) => unknown }).startViewTransition;
    if (transition && !prefersReducedMotion()) transition.call(document, apply);
    else apply();
  };
  const online = useMemo(() => nodes.filter((n) => n.status === "online"), [nodes]);
  const countries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) if (node.region) counts.set(node.region, (counts.get(node.region) || 0) + 1);
    return [...counts.entries()]
      .map(([code, count]) => ({ code, count, name: countryName(code, l) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, l));
  }, [nodes, l]);
  const visible = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    return nodes.filter(
      (n) =>
        (region === "all" || n.region === region) &&
        (status === "all" || n.status === status) &&
        (!needle ||
          `${n.name} ${regionName(n, l)} ${n.provider} ${n.ipv4 || ""} ${n.ipv6 || ""} ${n.tags || ""}`
            .toLowerCase()
            .includes(needle)),
    );
  }, [nodes, region, status, deferredQuery, l]);
  const selected = nodes.find((n) => n.id === nodeId);
  const totals = useMemo(() => {
    let up = 0,
      down = 0;
    for (const n of online) {
      up += (number(n.net_out_speed_kb) || 0) * 1024;
      down += (number(n.net_in_speed_kb) || 0) * 1024;
    }
    const latencies = online.map(averageLatency).filter((v): v is number => v !== null);
    return { up, down, latency: latencies.length ? latencies.reduce((s, v) => s + v, 0) / latencies.length : null };
  }, [online]);
  const offline = nodes.length - online.length;
  const filtering = !!query || region !== "all" || status !== "all";
  const stale = deferredQuery !== query;
  return (
    <div className="mp-app">
      <header className="mp-header">
        <div className="mp-header-inner">
          <a href="#/" className="mp-brand" aria-label={siteName}>
            <span>
              <Server size={19} />
            </span>
            <strong>{siteName}</strong>
          </a>
          <div className="mp-header-actions">
            <LiveBadge connection={connection} language={l} />
            <button
              type="button"
              className={`mp-icon-button ${refreshing ? "is-spinning" : ""}`}
              aria-label={words(l, "刷新数据", "Refresh data")}
              title={words(l, "刷新数据", "Refresh data")}
              onClick={() => void load(true)}
            >
              <RefreshCw size={16} />
            </button>
            <button type="button" className="mp-text-button" onClick={() => setLanguage(l === "zh" ? "en" : "zh")}>
              <Globe2 size={15} />
              {l === "zh" ? "EN" : "中文"}
            </button>
            <Segmented
              className="mp-theme-toggle"
              label={words(l, "颜色主题", "Color theme")}
              value={theme as "system" | "light" | "dark"}
              onChange={changeTheme}
              options={[
                { value: "system", label: <Monitor size={14} />, title: words(l, "跟随系统", "System") },
                { value: "light", label: <Sun size={14} />, title: words(l, "浅色", "Light") },
                { value: "dark", label: <Moon size={14} />, title: words(l, "深色", "Dark") },
              ]}
            />
          </div>
        </div>
      </header>
      <main className="mp-main">
        {error && (
          <div className="mp-notice mp-notice-warning" role="alert">
            {words(l, "暂时无法更新数据，正在显示上次结果。", "Unable to refresh. Showing the last available data.")}
            <button type="button" className="mp-text-button" onClick={() => void load(true)}>
              {words(l, "重试", "Retry")}
            </button>
          </div>
        )}
        {nodeId ? (
          selected ? (
            <Suspense fallback={<div className="mp-detail-placeholder" />}>
              <NodeDetailPage key={selected.id} node={selected} language={l} onBack={back} />
            </Suspense>
          ) : (
            <section className="mp-empty mp-view-enter">
              <Server size={32} />
              <h2>{loaded ? words(l, "未找到这个节点", "Node not found") : words(l, "正在获取节点", "Loading node")}</h2>
              <button type="button" className="mp-button" onClick={back}>
                {words(l, "返回节点列表", "Back to nodes")}
              </button>
            </section>
          )
        ) : (
          <div className="mp-view-enter">
            <div className="mp-page-heading">
              <div>
                <span className="mp-eyebrow">{words(l, "基础设施监控", "Infrastructure monitoring")}</span>
                <h1>{words(l, "节点总览", "Your infrastructure")}</h1>
              </div>
            </div>
            <section className="mp-summary" aria-label={words(l, "节点概况", "Infrastructure summary")}>
              <div>
                <span className="mp-summary-icon"><Server size={18} /></span>
                <div>
                  <small>{words(l, "节点状态", "Node status")}</small>
                  <strong>
                    <AnimatedNumber value={online.length} format={formatWhole} />
                    <small> / {nodes.length}</small>
                  </strong>
                  <em className={offline ? "mp-text-danger" : "mp-text-success"}>
                    {offline ? words(l, `${offline} 台离线`, `${offline} offline`) : words(l, "全部在线", "All online")}
                  </em>
                </div>
              </div>
              <div>
                <span className="mp-summary-icon purple"><Globe2 size={18} /></span>
                <div>
                  <small>{words(l, "国家 / 地区", "Countries / regions")}</small>
                  <strong>
                    {countries.length}
                    <small>{words(l, " 个地区", " regions")}</small>
                  </strong>
                </div>
              </div>
              <div>
                <span className="mp-summary-icon green"><ArrowDown size={18} /></span>
                <div>
                  <small>{words(l, "当前总网速", "Current network")}</small>
                  <strong className="mp-summary-network">
                    <i className="is-up">↑</i>
                    {online.length ? <AnimatedNumber value={totals.up} format={formatRate} /> : "—"}
                    <i className="is-down">↓</i>
                    {online.length ? <AnimatedNumber value={totals.down} format={formatRate} /> : "—"}
                  </strong>
                </div>
              </div>
              <div>
                <span className="mp-summary-icon amber"><Wifi size={18} /></span>
                <div>
                  <small>{words(l, "三网平均延迟", "Average carrier latency")}</small>
                  <strong>
                    {totals.latency === null ? "—" : <AnimatedNumber value={totals.latency} format={formatWhole} />}
                    {totals.latency !== null && <small> ms</small>}
                  </strong>
                </div>
              </div>
            </section>
            <section className="mp-node-section">
              <div className="mp-section-toolbar">
                <Tabs
                  label={words(l, "查看方式", "Dashboard section")}
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: "nodes", label: <><Server size={15} />{words(l, "全部节点", "Nodes")}</>, count: nodes.length },
                    { value: "map", label: <><Globe2 size={15} />{words(l, "全球分布", "World map")}</> },
                  ]}
                />
                <Segmented
                  label={words(l, "列表布局", "Node layout")}
                  value={view}
                  onChange={(value) => {
                    setView(value);
                    setTab("nodes");
                    localStorage.setItem("moniter_public_view", value);
                  }}
                  options={[
                    { value: "cards", label: <LayoutGrid size={15} />, title: words(l, "卡片视图", "Card view") },
                    { value: "list", label: <List size={15} />, title: words(l, "列表视图", "List view") },
                  ]}
                />
              </div>
              <div className="mp-filters">
                <SearchField
                  shortcut
                  value={query}
                  onChange={setQuery}
                  label={words(l, "搜索节点", "Search nodes")}
                  clearLabel={words(l, "清除搜索", "Clear search")}
                  placeholder={words(l, "搜索名称、IP、厂商或标签", "Search name, IP, provider or tag")}
                />
                <Segmented
                  label={words(l, "节点状态", "Node status")}
                  value={status}
                  onChange={setStatus}
                  options={[
                    { value: "all", label: words(l, "全部", "All"), count: nodes.length },
                    { value: "online", label: words(l, "在线", "Online"), count: online.length },
                    { value: "offline", label: words(l, "离线", "Offline"), count: offline },
                  ]}
                />
              </div>
              {countries.length > 1 && (
                <div className="mp-region-chips" role="group" aria-label={words(l, "国家 / 地区", "Country / region")}>
                  <button type="button" aria-pressed={region === "all"} onClick={() => setRegion("all")}>
                    {words(l, "全部地区", "All regions")}
                  </button>
                  {countries.map((c) => (
                    <button key={c.code} type="button" aria-pressed={region === c.code} onClick={() => setRegion(region === c.code ? "all" : c.code)}>
                      <img src={flag(c.code)} alt="" loading="lazy" decoding="async" />
                      {c.name}
                      <b>{c.count}</b>
                    </button>
                  ))}
                </div>
              )}
              {filtering && (
                <div className="mp-filter-result" aria-live="polite">
                  <span>{words(l, `找到 ${visible.length} / ${nodes.length} 个节点`, `${visible.length} of ${nodes.length} nodes`)}</span>
                  <button type="button" className="mp-text-button" onClick={() => { setQuery(""); setRegion("all"); setStatus("all"); }}>
                    {words(l, "清除筛选", "Clear filters")}
                  </button>
                </div>
              )}
              <div className={`mp-results ${stale ? "is-stale" : ""}`} key={tab === "map" ? "map" : view}>
                {tab === "map" ? (
                  <div className="mp-map-layout">
                    {renderMap(visible, openNodeObject)}
                    <div className="mp-map-list">
                      {visible.map((n) => (
                        <button key={n.id} type="button" onClick={() => openNode(n.id)}>
                          <img className="mp-filter-flag" src={flag(n.region)} alt="" loading="lazy" />
                          <strong>{n.name}</strong>
                          <NodeStatus node={n} language={l} />
                          <ChevronRight size={15} />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : view === "cards" ? (
                  <div className="mp-node-grid">
                    {visible.map((n, index) => (
                      <NodeCard key={n.id} node={n} language={l} index={index} onOpen={openNode} />
                    ))}
                  </div>
                ) : (
                  <div className="mp-table-scroll">
                    <table className="mp-table">
                      <thead>
                        <tr>
                          {[
                            words(l, "节点", "Node"),
                            "CPU",
                            words(l, "内存", "Memory"),
                            words(l, "磁盘", "Disk"),
                            words(l, "上传 / 下载", "Upload / download"),
                            words(l, "本期流量", "Cycle traffic"),
                            words(l, "三网延迟", "Carrier latency"),
                            words(l, "价格 / 到期", "Price / renewal"),
                            "",
                          ].map((s, i) => (
                            <th key={i}>{s}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((n, index) => (
                          <NodeRow key={n.id} node={n} language={l} index={index} onOpen={openNode} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              {loaded && !visible.length && (
                <div className="mp-empty">
                  <Search size={30} />
                  <h3>{words(l, nodes.length ? "没有符合条件的节点" : "还没有节点", nodes.length ? "No matching nodes" : "No nodes yet")}</h3>
                  <p>
                    {words(
                      l,
                      nodes.length ? "试试其他关键词，或清除筛选条件。" : "添加节点并连接后，监控信息将显示在这里。",
                      nodes.length ? "Try another search or clear your filters." : "Add a node and connect it to see monitoring data here.",
                    )}
                  </p>
                </div>
              )}
              {!loaded && (
                <div className="mp-node-grid" aria-hidden="true">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="mp-node-skeleton" />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
        <footer className="mp-footer">
          <span>{siteName}</span>
        </footer>
      </main>
    </div>
  );
}
