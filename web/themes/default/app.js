/**
 * Moniter Application Core
 * Features:
 *  - i18n Bilingual Switcher (ZH / EN) with LocalStorage
 *  - Theme Switcher (System / Light / Dark) with MediaQuery Auto-follow
 *  - High-Fidelity Smokeping Canvas Chart (Multi-line Latency Graph)
 *  - Live HTTP Ping & Jitter Tester
 *  - Traffic & Billing Calculations (Cycle, Price, Remaining Days)
 *  - Dynamic Filtering & Real-time Auto-refresh
 */

// ==========================================================================
// 0. 通用小工具
// ==========================================================================

// 线路名太长会把表格列撑开，只取第一个词；没有数据时返回占位符
function routeShort(line) {
  if (!line || line === "—") return "—";
  return String(line).split(" ")[0];
}

function getRegionFlagCode(server) {
  const code = String(server && server.region || "").trim().toLowerCase();
  const supported = window.AEGIS_ISO_REGIONS;
  return /^[a-z]{2}$/.test(code) && (!Array.isArray(supported) || supported.includes(code)) ? code : "unknown";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function regionFlagMarkup(server, extraClass = "") {
  const code = getRegionFlagCode(server);
  const label = String(server && (server.regionName || server.regionNameEn) || "").trim();
  return `<img class="region-flag ${extraClass}" src="/assets/flags/${code}.svg" alt="${escapeHtml(label || code.toUpperCase())}" loading="lazy" onerror="this.onerror=null;this.src='/assets/flags/unknown.svg';">`;
}

// Agent 探测超时会回 999 这个哨兵值，别把它当成"999 毫秒"展示
function latencyText(ms) {
  if (!ms || ms <= 0) return "—";
  if (ms >= 999) return "超时";
  return `${ms} ms`;
}

// 把开机秒数格式化成人能读的形式，不足一天就别显示"0 天"
function uptimeText(secs, isEn) {
  if (!secs || secs <= 0) return "—";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return isEn ? `${d}d ${h}h` : `${d} 天 ${h} 小时`;
  if (h > 0) return isEn ? `${h}h ${m}m` : `${h} 小时 ${m} 分`;
  return isEn ? `${m}m` : `${m} 分钟`;
}

function offlineDurationText(lastSeenMs, isEn) {
  if (!lastSeenMs) return isEn ? "Offline duration unavailable" : "离线时长未知";
  const elapsed = Math.max(0, Math.floor((Date.now() - lastSeenMs) / 1000));
  if (elapsed < 60) return isEn ? `Offline ${elapsed}s` : `离线 ${elapsed} 秒`;
  const minutes = Math.floor(elapsed / 60);
  if (minutes < 60) return isEn ? `Offline ${minutes}m` : `离线 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remainder = minutes % 60;
    return isEn ? `Offline ${hours}h ${remainder}m` : `离线 ${hours} 小时 ${remainder} 分钟`;
  }
  const days = Math.floor(hours / 24);
  const remainder = hours % 24;
  return isEn ? `Offline ${days}d ${remainder}h` : `离线 ${days} 天 ${remainder} 小时`;
}

// ==========================================================================
// 1. i18n Translations Dictionary
// ==========================================================================
const I18N = {
  zh: {
    tag_probe: "PROBE 探针",
    theme_system: "跟随系统",
    theme_light: "浅色模式",
    theme_dark: "深色模式",
    stat_nodes: "服务器节点",
    stat_all_online: "所有服务正常运转",
    stat_monthly_cost: "月度开销预估",
    month: "月",
    stat_traffic_used: "累计出站流量",
    stat_traffic_pct: "已使用",
    stat_avg_latency: "国内/亚太平均延时",
    stat_jitter: "在线探针平均抖动",
    search_placeholder: "搜索节点名称、地区或厂商...",
    filter_all: "全部地区",
    th_system: "系统名称 / 地区",
    th_cpu: "CPU 占用",
    th_memory: "内存占用",
    th_disk: "磁盘占用",
    th_network: "实时网速 (上/下)",
    th_traffic: "当月流量",
    th_billing: "周期 & 价格",
    th_route: "三网回程",
    th_action: "操作",
    btn_detail: "详情",
    chart_title: "Smokeping 多线延迟监控 (24H)",
    chart_sub: "三网回程及国际骨干实时往返延时与抖动曲线 (单位: 毫秒 ms)",
    card_billing_title: "付款周期与费用",
    billing_due_date: "到期时间",
    billing_cycle_progress: "当前账期已过",
    card_traffic_title: "流量配额与实时网速",
    traffic_used_percent: "已消耗比例",
    traffic_reset_day: "流量重置日",
    card_route_title: "国内三网回程线路诊断 (Route Traceback)",
    route_tip: "基于 BGP / AS 路径实测评估", map_title: "全球节点分布", map_collapse: "收起地图", map_expand: "展开地图",
    view_nodes: "节点", view_map: "地图", refresh_now: "刷新",
    latency_scope: "来自在线探针", footer_brand: "Moniter · 开源服务器探针",
    detail_system: "系统信息", agent_live: "Agent 实时上报", metric_history: "性能指标趋势",
    range_live: "实时", range_1h: "1 小时", range_4h: "4 小时", range_1d: "1 天", range_7d: "7 天", range_30d: "30 天", range_365d: "1 年", syncing: "正在同步",
    metric_memory: "内存", metric_disk: "磁盘", metric_network: "网络", metric_connections: "连接数", metric_load: "负载", metric_processes: "进程",
    metric_hint: "实时模式为最近 60 秒的滚动采样，其余区间为数据库聚合值",
    custom_targets: "自定义监控目标", targets_admin_hint: "目标可在管理后台配置",
    footer_updated: "实时数据每 5 秒同步",
    footer_api_doc: "API 接口说明",
    docs_title: "探针配置与说明",
    docs_p1: "本探针页面为纯 HTML + CSS + JavaScript 编写，具有零依赖、极度美观、加载秒开的特性。",
    docs_p2: "支持中英双语、跟随系统深浅色自适应、付款周期（如 1$/月）、流量进度与多线延迟监控图。",
    docs_p3: "节点资料由管理后台和 SQLite 管理；实时指标由 Agent 上报。",
    btn_close: "好的，知道了",
    status_online: "在线",
    status_warning: "高负载",
    status_offline: "离线",
    auto_renew: "自动续费",
    manual_renew: "手动续费",
    days_left: "剩余 {d} 天",
    cost_breakdown: "约 ¥{cny} / 包含 {n} 台机器",
    opt_optimal: "极佳",
    opt_good: "良好",
    opt_normal: "普通",
    opt_warning: "绕路"
  },
  en: {
    tag_probe: "PROBE",
    theme_system: "System Theme",
    theme_light: "Light Mode",
    theme_dark: "Dark Mode",
    stat_nodes: "Server Nodes",
    stat_all_online: "All services operational",
    stat_monthly_cost: "Est. Monthly Cost",
    month: "mo",
    stat_traffic_used: "Total Outbound",
    stat_traffic_pct: "Used",
    stat_avg_latency: "Average Latency",
    stat_jitter: "Average jitter of online probes",
    search_placeholder: "Search node name, region or provider...",
    filter_all: "All Regions",
    th_system: "System / Location",
    th_cpu: "CPU Load",
    th_memory: "Memory",
    th_disk: "Disk Usage",
    th_network: "Net Speed (Up/Down)",
    th_traffic: "Traffic Quota",
    th_billing: "Billing & Price",
    th_route: "Return Route",
    th_action: "Action",
    btn_detail: "Details",
    chart_title: "Smokeping Multi-Line Latency (24H)",
    chart_sub: "Real-time RTT & Jitter curves across ISP backbones (unit: ms)",
    card_billing_title: "Billing Cycle & Pricing",
    billing_due_date: "Next Due Date",
    billing_cycle_progress: "Billing Cycle Elapsed",
    card_traffic_title: "Bandwidth & Real-time Speed",
    traffic_used_percent: "Bandwidth Used",
    traffic_reset_day: "Reset Day",
    card_route_title: "Return Route Traceback Analysis",
    route_tip: "Evaluated by BGP / AS Paths", map_title: "Node distribution", map_collapse: "Collapse map", map_expand: "Expand map",
    view_nodes: "Nodes", view_map: "Map", refresh_now: "Refresh",
    latency_scope: "From online probes", footer_brand: "Moniter · Open-source server probes",
    detail_system: "System information", agent_live: "Reported by Agent", metric_history: "Metric history",
    range_live: "Live", range_1h: "1 hour", range_4h: "4 hours", range_1d: "1 day", range_7d: "7 days", range_30d: "30 days", range_365d: "1 year", syncing: "Syncing",
    metric_memory: "Memory", metric_disk: "Disk", metric_network: "Network", metric_connections: "Connections", metric_load: "Load", metric_processes: "Processes",
    metric_hint: "Live shows a rolling 60-second sample; longer ranges use database aggregates.",
    custom_targets: "Custom targets", targets_admin_hint: "Configure targets in the admin console",
    footer_updated: "Live data syncs every 5 seconds",
    footer_api_doc: "API Specs",
    docs_title: "Probe Configuration & Specs",
    docs_p1: "This server probe is built purely with modern HTML + CSS + JS, lightweight and ultra fast.",
    docs_p2: "Supports bilingual switching, System/Dark/Light themes, billing cycle (e.g. $1/mo), and Smokeping charts.",
    docs_p3: "Manage nodes in the admin console; live metrics are reported by each Agent.",
    btn_close: "Got it",
    status_online: "Online",
    status_warning: "High Load",
    status_offline: "Offline",
    auto_renew: "Auto Renew",
    manual_renew: "Manual Renew",
    days_left: "{d} days left",
    cost_breakdown: "~¥{cny} / Across {n} servers",
    opt_optimal: "Optimal",
    opt_good: "Good",
    opt_normal: "Normal",
    opt_warning: "Detour"
  }
};

// ==========================================================================
// 2. Application State
// ==========================================================================
class ProbeApp {
  constructor() {
    const staticSeed = typeof window !== 'undefined' && Array.isArray(window.SERVER_DATA)
      ? window.SERVER_DATA
      : ((typeof SERVER_DATA !== 'undefined' && Array.isArray(SERVER_DATA)) ? SERVER_DATA : []);
    this.servers = staticSeed.map((s) => this.normalizeServer(s));
    this.currentLang = localStorage.getItem("aegis_lang") || (navigator.language.startsWith("zh") ? "zh" : "en");
    this.siteName = document.querySelector('meta[name="site-name"]')?.content || "Moniter";
    this.currentThemeSetting = localStorage.getItem("aegis_theme") || "system";
    this.currentFilter = "all";
    this.searchQuery = "";
    this.currentView = "table"; // 'table' or 'grid'
    this.activeServer = this.servers[0] || null;
    this.refreshInterval = 5; // seconds
    this.refreshTimer = null;
    this.secondsRemaining = 5;
    this.metricsCache = {}; // server_id -> 时序点数组
    this.lastLiveChartRenderAt = 0;
    this.hasRenderedViews = false;

    this.init();
  }

  // ========================================================================
  // 数据归一化
  //
  // data.js 只提供静态元数据（名称 / 地区 / 账单 / 流量配额），所有实时指标
  // 一律从零起步并标记 _live=false，真实数字只来自 agent 上报。
  // 这样就不会出现"页面显示 14.2% CPU 但其实根本没有 agent 在跑"的假象。
  // ========================================================================
  normalizeServer(raw) {
    const b = raw.billing || {};
    const bw = raw.bandwidth || {};
    const totalBytes = bw.totalBytes
      ? bw.totalBytes
      : (raw.traffic && raw.traffic.totalGB ? raw.traffic.totalGB * 1024 ** 3 : 0);

    return {
      id: raw.id,
      name: raw.name || raw.id,
      region: (raw.region || "us").toLowerCase(),
      regionName: raw.regionName || "",
      regionNameEn: raw.regionNameEn || raw.regionName || "",
      provider: raw.provider || "—",
      status: "offline",
      lastSeen: Number(raw.last_seen || raw.lastSeen || 0),
      _live: false,
      os: "",
      kernel: "",
      cpuModel: "",
      cpuCores: 0,
      uptimeDays: 0,
      uptimeSecs: 0,
      billing: {
        price: typeof b.price === "number" ? b.price : 0,
        currency: b.currency || "$",
        currencyCode: b.currencyCode || "USD",
        cycle: b.cycle || "monthly",
        cycleTextCn: b.cycleTextCn || "月付",
        cycleTextEn: b.cycleTextEn || "Monthly",
        startDate: b.startDate || "",
        renewalDate: b.renewalDate || "",
        autoRenew: b.autoRenew !== false,
        remainingDays: 0,
      },
      bandwidth: {
        usedBytes: 0,
        totalBytes: totalBytes,
        type: bw.type || "outbound",
        resetDay: bw.resetDay || 1,
        currentInSpeed: 0,
        currentOutSpeed: 0,
      },
      metrics: { cpuUsage: 0, memoryUsed: 0, memoryTotal: 0, diskUsed: 0, diskTotal: 0, swapUsed: 0, swapTotal: 0 },
      // 系统信息（agent 上报）
      arch: "",
      virtualization: "",
      gpu: "",
      load1: 0,
      load5: 0,
      load15: 0,
      processes: 0,
      tcpConns: 0,
      udpConns: 0,
      totalRx: 0,
      totalTx: 0,
      // 实时滚动缓冲，供"实时"模式画图（最多 60 个采样点）
      liveBuffer: [],
      routes: {
        ct: { name: "中国电信", line: "—", as: "—", status: "normal", ping: 0 },
        cu: { name: "中国联通", line: "—", as: "—", status: "normal", ping: 0 },
        cm: { name: "中国移动", line: "—", as: "—", status: "normal", ping: 0 },
        cer: { name: "教育网", line: "—", as: "—", status: "normal", ping: 0 },
      },
      pingTest: { avgPing: 0, loss: 0, jitter: 0 },
      pingHistory: null,
      // 自定义监控目标的探测结果，由后端下发
      targets: [],
    };
  }

  // 把后端 /api/v1/servers 或 /ws/client 推来的数据合并进本地结构
  applyLiveToServer(s, live) {
    // 只有 online 的节点才算"有实时数据"，离线节点保持占位符
    s._live = live.status === "online";
    s.status = live.status || "offline";
    if (Number(live.last_seen) > 0) s.lastSeen = Number(live.last_seen);
    if (live.name) s.name = live.name;
    if (live.region) s.region = String(live.region).toLowerCase();
    if (live.region_name) s.regionName = live.region_name;
    if (live.provider) s.provider = live.provider;

    s.os = live.os_name || s.os || "";
    s.kernel = live.kernel_ver || s.kernel || "";
    s.cpuCores = live.cpu_cores || 0;
    s.cpuModel = live.cpu_model
      ? (live.cpu_cores ? `${live.cpu_model} (${live.cpu_cores} vCPU)` : live.cpu_model)
      : (s.cpuModel || "");
    s.uptimeDays = Math.floor((live.uptime_secs || 0) / 86400);
    s.uptimeSecs = live.uptime_secs || 0;

    s.metrics.cpuUsage = +(live.current_cpu || 0).toFixed(1);
    s.metrics.memoryUsed = +((live.mem_used_mb || 0) / 1024).toFixed(1);
    s.metrics.memoryTotal = +((live.mem_total_mb || 0) / 1024).toFixed(1);
    s.metrics.diskUsed = +((live.disk_used_bytes || 0) / 1024 ** 3).toFixed(1);
    s.metrics.diskTotal = +((live.disk_total_bytes || 0) / 1024 ** 3).toFixed(1);
    s.metrics.swapUsed = +((live.swap_used_mb || 0) / 1024).toFixed(1);
    s.metrics.swapTotal = +((live.swap_total_mb || 0) / 1024).toFixed(1);

    s.arch = live.arch || s.arch || "";
    s.virtualization = live.virtualization || s.virtualization || "";
    s.gpu = live.gpu || s.gpu || "";
    s.load1 = live.load1 || 0;
    s.load5 = live.load5 || 0;
    s.load15 = live.load15 || 0;
    s.processes = live.processes || 0;
    s.tcpConns = live.tcp_conns || 0;
    s.udpConns = live.udp_conns || 0;
    s.totalRx = live.total_rx_bytes || 0;
    s.totalTx = live.total_tx_bytes || 0;

    s.bandwidth.currentInSpeed = (live.net_in_speed_kb || 0) * 1024;
    s.bandwidth.currentOutSpeed = (live.net_out_speed_kb || 0) * 1024;
    // 已用流量取网卡累计出站字节（单向计费口径）。注意这是开机以来的累计值，
    // 不是"本月已用"，所以下方 UI 的提示文字也相应写清楚了。
    s.bandwidth.usedBytes = Math.max(live.total_tx_bytes || 0, live.total_rx_bytes || 0);
    if (live.traffic_limit_gb > 0) s.bandwidth.totalBytes = live.traffic_limit_gb * 1024 ** 3;

    if (typeof live.billing_price === "number") s.billing.price = live.billing_price;
    if (live.billing_currency) s.billing.currency = live.billing_currency;
    if (live.billing_cycle) s.billing.cycle = live.billing_cycle;
    if (live.renewal_date) s.billing.renewalDate = live.renewal_date;

    if (s.billing.renewalDate) {
      const diff = new Date(s.billing.renewalDate) - new Date();
      if (!isNaN(diff)) s.billing.remainingDays = Math.ceil(diff / 86400000);
    }

    s.pingTest.avgPing = live.latency_ct || 0;

    if (Array.isArray(live.targets)) s.targets = live.targets;

    // 累积实时滚动数据（服务端每秒推一次，60 个点约等于最近 60 秒）
    if (s._live) {
      s.liveBuffer = s.liveBuffer || [];
      s.liveBuffer.push({
        ts: Date.now(),
        cpu: s.metrics.cpuUsage,
        mem: s.metrics.memoryUsed,
        memTotal: s.metrics.memoryTotal,
        disk: s.metrics.diskUsed,
        diskTotal: s.metrics.diskTotal,
        netIn: s.bandwidth.currentInSpeed / 1024,
        netOut: s.bandwidth.currentOutSpeed / 1024,
        tcp: s.tcpConns,
        udp: s.udpConns,
        load: s.load1,
        procs: s.processes,
      });
      if (s.liveBuffer.length > 60) s.liveBuffer.shift();
    }

    if (live.routes) {
      ["ct", "cu", "cm"].forEach((k) => {
        const r = live.routes[k];
        if (!r) return;
        s.routes[k] = {
          name: r.name || s.routes[k].name,
          line: r.line || s.routes[k].line,
          as: r.as || r.as_num || s.routes[k].as,
          status: r.status || s.routes[k].status,
          ping: live["latency_" + k] || 0,
        };
      });
    }
  }

  applyLiveSnapshot(liveList) {
    if (!Array.isArray(liveList) || liveList.length === 0) return;
    liveList.forEach((live) => {
      let s = this.servers.find((x) => x.id === live.id);
      if (!s) {
        // 后端存在但静态数据里没有的节点（后台新加的），动态建一条
        s = this.normalizeServer({
          id: live.id,
          name: live.name,
          region: live.region,
          regionName: live.region_name,
          provider: live.provider,
        });
        this.servers.push(s);
      }
      this.applyLiveToServer(s, live);
    });
  }

  async init() {
    this.applyTheme(this.currentThemeSetting, false);
    this.applySiteSettings();
    const hasServerSnapshot = Array.isArray(window.SERVER_DATA_LIVE);
    this.integrateInitialLiveData();
    this.applyLanguage(this.currentLang);
    this.bindEvents();
    this.startAutoRefresh();
    this.connectRealtimeWs();

    // data.js already carries a no-store snapshot. Avoid a second immediate
    // snapshot that can shift metrics just after the first frame is revealed.
    if (!hasServerSnapshot) await this.fetchServersSnapshot();

    // Reveal only after the initial table/stat render is complete. This closes
    // the paint window where static placeholders can flash before app.js mounts.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.documentElement.classList.remove("page-booting");
      const loadingIndicator = document.getElementById("loadingIndicator");
      if (loadingIndicator) loadingIndicator.setAttribute("aria-hidden", "true");
    }));

    // Listen to system theme changes dynamically
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
      if (this.currentThemeSetting === "system") {
        this.applyTheme("system", true);
      }
    });

    // Handle canvas resize
    window.addEventListener("resize", () => {
      if (document.getElementById("detailModal").classList.contains("show")) {
        this.renderSmokepingChart(this.activeServer);
        this.renderMetricChart();
      }
    });
  }

  async applySiteSettings() {
    try {
      const res = await fetch('/api/v1/site-settings', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const name = String(data.site_name || 'Moniter').trim() || 'Moniter';
      this.siteName = name;
      this.applyLanguage(this.currentLang);
      document.querySelectorAll('.brand-title > span:first-child').forEach((el) => { el.textContent = name; });
      document.querySelectorAll('[data-i18n="footer_brand"]').forEach((el) => { el.textContent = this.currentLang === 'zh' ? name + ' · 开源服务器探针' : name + ' · Open-source server probes'; });
    } catch (e) {}
  }

  async fetchServersSnapshot() {
    if (location.protocol === "file:") return;
    try {
      const res = await fetch("/api/v1/servers", { cache: "no-store" });
      if (!res.ok) return;
      const list = await res.json();
      if (!Array.isArray(list)) return;

      const before = this.servers.length;
      this.applyLiveSnapshot(list);
      this.renderStats();

      this.renderRegionFilters();
      if (this.servers.length !== before) {
        // 节点数量变了，表格结构必须重建
        this.renderServers();
        this.initWorldMap();
      } else {
        // 只是指标变化，走局部更新避免闪烁
        this.updateMetricsInPlace();
      }
    } catch (e) {
      // 后端不可达时保留静态元数据，页面仍然可读
    }
  }

  // ========================================================================
  // Real-time WebSocket & Live Data Integration
  // ========================================================================

  // ========================================================================
  // World Map: 点亮全球引擎
  // ========================================================================
  async initWorldMap() {
    const container = document.getElementById("worldContinents");
    if (!container) return;

    // 绑定收起/展开控制
    const toggleBtn = document.getElementById("toggleMapBtn");
    const mapBody = document.getElementById("worldMapBody");
    const isCollapsed = localStorage.getItem("aegis_map_collapsed") === "true";
    if (isCollapsed && mapBody) {
      mapBody.classList.add("collapsed");
      const txt = document.getElementById("toggleMapText");
      if (txt) txt.textContent = this.currentLang === "zh" ? "展开地图" : "Expand Map";
      const icon = document.getElementById("toggleMapIcon");
      if (icon) icon.innerHTML = '<polyline points="6 9 12 15 18 9"/>';
    }

    if (toggleBtn && mapBody) {
      toggleBtn.onclick = () => {
        const collapsed = mapBody.classList.toggle("collapsed");
        localStorage.setItem("aegis_map_collapsed", collapsed);
        const txt = document.getElementById("toggleMapText");
        const icon = document.getElementById("toggleMapIcon");
        if (txt) {
          txt.textContent = collapsed
            ? (this.currentLang === "zh" ? "展开地图" : "Expand Map")
            : (this.currentLang === "zh" ? "收起地图" : "Collapse Map");
        }
        if (icon) {
          icon.innerHTML = collapsed
            ? '<polyline points="6 9 12 15 18 9"/>'
            : '<polyline points="18 15 12 9 6 15"/>';
        }
      };
    }

    // 异步拉取优化世界地图 SVG 路径
    try {
      if (container.children.length === 0) {
        const resp = await fetch("/world-map-paths.svg");
        if (resp.ok) {
          const svgText = await resp.text();
          container.innerHTML = svgText;
        }
      }
    } catch (e) {
      console.warn("World map svg fetch notice:", e);
    }

    this.renderWorldMap();
  }

  renderWorldMap() {
    const container = document.getElementById("worldContinents");
    const pinsGroup = document.getElementById("mapPins");
    const connGroup = document.getElementById("mapConnections");
    const badge = document.getElementById("mapLitBadge");
    const tooltip = document.getElementById("mapTooltip");
    if (!pinsGroup) return;

    pinsGroup.innerHTML = "";
    if (connGroup) connGroup.innerHTML = "";

    // 提取所有活跃国家地区代码
    const litRegions = new Set();
    const cityCoords = {
      "srv-lax-01": { x: 171.6, y: 155.4, city: "Los Angeles", country: "US" },
      "srv-sjc-04": { x: 161.4, y: 146.3, city: "San Jose", country: "US" },
      "srv-fra-02": { x: 524.1, y: 110.8, city: "Frankfurt", country: "DE" },
      "srv-tyo-03": { x: 887.9, y: 150.9, city: "Tokyo", country: "JP" },
      "srv-hkg-05": { x: 817.1, y: 188.0, city: "Hong Kong", country: "HK" },
      "srv-shanghai": { x: 837.4, y: 163.2, city: "Shanghai", country: "CN" }
    };

    // 默认地区坐标映射
    const defaultRegionCoords = {
      us: { x: 190.0, y: 150.0, city: "United States", country: "US" },
      cn: { x: 820.0, y: 160.0, city: "China", country: "CN" },
      de: { x: 524.0, y: 110.0, city: "Germany", country: "DE" },
      jp: { x: 888.0, y: 150.0, city: "Japan", country: "JP" },
      hk: { x: 817.0, y: 188.0, city: "Hong Kong", country: "HK" },
      sg: { x: 788.0, y: 246.0, city: "Singapore", country: "SG" },
      gb: { x: 499.0, y: 107.0, city: "United Kingdom", country: "GB" }
    };

    const nodeCoords = [];

    this.servers.forEach(s => {
      const reg = (s.region || "us").toLowerCase();
      litRegions.add(reg);

      // 点亮对应的国家 SVG 路径
      const countryEl = document.getElementById(`country-${reg}`);
      if (countryEl) {
        countryEl.classList.add("lit");
      }

      // 确定坐标
      let coord = cityCoords[s.id];
      if (!coord) coord = defaultRegionCoords[reg] || { x: 500, y: 250, city: s.regionName, country: reg.toUpperCase() };

      nodeCoords.push({ s, coord });

      // 渲染脉冲雷达圆环与中心实体光斑
      const pinG = document.createElementNS("http://www.w3.org/2000/svg", "g");
      pinG.setAttribute("class", "map-node-pin");
      pinG.setAttribute("data-id", s.id);

      const color = s.status === "online" ? "var(--status-online)" : (s.status === "warning" ? "var(--status-warning)" : "var(--status-danger)");

      pinG.innerHTML = `
        <circle class="map-pulse-ring" cx="${coord.x}" cy="${coord.y}" r="6" stroke="${color}" stroke-width="1.5" fill="none" />
        <circle cx="${coord.x}" cy="${coord.y}" r="3.5" fill="${color}" />
        <circle cx="${coord.x}" cy="${coord.y}" r="10" fill="transparent" />
      `;

      // 悬停交互 Tooltip
      pinG.addEventListener("mouseenter", (e) => {
        if (!tooltip) return;
        const rect = document.getElementById("worldMapSvg").getBoundingClientRect();
        const screenX = (coord.x / 1000) * rect.width;
        const screenY = (coord.y / 500) * rect.height;

        const ping = latencyText(s.pingTest && s.pingTest.avgPing);
        const statusText = s.status === "online" ? (this.currentLang === "zh" ? "正常在线" : "Online") : "Offline";

        tooltip.innerHTML = `
          <div style="font-weight:700; margin-bottom:2px; display:flex; align-items:center; gap:4px;">
            <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:${color};"></span>
            <span>${s.name}</span>
          </div>
          <div style="color:var(--text-muted); font-size:0.7rem;">${coord.city} · ${s.provider}</div>
          <div style="margin-top:4px; display:flex; gap:8px; font-size:0.72rem;">
            <span>${this.currentLang === "zh" ? "延时" : "Ping"}: <strong>${ping}</strong></span>
            <span>${this.currentLang === "zh" ? "状态" : "Status"}: <strong style="color:${color}">${statusText}</strong></span>
          </div>
        `;
        tooltip.style.left = `${screenX}px`;
        tooltip.style.top = `${screenY}px`;
        tooltip.style.display = "block";
      });

      pinG.addEventListener("mouseleave", () => {
        if (tooltip) tooltip.style.display = "none";
      });

      // 点击平滑滚动至列表对应机器卡片
      pinG.addEventListener("click", () => {
        const targetRow = document.querySelector(`[data-server-id="${s.id}"]`);
        if (targetRow) {
          targetRow.scrollIntoView({ behavior: "smooth", block: "center" });
          targetRow.style.outline = "2px solid var(--accent-primary)";
          setTimeout(() => { targetRow.style.outline = "none"; }, 1500);
        }
      });

      pinsGroup.appendChild(pinG);
    });

    // 渲染骨干拓扑连接弧线 (例如 上海/香港 跨洋连接 洛杉矶/法兰克福/东京)
    if (connGroup && nodeCoords.length >= 2) {
      const hub = nodeCoords.find(n => n.s.id === "srv-shanghai" || n.s.id === "srv-hkg-05") || nodeCoords[0];
      nodeCoords.forEach(target => {
        if (target !== hub) {
          const x1 = hub.coord.x, y1 = hub.coord.y;
          const x2 = target.coord.x, y2 = target.coord.y;
          const cx = (x1 + x2) / 2;
          const cy = Math.min(y1, y2) - 25; // 抛物线控制点

          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute("class", "map-connection-line");
          path.setAttribute("d", `M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`);
          connGroup.appendChild(path);
        }
      });
    }

    // 更新点亮徽章
    if (badge) {
      badge.textContent = this.currentLang === "zh"
        ? `已点亮 ${litRegions.size} 个国家/地区 (${this.servers.length} 台在线)`
        : `${litRegions.size} Regions Illuminated (${this.servers.length} Nodes)`;
    }
  }

  integrateInitialLiveData() {
    if (window.SERVER_DATA_LIVE && Array.isArray(window.SERVER_DATA_LIVE) && window.SERVER_DATA_LIVE.length > 0) {
      // Merge the server snapshot before the one initial render in applyLanguage().
      this.applyLiveSnapshot(window.SERVER_DATA_LIVE);
    }
  }

  connectRealtimeWs() {
    if (location.protocol === 'file:') return; // 本地双击文件时不连接
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws/client`;
    try {
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        console.log("[Moniter] 成功接入 Rust 后端毫秒级流式 WebSocket！");
      };
      ws.onmessage = (event) => {
        try {
          const liveList = JSON.parse(event.data);
          this.handleIncomingLiveData(liveList);
        } catch (e) {}
      };
      ws.onclose = () => {
      console.warn("[Moniter] WebSocket 断开，自动降级为平滑轮询模式");
      };
    } catch (e) {}
  }

  handleIncomingLiveData(liveList) {
    if (!Array.isArray(liveList) || liveList.length === 0) return;

    // 记录更新前的节点数，新增节点才需要重绘整表
    const before = this.servers.length;
    this.applyLiveSnapshot(liveList);
    this.renderRegionFilters();

    if (this.servers.length !== before) {
      // 有新节点接入，表格结构变了，必须重绘
      this.renderServers();
      this.initWorldMap();
    } else {
      // 纯指标更新走局部 DOM 写入，避免整表重绘闪烁
      this.updateMetricsInPlace();
    }
    this.renderStats();
  }

  // ========================================================================
  // Theme Engine (System / Light / Dark)
  // ========================================================================
  applyTheme(themeSetting, animate = false) {
    this.currentThemeSetting = themeSetting;
    localStorage.setItem("aegis_theme", themeSetting);

    if (animate) {
      document.documentElement.classList.add("theme-transitioning");
      clearTimeout(this._themeTransitionTimer);
      this._themeTransitionTimer = setTimeout(() => {
        document.documentElement.classList.remove("theme-transitioning");
      }, 300);
    }

    let resolvedTheme = themeSetting;
    if (themeSetting === "system") {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      resolvedTheme = prefersDark ? "dark" : "light";
    }

    document.documentElement.setAttribute("data-theme", resolvedTheme);

    // Update Dropdown UI
    const themeIcon = document.getElementById("currentThemeIcon");
    const themeLabel = document.getElementById("currentThemeLabel");
    const t = I18N[this.currentLang];

    if (themeSetting === "system") {
      themeLabel.textContent = t.theme_system;
      themeIcon.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>`;
    } else if (themeSetting === "light") {
      themeLabel.textContent = t.theme_light;
      themeIcon.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`;
    } else {
      themeLabel.textContent = t.theme_dark;
      themeIcon.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`;
    }

    document.querySelectorAll("#themeMenu .dropdown-item").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-theme-val") === themeSetting);
    });

    // Re-draw chart if modal open because colors change
    if (this.activeServer && document.getElementById("detailModal").classList.contains("show")) {
      this.renderSmokepingChart(this.activeServer);
    }
  }

  // ========================================================================
  // i18n Language Engine
  // ========================================================================
  applyLanguage(lang) {
    const languageChanged = this.currentLang !== lang;
    this.currentLang = lang;
    localStorage.setItem("aegis_lang", lang);
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    const title = lang === "zh" ? this.siteName + " · 服务器状态与网络监控" : this.siteName + " · Server and network monitoring";
    if (document.title !== title) document.title = title;

    const dict = I18N[lang];

    // Update Elements with data-i18n
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (dict[key]) {
        if (el.textContent !== dict[key]) el.textContent = dict[key];
      }
    });

    // Update Placeholders with data-i18n-ph
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
      const key = el.getAttribute("data-i18n-ph");
      if (dict[key]) {
        if (el.getAttribute("placeholder") !== dict[key]) el.setAttribute("placeholder", dict[key]);
      }
    });

    // Update Dropdown UI
    const langLabel = lang === "zh" ? "中文" : "English";
    const currentLangLabel = document.getElementById("currentLangLabel");
    if (currentLangLabel.textContent !== langLabel) currentLangLabel.textContent = langLabel;
    document.querySelectorAll("#langMenu .dropdown-item").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-lang") === lang);
    });

    // Rebuild dynamic views only for first paint or an actual language change.
    if (!this.hasRenderedViews || languageChanged) {
      this.renderRegionFilters();
      this.renderStats();
      this.renderServers();
      if (this.currentView === "map") this.initWorldMap();
      this.hasRenderedViews = true;
      if (this.activeServer && document.getElementById("detailModal").classList.contains("show")) {
        this.populateModal(this.activeServer);
      }
    }
  }

  // ========================================================================
  // Event Listeners Binding
  // ========================================================================
  bindEvents() {
    // Dropdown toggles
    const setupDropdown = (btnId, menuId) => {
      const btn = document.getElementById(btnId);
      const menu = document.getElementById(menuId);
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = menu.classList.contains("show");
        document.querySelectorAll(".dropdown-menu").forEach(m => m.classList.remove("show"));
        if (!isOpen) menu.classList.add("show");
      });
    };

    setupDropdown("langToggleBtn", "langMenu");
    setupDropdown("themeToggleBtn", "themeMenu");

    window.addEventListener("click", () => {
      document.querySelectorAll(".dropdown-menu").forEach(m => m.classList.remove("show"));
    });

    // Language change clicks
    document.querySelectorAll("#langMenu .dropdown-item").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.applyLanguage(btn.getAttribute("data-lang"));
        document.getElementById("langMenu").classList.remove("show");
      });
    });

    // Theme change clicks
    document.querySelectorAll("#themeMenu .dropdown-item").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.applyTheme(btn.getAttribute("data-theme-val"), true);
        document.getElementById("themeMenu").classList.remove("show");
      });
    });

    // Search Input
    document.getElementById("searchInput").addEventListener("input", (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      this.renderServers();
    this.initWorldMap();
    });

    // Region filters are generated from the regions present in the current data.
    const regionFilters = document.getElementById("regionFilters");
    regionFilters.addEventListener("click", (e) => {
      const pill = e.target.closest(".filter-pill");
      if (!pill) return;
      document.querySelectorAll("#regionFilters .filter-pill").forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      this.currentFilter = pill.getAttribute("data-filter") || "all";
      this.renderServers();
      if (this.currentView === "map") this.initWorldMap();
    });

    // Primary workspace switcher: nodes first, map kept as an intentional secondary view.
    const nodesViewBtn = document.getElementById("nodesViewBtn");
    const mapViewBtn = document.getElementById("mapViewBtn");
    const nodesViewPanel = document.getElementById("nodesViewPanel");
    const mapViewPanel = document.getElementById("mapViewPanel");
    const showWorkspace = (view) => {
      const isMap = view === "map";
      nodesViewPanel.style.display = isMap ? "none" : "block";
      mapViewPanel.style.display = isMap ? "block" : "none";
      nodesViewBtn.classList.toggle("active", !isMap);
      mapViewBtn.classList.toggle("active", isMap);
      if (isMap) this.initWorldMap();
      localStorage.setItem("aegis_workspace", view);
    };
    nodesViewBtn.addEventListener("click", () => showWorkspace("nodes"));
    mapViewBtn.addEventListener("click", () => showWorkspace("map"));
    showWorkspace(localStorage.getItem("aegis_workspace") === "map" ? "map" : "nodes");

    // View Switcher (Table / Grid)
    document.getElementById("viewTableBtn").addEventListener("click", () => {
      this.currentView = "table";
      document.getElementById("viewTableBtn").classList.add("active");
      document.getElementById("viewGridBtn").classList.remove("active");
      document.getElementById("tableViewSection").style.display = "block";
      document.getElementById("gridViewSection").style.display = "none";
    });

    document.getElementById("viewGridBtn").addEventListener("click", () => {
      this.currentView = "grid";
      document.getElementById("viewGridBtn").classList.add("active");
      document.getElementById("viewTableBtn").classList.remove("active");
      document.getElementById("tableViewSection").style.display = "none";
      document.getElementById("gridViewSection").style.display = "grid";
    });

    // Modal Close
    document.getElementById("modalCloseBtn").addEventListener("click", () => {
      this.closeDetailModal();
    });

    document.getElementById("detailModal").addEventListener("click", (e) => {
      if (e.target.id === "detailModal") {
        this.closeDetailModal();
      }
    });

    // Refresh button click
    document.getElementById("refreshBtn").addEventListener("click", () => {
      this.triggerDataRefresh(true);
    });

  }

  // ========================================================================
  // Top Stats Summary
  // ========================================================================
  renderStats() {
    const t = I18N[this.currentLang];
    const totalCount = this.servers.length;
    const onlineCount = this.servers.filter(s => s.status === "online").length;

    // Estimate monthly cost: normalize everything to USD
    let totalMonthlyUSD = 0;
    this.servers.forEach((s) => {
      let price = s.billing.price;
      // Convert cycles to monthly equivalent
      let cycle = s.billing.cycle;
      let monthly = price;
      if (cycle === "quarterly") monthly = price / 3;
      else if (cycle === "semi_annually") monthly = price / 6;
      else if (cycle === "annually") monthly = price / 12;
      else if (cycle === "biennially") monthly = price / 24;
      else if (cycle === "triennially") monthly = price / 36;
      else if (cycle === "lifetime" || cycle === "free") monthly = 0;

      // Currency conversion approx
      if (s.billing.currencyCode === "EUR") monthly *= 1.08;
      if (s.billing.currencyCode === "CNY") monthly /= 7.25;

      totalMonthlyUSD += monthly;
    });

    // Total traffic（只统计真正上报过数据的节点，避免占位 0 拉低平均值）
    let totalUsedBytes = 0;
    let totalMaxBytes = 0;
    const liveServers = this.servers.filter((s) => s._live);

    liveServers.forEach((s) => {
      totalUsedBytes += s.bandwidth.usedBytes;
      totalMaxBytes += s.bandwidth.totalBytes;
    });

    const usedTB = (totalUsedBytes / (1024 ** 4)).toFixed(1);
    const totalTB = (totalMaxBytes / (1024 ** 4)).toFixed(1);
    const trafficPct = totalMaxBytes > 0 ? ((totalUsedBytes / totalMaxBytes) * 100).toFixed(1) : "0.0";
    // 超时（999）不参与平均值，否则一台探测失败的机器会把整体延迟拉到 999
    const validPings = liveServers
      .map((s) => s.pingTest.avgPing)
      .filter((v) => v > 0 && v < 999);
    const avgPing = validPings.length
      ? Math.round(validPings.reduce((a, b) => a + b, 0) / validPings.length)
      : 0;

    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== String(value)) el.textContent = value;
    };
    setText("statOnlineCount", onlineCount);
    setText("statTotalCount", totalCount);
    setText("statMonthlyCost", totalMonthlyUSD.toFixed(2));
    setText("statCostBreakdown", t.cost_breakdown
      .replace("{cny}", (totalMonthlyUSD * 7.25).toFixed(1))
      .replace("{n}", totalCount));

    setText("statTrafficUsed", usedTB);
    setText("statTrafficTotal", totalTB);
    setText("statTrafficPercent", `${trafficPct}%`);
    // 全部节点探测都超时时没有有效延迟，显示占位符而不是 0
    setText("statAvgPing", avgPing > 0 ? avgPing : "—");
  }

  renderRegionFilters() {
    const container = document.getElementById("regionFilters");
    if (!container) return;

    const isEn = this.currentLang === "en";
    const counts = new Map();
    this.servers.forEach((s) => {
      const code = String(s.region || "unknown").trim().toLowerCase() || "unknown";
      const name = String(s.regionName || "").trim();
      const key = `${code}::${name.toLocaleLowerCase()}`;
      const current = counts.get(key) || { count: 0, name: name || code.toUpperCase(), nameEn: "", code };
      current.count += 1;
      current.nameEn = current.nameEn || s.regionNameEn || s.regionName || code.toUpperCase();
      counts.set(key, current);
    });

    if (this.currentFilter !== "all" && !counts.has(this.currentFilter)) this.currentFilter = "all";

    const entries = [["all", I18N[this.currentLang].filter_all, this.servers.length]];
    [...counts.entries()]
      .sort((a, b) => (isEn ? a[1].nameEn : a[1].name).localeCompare(isEn ? b[1].nameEn : b[1].name, isEn ? "en" : "zh"))
      .forEach(([code, info]) => entries.push([code, isEn ? info.nameEn : info.name, info.count]));

    const signature = JSON.stringify(entries);
    const hasCurrentFilter = Array.from(container.querySelectorAll(".filter-pill"))
      .some((button) => button.dataset.filter === this.currentFilter);
    if (container.dataset.signature === signature && hasCurrentFilter) return;

    const fragment = document.createDocumentFragment();
    entries.forEach(([code, label, count]) => {
      const button = document.createElement("button");
      button.className = `filter-pill${this.currentFilter === code ? " active" : ""}`;
      button.dataset.filter = code;
      button.append(document.createTextNode(`${label} `));
      const countEl = document.createElement("span");
      countEl.className = "filter-count";
      countEl.textContent = `(${count})`;
      button.appendChild(countEl);
      fragment.appendChild(button);
    });
    container.replaceChildren(fragment);
    container.dataset.signature = signature;
  }

  // ========================================================================
  // Server List & Filtering (Table View & Grid View)
  // ========================================================================
  getFilteredServers() {
    return this.servers.filter((s) => {
      // Region Filter
      const code = String(s.region || "unknown").trim().toLowerCase() || "unknown";
      const name = String(s.regionName || "").trim();
      const regionKey = `${code}::${name.toLocaleLowerCase()}`;
      if (this.currentFilter !== "all" && regionKey !== this.currentFilter) return false;

      // Search Query
      if (this.searchQuery) {
        const query = this.searchQuery;
        const matchName = s.name.toLowerCase().includes(query);
        const matchRegion = (s.regionName + " " + s.regionNameEn).toLowerCase().includes(query);
        const matchProvider = s.provider.toLowerCase().includes(query);
        const matchRoute = Object.values(s.routes).some(r => (r.line + " " + r.as).toLowerCase().includes(query));
        return matchName || matchRegion || matchProvider || matchRoute;
      }
      return true;
    });
  }

  renderServers() {
    const list = this.getFilteredServers();
    const t = I18N[this.currentLang];
    const isEn = this.currentLang === "en";

    // 1. Render Table Body
    const tbody = document.getElementById("tableBody");
    tbody.innerHTML = "";

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:3rem; color:var(--text-muted);">${isEn ? "No servers found matching criteria" : "未找到匹配条件的服务器"}</td></tr>`;
    }

    list.forEach((s) => {
      const tr = document.createElement("tr");
      tr.setAttribute("data-server-id", s.id);
      tr.addEventListener("click", () => this.openDetailModal(s));

      const regionLabel = isEn ? s.regionNameEn : s.regionName;
      // 分母为 0 时不能算百分比，否则会渲染出 NaN
      const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0);
      const memPct = pct(s.metrics.memoryUsed, s.metrics.memoryTotal).toFixed(0);
      const diskPct = pct(s.metrics.diskUsed, s.metrics.diskTotal).toFixed(0);
      const trafficPct = pct(s.bandwidth.usedBytes, s.bandwidth.totalBytes).toFixed(1);
      const upMB = (s.bandwidth.currentOutSpeed / (1024 * 1024)).toFixed(2);
      const downMB = (s.bandwidth.currentInSpeed / (1024 * 1024)).toFixed(2);
      // 没有 agent 上报时一律显示占位符，不把 0 伪装成真实读数
      const dash = (text) => (s._live ? text : "—");

      // Format Price & Cycle
      const cycleText = isEn ? s.billing.cycleTextEn : s.billing.cycleTextCn;
      const priceText = `${s.billing.currency}${s.billing.price.toFixed(2)}`;

      // Status class
      const statusClass = s.status === "online" ? "" : s.status;

      tr.innerHTML = `
        <!-- System Cell -->
        <td>
          <div class="system-cell">
            <span class="status-dot ${statusClass}" title="${t['status_' + s.status] || 'Online'}"></span>
            ${regionFlagMarkup(s)}
            <div class="system-info">
              <span class="system-name">${s.name}</span>
              <span class="system-location">
                <span>${regionLabel}</span> · 
                <span style="color:var(--text-faint);">${s.provider}</span>
              </span>
              <span class="offline-duration" data-status="${s.status}" data-last-seen="${s.lastSeen}" ${s.status === "offline" ? "" : "hidden"}></span>
            </div>
          </div>
        </td>

        <!-- CPU -->
        <td>
          <div class="progress-wrap">
            <div class="progress-header">
              <span class="val-cpu-text">${dash(s.metrics.cpuUsage.toFixed(1) + "%")}</span>
            </div>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill val-cpu-bar ${s.metrics.cpuUsage > 80 ? 'danger' : s.metrics.cpuUsage > 60 ? 'warning' : ''}" style="width: ${s._live ? s.metrics.cpuUsage : 0}%"></div>
            </div>
          </div>
        </td>

        <!-- Memory -->
        <td>
          <div class="progress-wrap">
            <div class="progress-header">
              <span class="val-mem-used">${dash(s.metrics.memoryUsed + "G")}</span>
              <span class="val-mem-total" style="color:var(--text-muted); font-size:0.7rem;">/ ${dash(s.metrics.memoryTotal + "G")}</span>
            </div>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill val-mem-bar ${memPct > 85 ? 'danger' : memPct > 70 ? 'warning' : ''}" style="width: ${memPct}%"></div>
            </div>
          </div>
        </td>

        <!-- Disk -->
        <td>
          <div class="progress-wrap">
            <div class="progress-header">
              <span class="val-disk-pct">${dash(diskPct + "%")}</span>
              <span class="val-disk-used" style="color:var(--text-muted); font-size:0.7rem;">${dash(s.metrics.diskUsed + "G")}</span>
            </div>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill val-disk-bar ${diskPct > 90 ? 'danger' : diskPct > 75 ? 'warning' : ''}" style="width: ${diskPct}%"></div>
            </div>
          </div>
        </td>

        <!-- Net Speed (Up / Down) -->
        <td>
          <div style="font-family:var(--font-mono); font-size:0.78rem;">
            <div style="color: #10b981;" class="val-net-up">↑ ${dash(upMB + " MB/s")}</div>
            <div style="color: #3b82f6;" class="val-net-down">↓ ${dash(downMB + " MB/s")}</div>
          </div>
        </td>

        <!-- Traffic Quota -->
        <td>
          <div class="progress-wrap">
            <div class="progress-header">
              <span class="val-traffic-pct">${dash(trafficPct + "%")}</span>
              <span class="val-traffic-used" style="color:var(--text-muted); font-size:0.7rem;">${dash((s.bandwidth.usedBytes / (1024 ** 3)).toFixed(0) + "G")}</span>
            </div>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill val-traffic-bar ${trafficPct > 90 ? 'danger' : trafficPct > 80 ? 'warning' : ''}" style="width: ${trafficPct}%"></div>
            </div>
          </div>
        </td>

        <!-- Billing -->
        <td>
          <div class="billing-pill">
            <span class="billing-price">${priceText}</span>
            <span class="billing-cycle">${cycleText}</span>
          </div>
        </td>

        <!-- Route Tags -->
        <td>
          <div class="routes-chips">
            <span class="route-chip val-route-ct ${s.routes.ct.status}">CT:${routeShort(s.routes.ct.line)}</span>
            <span class="route-chip val-route-cu ${s.routes.cu.status}">CU:${routeShort(s.routes.cu.line)}</span>
            <span class="route-chip val-route-cm ${s.routes.cm.status}">CM:${routeShort(s.routes.cm.line)}</span>
          </div>
        </td>

        <!-- Action -->
        <td style="text-align: right;">
          <button class="btn-action" onclick="event.stopPropagation(); window.app.openDetailModal(window.app.servers.find(x => x.id === '${s.id}'))">
            ${t.btn_detail}
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // 2. Render Cards View
    const gridContainer = document.getElementById("gridViewSection");
    gridContainer.innerHTML = "";

    list.forEach((s) => {
      const card = document.createElement("div");
      card.className = "server-card";
      card.setAttribute("data-server-id", s.id);
      card.addEventListener("click", () => this.openDetailModal(s));

      const regionLabel = isEn ? s.regionNameEn : s.regionName;
      const cpct = (a, b) => (b > 0 ? (a / b) * 100 : 0);
      const memPct = cpct(s.metrics.memoryUsed, s.metrics.memoryTotal).toFixed(0);
      const trafficPct = cpct(s.bandwidth.usedBytes, s.bandwidth.totalBytes).toFixed(1);
      const cycleText = isEn ? s.billing.cycleTextEn : s.billing.cycleTextCn;
      const priceText = `${s.billing.currency}${s.billing.price.toFixed(2)}`;
      const cdash = (text) => (s._live ? text : "—");

      card.innerHTML = `
        <div>
          <div class="card-top">
            <div class="card-title-group">
              <span class="status-dot ${s.status === 'online' ? '' : s.status}"></span>
              ${regionFlagMarkup(s)}
              <div>
                <div style="font-weight:600; font-size:0.95rem; color:var(--text-main);">${s.name}</div>
                <div class="card-meta">${regionLabel} · ${s.provider}</div>
                <div class="offline-duration" data-status="${s.status}" data-last-seen="${s.lastSeen}" ${s.status === "offline" ? "" : "hidden"}></div>
              </div>
            </div>
            <span class="card-badge">${s.billing.cycleTextEn}</span>
          </div>

          <div class="card-metrics-grid">
            <div>
              <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:0.25rem;">CPU (<span class="card-cpu-val">${cdash(s.metrics.cpuUsage.toFixed(1) + "%")}</span>)</div>
              <div class="progress-bar-bg">
                <div class="progress-bar-fill card-cpu-bar" style="width: ${s._live ? s.metrics.cpuUsage : 0}%;"></div>
              </div>
            </div>
            <div>
              <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:0.25rem;">RAM (${cdash(memPct + "%")})</div>
              <div class="progress-bar-bg">
                <div class="progress-bar-fill" style="width: ${memPct}%;"></div>
              </div>
            </div>
            <div>
              <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:0.25rem;">TRAFFIC (${cdash(trafficPct + "%")})</div>
              <div class="progress-bar-bg">
                <div class="progress-bar-fill" style="width: ${trafficPct}%;"></div>
              </div>
            </div>
            <div>
              <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:0.25rem;">PING (${cdash(latencyText(s.pingTest.avgPing))})</div>
              <div class="progress-bar-bg">
                <div class="progress-bar-fill" style="width: ${s._live && s.pingTest.avgPing > 0 && s.pingTest.avgPing < 999 ? Math.min(100, s.pingTest.avgPing / 2) : 0}%;"></div>
              </div>
            </div>
          </div>
        </div>

        <div class="card-billing-row">
          <div>
            <span style="font-size:1.05rem; font-weight:700; font-family:var(--font-mono);">${priceText}</span>
            <span style="color:var(--text-muted); font-size:0.75rem;">/ ${cycleText}</span>
          </div>
          <button class="btn-action">${t.btn_detail}</button>
        </div>
      `;
      gridContainer.appendChild(card);
    });

    this.updateOfflineDurations();
  }

  // ========================================================================
  // Detail Modal & Smokeping Latency Chart (Canvas Engine)
  // ========================================================================
  async openDetailModal(server) {
    if (!server) return;
    this.activeServer = server;
    this.populateModal(server);
    const modal = document.getElementById("detailModal");
    modal.classList.add("show");
    document.body.style.overflow = "hidden"; // Prevent body scroll

    // 先拉这个节点的真实历史时序，再画图。原来这里画的是写死的数组。
    await Promise.all([this.loadMetricsFor(server), this.loadTargetHistory(server.id)]);
    setTimeout(() => {
      this.renderSmokepingChart(server);
      this.populateModal(server); // 历史数据到位后重渲染，把 sparkline 画上

      // 指标图初始化：默认实时 + CPU
      this.currentMetric = "cpu";
      this.currentRange = "live";
      document.querySelectorAll("#metricTabs button").forEach((b) => {
        b.classList.toggle("active", b.dataset.metric === "cpu");
        b.onclick = () => {
          this.currentMetric = b.dataset.metric;
          document.querySelectorAll("#metricTabs button").forEach((x) => x.classList.toggle("active", x === b));
          this.renderMetricChart();
        };
      });
      document.querySelectorAll("#metricRangeBtns button").forEach((b) => {
        b.classList.toggle("active", b.dataset.range === "live");
        b.onclick = () => this.setMetricRange(b.dataset.range);
      });
      this.renderMetricChart();
    }, 60);
  }

  /// 拉取该节点所有监控目标的历史时序（用于画 sparkline）
  async loadTargetHistory(serverId) {
    if (!serverId || location.protocol === "file:") return;
    try {
      const url = (bucket) =>
        `/api/v1/target_metrics/${encodeURIComponent(serverId)}?hours=24&bucket=${bucket}`;

      let res = await fetch(url(300), { cache: "no-store" });
      if (!res.ok) return;
      let data = await res.json();
      if (!Array.isArray(data)) return;

      // 刚部署的实例 5 分钟才有一个桶，画不出线。这时改用 60 秒桶重取一次，
      // 让用户不用等太久；数据攒起来之后仍然回到 300 秒桶，避免点数过多。
      const avgPoints = data.length
        ? data.reduce((a, s) => a + s.points.length, 0) / data.length
        : 0;
      if (avgPoints < 2) {
        const fine = await fetch(url(60), { cache: "no-store" });
        if (fine.ok) {
          const fineData = await fine.json();
          if (Array.isArray(fineData)) data = fineData;
        }
      }

      this.targetHistory = this.targetHistory || {};
      this.targetHistory[serverId] = data;
    } catch (e) {
      // 没有历史数据就只显示当前值，不画线
    }
  }

  /// 用内联 SVG 画一条迷你趋势线。null（整桶超时）处断开。
  renderSparkline(points, color) {
    if (!Array.isArray(points) || points.length < 2) return "";

    const W = 120;
    const H = 24;
    const PAD = 2;

    const vals = points.map((p) => p.ms).filter((v) => v != null);
    if (vals.length === 0) return "";

    const max = Math.max(50, ...vals);
    const stepX = W / (points.length - 1);

    let d = "";
    let pen = false;
    points.forEach((p, i) => {
      if (p.ms == null) {
        pen = false; // 这一桶全超时，断线
        return;
      }
      const x = i * stepX;
      const y = H - PAD - (p.ms / max) * (H - PAD * 2);
      d += `${pen ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)} `;
      pen = true;
    });
    if (!d) return "";

    return `<svg class="target-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <path d="${d}" fill="none" stroke="${color}" stroke-width="1.5"
            stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    </svg>`;
  }

  /// 从后端取近 24 小时的聚合时序，转成 Canvas 图表需要的结构
  async loadMetricsFor(server) {
    if (!server || location.protocol === "file:") {
      if (server) server.pingHistory = null;
      return;
    }
    try {
      const res = await fetch(
        `/api/v1/metrics/${encodeURIComponent(server.id)}?hours=24&bucket=300`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        server.pingHistory = null;
        return;
      }
      const pts = await res.json();
      if (!Array.isArray(pts) || pts.length === 0) {
        server.pingHistory = null;
        return;
      }

      const timestamps = pts.map((p) => {
        const d = new Date(p.ts * 1000);
        return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      });

      server.pingHistory = {
        timestamps,
        series: [
          { name: "中国电信", color: "#10b981", data: pts.map((p) => Math.round(p.lat_ct)) },
          { name: "中国联通", color: "#3b82f6", data: pts.map((p) => Math.round(p.lat_cu)) },
          { name: "中国移动", color: "#f59e0b", data: pts.map((p) => Math.round(p.lat_cm)) },
        ],
      };
    } catch (e) {
      server.pingHistory = null;
    }
  }

  closeDetailModal() {
    const modal = document.getElementById("detailModal");
    modal.classList.remove("show");
    document.body.style.overflow = "";
  }

  populateModal(s) {
    const t = I18N[this.currentLang];
    const isEn = this.currentLang === "en";

    // Header info
    document.getElementById("modalServerName").textContent = s.name;
    document.getElementById("modalProvider").textContent = s.provider;
    const modalRegionLabel = document.getElementById("modalRegionLabel");
    if (modalRegionLabel) modalRegionLabel.textContent = isEn ? s.regionNameEn : s.regionName;
    else document.getElementById("modalRegion").textContent = isEn ? s.regionNameEn : s.regionName;
    const modalRegionFlag = document.getElementById("modalRegionFlag");
    if (modalRegionFlag) {
      modalRegionFlag.src = `/assets/flags/${getRegionFlagCode(s)}.svg`;
      modalRegionFlag.alt = isEn ? s.regionNameEn : s.regionName;
    }
    document.getElementById("modalOs").textContent = s._live
      ? ([s.os, s.cpuModel].filter(Boolean).join(" · ") || "—")
      : "—";
    document.getElementById("modalUptime").textContent = s._live
      ? (isEn ? `Uptime ${uptimeText(s.uptimeSecs, true)}` : `连续在线 ${uptimeText(s.uptimeSecs, false)}`)
      : (isEn ? "No agent reporting" : "暂无 Agent 上报");

    const statusDot = document.getElementById("modalStatusDot");
    statusDot.className = "status-dot " + (s.status === "online" ? "" : s.status);

    // Billing
    const priceFormatted = `${s.billing.currency}${s.billing.price.toFixed(2)}`;
    document.getElementById("modalBillingPrice").textContent = priceFormatted;
    document.getElementById("modalBillingCycle").textContent = isEn ? s.billing.cycleTextEn : s.billing.cycleTextCn;
    document.getElementById("modalRenewalDate").textContent = s.billing.renewalDate;
    document.getElementById("modalRemainingDays").textContent = t.days_left.replace("{d}", s.billing.remainingDays);
    document.getElementById("modalAutoRenew").textContent = s.billing.autoRenew ? t.auto_renew : t.manual_renew;

    // Billing progress calculation
    const cycleProgress = Math.min(100, Math.max(10, 100 - (s.billing.remainingDays / 30) * 100));
    document.getElementById("modalCycleProgressText").textContent = `${cycleProgress.toFixed(0)}%`;
    document.getElementById("modalCycleProgressBar").style.width = `${cycleProgress.toFixed(0)}%`;

    // Bandwidth
    const usedGB = (s.bandwidth.usedBytes / (1024 ** 3)).toFixed(1);
    const totalGB = (s.bandwidth.totalBytes / (1024 ** 3)).toFixed(0);
    const trafficPct = s.bandwidth.totalBytes > 0
      ? ((s.bandwidth.usedBytes / s.bandwidth.totalBytes) * 100).toFixed(1)
      : "0.0";
    const remainingGB = Math.max(0, totalGB - usedGB).toFixed(1);

    document.getElementById("modalTrafficUsed").textContent = `${usedGB} GB`;
    document.getElementById("modalTrafficTotal").textContent = `${totalGB} GB`;
    document.getElementById("modalTrafficPct").textContent = `${trafficPct}%`;
    document.getElementById("modalTrafficBar").style.width = `${trafficPct}%`;
    document.getElementById("modalSpeedUp").textContent = `${(s.bandwidth.currentOutSpeed / (1024 * 1024)).toFixed(2)} MB/s`;
    document.getElementById("modalSpeedDown").textContent = `${(s.bandwidth.currentInSpeed / (1024 * 1024)).toFixed(2)} MB/s`;
    document.getElementById("modalResetDay").textContent = isEn ? `Day ${s.bandwidth.resetDay} of month` : `每月 ${s.bandwidth.resetDay} 日`;
    document.getElementById("modalTrafficRemaining").textContent = isEn ? `${remainingGB} GB remaining` : `剩余 ${remainingGB} GB 可用`;
    document.getElementById("modalTrafficType").textContent = s.bandwidth.type === "outbound" ? (isEn ? "Outbound Quota" : "单向出站计费") : (isEn ? "Bidirectional" : "双向计费");

    // 系统信息（agent 上报的完整硬件/系统画像）
    const sysGrid = document.getElementById("sysInfoGrid");
    if (sysGrid) {
      const kv = (k, v) => {
        const val = (v === 0 || v) && v !== "" ? String(v) : "—";
        return '<div class="sys-kv"><span class="k">' + k + '</span><span class="v" title="' + val.replace(/"/g, '&quot;') + '">' + val + '</span></div>';
      };
      const gb = (bytes) => (bytes / 1024 ** 3).toFixed(1) + " GB";
      const swapPct = s.metrics.swapTotal > 0
        ? ((s.metrics.swapUsed / s.metrics.swapTotal) * 100).toFixed(0)
        : null;

      sysGrid.innerHTML = [
        kv("操作系统", s.os),
        kv("内核版本", s.kernel),
        kv("架构", s.arch),
        kv("虚拟化", s.virtualization),
        kv("处理器", s.cpuModel),
        kv("核心数", s.cpuCores ? s.cpuCores + " 核" : ""),
        kv("显卡", s.gpu),
        kv("内存", s._live ? s.metrics.memoryUsed + " / " + s.metrics.memoryTotal + " GB" : ""),
        kv("Swap", s._live
          ? (s.metrics.swapTotal > 0
              ? s.metrics.swapUsed + " / " + s.metrics.swapTotal + " GB (" + swapPct + "%)"
              : "未启用")
          : ""),
        kv("磁盘", s._live ? s.metrics.diskUsed + " / " + s.metrics.diskTotal + " GB" : ""),
        kv("系统负载", s._live
          ? s.load1.toFixed(2) + " / " + s.load5.toFixed(2) + " / " + s.load15.toFixed(2)
          : ""),
        kv("进程数", s._live ? s.processes : ""),
        kv("TCP 连接", s._live ? s.tcpConns : ""),
        kv("UDP 连接", s._live ? s.udpConns : ""),
        kv("运行时长", s._live ? uptimeText(s.uptimeSecs, isEn) : ""),
        kv("累计流量", s._live ? "↑ " + gb(s.totalTx) + "  ↓ " + gb(s.totalRx) : ""),
        kv("实时速率", s._live
          ? "↑ " + (s.bandwidth.currentOutSpeed / 1024 / 1024).toFixed(2) +
            "  ↓ " + (s.bandwidth.currentInSpeed / 1024 / 1024).toFixed(2) + " MB/s"
          : ""),
      ].join("");
    }

    // Routes Traceback
    const routesContainer = document.getElementById("modalRoutesContainer");
    routesContainer.innerHTML = "";
    Object.keys(s.routes).forEach((k) => {
      const r = s.routes[k];
      const statusLabel = t["opt_" + r.status] || r.status;
      const item = document.createElement("div");
      item.className = "route-item";
      item.dataset.routeKey = k;
      item.innerHTML = `
        <div class="route-item-head">
          <span class="route-name">${r.name}</span>
          <span class="route-chip ${r.status}">${statusLabel}</span>
        </div>
        <div class="route-line">${r.line}</div>
        <div class="route-meta">
          <span>${r.as}</span> · <span>${latencyText(r.ping)}</span>
        </div>
      `;
      routesContainer.appendChild(item);
    });

    // 自定义监控目标（后台配置的 IP 列表，Agent 逐个 TCP 探测）
    const targetsCard = document.getElementById("targetsCard");
    const targetsContainer = document.getElementById("modalTargetsContainer");
    if (targetsCard && targetsContainer) {
      const tlist = Array.isArray(s.targets) ? s.targets : [];
      if (tlist.length === 0) {
        targetsCard.style.display = "none";
      } else {
        targetsCard.style.display = "block";
        targetsContainer.innerHTML = "";
        tlist.forEach((tg) => {
          const ok = tg.ms > 0 && tg.ms < 999;

          // 历史趋势：同一目标的时序点
          const hist = ((this.targetHistory || {})[s.id] || []).find(
            (h) => h.target_id === tg.id
          );
          const points = hist ? hist.points : [];
          const spark = this.renderSparkline(points, ok ? "#10b981" : "#ef4444");

          // 近 24 小时丢包率（该目标所有桶的超时次数 / 总次数）
          let lossText = "";
          if (points.length > 0) {
            const total = points.reduce((a, p) => a + p.total, 0);
            const to = points.reduce((a, p) => a + p.timeouts, 0);
            if (total > 0) lossText = ` · 丢包 ${((to / total) * 100).toFixed(0)}%`;
          }

          const item = document.createElement("div");
          item.className = "route-item";
          item.dataset.targetId = tg.id;
          item.innerHTML = `
            <div class="route-item-head">
              <span class="route-name">${tg.name}</span>
              <span class="route-chip ${ok ? "optimal" : "warning"}">${ok ? "正常" : "超时"}</span>
            </div>
            <div class="route-line">${tg.host}</div>
            <div class="route-meta">
              <span>${tg.region || "—"}</span> · <span>${latencyText(tg.ms)}${lossText}</span>
            </div>
            ${spark}
          `;
          targetsContainer.appendChild(item);
        });
      }
    }
  }

  // ========================================================================
  // Canvas Smokeping Chart Renderer (Matches User's Image 2)
  // ========================================================================
  // ========================================================================
  // 多周期性能指标图表（实时 / 1h / 4h / 1d / 7d / 30d）
  // ========================================================================

  /// 把某个指标在某区间内的数据整理成 { unit, max, series }
  metricSeriesFor(s, metric, range) {
    let pts;
    let pick;

    if (range === "live") {
      pts = s.liveBuffer || [];
      pick = (fn) => pts.map(fn);
      switch (metric) {
        case "cpu":
          return { unit: "%", max: 100, series: [{ name: "CPU", color: "#10b981", data: pick((p) => p.cpu) }] };
        case "mem":
          return { unit: "GB", series: [{ name: "内存", color: "#3b82f6", data: pick((p) => p.mem) }] };
        case "disk":
          return { unit: "GB", series: [{ name: "磁盘", color: "#f59e0b", data: pick((p) => p.disk) }] };
        case "net":
          return { unit: "KB/s", series: [
            { name: "下行", color: "#3b82f6", data: pick((p) => p.netIn) },
            { name: "上行", color: "#10b981", data: pick((p) => p.netOut) },
          ] };
        case "conns":
          return { unit: "条", series: [
            { name: "TCP", color: "#8b5cf6", data: pick((p) => p.tcp) },
            { name: "UDP", color: "#f59e0b", data: pick((p) => p.udp) },
          ] };
        case "load":
          return { unit: "", series: [{ name: "1 分钟负载", color: "#ef4444", data: pick((p) => p.load) }] };
        case "processes":
          return { unit: "个", series: [{ name: "进程数", color: "#06b6d4", data: pick((p) => p.procs) }] };
      }
      return { unit: "", series: [] };
    }

    pts = ((this.metricSeries || {})[range]) || [];
    pick = (fn) => pts.map(fn);
    switch (metric) {
      case "cpu":
        return { unit: "%", max: 100, series: [{ name: "CPU", color: "#10b981", data: pick((p) => p.cpu) }] };
      case "mem":
        return { unit: "GB", series: [{ name: "内存", color: "#3b82f6", data: pick((p) => p.mem_used_mb / 1024) }] };
      case "disk":
        return { unit: "GB", series: [{ name: "磁盘", color: "#f59e0b", data: pick((p) => p.disk_used_bytes / 1024 ** 3) }] };
      case "net":
        return { unit: "KB/s", series: [
          { name: "下行", color: "#3b82f6", data: pick((p) => p.net_in_kb) },
          { name: "上行", color: "#10b981", data: pick((p) => p.net_out_kb) },
        ] };
      case "conns":
        return { unit: "条", series: [
          { name: "TCP", color: "#8b5cf6", data: pick((p) => p.tcp_conns) },
          { name: "UDP", color: "#f59e0b", data: pick((p) => p.udp_conns) },
        ] };
      case "load":
        return { unit: "", series: [
          { name: "1 分钟", color: "#ef4444", data: pick((p) => p.load1) },
          { name: "5 分钟", color: "#f59e0b", data: pick((p) => p.load5) },
        ] };
      case "processes":
        return { unit: "个", series: [{ name: "进程数", color: "#06b6d4", data: pick((p) => p.processes) }] };
    }
    return { unit: "", series: [] };
  }

  async loadMetricSeries(range) {
    const s = this.activeServer;
    if (!s || location.protocol === "file:") return;
    const conf = {
      "1h": [1, 60],
      "4h": [4, 120],
      "1d": [24, 300],
      "7d": [168, 1800],
      "30d": [720, 7200],
      "365d": [8760, 86400],
    }[range];
    if (!conf) return;

    try {
      const res = await fetch(
        `/api/v1/metrics/${encodeURIComponent(s.id)}?hours=${conf[0]}&bucket=${conf[1]}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const pts = await res.json();
      this.metricSeries = this.metricSeries || {};
      this.metricSeries[range] = Array.isArray(pts) ? pts : [];
    } catch (e) {}
  }

  async setMetricRange(range) {
    this.currentRange = range;
    document.querySelectorAll("#metricRangeBtns button").forEach((b) => {
      b.classList.toggle("active", b.dataset.range === range);
    });
    if (range !== "live") await this.loadMetricSeries(range);
    this.renderMetricChart();
  }

  renderMetricChart() {
    const canvas = document.getElementById("metricCanvas");
    const s = this.activeServer;
    if (!canvas || !s) return;

    const metric = this.currentMetric || "cpu";
    const range = this.currentRange || "live";
    const { unit, max, series } = this.metricSeriesFor(s, metric, range);

    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, rect.width * dpr);
    canvas.height = Math.max(1, rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const gridColor = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)";
    const textColor = isDark ? "#64748b" : "#94a3b8";

    const padL = 46;
    const padR = 12;
    const padT = 12;
    const padB = 24;
    const plotW = Math.max(1, w - padL - padR);
    const plotH = Math.max(1, h - padT - padB);

    const all = series.flatMap((x) => x.data).filter((v) => v != null && !isNaN(v));
    let yMax = max || (all.length ? Math.max(...all) : 1);
    if (!yMax || yMax <= 0) yMax = 1;
    if (!max) yMax = yMax * 1.15;

    ctx.font = "10px -apple-system, BlinkMacSystemFont, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const v = (yMax / 4) * i;
      const y = padT + plotH - (v / yMax) * plotH;
      ctx.beginPath();
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      ctx.fillStyle = textColor;
      ctx.fillText(v < 10 ? v.toFixed(1) : Math.round(v).toString(), padL - 6, y);
    }

    const hasData = series.some((x) => x.data.length >= 2);
    if (!hasData) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = textColor;
      ctx.font = "12px -apple-system, sans-serif";
      ctx.fillText(
        range === "live" ? "正在采集实时数据…" : "该区间暂无历史数据",
        w / 2,
        h / 2
      );
      return;
    }

    series.forEach((sr) => {
      const n = sr.data.length;
      if (n < 2) return;
      const stepX = plotW / (n - 1);
      ctx.beginPath();
      ctx.strokeStyle = sr.color;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      sr.data.forEach((v, i) => {
        const val = Math.min(yMax, Math.max(0, v == null || isNaN(v) ? 0 : v));
        const x = padL + i * stepX;
        const y = padT + plotH - (val / yMax) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    // 单位标签
    if (unit) {
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = textColor;
      ctx.font = "10px -apple-system, sans-serif";
      ctx.fillText(unit, 6, padT + 8);
    }

    // 图例
    let lx = padL;
    const ly = h - 7;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "10px -apple-system, sans-serif";
    series.forEach((sr) => {
      ctx.fillStyle = sr.color;
      ctx.fillRect(lx, ly - 3, 9, 3);
      ctx.fillStyle = textColor;
      ctx.fillText(sr.name, lx + 13, ly - 1);
      lx += ctx.measureText(sr.name).width + 30;
    });
  }

  renderSmokepingChart(server) {
    const canvas = document.getElementById("pingCanvas");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    // Detect Theme colors
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const gridColor = isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.06)";
    const textColor = isDark ? "#64748b" : "#94a3b8";

    // Chart margins
    const padLeft = 45;
    const padRight = 15;
    const padTop = 15;
    const padBottom = 28;

    const plotW = w - padLeft - padRight;
    const plotH = h - padTop - padBottom;

    ctx.clearRect(0, 0, w, h);

    // 没有历史数据时画一句说明，不要拿假数组糊弄
    if (!server.pingHistory || !server.pingHistory.series || server.pingHistory.series.length === 0) {
      ctx.fillStyle = textColor;
      ctx.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        this.currentLang === "zh"
          ? "暂无历史数据 · Agent 上报后每 60 秒归档一次"
          : "No history yet · archived every 60s once an agent reports",
        w / 2,
        h / 2
      );
      return;
    }

    const seriesData = server.pingHistory.series;
    const timestamps = server.pingHistory.timestamps;

    // Y-Axis scale: 0 to 300 ms (exactly like Image 2)
    const maxPing = 300;
    const yTicks = [0, 50, 100, 150, 200, 250, 300];

    // 1. Draw horizontal grid lines & Y labels
    ctx.font = "10px -apple-system, BlinkMacSystemFont, monospace";
    ctx.fillStyle = textColor;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    yTicks.forEach((tick) => {
      const y = padTop + plotH - (tick / maxPing) * plotH;
      ctx.beginPath();
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      ctx.moveTo(padLeft, y);
      ctx.lineTo(w - padRight, y);
      ctx.stroke();

      ctx.fillText(`${tick} ms`, padLeft - 6, y);
    });

    // 2. Draw X-Axis labels
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const xStep = plotW / (timestamps.length - 1);
    timestamps.forEach((t, i) => {
      // show every 2nd or 3rd label on small screens
      if (w < 500 && i % 2 !== 0) return;
      const x = padLeft + i * xStep;
      ctx.fillText(t, x, h - padBottom + 8);
    });

    // 3. Render Chart Legend
    const legendContainer = document.getElementById("chartLegend");
    legendContainer.innerHTML = "";
    seriesData.forEach((s) => {
      const item = document.createElement("div");
      item.className = "legend-item";
      item.innerHTML = `
        <span class="legend-color" style="background-color: ${s.color};"></span>
        <span>${s.name}</span>
      `;
      legendContainer.appendChild(item);
    });

    // 4. Draw Smokeping lines with jitter & noise (just like the user's uploaded graph)
    seriesData.forEach((s) => {
      ctx.beginPath();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5;

      const pts = s.data;
      pts.forEach((val, i) => {
        const x = padLeft + i * xStep;
        // Clamp value between 0 and maxPing
        const clampedVal = Math.min(maxPing, Math.max(0, val));
        const y = padTop + plotH - (clampedVal / maxPing) * plotH;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();

      // Draw little pulse nodes
      pts.forEach((val, i) => {
        const x = padLeft + i * xStep;
        const clampedVal = Math.min(maxPing, Math.max(0, val));
        const y = padTop + plotH - (clampedVal / maxPing) * plotH;

        ctx.beginPath();
        ctx.fillStyle = s.color;
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      });
    });
  }

  // ========================================================================
  // In-Place Smooth DOM Updates (No screen flashing, fluid liquid transition)
  // ========================================================================
  updateMetricsInPlace() {
    this.servers.forEach((s) => {
      const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0);
      const upMB = (s.bandwidth.currentOutSpeed / (1024 * 1024)).toFixed(2);
      const downMB = (s.bandwidth.currentInSpeed / (1024 * 1024)).toFixed(2);
      const cpuVal = s.metrics.cpuUsage.toFixed(1);
      const memPct = pct(s.metrics.memoryUsed, s.metrics.memoryTotal).toFixed(0);
      const diskPct = pct(s.metrics.diskUsed, s.metrics.diskTotal).toFixed(0);
      const trafficPct = pct(s.bandwidth.usedBytes, s.bandwidth.totalBytes).toFixed(1);
      const trafficUsedGB = (s.bandwidth.usedBytes / 1024 ** 3).toFixed(0);
      const dash = (text) => (s._live ? text : "—");

      // 1. Table View Update (Fluid CSS Transition)
      const row = document.querySelector(`tr[data-server-id="${s.id}"]`);
      if (row) {
        const set = (sel, txt) => {
          const el = row.querySelector(sel);
          if (el && el.textContent !== txt) el.textContent = txt;
        };
        const setBar = (sel, width, cls) => {
          const el = row.querySelector(sel);
          if (!el) return;
          if (el.style.width !== width) el.style.width = width;
          if (el.className !== cls) el.className = cls;
        };
        const barCls = (base, v, hi, mid) =>
          `${base} ${v > hi ? "danger" : v > mid ? "warning" : ""}`;

        set(".val-cpu-text", dash(`${cpuVal}%`));
        setBar(
          ".val-cpu-bar",
          s._live ? `${cpuVal}%` : "0%",
          barCls("progress-bar-fill val-cpu-bar", s.metrics.cpuUsage, 80, 60)
        );

        set(".val-mem-used", dash(`${s.metrics.memoryUsed}G`));
        set(".val-mem-total", `/ ${dash(`${s.metrics.memoryTotal}G`)}`);
        setBar(
          ".val-mem-bar",
          `${memPct}%`,
          barCls("progress-bar-fill val-mem-bar", +memPct, 85, 70)
        );

        set(".val-disk-pct", dash(`${diskPct}%`));
        set(".val-disk-used", dash(`${s.metrics.diskUsed}G`));
        setBar(
          ".val-disk-bar",
          `${diskPct}%`,
          barCls("progress-bar-fill val-disk-bar", +diskPct, 90, 75)
        );

        set(".val-net-up", `↑ ${dash(upMB + " MB/s")}`);
        set(".val-net-down", `↓ ${dash(downMB + " MB/s")}`);

        set(".val-traffic-pct", dash(`${trafficPct}%`));
        set(".val-traffic-used", dash(`${trafficUsedGB}G`));
        setBar(
          ".val-traffic-bar",
          `${trafficPct}%`,
          barCls("progress-bar-fill val-traffic-bar", +trafficPct, 90, 80)
        );

        // 回程线路：名称和状态色都要跟着更新
        ["ct", "cu", "cm"].forEach((k) => {
          const el = row.querySelector(`.val-route-${k}`);
          if (!el) return;
          const r = s.routes[k];
          const label = `${k.toUpperCase()}:${routeShort(r.line)}`;
          const className = `route-chip val-route-${k} ${r.status}`;
          if (el.textContent !== label) el.textContent = label;
          if (el.className !== className) el.className = className;
        });

        const dot = row.querySelector(".status-dot");
        const dotClass = `status-dot ${s.status === "online" ? "" : s.status}`;
        if (dot && dot.className !== dotClass) dot.className = dotClass;
        const offline = row.querySelector(".offline-duration");
        if (offline) {
          offline.dataset.status = s.status;
          offline.dataset.lastSeen = String(s.lastSeen || 0);
          offline.hidden = s.status !== "offline";
        }
      }

      // 2. Card View Update
      const card = document.querySelector(`.server-card[data-server-id="${s.id}"]`);
      if (card) {
        const cardCpuVal = card.querySelector(".card-cpu-val");
        const cardCpuBar = card.querySelector(".card-cpu-bar");
        const cardCpuText = dash(`${cpuVal}%`);
        if (cardCpuVal && cardCpuVal.textContent !== cardCpuText) cardCpuVal.textContent = cardCpuText;
        const cardCpuWidth = s._live ? `${cpuVal}%` : "0%";
        if (cardCpuBar && cardCpuBar.style.width !== cardCpuWidth) cardCpuBar.style.width = cardCpuWidth;
        const offline = card.querySelector(".offline-duration");
        if (offline) {
          offline.dataset.status = s.status;
          offline.dataset.lastSeen = String(s.lastSeen || 0);
          offline.hidden = s.status !== "offline";
        }
      }
    });

    this.updateOfflineDurations();

    // Update modal if currently open
    if (this.activeServer && document.getElementById("detailModal").classList.contains("show")) {
      this.updateModalLiveMetrics(this.activeServer);
      // Smokeping chart uses archived history and does not change on each live heartbeat.
      // Keep the live metric chart responsive without clearing/redrawing it every second.
      const now = performance.now();
      if ((this.currentRange || "live") === "live" && now - this.lastLiveChartRenderAt >= 3000) {
        this.renderMetricChart();
        this.lastLiveChartRenderAt = now;
      }
    }
  }

  updateModalLiveMetrics(s) {
    const modal = document.getElementById("detailModal");
    if (!modal || !modal.classList.contains("show")) return;

    const renderedTargetCount = document.querySelectorAll("#modalTargetsContainer [data-target-id]").length;
    if (renderedTargetCount !== (s.targets || []).length) {
      // Target configuration changed while the dialog was open; rebuild once for the new shape.
      this.populateModal(s);
      return;
    }

    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== value) el.textContent = value;
    };
    const setWidth = (id, value) => {
      const el = document.getElementById(id);
      if (el && el.style.width !== value) el.style.width = value;
    };
    const isEn = this.currentLang === "en";
    setText("modalOs", s._live ? ([s.os, s.cpuModel].filter(Boolean).join(" · ") || "—") : "—");
    setText("modalUptime", s._live
      ? (isEn ? `Uptime ${uptimeText(s.uptimeSecs, true)}` : `连续在线 ${uptimeText(s.uptimeSecs, false)}`)
      : (isEn ? "No agent reporting" : "暂无 Agent 上报"));
    setText("modalSpeedUp", `${(s.bandwidth.currentOutSpeed / (1024 * 1024)).toFixed(2)} MB/s`);
    setText("modalSpeedDown", `${(s.bandwidth.currentInSpeed / (1024 * 1024)).toFixed(2)} MB/s`);

    const usedGB = (s.bandwidth.usedBytes / (1024 ** 3)).toFixed(1);
    const totalGB = (s.bandwidth.totalBytes / (1024 ** 3)).toFixed(0);
    const trafficPct = s.bandwidth.totalBytes > 0
      ? ((s.bandwidth.usedBytes / s.bandwidth.totalBytes) * 100).toFixed(1)
      : "0.0";
    const remainingGB = Math.max(0, totalGB - usedGB).toFixed(1);
    setText("modalTrafficUsed", `${usedGB} GB`);
    setText("modalTrafficTotal", `${totalGB} GB`);
    setText("modalTrafficPct", `${trafficPct}%`);
    setWidth("modalTrafficBar", `${trafficPct}%`);
    setText("modalTrafficRemaining", isEn ? `${remainingGB} GB remaining` : `剩余 ${remainingGB} GB 可用`);

    // These cells are stable after the modal opens; update only their values, not the grid markup.
    const values = document.querySelectorAll("#sysInfoGrid .sys-kv .v");
    const gb = (bytes) => (bytes / 1024 ** 3).toFixed(1) + " GB";
    const swapPct = s.metrics.swapTotal > 0
      ? ((s.metrics.swapUsed / s.metrics.swapTotal) * 100).toFixed(0)
      : null;
    const dynamicValues = [
      s._live ? `${s.metrics.memoryUsed} / ${s.metrics.memoryTotal} GB` : "—",
      s._live
        ? (s.metrics.swapTotal > 0
            ? `${s.metrics.swapUsed} / ${s.metrics.swapTotal} GB (${swapPct}%)`
            : "未启用")
        : "—",
      s._live ? `${s.metrics.diskUsed} / ${s.metrics.diskTotal} GB` : "—",
      s._live ? `${s.load1.toFixed(2)} / ${s.load5.toFixed(2)} / ${s.load15.toFixed(2)}` : "—",
      s._live ? String(s.processes) : "—",
      s._live ? String(s.tcpConns) : "—",
      s._live ? String(s.udpConns) : "—",
      s._live ? uptimeText(s.uptimeSecs, isEn) : "—",
      s._live ? `↑ ${gb(s.totalTx)}  ↓ ${gb(s.totalRx)}` : "—",
      s._live
        ? `↑ ${(s.bandwidth.currentOutSpeed / 1024 / 1024).toFixed(2)}  ↓ ${(s.bandwidth.currentInSpeed / 1024 / 1024).toFixed(2)} MB/s`
        : "—",
    ];
    dynamicValues.forEach((value, index) => {
      const el = values[index + 7];
      if (el && el.textContent !== value) {
        el.textContent = value;
        el.title = value;
      }
    });

    Object.entries(s.routes).forEach(([key, route]) => {
      const item = document.querySelector(`#modalRoutesContainer [data-route-key="${key}"]`);
      if (!item) return;
      const chip = item.querySelector(".route-chip");
      const line = item.querySelector(".route-line");
      const meta = item.querySelectorAll(".route-meta span");
      const statusLabel = I18N[this.currentLang]["opt_" + route.status] || route.status;
      if (chip) {
        chip.className = `route-chip ${route.status}`;
        if (chip.textContent !== statusLabel) chip.textContent = statusLabel;
      }
      if (line && line.textContent !== route.line) line.textContent = route.line;
      if (meta[0] && meta[0].textContent !== route.as) meta[0].textContent = route.as;
      const latency = latencyText(route.ping);
      if (meta[1] && meta[1].textContent !== latency) meta[1].textContent = latency;
    });

    (s.targets || []).forEach((target) => {
      const item = Array.from(document.querySelectorAll("#modalTargetsContainer [data-target-id]"))
        .find((el) => el.dataset.targetId === target.id);
      if (!item) return;
      const ok = target.ms > 0 && target.ms < 999;
      const chip = item.querySelector(".route-chip");
      const meta = item.querySelectorAll(".route-meta span");
      const statusText = ok ? (isEn ? "Healthy" : "正常") : (isEn ? "Timeout" : "超时");
      if (chip) {
        chip.className = `route-chip ${ok ? "optimal" : "warning"}`;
        if (chip.textContent !== statusText) chip.textContent = statusText;
      }
      const latency = latencyText(target.ms);
      if (meta[1]) {
        const current = meta[1].textContent;
        const suffixAt = current.indexOf(" · ");
        const suffix = suffixAt >= 0 ? current.slice(suffixAt) : "";
        const next = `${latency}${suffix}`;
        if (current !== next) meta[1].textContent = next;
      }
    });

    const statusDot = document.getElementById("modalStatusDot");
    const statusClass = "status-dot " + (s.status === "online" ? "" : s.status);
    if (statusDot && statusDot.className !== statusClass) statusDot.className = statusClass;
  }

  // ========================================================================
  // Auto Refresh Timer & Dynamic Jitter Engine
  // ========================================================================
  startAutoRefresh() {
    this.refreshTimer = setInterval(() => {
      this.updateOfflineDurations();
      this.secondsRemaining--;
      if (this.secondsRemaining <= 0) {
        this.triggerDataRefresh(false);
        this.secondsRemaining = this.refreshInterval;
      }
    }, 1000);
  }

  updateOfflineDurations() {
    const isEn = this.currentLang === "en";
    document.querySelectorAll(".offline-duration").forEach((el) => {
      const offline = el.dataset.status === "offline";
      el.hidden = !offline;
      if (offline) {
        const text = offlineDurationText(Number(el.dataset.lastSeen), isEn);
        if (el.textContent !== text) el.textContent = text;
      }
    });
  }

  async triggerDataRefresh(manual) {
    if (this.refreshPromise) {
      if (manual) this.secondsRemaining = this.refreshInterval;
      return this.refreshPromise;
    }
    const refreshBtn = document.getElementById("refreshBtn");
    const refreshIcon = refreshBtn ? refreshBtn.querySelector(".refresh-icon") : null;
    if (manual && refreshIcon) {
      refreshIcon.classList.remove("spinning");
      void refreshIcon.offsetWidth; // force reflow for smooth re-trigger
      refreshIcon.classList.add("spinning");
    }
    if (manual) {
      document.documentElement.classList.add("data-loading");
      const loadingIndicator = document.getElementById("loadingIndicator");
      if (loadingIndicator) loadingIndicator.setAttribute("aria-hidden", "false");
      if (refreshBtn) refreshBtn.setAttribute("aria-busy", "true");
    }

    // 原来这里给每个节点随机抖动 CPU 和网速来"模拟心跳"，
    // 结果页面上的数字全是编的。现在老老实实向主控拉一次真实快照。
    const loadingStartedAt = performance.now();
    this.refreshPromise = this.fetchServersSnapshot().finally(() => {
      const visibleFor = performance.now() - loadingStartedAt;
      if (manual && visibleFor < 400) {
        return new Promise((resolve) => setTimeout(resolve, 400 - visibleFor));
      }
    }).finally(() => {
      if (manual && refreshIcon) refreshIcon.classList.remove("spinning");
      if (manual) {
        document.documentElement.classList.remove("data-loading");
        const loadingIndicator = document.getElementById("loadingIndicator");
        if (loadingIndicator) loadingIndicator.setAttribute("aria-hidden", "true");
        if (refreshBtn) refreshBtn.removeAttribute("aria-busy");
      }
      if (manual) this.secondsRemaining = this.refreshInterval;
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }
}

// Global modal helpers
window.openDocsModal = function() {
  document.getElementById("docsModal").classList.add("show");
};

window.closeDocsModal = function() {
  document.getElementById("docsModal").classList.remove("show");
};

// Initialize Application when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  window.app = new ProbeApp();
});
