import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  Select,
  SelectItem,
  Tab,
  Tabs,
} from "@heroui/react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CalendarDays,
  Check,
  ChevronRight,
  Copy,
  Cpu,
  Globe2,
  HardDrive,
  Network,
  Search,
  Server,
  Wallet,
  Wifi,
} from "lucide-react";
import { flag, copyText, type ServerNode } from "../lib";
import {
  bytes,
  dateTime,
  duration,
  latency,
  number,
  percent,
  price,
  ratio,
  regionName,
  renewal,
  words,
  type Language,
} from "./format";
import { MetricChart, metricSpecs, palette, type ChartSpec } from "./charts";
import {
  ranges,
  useNodeHistory,
  useTargetHistory,
  withGaps,
  type ChartPoint,
  type HistoryRange,
  type TargetHistory,
} from "./useNodeHistory";

type Props = { node: ServerNode; language: Language; onBack: () => void };
function Info({
  label,
  value,
  title,
}: {
  label: string;
  value: React.ReactNode;
  title?: string;
}) {
  return (
    <div className="mp-info-row">
      <dt>{label}</dt>
      <dd title={title}>
        {value === null || value === undefined || value === "" ? "—" : value}
      </dd>
    </div>
  );
}
function InfoGroup({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mp-info-group">
      <h2>
        {icon}
        {title}
      </h2>
      <dl>{children}</dl>
    </section>
  );
}

export function NodeDetailPage({ node: n, language: l, onBack }: Props) {
  const initialQuery=new URLSearchParams(location.hash.split("?")[1]||"");
  const [tab, updateTab] = useState(initialQuery.get("tab")==="network"?"network":"performance");
  const [range, updateRange] = useState<HistoryRange>(()=>{
    const selected=initialQuery.get("range");if(selected && selected in ranges)return selected as HistoryRange;
    if(n.status==="offline" && n.last_seen){const age=(Date.now()-n.last_seen)/3600000+0.2;return (Object.keys(ranges) as HistoryRange[]).find(key=>ranges[key].hours>=age)||"30d";}
    return "1h";
  });
  const remember=(nextTab:string,nextRange:HistoryRange)=>{const query=new URLSearchParams({tab:nextTab,range:nextRange});window.history.replaceState(null,"",`#/nodes/${encodeURIComponent(n.id)}?${query}`)};
  const setTab=(value:string)=>{updateTab(value);remember(value,range)};
  const setRange=(value:HistoryRange)=>{updateRange(value);remember(tab,value)};
  const [expanded, setExpanded] = useState<ChartSpec | null>(null);
  const [copyState, setCopyState] = useState(false);
  const [copyError,setCopyError]=useState("");
  const history = useNodeHistory(n, range);
  const online = n.status === "online";
  const live = (v: unknown) => (online ? number(v) : null);
  const windows=/windows/i.test(n.os_name||"");
  const specs = metricSpecs(l).filter(spec=>spec.id!=="load"||!windows);
  const inbound = live(n.net_in_speed_kb),
    outbound = live(n.net_out_speed_kb);
  const quota = number(n.traffic_limit_gb),
    used = number(n.traffic_used_bytes);
  const trafficPercent =
    quota && used !== null ? (used / (quota * 1024 ** 3)) * 100 : null;
  const copyLink = async () => {
    try {
      await copyText(location.href);
      setCopyState(true);
      window.setTimeout(() => setCopyState(false), 1800);
    } catch {
      setCopyState(false);setCopyError(words(l,"复制失败，请复制浏览器地址栏的链接","Copy failed. Copy the URL from the address bar."));
    }
  };
  return (
    <div className="mp-detail">
      <nav
        className="mp-breadcrumb"
        aria-label={words(l, "当前位置", "Breadcrumb")}
      >
        <button onClick={onBack}>{words(l, "节点总览", "Nodes")}</button>
        <ChevronRight size={12} />
        <span>{n.name}</span>
      </nav>
      {copyError&&<p role="alert">{copyError}</p>}
      <div className="mp-detail-title">
        <div>
          <Button
            isIconOnly
            variant="bordered"
            className="mp-back"
            aria-label={words(l, "返回节点列表", "Back to nodes")}
            onPress={onBack}
          >
            <ArrowLeft size={18} />
          </Button>
          <img
            className="mp-detail-flag"
            src={flag(n.region)}
            alt={regionName(n, l)}
          />
          <div>
            <div className="mp-detail-name">
              <h1>{n.name}</h1>
              <span
                className={`mp-status ${online ? "is-online" : "is-offline"}`}
              >
                <i />
                {words(
                  l,
                  online ? "在线" : "离线",
                  online ? "Online" : "Offline",
                )}
              </span>
            </div>
            <p>
              {[
                regionName(n, l),
                n.provider,
                n.agent_version ? `Agent ${n.agent_version}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="bordered"
          className="mp-copy-link"
          onPress={() => void copyLink()}
          startContent={copyState ? <Check size={14} /> : <Copy size={14} />}
        >
          {words(
            l,
            copyState ? "已复制" : "复制链接",
            copyState ? "Copied" : "Copy link",
          )}
        </Button>
      </div>
      {!online && (
        <div className="mp-offline-banner">
          <span className="mp-status is-offline">
            <i />
            {words(l, "节点已离线", "Node is offline")}
          </span>
          <span>
            {n.last_seen
              ? words(
                  l,
                  `已离线 ${duration(Math.max(0, Date.now() - n.last_seen) / 1000, l)} · 最后上报 ${dateTime(n.last_seen, l)}`,
                  `Offline for ${duration(Math.max(0, Date.now() - n.last_seen) / 1000, l)} · Last report ${dateTime(n.last_seen, l)}`,
                )
              : words(l, "尚无上报记录", "No report received yet")}
          </span>
          <small>
            {words(l, "历史图表仍可查看", "History remains available")}
          </small>
        </div>
      )}
      <div className="mp-detail-summary">
        <InfoGroup
          title={words(l, "系统", "System")}
          icon={<Server size={15} />}
        >
          <Info label={words(l, "操作系统", "OS")} value={n.os_name} />
          <Info label={words(l, "内核", "Kernel")} value={n.kernel_ver} />
          <Info
            label={words(l, "架构 / 虚拟化", "Arch / virtualization")}
            value={[n.arch, n.virtualization].filter(Boolean).join(" / ")}
          />
          <Info
            label={words(l, "系统运行时长", "System uptime")}
            value={online ? duration(n.uptime_secs, l) : "—"}
          />
          <Info
            label={words(l, "最后上报", "Last report")}
            value={dateTime(n.last_seen, l)}
          />
        </InfoGroup>
        <InfoGroup
          title={words(l, "资源", "Resources")}
          icon={<Cpu size={15} />}
        >
          <Info
            label={words(l, "处理器", "Processor")}
            value={n.cpu_model}
            title={n.cpu_model}
          />
          <Info
            label={words(l, "核心 / 使用率", "Cores / usage")}
            value={`${n.cpu_cores || "—"} / ${percent(live(n.current_cpu))}`}
          />
          <Info
            label={words(l, "内存", "Memory")}
            value={
              online && n.mem_total_mb
                ? `${bytes(live(n.mem_used_mb) === null ? null : n.mem_used_mb! * 1024 ** 2)} / ${bytes(n.mem_total_mb * 1024 ** 2)}`
                : "—"
            }
          />
          <Info
            label="Swap"
            value={
              online && number(n.swap_total_mb) !== null
                ? n.swap_total_mb === 0
                  ? words(l, "未配置", "Not configured")
                  : `${bytes(live(n.swap_used_mb) === null ? null : n.swap_used_mb! * 1024 ** 2)} / ${bytes(n.swap_total_mb! * 1024 ** 2)}`
                : "—"
            }
          />
          <Info
            label={words(l, "磁盘", "Disk")}
            value={
              online && n.disk_total_bytes
                ? `${bytes(n.disk_used_bytes)} / ${bytes(n.disk_total_bytes)}`
                : "—"
            }
          />
          {n.gpu && <Info label="GPU" value={n.gpu} title={n.gpu} />}
        </InfoGroup>
        <InfoGroup
          title={words(l, "网络", "Network")}
          icon={<Network size={15} />}
        >
          <Info label="IPv4" value={n.ipv4} title={n.ipv4} />
          <Info label="IPv6" value={n.ipv6} title={n.ipv6} />
          <Info
            label={words(l, "上传 / 下载", "Upload / download")}
            value={
              <span>
                <b className="mp-text-blue">
                  ↑ {bytes(outbound === null ? null : outbound * 1024, true)}
                </b>
                <b className="mp-text-success">
                  ↓ {bytes(inbound === null ? null : inbound * 1024, true)}
                </b>
              </span>
            }
          />
          <Info
            label="TCP / UDP"
            value={
              online
                ? `${number(n.tcp_conns) ?? "—"} / ${number(n.udp_conns) ?? "—"}`
                : "—"
            }
          />
          <Info
            label={words(l, "累计上传 / 下载", "Total upload / download")}
            value={
              online
                ? `${bytes(n.total_tx_bytes)} / ${bytes(n.total_rx_bytes)}`
                : "—"
            }
          />
        </InfoGroup>
        <InfoGroup
          title={words(l, "服务与账单", "Service & billing")}
          icon={<Wallet size={15} />}
        >
          <Info label={words(l, "费用", "Price")} value={price(n, l)} />
          <Info
            label={words(l, "到期日期", "Renewal date")}
            value={
              n.billing_cycle === "lifetime" || n.billing_cycle === "free"
                ? renewal(n, l)
                : n.renewal_date?.slice(0, 10)
            }
          />
          <Info
            label={words(l, "剩余时间", "Time remaining")}
            value={renewal(n, l)}
          />
          <Info
            label={words(l, "本期流量", "Cycle traffic")}
            value={`${bytes(n.traffic_used_bytes)} / ${quota && quota > 0 ? bytes(quota * 1024 ** 3) : words(l, "未设限额", "No quota set")}`}
          />
          <Info
            label={words(l, "流量计费", "Traffic accounting")}
            value={`${words(l, n.traffic_type === "outbound" ? "仅出站" : "双向", n.traffic_type === "outbound" ? "Outbound" : "Both directions")} · ${words(l, `每月 ${n.traffic_reset_day || 1} 日重置`, `Resets on day ${n.traffic_reset_day || 1}`)}`}
          />
        </InfoGroup>
      </div>
      {!!n.tags && (
        <div className="mp-detail-tags">
          {n.tags
            .split(/[,，]/)
            .map((t) => t.trim())
            .filter(Boolean)
            .map((t) => (
              <Chip key={t} size="sm" variant="flat">
                {t}
              </Chip>
            ))}
        </div>
      )}
      <div className="mp-detail-toolbar">
        <Tabs
          aria-label={words(l, "节点详情内容", "Node details section")}
          selectedKey={tab}
          onSelectionChange={(key) => setTab(String(key))}
          variant="underlined"
          classNames={{ tabList: "mp-main-tabs", cursor: "mp-tab-cursor" }}
        >
          <Tab
            key="performance"
            title={
              <span className="mp-tab-label">
                <Cpu size={15} />
                {words(l, "性能监控", "Performance")}
              </span>
            }
          />
          <Tab
            key="network"
            title={
              <span className="mp-tab-label">
                <Wifi size={15} />
                {words(l, "网络分析", "Network analysis")}
              </span>
            }
          />
        </Tabs>
        <div className="mp-range">
          <CalendarDays size={14} />
          <div
            role="group"
            aria-label={words(l, "历史时间范围", "History range")}
          >
            {(Object.keys(ranges) as HistoryRange[]).map((key) => (
              <Button
                key={key}
                size="sm"
                variant={range === key ? "flat" : "light"}
                aria-pressed={range === key}
                onPress={() => setRange(key)}
              >
                {
                  {
                    "1h": words(l, "1 小时", "1h"),
                    "6h": words(l, "6 小时", "6h"),
                    "24h": words(l, "24 小时", "24h"),
                    "7d": words(l, "7 天", "7d"),
                    "30d": words(l, "30 天", "30d"),
                  }[key]
                }
              </Button>
            ))}
          </div>
        </div>
      </div>
      {history.error && (
        <div className="mp-notice mp-notice-warning" role="alert">
          {words(l, "历史数据加载失败。", "Unable to load metric history.")}
          <Button size="sm" variant="light" onPress={history.reload}>
            {words(l, "重新加载", "Retry")}
          </Button>
        </div>
      )}
      {tab === "performance" ? (
        <>
          <div className="mp-charts-intro">
            <span>
              {words(
                l,
                "各项指标共用时间范围，可点击右上角放大。",
                "All charts share the selected period. Expand any chart for more detail.",
              )}
            </span>
            <span>
              {history.loading
                ? words(l, "正在更新…", "Updating…")
                : words(
                    l,
                    "历史记录每分钟更新",
                    "History refreshes every minute",
                  )}
            </span>
          </div>
          <div className="mp-chart-grid">
            {specs.map((spec) => (
              <MetricChart
                key={spec.id}
                spec={spec}
                points={history.points}
                language={l}
                range={range}
                loading={history.loading}
                onExpand={() => setExpanded(spec)}
              />
            ))}
            <section className="mp-traffic-panel">
              <header>
                <HardDrive size={16} />
                <h3>{words(l, "流量配额", "Traffic allowance")}</h3>
              </header>
              <strong>
                {bytes(used)}
                <span>
                  {" "}
                  /{" "}
                  {quota && quota > 0
                    ? bytes(quota * 1024 ** 3)
                    : words(l, "未设置", "Not set")}
                </span>
              </strong>
              <div className="mp-meter">
                <i
                  style={{
                    width: `${Math.min(100, Math.max(0, trafficPercent || 0))}%`,
                    background:
                      trafficPercent && trafficPercent > 90
                        ? "#e56f8c"
                        : "var(--mp-blue)",
                  }}
                />
              </div>
              <dl>
                <Info
                  label={words(l, "剩余流量", "Remaining")}
                  value={
                    quota && used !== null
                      ? bytes(Math.max(0, quota * 1024 ** 3 - used))
                      : "—"
                  }
                />
                <Info
                  label={words(l, "已用比例", "Used")}
                  value={percent(trafficPercent)}
                />
                <Info
                  label={words(l, "统计口径", "Accounting")}
                  value={words(
                    l,
                    n.traffic_type === "outbound" ? "出站流量" : "入站 + 出站",
                    n.traffic_type === "outbound"
                      ? "Outbound"
                      : "Inbound + outbound",
                  )}
                />
              </dl>
            </section>
          </div>
        </>
      ) : (
        <NetworkAnalysis
          node={n}
          language={l}
          range={range}
          historyPoints={history.points}
        />
      )}
      <Modal
        isOpen={!!expanded}
        onOpenChange={(open) => !open && setExpanded(null)}
        size="5xl"
        scrollBehavior="inside"
        classNames={{ base: "mp-chart-modal", backdrop: "mp-chart-backdrop" }}
      >
        <ModalContent>
          <ModalHeader>{expanded?.title}</ModalHeader>
          <ModalBody>
            {expanded && (
              <MetricChart
                spec={expanded}
                points={history.points}
                language={l}
                range={range}
                large
              />
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  );
}

function targetStats(targets: TargetHistory[]) {
  let total = 0,
    timeouts = 0,
    sum = 0,
    successes = 0;
  targets.forEach((t) =>
    t.points.forEach((p) => {
      total += p.total;
      timeouts += p.timeouts;
      const valid = Math.max(0, p.total - p.timeouts);
      if (latency(p.ms) !== null) {
        sum += p.ms! * valid;
        successes += valid;
      }
    }),
  );
  return {
    total,
    timeouts,
    average: successes ? sum / successes : null,
    failure: total ? (timeouts / total) * 100 : null,
  };
}

function NetworkAnalysis({
  node: n,
  language: l,
  range,
  historyPoints,
}: {
  node: ServerNode;
  language: Language;
  range: HistoryRange;
  historyPoints: ChartPoint[];
}) {
  const {
    targets: historyTargets,
    loading,
    error,
    reload,
  } = useTargetHistory(n.id, range, true);
  const targets = useMemo(
    () => [
      ...historyTargets.map(target=>({...target,name:target.deleted?`${target.name} (${words(l,"已删除","removed")})`:target.name})),
      ...(n.targets || [])
        .filter(
          (target) => !historyTargets.some((t) => t.target_id === target.id),
        )
        .map((target) => ({
          target_id: target.id,
          name: target.name,
          host: target.host,
          carrier: target.carrier,
          region: target.region,
          points: [],
        })),
    ],
    [historyTargets, n.targets, l],
  );
  const [query, setQuery] = useState("");
  const [carrier, setCarrier] = useState("all");
  const [region, setRegion] = useState("all");
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const initializedTargets = useRef(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!historyTargets.length || initializedTargets.current) return;
    initializedTargets.current = true;
    let selected:number[]=[];
    try {const saved=JSON.parse(localStorage.getItem(`moniter-targets-${n.id}`)||"null");if(Array.isArray(saved))selected=saved.map(Number);}catch{}
    if(!selected.length){
      const sample=targets.filter(t=>/上海|广东|Shanghai|Guangdong/i.test(t.region));
      const source=sample.length?sample:targets;
      for(const carrier of ["ct","cu","cm","intl"]){selected.push(...source.filter(t=>t.carrier===carrier).slice(0,2).map(t=>t.target_id));}
      if(!selected.length)selected=source.slice(0,6).map(t=>t.target_id);
    }
    setHidden(new Set(targets.filter(t=>!selected.includes(t.target_id)).map(t=>t.target_id)));
  }, [historyTargets, targets,n.id]);
  useEffect(()=>{if(initializedTargets.current)localStorage.setItem(`moniter-targets-${n.id}`,JSON.stringify(targets.filter(t=>!hidden.has(t.target_id)).map(t=>t.target_id)));},[hidden,n.id]);
  const carriers = [...new Set(targets.map((t) => t.carrier).filter(Boolean))];
  const regions = [...new Set(targets.map((t) => t.region).filter(Boolean))];
  const carrierName = (s: string) =>
    (
      ({
        ct: words(l, "电信", "China Telecom"),
        cu: words(l, "联通", "China Unicom"),
        cm: words(l, "移动", "China Mobile"),
        intl: words(l, "国际", "International"),
        other: words(l, "其他", "Other"),
      }) as Record<string, string>
    )[s] || s;
  const filtered = targets.filter(
    (t) =>
      (carrier === "all" || t.carrier === carrier) &&
      (region === "all" || t.region === region) &&
      (!query.trim() ||
        `${t.name} ${t.host} ${t.region}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())),
  );
  const shown = filtered.filter((t) => !hidden.has(t.target_id));
  const stats = targetStats(shown);
  const colors = new Map(
    targets.map((t, i) => [t.target_id, palette[i % palette.length]]),
  );
  const chart = useMemo(() => {
    const rows = new Map<number, ChartPoint>();
    shown.forEach((t) =>
      t.points.forEach((p) => {
        const row = rows.get(p.ts) || { ts: p.ts };
        row[`t${t.target_id}`] = latency(p.ms);
        rows.set(p.ts, row);
      }),
    );
    const data = [...rows.values()];
    data.forEach((p) =>
      shown.forEach((t) => {
        if (!(`t${t.target_id}` in p)) p[`t${t.target_id}`] = null;
      }),
    );
    return withGaps(data, ranges[range].bucket * 2.5);
  }, [targets, query, carrier, region, hidden, range]);
  const targetSpec: ChartSpec = {
    id: "latency",
    title: words(l, "监控目标延迟", "Target latency"),
    unit: "ms",
    series: shown.map((t) => ({
      key: `t${t.target_id}`,
      name: t.name,
      color: colors.get(t.target_id)!,
    })),
  };
  const carrierSpec: ChartSpec = {
    id: "carriers",
    title: words(l, "三网延迟趋势", "Carrier latency trends"),
    unit: "ms",
    series: [
      { key: "ct", name: words(l, "电信", "China Telecom"), color: palette[0] },
      { key: "cu", name: words(l, "联通", "China Unicom"), color: palette[1] },
      { key: "cm", name: words(l, "移动", "China Mobile"), color: palette[2] },
    ],
  };
  const routeState = (s?: string) =>
    (
      ({
        optimal: words(l, "优选", "Optimal"),
        good: words(l, "良好", "Good"),
        normal: words(l, "正常", "Normal"),
        warning: words(l, "警告", "Warning"),
        unknown: words(l, "未知", "Unknown"),
      }) as Record<string, string>
    )[s || ""] ||
    s ||
    "—";
  return (
    <div className="mp-network-section">
      {!n.monitor_enabled && (
        <div className="mp-notice">
          {words(
            l,
            "该节点未启用延迟监控。已有历史记录仍可查询。",
            "Latency monitoring is disabled for this node. Existing history remains available.",
          )}
        </div>
      )}
      {error && (
        <div className="mp-notice mp-notice-warning" role="alert">
          {words(
            l,
            "监控目标历史记录加载失败。",
            "Unable to load target history.",
          )}
          <Button size="sm" onPress={reload}>
            {words(l, "重试", "Retry")}
          </Button>
        </div>
      )}
      <div className="mp-network-stats">
        {[
          [
            words(l, "显示目标", "Visible targets"),
            `${shown.length}`,
            words(
              l,
              `共 ${targets.length} 个有记录的目标`,
              `${targets.length} targets with history`,
            ),
          ],
          [
            words(l, "平均延迟", "Average latency"),
            stats.average === null ? "—" : `${stats.average.toFixed(1)} ms`,
            words(l, "按成功检测次数加权", "Weighted by successful checks"),
          ],
          [
            words(l, "超时比例", "Timeout rate"),
            percent(stats.failure),
            words(
              l,
              `${stats.timeouts.toLocaleString()} 次超时`,
              `${stats.timeouts.toLocaleString()} timed out`,
            ),
          ],
          [
            words(l, "检测次数", "Checks"),
            stats.total.toLocaleString(),
            words(l, "当前筛选与时间范围", "Selected targets and period"),
          ],
        ].map(([label, value, hint]) => (
          <section key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
            <span>{hint}</span>
          </section>
        ))}
      </div>
      <div className="mp-network-targets">
        <div className="mp-network-heading">
          <div>
            <h2>{words(l, "延迟分析", "Latency analysis")}</h2>
            <p>
              {words(
                l,
                "按地区和线路筛选，点击目标可显示或隐藏曲线。",
                "Filter by region or carrier. Click a target to toggle its chart line.",
              )}
            </p>
          </div>
          <Button size="sm" variant="flat" onPress={() => setExpanded(true)}>
            {words(l, "放大图表", "Expand chart")}
          </Button>
        </div>
        <div className="mp-filters">
          <Input
            className="mp-search"
            aria-label={words(l, "搜索监控目标", "Search targets")}
            placeholder={words(
              l,
              "搜索目标名称或地址…",
              "Search targets or hosts…",
            )}
            value={query}
            onValueChange={setQuery}
            startContent={<Search size={15} />}
            isClearable
            onClear={() => setQuery("")}
          />
          <Select
            aria-label={words(l, "目标地区", "Target region")}
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
              ...regions.map((r) => <SelectItem key={r}>{r}</SelectItem>),
            ]}
          </Select>
          <Select
            aria-label={words(l, "运营商", "Carrier")}
            className="mp-status-select"
            selectedKeys={[carrier]}
            disallowEmptySelection
            onSelectionChange={(keys) =>
              setCarrier(String([...keys][0] || "all"))
            }
          >
            {[
              <SelectItem key="all">
                {words(l, "全部线路", "All carriers")}
              </SelectItem>,
              ...carriers.map((c) => (
                <SelectItem key={c}>{carrierName(c)}</SelectItem>
              )),
            ]}
          </Select>
        </div>
        {filtered.length > 0 && (
          <>
            <div className="mp-target-actions">
              <span>
                {words(
                  l,
                  `显示 ${shown.length} / ${filtered.length} 个目标`,
                  `${shown.length} / ${filtered.length} targets shown`,
                )}
              </span>
              <div>
                <Button
                  size="sm"
                  variant="light"
                  onPress={() =>
                    setHidden(
                      (previous) =>
                        new Set(
                          [...previous].filter(
                            (id) => !filtered.some((t) => t.target_id === id),
                          ),
                        ),
                    )
                  }
                >
                  {words(l, "全部显示", "Show all")}
                </Button>
                <Button
                  size="sm"
                  variant="light"
                  onPress={() =>
                    setHidden(
                      (previous) =>
                        new Set([
                          ...previous,
                          ...filtered.map((t) => t.target_id),
                        ]),
                    )
                  }
                >
                  {words(l, "全部隐藏", "Hide all")}
                </Button>
              </div>
            </div>
            <div className="mp-target-grid">
              {filtered.map((t) => {
                const last = t.points[t.points.length - 1];
                const ts = targetStats([t]);
                const latest = n.targets?.find((p) => p.id === t.target_id);
                const current =
                  n.status === "online" && n.monitor_enabled && latest
                    ? latest.ms
                    : last?.ms;
                return (
                  <button
                    className={`mp-target-card ${hidden.has(t.target_id) ? "is-hidden" : ""}`}
                    style={
                      {
                        "--target-color": colors.get(t.target_id),
                      } as React.CSSProperties
                    }
                    key={t.target_id}
                    aria-pressed={!hidden.has(t.target_id)}
                    onClick={() =>
                      setHidden((previous) => {
                        const next = new Set(previous);
                        if (next.has(t.target_id)) next.delete(t.target_id);
                        else next.add(t.target_id);
                        return next;
                      })
                    }
                  >
                    <div>
                      <i />
                      <strong>{t.name}</strong>
                      <span className="mp-target-check">
                        {!hidden.has(t.target_id) && <Check size={10} />}
                      </span>
                    </div>
                    <small title={t.host}>{t.host}</small>
                    <p>
                      <b>
                        {latency(current) === null
                          ? current === 999 ||
                            (last &&
                              last.total > 0 &&
                              last.timeouts === last.total)
                            ? words(l, "超时", "Timeout")
                            : "—"
                          : `${current!.toFixed(1)} ms`}
                      </b>
                      <span>
                        {words(l, "超时", "Timeout")} {percent(ts.failure)}
                      </span>
                    </p>
                    <em>
                      {words(l, "最后记录", "Last recorded")}{" "}
                      {dateTime(last ? last.ts * 1000 : undefined, l)}
                    </em>
                  </button>
                );
              })}
            </div>
          </>
        )}
        <MetricChart
          spec={targetSpec}
          points={chart}
          language={l}
          range={range}
          loading={loading}
          large
        />
        {!loading && !targets.length && (
          <p className="mp-section-hint">
            {words(
              l,
              "所选时段还没有目标记录。启用延迟监控并等待节点上报后，即可查看。",
              "No target history in this period. Enable latency monitoring and wait for the next node report.",
            )}
          </p>
        )}
      </div>
      <MetricChart
        spec={carrierSpec}
        points={historyPoints}
        language={l}
        range={range}
      />
      <section className="mp-route-panel">
        <div className="mp-network-heading">
          <div>
            <h2>{words(l, "回程线路", "Return routes")}</h2>
            <p>
              {words(
                l,
                n.route_enabled
                  ? "节点最近一次上报的路由结果"
                  : "该节点未启用回程检测",
                n.route_enabled
                  ? "Last route report from this node"
                  : "Route detection is disabled for this node",
              )}
            </p>
          </div>
          <Globe2 size={18} />
        </div>
        {Object.keys(n.routes || {}).length ? (
          <div className="mp-route-grid">
            {Object.entries(n.routes || {}).map(([key, route]) => (
              <div key={key}>
                <small>{route.name || carrierName(key)}</small>
                <strong>{route.line || "—"}</strong>
                <span>{route.as || route.as_num || "—"}</span>
                <div>
                  <Chip size="sm" variant="flat">
                    {routeState(route.status)}
                  </Chip>
                  <span>
                    {latency(route.ping) === null
                      ? "—"
                      : `${route.ping!.toFixed(1)} ms`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mp-route-empty">
            {words(l, "暂无回程线路记录", "No route report available")}
          </div>
        )}
      </section>
      <Modal
        isOpen={expanded}
        onOpenChange={setExpanded}
        size="5xl"
        scrollBehavior="inside"
        classNames={{ base: "mp-chart-modal" }}
      >
        <ModalContent>
          <ModalHeader>{targetSpec.title}</ModalHeader>
          <ModalBody>
            <MetricChart
              spec={targetSpec}
              points={chart}
              language={l}
              range={range}
              large
            />
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  );
}
