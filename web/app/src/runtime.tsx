import React,{createContext,useContext,useEffect,useMemo,useState} from "react";
import {API,type ServerNode} from "./lib";
export type Language = "zh" | "en";
type BootstrapWindow = Window & {
  __MONITER_BOOTSTRAP__?: ServerNode[];
};

export function initialServers(): ServerNode[] {
  const value = (window as BootstrapWindow).__MONITER_BOOTSTRAP__;
  return Array.isArray(value) ? value : [];
}

const LanguageContext = createContext<{
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, fallback: string) => string;
}>({ language: "zh", setLanguage: () => {}, t: (_, fallback) => fallback });

const translations: Record<Language, Record<string, string>> = {
  zh: {
    "nav.overview": "仪表盘",
    "nav.nodes": "节点管理",
    "nav.targets": "监控目标",
    "nav.themes": "主题中心",
    "nav.costs": "成本中心",
    "nav.alerts": "告警通知",
    "nav.audit": "安全审计",
    "nav.settings": "网站设置",
    "shell.running": "服务运行中",
    "shell.logout": "退出登录",
    "shell.refresh": "刷新当前页面",
    "shell.language": "中文",
    "shell.live": "实时",
    "overview.greeting": "运行概览",
    "overview.description": "这里是节点、监控和成本的实时概览。",
    "overview.refresh": "刷新数据",
    "overview.nodes": "服务器节点",
    "overview.cost": "月度开销预估",
    "overview.traffic": "累计出站流量",
    "overview.latency": "三网基准延迟",
    "overview.allHealthy": "所有服务正常运行",
    "overview.fromProbes": "在线节点上海三网 TCP 基准",
    "overview.nodeLoad": "节点负载",
    "overview.nodeLoadHint": "当前 CPU 使用率 · 前 8 个节点",
    "overview.costDistribution": "成本分布",
    "overview.costDistributionHint": "按节点账单折算 USD / 月",
    "overview.health": "节点健康状态",
    "overview.healthHint": "最近一次心跳和网络区域",
    "overview.noQuota": "暂无配额数据",
    "overview.attention": "台需要关注",
    "overview.cpuTrend": "24 小时 CPU 趋势",
    "overview.cpuTrendHint": "前 8 个节点平均值",
    "overview.networkTrend": "网络与延迟趋势",
    "overview.networkTrendHint": "前 8 个节点聚合 · KiB/s、ms",
    "overview.live": "实时",
    "overview.viewAll": "查看全部",
    "overview.noHistory": "暂无历史指标",
    "overview.noHistoryCpu": "Agent 上报数据后会显示 24 小时趋势。",
    "overview.noHistoryNetwork": "Agent 上报数据后会显示网络和延迟曲线。",
    "overview.costHint": "按当前节点账单折算",
    "overview.noLiveNodes": "还没有实时节点",
    "overview.agentOnlineLoad": "Agent 上线后，这里会显示当前负载。",
    "overview.noBilling": "暂无账单数据",
    "overview.addBilling": "在节点管理中填写价格和付费周期。",
    "overview.noNodes": "暂无节点",
    "overview.addFirstNode": "去节点管理添加你的第一台服务器。",
    "overview.liveNodesHint": "所有服务实时状态",
    "overview.trafficHint": "来自 Agent 网卡计数",
    "overview.regions": "节点地区",
    "public.onlineHint": "台在线",
    "public.offlineHint": "台离线",
    "public.trafficHint": "来自 Agent 网卡计数",
    "public.avgLatencyHint": "在线节点上海三网 TCP 基准均值",
    "public.regionHint": "按节点国家/地区统计",
    "public.search": "搜索节点名称、地区、厂商或 IP",
    "public.nodeList": "节点列表",
    "public.map": "地图",
    "public.systemRegion": "系统名称 / 地区",
    "public.cpu": "CPU",
    "public.memory": "内存",
    "public.disk": "磁盘",
    "public.speed": "当前网速",
    "public.monthTraffic": "本月流量",
    "public.priceCycle": "价格周期",
    "public.latency": "三网延迟",
    "public.online": "在线",
    "public.offline": "离线",
    "public.detail": "详情",
    "public.noNodes": "暂无节点",
    "public.noNodesHint": "节点上线后会出现在这里。",
    "map.title": "全球节点分布",
    "map.hint": "在线节点和区域分布",
    "map.regions": "个地区",
    "map.alt": "全球节点分布地图",
    "page.nodes": "节点管理",
    "page.nodesHint": "管理服务器、Agent 版本、网络和告警策略。",
    "page.targets": "延迟监控目标",
    "page.targetsHint": "Agent 按这些地址探测 TCP 延迟，结果显示在节点详情中。",
    "page.costs": "成本中心",
    "page.costsHint": "按当前价格和续费周期估算节点成本，不包含历史支付记录。",
    "page.alerts": "告警通知",
    "page.alertsHint": "配置通知渠道，再为每台节点选择需要接收的事件。",
    "page.audit": "安全审计",
    "page.auditHint": "登录、配置修改和管理操作都会记录在这里。",
    "page.settings": "网站设置",
    "page.settingsHint": "名称会应用到登录页、前台标题、后台标题和品牌区域。",
    "common.add": "添加",
    "common.search": "搜索",
    "common.refresh": "刷新",
    "common.edit": "编辑",
    "common.delete": "删除",
    "common.name": "名称",
    "common.region": "地区",
    "common.status": "状态",
    "common.all": "全部",
    "common.allStatuses": "全部状态",
    "common.allRegions": "全部地区",
    "common.online": "在线",
    "common.offline": "离线",
    "common.enabled": "已启用",
    "common.disabled": "未启用",
    "common.save": "保存",
    "common.confirmDeleteNode": "确定删除这个节点及其历史指标吗？",
    "nodes.add": "添加节点",
    "nodes.search": "搜索名称或 IP",
    "nodes.network": "网络",
    "nodes.agentVersion": "Agent 版本",
    "nodes.billing": "价格周期",
    "nodes.tags": "标签",
    "nodes.noNodes": "暂无节点",
    "nodes.inventory": "节点清单",
    "nodes.noMatches": "没有匹配节点",
    "nodes.adjustFilters": "调整搜索关键词或筛选条件后重试。",
    "nodes.emptyHint": "添加服务器并连接 Agent 后，节点会显示在这里。",
    "targets.add": "添加目标",
    "targets.reset": "重置默认目标",
    "targets.confirmReset": "确定恢复系统默认的延迟监控目标？当前自定义目标将被替换。",
    "targets.host": "主机",
    "targets.port": "端口",
    "targets.carrier": "运营商",
    "targets.deleteConfirm": "确定删除这个监控目标吗？",
    "costs.monthly": "月均成本",
    "costs.annual": "年度成本",
    "costs.count": "节点数",
    "costs.byNode": "月均成本 · 按节点",
    "costs.renewals": "近期续费",
    "alerts.global": "启用全局告警",
    "alerts.globalOn": "告警渠道已按配置运行",
    "alerts.globalOff": "当前暂停所有告警投递",
    "alerts.smtp": "SMTP 邮件",
    "alerts.smtpHint": "适合接收完整告警内容",
    "alerts.telegram": "Telegram",
    "alerts.telegramHint": "移动端即时通知",
    "alerts.webhook": "Webhook",
    "alerts.webhookHint": "发送 JSON 到你的自动化系统",
    "alerts.triggers": "触发条件",
    "alerts.triggersHint": "控制哪些事件会投递",
    "alerts.offline": "节点离线",
    "alerts.online": "节点恢复",
    "alerts.cpu": "CPU 超阈值",
    "alerts.traffic": "流量超阈值",
    "alerts.cpuThreshold": "CPU 阈值 (%)",
    "alerts.trafficThreshold": "流量阈值 (%)",
    "alerts.save": "保存告警配置",
    "alerts.sendTest": "发送测试通知",
    "audit.time": "时间",
    "audit.action": "审计行为",
    "audit.sourceIp": "来源 IP",
    "settings.brand": "品牌设置",
    "settings.siteName": "网站名称",
    "settings.saveName": "保存网站名称",
    "settings.password": "修改管理员密码",
    "settings.currentPassword": "当前密码",
    "settings.newPassword": "新密码",
    "settings.updatePassword": "更新密码",
    "settings.twoFactor": "两步验证",
    "settings.generateQr": "生成验证器二维码",
  },
  en: {
    "nav.overview": "Dashboard",
    "nav.nodes": "Nodes",
    "nav.targets": "Monitor targets",
    "nav.themes": "Theme center",
    "nav.costs": "Cost center",
    "nav.alerts": "Notifications",
    "nav.audit": "Security audit",
    "nav.settings": "Settings",
    "shell.running": "Service running",
    "shell.logout": "Sign out",
    "shell.refresh": "Refresh data",
    "shell.language": "English",
    "shell.live": "Live",
    "overview.greeting": "Operations overview",
    "overview.description": "A live view of nodes, monitoring, and costs.",
    "overview.refresh": "Refresh data",
    "overview.nodes": "Server nodes",
    "overview.cost": "Estimated monthly cost",
    "overview.traffic": "Outbound traffic",
    "overview.latency": "Average regional latency",
    "overview.allHealthy": "All services are running",
    "overview.fromProbes": "Shanghai carrier TCP probes",
    "overview.nodeLoad": "Node load",
    "overview.nodeLoadHint": "Current CPU usage · first 8 nodes",
    "overview.costDistribution": "Cost distribution",
    "overview.costDistributionHint": "Monthly USD converted from node billing",
    "overview.health": "Node health",
    "overview.healthHint": "Latest heartbeat and network region",
    "overview.noQuota": "No quota data",
    "overview.attention": "need attention",
    "overview.cpuTrend": "24-hour CPU trend",
    "overview.cpuTrendHint": "Average across the first 8 nodes",
    "overview.networkTrend": "Network and latency",
    "overview.networkTrendHint": "First 8 nodes · KB/s, ms",
    "overview.live": "Live",
    "overview.viewAll": "View all",
    "overview.noHistory": "No historical metrics",
    "overview.noHistoryCpu": "24-hour trends appear after agents report data.",
    "overview.noHistoryNetwork": "Network and latency trends appear after agents report data.",
    "overview.costHint": "Calculated from current node billing",
    "overview.noLiveNodes": "No live nodes yet",
    "overview.agentOnlineLoad": "Current load appears here when an Agent connects.",
    "overview.noBilling": "No billing data",
    "overview.addBilling": "Add price and billing cycle in Node management.",
    "overview.noNodes": "No nodes yet",
    "overview.addFirstNode": "Add your first server in Node management.",
    "overview.liveNodesHint": "Live status for all services",
    "overview.trafficHint": "From Agent network counters",
    "overview.regions": "Node regions",
    "public.onlineHint": " online",
    "public.offlineHint": " offline",
    "public.trafficHint": "From Agent network counters",
    "public.avgLatencyHint": "Three-carrier average for online nodes",
    "public.regionHint": "Unique countries and regions represented",
    "public.search": "Search node, region, provider, or IP",
    "public.nodeList": "Nodes",
    "public.map": "Map",
    "public.systemRegion": "Node / region",
    "public.cpu": "CPU",
    "public.memory": "Memory",
    "public.disk": "Disk",
    "public.speed": "Current network speed",
    "public.monthTraffic": "Monthly traffic",
    "public.priceCycle": "Price / cycle",
    "public.latency": "Latency by carrier",
    "public.online": "Online",
    "public.offline": "Offline",
    "public.detail": "Details",
    "public.noNodes": "No nodes yet",
    "public.noNodesHint": "Nodes will appear here when they come online.",
    "map.title": "Global node distribution",
    "map.hint": "Online nodes and regional coverage",
    "map.regions": "regions",
    "map.alt": "Global node distribution map",
    "page.nodes": "Nodes",
    "page.nodesHint": "Manage servers, Agent versions, networks, and alert policies.",
    "page.targets": "Latency targets",
    "page.targetsHint": "Agents probe these TCP endpoints and report results in node details.",
    "page.costs": "Cost center",
    "page.costsHint": "Estimated from current prices and renewal cycles; historical payments are excluded.",
    "page.alerts": "Notifications",
    "page.alertsHint": "Configure delivery channels and choose events for each node.",
    "page.audit": "Security audit",
    "page.auditHint": "Sign-ins, configuration changes, and admin actions are recorded here.",
    "page.settings": "Settings",
    "page.settingsHint": "The name is applied to the sign-in page, public title, admin title, and brand.",
    "common.add": "Add",
    "common.search": "Search",
    "common.refresh": "Refresh",
    "common.edit": "Edit",
    "common.delete": "Delete",
    "common.name": "Name",
    "common.region": "Region",
    "common.status": "Status",
    "common.all": "All",
    "common.allStatuses": "All statuses",
    "common.allRegions": "All regions",
    "common.online": "Online",
    "common.offline": "Offline",
    "common.enabled": "Enabled",
    "common.disabled": "Disabled",
    "common.save": "Save",
    "common.confirmDeleteNode": "Delete this node and its historical metrics?",
    "nodes.add": "Add node",
    "nodes.search": "Search name or IP",
    "nodes.network": "Network",
    "nodes.agentVersion": "Agent version",
    "nodes.billing": "Price cycle",
    "nodes.tags": "Tags",
    "nodes.noNodes": "No nodes yet",
    "nodes.inventory": "Node inventory",
    "nodes.noMatches": "No matching nodes",
    "nodes.adjustFilters": "Adjust the search or filters and try again.",
    "nodes.emptyHint": "Add a server and connect its Agent to see it here.",
    "targets.add": "Add target",
    "targets.reset": "Reset defaults",
    "targets.confirmReset": "Restore the default latency targets? Custom targets will be replaced.",
    "targets.host": "Host",
    "targets.port": "Port",
    "targets.carrier": "Carrier",
    "targets.deleteConfirm": "Delete this monitoring target?",
    "costs.monthly": "Monthly cost",
    "costs.annual": "Annual cost",
    "costs.count": "Nodes",
    "costs.byNode": "Monthly cost · by node",
    "costs.renewals": "Upcoming renewals",
    "alerts.global": "Enable global alerts",
    "alerts.globalOn": "Alert channels are running",
    "alerts.globalOff": "All alert delivery is paused",
    "alerts.smtp": "SMTP email",
    "alerts.smtpHint": "Best for complete alert details",
    "alerts.telegram": "Telegram",
    "alerts.telegramHint": "Instant mobile notifications",
    "alerts.webhook": "Webhook",
    "alerts.webhookHint": "Send JSON to your automation system",
    "alerts.triggers": "Triggers",
    "alerts.triggersHint": "Choose which events are delivered",
    "alerts.offline": "Node offline",
    "alerts.online": "Node recovered",
    "alerts.cpu": "CPU threshold",
    "alerts.traffic": "Traffic threshold",
    "alerts.cpuThreshold": "CPU threshold (%)",
    "alerts.trafficThreshold": "Traffic threshold (%)",
    "alerts.save": "Save alert settings",
    "alerts.sendTest": "Send test notification",
    "audit.time": "Time",
    "audit.action": "Action",
    "audit.sourceIp": "Source IP",
    "settings.brand": "Brand settings",
    "settings.siteName": "Site name",
    "settings.saveName": "Save site name",
    "settings.password": "Change admin password",
    "settings.currentPassword": "Current password",
    "settings.newPassword": "New password",
    "settings.updatePassword": "Update password",
    "settings.twoFactor": "Two-factor authentication",
    "settings.generateQr": "Generate authenticator QR code",
  },
};

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem("aegis_lang");
    return saved === "en" || saved === "zh"
      ? saved
      : navigator.language.toLowerCase().startsWith("zh")
        ? "zh"
        : "en";
  });
  useEffect(() => {
    localStorage.setItem("aegis_lang", language);
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);
  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t: (key: string, fallback: string) => translations[language][key] || fallback,
    }),
    [language],
  );
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}

export function useSiteName() {
  const initial = document
    .querySelector('meta[name="site-name"]')
    ?.getAttribute("content")
    ?.trim();
  const [siteName, setSiteName] = useState(
    initial && initial !== "__SITE_NAME__" ? initial : "Moniter",
  );
  useEffect(() => {
    API("/api/v1/site-settings")
      .then((v) => {
        const name = String(v.site_name || "Moniter").trim() || "Moniter";
        setSiteName(name);
        if(!location.pathname.startsWith("/admin"))document.title = name;
      })
      .catch(() => {});
  }, []);
  return siteName;
}

export function useTheme() {
  const [theme, setTheme] = useState(
    localStorage.getItem("aegis_theme") || "system",
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    applyTheme();
    if (theme === "system") media.addEventListener("change", applyTheme);
    localStorage.setItem("aegis_theme", theme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);
  return [theme, setTheme] as const;
}

