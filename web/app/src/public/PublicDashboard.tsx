import {
  lazy, Suspense,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Button,
  Chip,
  Input,
  Select,
  SelectItem,
  Tab,
  Tabs,
} from "@heroui/react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
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
  X,
} from "lucide-react";
import { flag, type ServerNode } from "../lib";
import { useLiveNodes } from "./useLiveNodes";
import {
  averageLatency,
  bytes,
  duration,
  latency,
  number,
  percent,
  price,
  ratio,
  regionName,
  countryName,
  renewal,
  words,
  type Language,
} from "./format";
const NodeDetailPage=lazy(()=>import("./NodeDetailPage").then(module=>({default:module.NodeDetailPage})));

type Props = {
  siteName: string;
  language: Language;
  setLanguage: (value: Language) => void;
  theme: string;
  setTheme: (value: string) => void;
  initialNodes: ServerNode[];
  renderMap: (
    nodes: ServerNode[],
    onSelect: (node: ServerNode) => void,
  ) => ReactNode;
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
        <span>
          {" "}
          ·{" "}
          {duration(Math.max(0, Date.now() - node.last_seen) / 1000, language)}
        </span>
      )}
    </span>
  );
}

function ResourceMeter({
  label,
  value,
  caption,
  tone = "blue",
}: {
  label: string;
  value: number | null;
  caption?: string;
  tone?: string;
}) {
  return (
    <div className="mp-resource">
      <div>
        <span>{label}</span>
        <strong>{percent(value)}</strong>
      </div>
      <div
        className={`mp-meter ${tone}`}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={
          value === null ? undefined : Math.min(100, Math.max(0, value))
        }
        aria-valuetext={value === null ? "—" : percent(value)}
      >
        <i
          style={{
            width: `${value === null ? 0 : Math.max(0, Math.min(100, value))}%`,
          }}
        />
      </div>
      <small>{caption || "\u00a0"}</small>
    </div>
  );
}

function NodeCard({
  node: n,
  language: l,
  onSelect,
}: {
  node: ServerNode;
  language: Language;
  onSelect: () => void;
}) {
  const online = n.status === "online";
  const mem = online ? ratio(n.mem_used_mb, n.mem_total_mb) : null;
  const disk = online ? ratio(n.disk_used_bytes, n.disk_total_bytes) : null;
  const cpu = online ? number(n.current_cpu) : null;
  const limit = number(n.traffic_limit_gb);
  const used = number(n.traffic_used_bytes);
  const tags = (n.tags || "")
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const latencyText = (v: unknown) =>
    !n.monitor_enabled
      ? words(l, "未启用", "Disabled")
      : !online
        ? "—"
        : number(v) === 999
          ? words(l, "超时", "Timeout")
          : latency(v) === null
            ? "—"
            : `${latency(v)!.toFixed(0)} ms`;
  return (
    <article className={`mp-node ${online ? "" : "mp-node-offline"}`} tabIndex={0} role="link" aria-label={n.name} onClick={event=>{if(!(event.target as HTMLElement).closest("button,a,input"))onSelect()}} onKeyDown={event=>{if(event.target===event.currentTarget && (event.key==="Enter"||event.key===" ")){event.preventDefault();onSelect()}}}>
      <div className="mp-node-head">
        <img className="mp-flag" src={flag(n.region)} alt={regionName(n, l)} />
        <div className="mp-node-identity">
          <button className="mp-node-link" onClick={onSelect}>
            <span title={n.name}>{n.name}</span>
            <ArrowUpRight size={15} />
          </button>
          <span>
            {[regionName(n, l), n.provider].filter(Boolean).join(" · ")}
          </span>
        </div>
        <NodeStatus node={n} language={l} />
      </div>
      <div className="mp-node-meta">
        <span title={n.cpu_model}>
          {n.cpu_cores ? `${n.cpu_cores} ${words(l, "核", "vCPU")}` : "CPU —"}
          <b>·</b>
          {online && n.mem_total_mb
            ? bytes(n.mem_total_mb * 1024 ** 2)
            : "RAM —"}
          <b>·</b>
          {n.os_name ||
            n.arch ||
            words(l, "等待系统信息", "Awaiting system info")}
        </span>
      </div>
      <div className="mp-resources">
        <ResourceMeter
          label="CPU"
          value={cpu}
          caption={
            online && !/windows/i.test(n.os_name||"") && number(n.load1) !== null
              ? `${words(l, "负载", "Load")} ${n.load1!.toFixed(2)}`
              : "—"
          }
        />
        <ResourceMeter
          label={words(l, "内存", "Memory")}
          value={mem}
          tone="purple"
          caption={
            online
              ? bytes(
                  number(n.mem_used_mb) === null
                    ? null
                    : n.mem_used_mb! * 1024 ** 2,
                )
              : "—"
          }
        />
        <ResourceMeter
          label={words(l, "磁盘", "Disk")}
          value={disk}
          tone="amber"
          caption={online ? bytes(n.disk_used_bytes) : "—"}
        />
      </div>
      <div className="mp-node-speeds">
        <div>
          <ArrowUp size={14} />
          <span>{words(l, "上传", "Upload")}</span>
          <strong>
            {online
              ? bytes(
                  number(n.net_out_speed_kb) === null
                    ? null
                    : n.net_out_speed_kb! * 1024,
                  true,
                )
              : "—"}
          </strong>
        </div>
        <div>
          <ArrowDown size={14} />
          <span>{words(l, "下载", "Download")}</span>
          <strong>
            {online
              ? bytes(
                  number(n.net_in_speed_kb) === null
                    ? null
                    : n.net_in_speed_kb! * 1024,
                  true,
                )
              : "—"}
          </strong>
        </div>
      </div>
      <div className="mp-traffic">
        <div>
          <span>{words(l, "本期流量", "Cycle traffic")}</span>
          <strong>
            {bytes(used)}
            <small>
              {" "}
              /{" "}
              {limit && limit > 0
                ? bytes(limit * 1024 ** 3)
                : words(l, "未设限额", "No quota set")}
            </small>
          </strong>
        </div>
        <div className="mp-meter subtle">
          <i
            style={{
              width: `${limit && used !== null ? Math.min(100, (used / (limit * 1024 ** 3)) * 100) : 0}%`,
            }}
          />
        </div>
      </div>
      <div
        className="mp-node-latency"
        aria-label={words(l, "上海三网 TCP 基准", "Shanghai carrier TCP reference")} title={words(l,"上海电信、联通、移动 TCP 80 端口基准","TCP port 80 reference endpoints on the three Shanghai carrier networks")}
      >
        {[
          [words(l, "电信", "CT"), n.latency_ct],
          [words(l, "联通", "CU"), n.latency_cu],
          [words(l, "移动", "CM"), n.latency_cm],
        ].map(([label, v]) => (
          <div key={String(label)}>
            <span>{label}</span>
            <strong>{latencyText(v)}</strong>
          </div>
        ))}
      </div>
      {!!tags.length && (
        <div className="mp-node-tags">
          {tags.slice(0, 3).map((tag) => (
            <Chip key={tag} size="sm" variant="flat">
              {tag}
            </Chip>
          ))}
          {tags.length > 3 && <small>+{tags.length - 3}</small>}
        </div>
      )}
      <div className="mp-node-footer">
        <div>
          <strong>{price(n, l)}</strong>
          <span>
            {online ? (
              `${words(l, "系统运行", "System uptime")} ${duration(n.uptime_secs, l)}`
            ) : (
              <NodeStatus node={n} language={l} detailed />
            )}
          </span>
        </div>
        <button
          onClick={onSelect}
          className="mp-node-expiry"
          title={words(l, "查看详情", "View details")}
        >
          <span>{words(l, "到期", "Renewal")}</span>
          <strong>
            {renewal(n, l)}
            <ChevronRight size={14} />
          </strong>
        </button>
      </div>
    </article>
  );
}

export function PublicDashboard({
  siteName,
  language: l,
  setLanguage,
  theme,
  setTheme,
  initialNodes,
  renderMap,
}: Props) {
  const { nodes, loaded, error, refreshing, refresh: load } = useLiveNodes(initialNodes);
  const [nodeId, setNodeId] = useState(routeNode);
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("all");
  const [status, setStatus] = useState("all");
  const [view, setView] = useState(() =>
    localStorage.getItem("moniter_public_view") === "list" ? "list" : "cards",
  );
  const [tab, setTab] = useState("nodes");
  useEffect(() => {
    const change = () => {
      setNodeId(routeNode());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const openNode = (node: ServerNode) => {
    location.hash = `/nodes/${encodeURIComponent(node.id)}`;
  };
  const back = () => {
    location.hash = "/";
  };
  const online = nodes.filter((n) => n.status === "online");
  const countries = useMemo(
    () =>
      [...new Set(nodes.map((n) => n.region).filter(Boolean))]
        .map((code) => ({
          code,
          node: nodes.find((n) => n.region === code)!,
          count: nodes.filter((n) => n.region === code).length,
        }))
        .sort((a, b) =>
          regionName(a.node, l).localeCompare(regionName(b.node, l), l),
        ),
    [nodes, l],
  );
  const visible = useMemo(
    () =>
      nodes.filter(
        (n) =>
          (region === "all" || n.region === region) &&
          (status === "all" || n.status === status) &&
          (!query.trim() ||
            `${n.name} ${regionName(n, l)} ${n.provider} ${n.ipv4 || ""} ${n.ipv6 || ""} ${n.tags || ""}`
              .toLowerCase()
              .includes(query.trim().toLowerCase())),
      ),
    [nodes, region, status, query, l],
  );
  const selected = nodes.find((n) => n.id === nodeId);
  const totalIn = online.reduce(
    (s, n) => s + (number(n.net_in_speed_kb) || 0) * 1024,
    0,
  );
  const totalOut = online.reduce(
    (s, n) => s + (number(n.net_out_speed_kb) || 0) * 1024,
    0,
  );
  const latencies = online
    .map(averageLatency)
    .filter((v): v is number => v !== null);
  return (
    <div className="mp-app">
      <header className="mp-header">
        <div className="mp-header-inner">
          <a href="/#/" className="mp-brand" aria-label={siteName}>
            <span>
              <Server size={20} />
            </span>
            <strong>{siteName}</strong>
          </a>
          <div className="mp-header-actions">
            <Button
              isIconOnly
              variant="light"
              aria-label={words(l, "刷新数据", "Refresh data")}
              isLoading={refreshing}
              onPress={() => void load(true)}
            >
              <RefreshCw size={17} />
            </Button>
            <Button
              variant="light"
              size="sm"
              onPress={() => setLanguage(l === "zh" ? "en" : "zh")}
              startContent={<Globe2 size={15} />}
            >
              {l === "zh" ? "EN" : "中文"}
            </Button>
            <Select
              className="mp-theme"
              classNames={{ popoverContent: "mp-theme-menu" }}
              popoverProps={{ placement: "bottom-end", style: { minWidth: 160 } }}
              size="sm"
              aria-label={words(l, "颜色主题", "Color theme")}
              disallowEmptySelection
              selectedKeys={[theme]}
              onSelectionChange={(keys) => {
                const value = [...keys][0];
                if (value) setTheme(String(value));
              }}
              startContent={
                theme === "dark" ? (
                  <Moon size={15} />
                ) : theme === "light" ? (
                  <Sun size={15} />
                ) : (
                  <Monitor size={15} />
                )
              }
            >
              <SelectItem key="system">
                {words(l, "跟随系统", "System")}
              </SelectItem>
              <SelectItem key="light">{words(l, "浅色", "Light")}</SelectItem>
              <SelectItem key="dark">{words(l, "深色", "Dark")}</SelectItem>
            </Select>
          </div>
        </div>
      </header>
      <main className="mp-main">
        {error && (
          <div className="mp-notice mp-notice-warning" role="alert">
            {words(
              l,
              "暂时无法更新数据，正在显示上次结果。",
              "Unable to refresh. Showing the last available data.",
            )}
            <Button size="sm" variant="light" onPress={() => void load(true)}>
              {words(l, "重试", "Retry")}
            </Button>
          </div>
        )}
        {nodeId ? (
          selected ? (
            <Suspense fallback={<div className="mp-history-loading">{words(l,"加载节点详情…","Loading node details…")}</div>}><NodeDetailPage
              key={selected.id}
              node={selected}
              language={l}
              onBack={back}
            /></Suspense>
          ) : (
            <section className="mp-empty">
              <Server size={32} />
              <h2>
                {loaded
                  ? words(l, "未找到这个节点", "Node not found")
                  : words(l, "正在获取节点", "Loading node")}
              </h2>
              <Button onPress={back} variant="flat">
                {words(l, "返回节点列表", "Back to nodes")}
              </Button>
            </section>
          )
        ) : (
          <>
            <div className="mp-page-heading">
              <div>
                <span className="mp-eyebrow">
                  {words(l, "基础设施监控", "INFRASTRUCTURE MONITORING")}
                </span>
                <h1>{words(l, "节点总览", "Your infrastructure")}</h1>
                <p>
                  {words(
                    l,
                    "资源、网络与服务状态，一目了然。",
                    "A clear view of your resources, network and service health.",
                  )}
                </p>
              </div>
            </div>
            <section
              className="mp-summary"
              aria-label={words(l, "节点概况", "Infrastructure summary")}
            >
              <div>
                <span className="mp-summary-icon">
                  <Server size={18} />
                </span>
                <div>
                  <small>{words(l, "节点状态", "Node status")}</small>
                  <strong>
                    {online.length}
                    <span> / {nodes.length}</span>
                  </strong>
                  <em
                    className={
                      nodes.length - online.length
                        ? "mp-text-danger"
                        : "mp-text-success"
                    }
                  >
                    {nodes.length - online.length
                      ? words(
                          l,
                          `${nodes.length - online.length} 台离线`,
                          `${nodes.length - online.length} offline`,
                        )
                      : words(l, "全部在线", "All online")}
                  </em>
                </div>
              </div>
              <div>
                <span className="mp-summary-icon purple">
                  <Globe2 size={18} />
                </span>
                <div>
                  <small>
                    {words(l, "国家 / 地区", "Countries / regions")}
                  </small>
                  <strong>
                    {countries.length}
                    <span>{words(l, " 个地区", " regions")}</span>
                  </strong>
                </div>
              </div>
              <div>
                <span className="mp-summary-icon green">
                  <ArrowDown size={18} />
                </span>
                <div>
                  <small>{words(l, "当前总网速", "Current network")}</small>
                  <strong className="mp-summary-network">
                    <span>↑</span>
                    {online.length ? bytes(totalOut, true) : "—"}
                    <span>↓</span>
                    {online.length ? bytes(totalIn, true) : "—"}
                  </strong>
                </div>
              </div>
              <div>
                <span className="mp-summary-icon amber">
                  <Wifi size={18} />
                </span>
                <div>
                  <small>
                    {words(l, "三网平均延迟", "Average carrier latency")}
                  </small>
                  <strong>
                    {latencies.length
                      ? (
                          latencies.reduce((s, v) => s + v, 0) /
                          latencies.length
                        ).toFixed(0)
                      : "—"}
                    {latencies.length > 0 && <span> ms</span>}
                  </strong>
                </div>
              </div>
            </section>
            <section className="mp-node-section">
              <div className="mp-section-toolbar">
                <Tabs
                  aria-label={words(l, "查看方式", "Dashboard section")}
                  selectedKey={tab}
                  onSelectionChange={(k) => setTab(String(k))}
                  variant="underlined"
                  classNames={{
                    tabList: "mp-main-tabs",
                    cursor: "mp-tab-cursor",
                  }}
                >
                  <Tab
                    key="nodes"
                    title={
                      <span className="mp-tab-label">
                        <Server size={16} />
                        {words(l, "全部节点", "Nodes")}
                        <b>{nodes.length}</b>
                      </span>
                    }
                  />
                  <Tab
                    key="map"
                    title={
                      <span className="mp-tab-label">
                        <Globe2 size={16} />
                        {words(l, "全球分布", "World map")}
                      </span>
                    }
                  />
                </Tabs>
                <div
                  className="mp-view-toggle"
                  role="group"
                  aria-label={words(l, "列表布局", "Node layout")}
                >
                  {[
                    ["cards", LayoutGrid, words(l, "卡片视图", "Card view")],
                    ["list", List, words(l, "列表视图", "List view")],
                  ].map(([key, Icon, label]) => {
                    const I = Icon as typeof List;
                    return (
                      <Button
                        key={String(key)}
                        isIconOnly
                        size="sm"
                        variant={view === key ? "flat" : "light"}
                        aria-label={String(label)}
                        aria-pressed={view === key}
                        onPress={() => {
                          setView(String(key));
                          setTab("nodes");
                          localStorage.setItem(
                            "moniter_public_view",
                            String(key),
                          );
                        }}
                      >
                        <I size={16} />
                      </Button>
                    );
                  })}
                </div>
              </div>
              <div className="mp-filters">
                <Input
                  className="mp-search"
                  aria-label={words(l, "搜索节点", "Search nodes")}
                  placeholder={words(
                    l,
                    "搜索名称、IP、厂商或标签…",
                    "Search name, IP, provider or tag…",
                  )}
                  startContent={<Search size={17} />}
                  value={query}
                  onValueChange={setQuery}
                  isClearable
                  onClear={() => setQuery("")}
                />
                <Select
                  aria-label={words(l, "国家 / 地区", "Country / region")}
                  className="mp-filter-select"
                  selectedKeys={[region]}
                  disallowEmptySelection
                  onSelectionChange={(keys) =>
                    setRegion(String([...keys][0] || "all"))
                  }
                >
                  {[
                    <SelectItem key="all">
                      {words(l, "全部地区", "All regions")}
                    </SelectItem>,
                    ...countries.map((c) => (
                      <SelectItem
                        key={c.code}
                        textValue={`${countryName(c.node.region, l)} (${c.count})`}
                        startContent={
                          <img
                            className="mp-filter-flag"
                            src={flag(c.code)}
                            alt=""
                          />
                        }
                      >
                        {countryName(c.node.region, l)} ({c.count})
                      </SelectItem>
                    )),
                  ]}
                </Select>
                <Select
                  aria-label={words(l, "节点状态", "Node status")}
                  className="mp-status-select"
                  selectedKeys={[status]}
                  disallowEmptySelection
                  onSelectionChange={(keys) =>
                    setStatus(String([...keys][0] || "all"))
                  }
                >
                  <SelectItem key="all">
                    {words(l, "全部状态", "All statuses")}
                  </SelectItem>
                  <SelectItem key="online">
                    {words(l, "在线", "Online")} ({online.length})
                  </SelectItem>
                  <SelectItem key="offline">
                    {words(l, "离线", "Offline")} (
                    {nodes.length - online.length})
                  </SelectItem>
                </Select>
              </div>
              {(query || region !== "all" || status !== "all") && (
                <div className="mp-filter-result">
                  <span>
                    {words(
                      l,
                      `找到 ${visible.length} / ${nodes.length} 个节点`,
                      `${visible.length} of ${nodes.length} nodes`,
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant="light"
                    onPress={() => {
                      setQuery("");
                      setRegion("all");
                      setStatus("all");
                    }}
                    endContent={<X size={13} />}
                  >
                    {words(l, "清除筛选", "Clear filters")}
                  </Button>
                </div>
              )}
              {tab === "map" ? (
                <div className="mp-map-layout">
                  {renderMap(visible, openNode)}
                  <div className="mp-map-list">
                    {visible.map((n) => (
                      <button key={n.id} onClick={() => openNode(n)}>
                        <img
                          className="mp-filter-flag"
                          src={flag(n.region)}
                          alt=""
                        />
                        <strong>{n.name}</strong>
                        <NodeStatus node={n} language={l} />
                        <ChevronRight size={15} />
                      </button>
                    ))}
                  </div>
                </div>
              ) : view === "cards" ? (
                <div className="mp-node-grid">
                  {visible.map((n) => (
                    <NodeCard
                      key={n.id}
                      node={n}
                      language={l}
                      onSelect={() => openNode(n)}
                    />
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
                          words(l, "内存 / 磁盘", "Memory / disk"),
                          words(l, "上传 / 下载", "Upload / download"),
                          words(l, "本期流量", "Cycle traffic"),
                          words(l, "三网平均延迟", "Carrier latency"),
                          words(l, "价格 / 到期", "Price / renewal"),
                          "",
                        ].map((s, i) => (
                          <th key={i}>{s}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((n) => {
                        const isOnline = n.status === "online";
                        return (
                          <tr key={n.id}>
                            <td>
                              <button
                                className="mp-list-identity"
                                onClick={() => openNode(n)}
                              >
                                <img
                                  className="mp-flag"
                                  src={flag(n.region)}
                                  alt=""
                                />
                                <span>
                                  <strong>{n.name}</strong>
                                  <small>
                                    {regionName(n, l)} · {n.provider}
                                  </small>
                                  <NodeStatus node={n} language={l} detailed />
                                </span>
                              </button>
                            </td>
                            <td>
                              {isOnline ? percent(number(n.current_cpu)) : "—"}
                            </td>
                            <td>
                              {isOnline
                                ? percent(ratio(n.mem_used_mb, n.mem_total_mb))
                                : "—"}
                              <small>
                                {isOnline
                                  ? percent(
                                      ratio(
                                        n.disk_used_bytes,
                                        n.disk_total_bytes,
                                      ),
                                    )
                                  : "—"}
                              </small>
                            </td>
                            <td>
                              <span className="mp-text-blue">
                                ↑{" "}
                                {isOnline
                                  ? bytes(
                                      number(n.net_out_speed_kb) === null
                                        ? null
                                        : n.net_out_speed_kb! * 1024,
                                      true,
                                    )
                                  : "—"}
                              </span>
                              <small className="mp-text-success">
                                ↓{" "}
                                {isOnline
                                  ? bytes(
                                      number(n.net_in_speed_kb) === null
                                        ? null
                                        : n.net_in_speed_kb! * 1024,
                                      true,
                                    )
                                  : "—"}
                              </small>
                            </td>
                            <td>{bytes(n.traffic_used_bytes)}</td>
                            <td>
                              {averageLatency(n) === null
                                ? "—"
                                : `${averageLatency(n)!.toFixed(0)} ms`}
                            </td>
                            <td>
                              {price(n, l)}
                              <small>{renewal(n, l)}</small>
                            </td>
                            <td>
                              <Button
                                isIconOnly
                                size="sm"
                                variant="light"
                                aria-label={words(
                                  l,
                                  `查看 ${n.name}`,
                                  `View ${n.name}`,
                                )}
                                onPress={() => openNode(n)}
                              >
                                <ChevronRight size={17} />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {loaded && !visible.length && (
                <div className="mp-empty">
                  <Search size={30} />
                  <h3>
                    {words(
                      l,
                      nodes.length ? "没有符合条件的节点" : "还没有节点",
                      nodes.length ? "No matching nodes" : "No nodes yet",
                    )}
                  </h3>
                  <p>
                    {words(
                      l,
                      nodes.length
                        ? "试试其他关键词，或清除筛选条件。"
                        : "添加节点并连接后，监控信息将显示在这里。",
                      nodes.length
                        ? "Try another search or clear your filters."
                        : "Add a node and connect it to see monitoring data here.",
                    )}
                  </p>
                </div>
              )}
              {!loaded && (
                <div className="mp-empty" role="status">
                  {words(l, "正在获取节点…", "Loading nodes…")}
                </div>
              )}
            </section>
          </>
        )}
        <footer className="mp-footer">
          <span>{siteName}</span>
        </footer>
      </main>
    </div>
  );
}
