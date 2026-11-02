import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "framer-motion";
import {
  Alert,
  HeroUIProvider,
  Avatar,
  Button,
  Card,
  CardBody as HeroCardBody,
  CardHeader as HeroCardHeader,
  Checkbox,
  Chip,
  Code,
  Divider,
  Input,
  Pagination,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Progress,
  Select,
  SelectItem,
  Spinner,
  Switch,
  Tab,
  Tabs,
  Textarea,
  Tooltip,
  useDisclosure,
} from "@heroui/react";
import {
  BarChart3,
  Bell,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clipboard,
  Cloud,
  Code2,
  Database,
  Globe2,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Network,
  Palette,
  PanelLeft,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sun,
  Target,
  Trash2,
  TriangleAlert,
  Upload,
  Wifi,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Legend,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  API,
  cycleLabel,
  billingCyclesEn,
  flag,
  money,
  monthlyCost,
  requestError,
  type CostNode,
  type ServerNode,
} from "../lib";



import { useAdminResource } from "../useAdminResource";
import { VersionProvider, VersionSettings, UpdateNotice } from "./VersionSettings";
import { NodeEditor } from "./NodeEditor";
import { ConfirmProvider, useConfirm } from "./ConfirmProvider";
import { AlertRuleFields, type ResourceRules } from "./AlertRuleFields";
import {englishAlert, englishMessage} from "../messages";
import { InitialPasswordNotice } from "./InitialPasswordNotice";
import { AccountSettings } from "./AccountSettings";
import { TargetsPage } from "./TargetsPage";


import {useLanguage,useTheme,useSiteName,initialServers} from "../runtime";
import { useLiveNodes } from "../public/useLiveNodes";
import { MiniRing } from "../public/Gauge";
import { number, ratio } from "../public/format";
const CardHeader = (props: React.ComponentProps<typeof HeroCardHeader>) => <HeroCardHeader {...props} data-slot="header" />;
const CardBody = (props: React.ComponentProps<typeof HeroCardBody>) => <HeroCardBody {...props} data-slot="body" />;
type AlertConfig = {
  enabled: boolean;
  smtp_enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass_set?: boolean;
  from: string;
  to: string;
  notify_offline: boolean;
  notify_online: boolean;
  notify_cpu: boolean;
  cpu_threshold: number;
  notify_traffic: boolean;
  traffic_threshold: number;
  telegram_enabled: boolean;
  telegram_bot_token_set?: boolean;
  telegram_chat_id: string;
  webhook_enabled: boolean;
  webhook_url: string;
  webhook_format: string;
  notify_login: boolean;
  resource_rules: ResourceRules;
};

function ThemeSelector({value,onChange}:{value:string;onChange:(value:string)=>void}) {
  const {language}=useLanguage();
  return <Select size="sm" className="theme-selector" aria-label={language==="zh"?"外观":"Appearance"} selectedKeys={[value]} disallowEmptySelection onSelectionChange={keys=>onChange(String([...keys][0]))}>
    <SelectItem key="system" startContent={<Monitor size={14}/>}>{language==="zh"?"跟随系统":"System"}</SelectItem>
    <SelectItem key="light" startContent={<Sun size={14}/>}>{language==="zh"?"浅色":"Light"}</SelectItem>
    <SelectItem key="dark" startContent={<Moon size={14}/>}>{language==="zh"?"深色":"Dark"}</SelectItem>
  </Select>;
}

function Brand({
  siteName,
  compact = false,
}: {
  siteName: string;
  compact?: boolean;
}) {
  const { language } = useLanguage();
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`}>
      <div className="brand-icon">
        <Server size={18} />
      </div>
      <div>
        <strong>{siteName}</strong>
        {!compact && (
          <span>{language === "zh" ? "监控控制中心" : "Monitoring console"}</span>
        )}
      </div>
    </div>
  );
}

function LoginPage({ siteName }: { siteName: string }) {
  const { language, setLanguage } = useLanguage();
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useTheme();
  useEffect(() => {
    const token = localStorage.getItem("aegis_admin_token");
    if (token)
      API("/api/v1/admin/status")
        .then((v) => v.logged_in && (location.href = "/admin"))
        .catch(() => {});
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await fetch("/api/v1/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: user.trim(),
          password,
          totp_code: totp || null,
        }),
      }).then((r) => r.json());
      if (data.success) {
        localStorage.setItem("aegis_admin_token", data.token);
        location.href = "/admin";
      } else {
        setNeedTotp(!!data.need_totp);
        setError(data.message || (language === "zh" ? "登录失败" : "Sign-in failed"));
      }
    } catch {
      setError(language === "zh" ? "无法连接管理后端" : "Cannot connect to the administration service");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-page">
      <div className="login-glow" />
      <div className="login-tools">
        <Button
          size="sm"
          variant="flat"
          startContent={<Globe2 size={16} />}
          onPress={() => setLanguage(language === "zh" ? "en" : "zh")}
        >
          {language === "zh" ? "EN" : "中文"}
        </Button>
        <ThemeSelector value={theme} onChange={setTheme} />
      </div>
      <Card className="login-card">
        <CardBody className="gap-6 p-8">
          <div className="text-center">
            <div className="login-logo">
              <Server size={26} />
            </div>
            <h1>{siteName}</h1>
            <p>{language === "zh" ? "安全监控控制中心" : "Secure monitoring console"}</p>
          </div>
          <form onSubmit={submit} className="grid gap-4">
            <Input
              label={language === "zh" ? "管理员账号" : "Username"}
              value={user}
              onValueChange={setUser}
              autoComplete="username"
              isRequired
              variant="bordered"
            />
            <Input
              label={language === "zh" ? "管理密码" : "Password"}
              value={password}
              onValueChange={setPassword}
              type="password"
              autoComplete="current-password"
              isRequired
              variant="bordered"
            />
            <div hidden={!needTotp}>
              <Input
                label={language === "zh" ? "两步验证码" : "Two-factor code"}
                value={totp}
                onValueChange={setTotp}
                inputMode="numeric"
                maxLength={6}
                variant="bordered"
              />
            </div>
            {error && <Alert color="danger" title={error} variant="flat" />}
            <Button color="primary" type="submit" isLoading={busy} size="lg">
              {language === "zh" ? "安全登录" : "Sign in"}
            </Button>
          </form>
          <p className="login-foot">
            <ShieldCheck size={14} /> {language === "zh" ? "会话绑定登录网络" : "Session is bound to your sign-in network"}
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

const nav = [
  ["overview", "仪表盘", LayoutDashboard],
  ["nodes", "节点管理", Server],
  ["targets", "监控目标", Target],
  ["costs", "成本中心", CircleDollarSign],
  ["themes", "主题中心", Palette],
  ["alerts", "告警通知", Bell],
  ["audit", "安全审计", ShieldCheck],
  ["settings", "网站设置", Settings],
] as const;

function AppShell({
  siteName,
  page,
  setPage,
  refreshing = false,
  notice,
  children,
}: {
  siteName: string;
  page: string;
  setPage: (p: string) => void;
  refreshing?: boolean;
  notice?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [theme, setTheme] = useTheme();
  const [mobile, setMobile] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const { language, setLanguage, t } = useLanguage();
  useEffect(()=>{const item=nav.find(n=>n[0]===page);document.title=`${item?t(`nav.${item[0]}`,item[1]):t("nav.overview","仪表盘")} · ${siteName}`},[page,siteName,language]);
  const navGroups = [
    {
      label: language === "zh" ? "工作区" : "Workspace",
      items: nav.slice(0, 1),
    },
    {
      label: language === "zh" ? "监控" : "Monitoring",
      items: nav.slice(1, 3),
    },
    {
      label: language === "zh" ? "管理" : "Management",
      items: nav.slice(3),
    },
  ];
  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={mobile ? "sidebar open" : "sidebar"}>
        <div className="sidebar-top">
          <Brand siteName={siteName} compact={collapsed} />
          <div className="sidebar-top-actions">
            <Tooltip content={language === "zh" ? "搜索节点" : "Search nodes"}>
              <Button
                isIconOnly
                variant="light"
                className="sidebar-search"
                onPress={() => {
                  setPage("nodes");
                  location.hash = "nodes";
                  setMobile(false);
                }}
                aria-label={language === "zh" ? "搜索节点" : "Search nodes"}
              >
                <Search size={18} />
              </Button>
            </Tooltip>
            <Button
              isIconOnly
              variant="light"
              className="mobile-close"
              onPress={() => setMobile(false)}
              aria-label={language === "zh" ? "关闭导航" : "Close navigation"}
            >
              <X size={18} />
            </Button>
          </div>
        </div>
        <nav className="sidebar-nav">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.items.map(([id, label, Icon]) => (
                <button
                  key={id}
                  className={page === id ? "nav-item active" : "nav-item"}
                  onClick={() => {
                    setPage(id);
                    setMobile(false);
                  }}
                >
                  {page === id && (
                    <motion.span
                      className="nav-active-pill"
                      layoutId="active-nav-pill"
                      transition={{ type: "spring", stiffness: 460, damping: 34 }}
                    />
                  )}
                  <Icon size={18} />
                  <span className="nav-label">{t(`nav.${id}`, label)}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="status-line">
            <span className="online-dot" />
            {t("shell.running", "服务运行中")}
          </div>
          <Button
            variant="flat"
            startContent={<LogOut size={16} />}
            isLoading={loggingOut}
            onPress={async () => {
              setLoggingOut(true); setLogoutError("");
              try {
                await API("/api/v1/admin/logout", { method: "POST" });
                localStorage.removeItem("aegis_admin_token"); location.href = "/admin/login";
              } catch (error) { setLogoutError(requestError(error)); }
              finally { setLoggingOut(false); }
            }}
          >
            {t("shell.logout", "退出登录")}
          </Button>
          {logoutError && <Alert color="danger" title={logoutError} />}
        </div>
      </aside>
      <AnimatePresence>
        {mobile && (
          <motion.button
            type="button"
            className="sidebar-backdrop"
            aria-label={language === "zh" ? "关闭导航" : "Close navigation"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => setMobile(false)}
          />
        )}
      </AnimatePresence>
      <div className="shell-main">
        <header className="topbar">
          <Tooltip content={language === "zh" ? (collapsed ? "展开导航" : "收起导航") : (collapsed ? "Expand navigation" : "Collapse navigation")}>
            <Button
              isIconOnly
              variant="light"
              className="desktop-sidebar-toggle"
              onPress={() => setCollapsed((value) => !value)}
              aria-label={language === "zh" ? (collapsed ? "展开导航" : "收起导航") : (collapsed ? "Expand navigation" : "Collapse navigation")}
            >
              <PanelLeft size={18} />
            </Button>
          </Tooltip>
          <Button
            isIconOnly
            variant="light"
            className="mobile-menu"
            aria-label={language === "zh" ? "打开导航" : "Open navigation"}
            onPress={() => setMobile(true)}
          >
            <Menu size={20} />
          </Button>
          <div>
            <p className="eyebrow">{siteName} / {language === "zh" ? "控制台" : "Console"}</p>
            <h1>
              {(() => {
                const item = nav.find((n) => n[0] === page);
                return item ? t(`nav.${item[0]}`, item[1]) : "";
              })()}
            </h1>
          </div>
          <div className="topbar-actions">
            <UpdateNotice />
            <Button
              className="language-toggle"
              variant="flat"
              startContent={<Globe2 size={16} />}
              onPress={() => setLanguage(language === "zh" ? "en" : "zh")}
              aria-label={language === "zh" ? "切换语言" : "Switch language"}
            >
              {language === "zh" ? "EN" : "中文"}
            </Button>
            <ThemeSelector value={theme} onChange={setTheme} />
          </div>
        </header>
        <AnimatePresence initial={false}>
          {refreshing && (
            <motion.div
              className="refresh-progress"
              role="status"
              aria-label={language === "zh" ? "正在刷新数据" : "Refreshing data"}
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 1 }}
              exit={{ scaleX: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            />
          )}
        </AnimatePresence>
        <main className="content">
          {notice}
          <div key={page} className="page-transition">{children}</div>
        </main>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  hint,
  icon,
  tone = "blue",
}: {
  title: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  tone?: string;
}) {
  return (
    <Card className="stat-card">
      <CardBody>
        <div className="stat-head">
          <span>{title}</span>
          <span className={`stat-icon ${tone}`}>{icon}</span>
        </div>
        <strong>{value}</strong>
        <span className="stat-hint">{hint}</span>
      </CardBody>
    </Card>
  );
}

/** Live CPU / memory / disk rings, fed by the same stream as the public page. */
function LiveLoadCard() {
  const { language, t } = useLanguage();
  const { nodes, connection } = useLiveNodes(initialServers());
  const rows = useMemo(
    () =>
      [...nodes]
        .sort((a, b) => Number(b.status === "online") - Number(a.status === "online") || Number(b.current_cpu || 0) - Number(a.current_cpu || 0))
        .slice(0, 8),
    [nodes],
  );
  return (
    <Card className="chart-card live-load-card">
      <CardHeader>
        <div>
          <h3>{t("overview.nodeLoad", "节点负载")}</h3>
          <p>{language === "zh" ? "实时 CPU、内存与磁盘 · 按 CPU 排序" : "Live CPU, memory and disk · sorted by CPU"}</p>
        </div>
        <span className={`live-dot is-${connection}`}>{connection === "live" ? (language === "zh" ? "实时" : "Live") : connection === "paused" ? (language === "zh" ? "已暂停" : "Paused") : (language === "zh" ? "连接中" : "Connecting")}</span>
      </CardHeader>
      <CardBody>
        {rows.length ? (
          <div className="live-load-list">
            {rows.map((n) => {
              const online = n.status === "online";
              return (
                <div key={n.id} className={online ? "" : "is-offline"}>
                  <img src={flag(n.region)} alt="" />
                  <strong title={n.name}>{n.name}</strong>
                  <MiniRing value={online ? number(n.current_cpu) : null} label="CPU" />
                  <MiniRing value={online ? ratio(n.mem_used_mb, n.mem_total_mb) : null} label={language === "zh" ? "内存" : "Memory"} />
                  <MiniRing value={online ? ratio(n.disk_used_bytes, n.disk_total_bytes) : null} label={language === "zh" ? "磁盘" : "Disk"} warn={80} crit={92} />
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={<Server size={24} />}
            title={t("overview.noLiveNodes", "还没有实时节点")}
            description={t("overview.agentOnlineLoad", "Agent 上线后，这里会显示当前负载。")}
          />
        )}
      </CardBody>
    </Card>
  );
}

function Overview({
  nodes,
  costs,
  refresh,
}: {
  nodes: ServerNode[];
  costs: CostNode[];
  refresh: () => void;
}) {
  const { language, t } = useLanguage();
  const total = costs.reduce((sum, n) => sum + monthlyCost(n), 0);
  const online = nodes.filter((n) => n.status === "online").length;
  const traffic = nodes.reduce(
    (sum, n) =>
      sum +
      Number(n.traffic_used_gb || (n.traffic_used_bytes || 0) / 1024 ** 3),
    0,
  );
  const limit = nodes.reduce(
    (sum, n) => sum + Number(n.traffic_limit_gb || 0),
    0,
  );
  const latency = nodes
    .filter((n) => n.status === "online")
    .flatMap((n) => [n.latency_ct, n.latency_cu, n.latency_cm])
    .filter((n): n is number => !!n && n > 0 && n < 999);
  const avg = latency.length
    ? Math.round(latency.reduce((a, b) => a + b, 0) / latency.length)
    : 0;
  return (
    <div className="page-stack">
      <div className="page-intro">
        <div>
          <span className="eyebrow accent">{language === "zh" ? "监控概览" : "System overview"}</span>
          <h2>{t("overview.greeting", "早上好，管理员")}</h2>
          <p>{t("overview.description", "这里是节点、监控和成本的实时概览。")}</p>
        </div>
        <Button
          color="primary"
          startContent={<RefreshCw size={16} />}
          onPress={refresh}
        >
          {t("overview.refresh", "刷新数据")}
        </Button>
      </div>
      <div className="stats-grid">
        <StatCard
          title={t("overview.nodes", "服务器节点")}
          value={`${online} / ${nodes.length}`}
          hint={
            online === nodes.length
              ? t("overview.allHealthy", "所有服务正常运行")
              : `${nodes.length - online} ${t("overview.attention", "台需要关注")}`
          }
          icon={<Server size={18} />}
        />
        <StatCard
          title={t("overview.cost", "月度开销预估")}
          value={money(total)}
          hint={t("overview.costHint", "按当前节点账单折算")}
          icon={<CircleDollarSign size={18} />}
          tone="violet"
        />
        <StatCard
          title={t("overview.traffic", "累计出站流量")}
          value={`${traffic.toFixed(1)} GiB`}
          hint={
            limit
              ? (language === "zh" ? `已使用 ${((traffic / limit) * 100).toFixed(1)}%` : `${((traffic / limit) * 100).toFixed(1)}% used`)
              : t("overview.noQuota", "暂无配额数据")
          }
          icon={<BarChart3 size={18} />}
          tone="green"
        />
        <StatCard
          title={t("overview.latency", "国内/亚太平均延时")}
          value={avg ? `${avg} ms` : "—"}
          hint={t("overview.fromProbes", "来自在线探针")}
          icon={<Wifi size={18} />}
          tone="orange"
        />
      </div>
      <DashboardHistory nodes={nodes} />
      <div className="dashboard-grid">
        <LiveLoadCard />
        <Card className="chart-card">
          <CardHeader>
            <div>
              <h3>{t("overview.costDistribution", "成本分布")}</h3>
              <p>{t("overview.costDistributionHint", "按节点账单折算 USD / 月")}</p>
            </div>
            <Chip variant="flat" color="success">
              {money(total)}
            </Chip>
          </CardHeader>
          <CardBody>
            <div className="chart-wrap">
              {costs.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={costs.map((n) => ({
                      name: n.name,
                      cost: Number(monthlyCost(n).toFixed(2)),
                    }))}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="var(--line)"
                    />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                    />
                    <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} />
                    <ChartTooltip
                      contentStyle={{
                        background: "var(--surface-strong)",
                        border: "1px solid var(--line)",
                        borderRadius: 12,
                      }}
                    />
                    <Bar
                      dataKey="cost"
                      name={language === "zh" ? "USD / 月" : "USD / month"}
                      fill="#8b5cf6"
                      radius={[5, 5, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState
                  icon={<CircleDollarSign size={24} />}
                  title={t("overview.noBilling", "暂无账单数据")}
                  description={t("overview.addBilling", "在节点管理中填写价格和付费周期。")}
                />
              )}
            </div>
          </CardBody>
        </Card>
      </div>
      <Card className="panel-card">
        <CardHeader>
          <div>
            <h3>{t("overview.health", "节点健康状态")}</h3>
            <p>{t("overview.healthHint", "最近一次心跳和网络区域")}</p>
          </div>
          <Button
            variant="light"
            endContent={<ChevronRight size={15} />}
            onPress={() => (location.hash = "nodes")}
          >
            {language === "zh" ? "查看全部" : "View all"}
          </Button>
        </CardHeader>
        <CardBody>
          <div className="health-list">
            {nodes.slice(0, 5).map((n) => (
              <div className="health-row" key={n.id}>
                <div className="node-ident">
                  <span className={`health-dot ${n.status}`} />
                  <img src={flag(n.region)} alt="" />
                  <div>
                    <strong>{n.name}</strong>
                    <span>
                      {n.region_name || n.region} · {n.provider}
                    </span>
                  </div>
                </div>
                <Chip
                  size="sm"
                  color={n.status === "online" ? "success" : "danger"}
                  variant="flat"
                >
                  {n.status === "online" ? t("common.online", "在线") : t("common.offline", "离线")}
                </Chip>
              </div>
            ))}
            {!nodes.length && (
              <EmptyState
                title={t("overview.noNodes", "暂无节点")}
                description={t("overview.addFirstNode", "去节点管理添加你的第一台服务器。")}
              />
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function Loading() {
  return (
    <div className="loading-page">
      <Spinner color="primary" label={localStorage.getItem("aegis_lang")==="en"?"Loading":"加载中"} />
    </div>
  );
}

function AdminApp({ siteName }: { siteName: string }) {
  const { language } = useLanguage();
  const [loadError, setLoadError] = useState("");
  const [brandName, setBrandName] = useState(siteName);
  const [page, setPage] = useState(location.hash.slice(1) || "overview");
  const [nodes, setNodes] = useState<ServerNode[]>(initialServers);
  const [costs, setCosts] = useState<CostNode[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [passwordFocusRequest, setPasswordFocusRequest] = useState(0);
  const load = (showProgress = false) => {
    if (showProgress) setRefreshing(true);
    return Promise.all([
      API("/api/v1/admin/servers"),
      API("/api/v1/admin/costs"),
    ]).then(([servers, billing]) => {
      setNodes(servers);
      setCosts(billing);
      setLoadError("");
    }).catch((error) => {
      setLoadError(requestError(error));
    }).finally(() => {
      if (showProgress) setRefreshing(false);
    });
  };
  useEffect(() => {
    void load();
    const onHash = () => setPage(location.hash.slice(1) || "overview");
    const onRefresh = () => {
      void load(true);
    };
    addEventListener("hashchange", onHash);
    addEventListener("antox:refresh", onRefresh);
    return () => {
      removeEventListener("hashchange", onHash);
      removeEventListener("antox:refresh", onRefresh);
    };
  }, []);
  const go = (p: string) => {
    setPage(p);
    location.hash = p;
  };
  const content =
    page === "nodes" ? (
      <NodesPage nodes={nodes} onReload={() => load(true)} />
    ) : page === "targets" ? (
      <TargetsPage onReload={() => load(true)} />
    ) : page === "costs" ? (
      <CostsPage />
    ) : page === "themes" ? (
      <ThemeCenterPage />
    ) : page === "alerts" ? (
      <AlertsPage />
    ) : page === "audit" ? (
      <AuditPage />
    ) : page === "settings" ? (
      <SettingsPage
        siteName={brandName}
        passwordFocusRequest={passwordFocusRequest}
        onSaved={(name) => {
          setBrandName(name);
          document.title = name;
        }}
      />
    ) : (
      <Overview nodes={nodes} costs={costs} refresh={() => load(true)} />
    );
  return (
    <AppShell
      siteName={brandName}
      page={page}
      setPage={go}
      refreshing={refreshing}
      notice={<InitialPasswordNotice onChangePassword={() => {
        setPasswordFocusRequest(value => value + 1);
        go("settings");
      }} />}
    >
      {loadError && <RequestFailure error={loadError} retry={() => load(true)} />}
      {content}
    </AppShell>
  );
}

function RequestFailure({ error, retry }: { error: string; retry: () => void }) {
  const { language } = useLanguage();
  return <Alert color="danger" className="request-failure" title={language === "zh" ? "更新失败，已保留现有数据" : "Update failed. Your existing data is preserved."}
    description={error} endContent={<Button size="sm" variant="flat" onPress={retry}>{language === "zh" ? "重试" : "Retry"}</Button>} />;
}

function DashboardHistory({ nodes }: { nodes: ServerNode[] }) {
  const { language, t } = useLanguage();
  const [data, setData] = useState<
    Array<{
      ts: number;
      cpu: number;
      latency: number|null;
      netIn: number;
      netOut: number;
    }>
  >([]);
  useEffect(() => {
    let active = true;
    Promise.all(
      nodes.slice(0, 8).map((node) =>
        API(`/api/v1/metrics/${node.id}?hours=24&bucket=900`)
          .then((rows) =>
            rows
              .map((p: any) => ({ ...p, ts: Number(p.ts) }))
              .filter((p: any) => p.ts > 0),
          )
          .catch(() => []),
      ),
    ).then((series) => {
      if (!active) return;
      const buckets = new Map<number, any>();
      series.flat().forEach((point: any) => {
        const row = buckets.get(point.ts) || {
          ts: point.ts,
          cpu: 0,
          latency: 0,
          netIn: 0,
          netOut: 0,
          count: 0,
          pingCount: 0,
        };
        row.cpu += Number(point.cpu || 0);
        row.netIn += Number(point.net_in_kb || 0);
        row.netOut += Number(point.net_out_kb || 0);
        const pings = [point.lat_ct, point.lat_cu, point.lat_cm]
          .map(Number)
          .filter((v: number) => v > 0 && v < 999);
        if (pings.length) {
          row.latency +=
            pings.reduce((a: number, b: number) => a + b, 0) / pings.length;
          row.pingCount += 1;
        }
        row.count += 1;
        buckets.set(point.ts, row);
      });
      setData(
        [...buckets.values()]
          .sort((a, b) => a.ts - b.ts)
          .map((r) => ({
            ts: r.ts,
            cpu: r.cpu / r.count,
            latency: r.pingCount ? r.latency / r.pingCount : null,
            netIn: r.netIn / r.count,
            netOut: r.netOut / r.count,
          })),
      );
    });
    return () => {
      active = false;
    };
  }, [nodes]);
  const chart = data.map((p) => ({
    ...p,
    time: new Date(p.ts * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  }));
  return (
    <div className="dashboard-grid">
      <Card className="chart-card">
        <CardHeader>
          <div>
            <h3>{t("overview.cpuTrend", "24 小时 CPU 趋势")}</h3>
            <p>{t("overview.cpuTrendHint", "前 8 个节点平均值")}</p>
          </div>
        </CardHeader>
        <CardBody>
          <div className="chart-wrap">
            {chart.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="var(--line)"
                  />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: "var(--muted)", fontSize: 10 }}
                  />
                  <YAxis tick={{ fill: "var(--muted)", fontSize: 10 }} />
                  <ChartTooltip
                    contentStyle={{
                      background: "var(--surface-strong)",
                      border: "1px solid var(--line)",
                      borderRadius: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="cpu"
                    name="CPU %"
                    stroke="#1683ff"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                title={t("overview.noHistory", "暂无历史指标")}
                description={t("overview.noHistoryCpu", "Agent 上报数据后会显示 24 小时趋势。")}
              />
            )}
          </div>
        </CardBody>
      </Card>
      <Card className="chart-card">
        <CardHeader>
          <div>
            <h3>{t("overview.networkTrend", "网络与延迟趋势")}</h3>
            <p>{t("overview.networkTrendHint", "前 8 个节点聚合 · KB/s、ms")}</p>
          </div>
        </CardHeader>
        <CardBody>
          <div className="chart-wrap">
            {chart.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="var(--line)"
                  />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: "var(--muted)", fontSize: 10 }}
                  />
                  <YAxis yAxisId="rate" tick={{ fill: "var(--muted)", fontSize: 10 }} unit=" KiB/s" width={76} /><YAxis yAxisId="latency" orientation="right" tick={{ fill: "var(--muted)", fontSize: 10 }} unit=" ms" width={65} /><Legend wrapperStyle={{fontSize:11}} />
                  <ChartTooltip
                    contentStyle={{
                      background: "var(--surface-strong)",
                      border: "1px solid var(--line)",
                      borderRadius: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    yAxisId="rate" dataKey="netOut"
                    name={language==="zh"?"出站 KiB/s":"Outbound KiB/s"}
                    stroke="#21b77a"
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    yAxisId="latency" dataKey="latency"
                    name={language==="zh"?"平均延迟 ms":"Latency ms"}
                    stroke="#f59e0b"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                title={t("overview.noHistory", "暂无历史指标")}
                description={t("overview.noHistoryNetwork", "Agent 上报数据后会显示网络和延迟曲线。")}
              />
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon?: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon">{icon}</div>}
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}

function NodesPage({
  nodes,
  onReload,
}: {
  nodes: ServerNode[];
  onReload: () => void;
}) {
  const { language, t } = useLanguage();
  const confirmAction=useConfirm();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [region, setRegion] = useState("all");
  const edit = useDisclosure();
  const [current, setCurrent] = useState<ServerNode | null>(null);
  const [busy, setBusy] = useState(false);
  const [operationError, setOperationError] = useState("");
  const regions: Array<[string, string]> = [
    ...new Map(
      nodes.map((n): [string, string] => [n.region, n.region_name || n.region]),
    ).entries(),
  ];
  const filtered = nodes.filter((n) => {
    const q = query.toLowerCase();
    return (
      (!q ||
        `${n.name} ${n.ipv4 || ""} ${n.ipv6 || ""}`
          .toLowerCase()
          .includes(q)) &&
      (status === "all" || n.status === status) &&
      (region === "all" || n.region === region)
    );
  });
  const remove = async (id: string) => {
    if (busy) return;
    if (!await confirmAction({title:language==="zh"?"删除节点":"Delete node",body:language==="zh"?`删除「${nodes.find(n=>n.id===id)?.name||id}」及其全部历史数据？此操作无法撤销。`:`Delete "${nodes.find(n=>n.id===id)?.name||id}" and all its history? This cannot be undone.`,danger:true})) return;
    setBusy(true); setOperationError("");
    try {
      const result = await API("/api/v1/admin/servers/delete", { method: "POST", body: JSON.stringify({ id }) });
      if (!result.success) throw new Error(result.message || (language === "zh" ? "删除失败" : "Delete failed"));
      onReload();
    } catch (error) { setOperationError(requestError(error)); }
    finally { setBusy(false); }
  };
  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <div>
          <h2>{t("page.nodes", "节点管理")}</h2>
          <p>{t("page.nodesHint", "管理服务器、Agent 版本、网络和告警策略。")}</p>
        </div>
        <Button
          color="primary"
          startContent={<Plus size={16} />}
          onPress={() => {
            setCurrent(null);
            edit.onOpen();
          }}
        >
          {t("nodes.add", "添加节点")}
        </Button>
      </div>
      {operationError && <Alert color="danger" title={operationError} />}
      <div className="node-summary-bar">
        <span>{t("nodes.inventory", "节点清单")}</span>
        <div>
          <Chip size="sm" color="success" variant="flat">{nodes.filter((n) => n.status === "online").length} {t("common.online", "在线")}</Chip>
          <Chip size="sm" color="danger" variant="flat">{nodes.filter((n) => n.status !== "online").length} {t("common.offline", "离线")}</Chip>
          <span className="table-result-count">{filtered.length} / {nodes.length} {language === "zh" ? "台节点" : "nodes"}</span>
        </div>
      </div>
      <Card className="panel-card">
        <CardBody className="p-0">
          <div className="table-toolbar">
            <Input
              value={query}
              onValueChange={setQuery}
              placeholder={t("nodes.search", "搜索名称或 IP")}
              aria-label={t("nodes.search", "搜索名称或 IP")}
              startContent={<Search size={16} />}
              className="max-w-xs"
              variant="bordered"
            />
            <Select
              aria-label={t("common.status", "状态")}
              selectedKeys={[status]}
              onSelectionChange={(keys) => setStatus(String([...keys][0]))}
              className="filter-select"
              variant="bordered"
            >
              <SelectItem key="all">{t("common.allStatuses", "全部状态")}</SelectItem>
              <SelectItem key="online">{t("common.online", "在线")}</SelectItem>
              <SelectItem key="offline">{t("common.offline", "离线")}</SelectItem>
            </Select>
            <Select
              aria-label={t("common.region", "地区")}
              selectedKeys={[region]}
              onSelectionChange={(keys) => setRegion(String([...keys][0]))}
              className="filter-select"
              variant="bordered"
            >
              <SelectItem key="all">{t("common.allRegions", "全部地区")}</SelectItem>
              {
                regions.map(([code, label]) => (
                  <SelectItem key={code}>{label}</SelectItem>
                )) as any
              }
            </Select>
            <Button isIconOnly variant="flat" onPress={onReload} aria-label={language === "zh" ? "刷新节点" : "Refresh nodes"}>
              <RefreshCw size={16} />
            </Button>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("common.name", "名称")}</th>
                  <th>{t("nodes.network", "网络")}</th>
                  <th>{t("nodes.agentVersion", "Agent 版本")}</th>
                  <th>{t("nodes.billing", "价格周期")}</th>
                  <th>{t("nodes.tags", "标签")}</th>
                  <th>{t("common.status", "状态")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((n) => (
                  <tr key={n.id}>
                    <td>
                      <div className="node-ident">
                        <img src={flag(n.region)} alt="" />
                        <div>
                          <strong>{n.name}</strong>
                          <span>
                            {n.region_name || n.region} · {n.provider}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Code size="sm">v4 {n.ipv4 || "—"}</Code>
                      <br />
                      <Code size="sm">v6 {n.ipv6 || "—"}</Code>
                    </td>
                    <td>{n.agent_version || "—"}</td>
                    <td>
                      {n.billing_currency}
                      {Number(n.billing_price).toFixed(2)}
                      <span className="subline">
                        {language === "zh" ? cycleLabel[n.billing_cycle] || n.billing_cycle : billingCyclesEn[n.billing_cycle] || n.billing_cycle}
                      </span>
                    </td>
                    <td>
                      <div className="chip-wrap">
                        {String(n.tags || "")
                          .split(",")
                          .filter(Boolean)
                          .map((tag) => (
                            <Chip key={tag} size="sm" variant="flat">
                              {tag.trim()}
                            </Chip>
                          ))}
                      </div>
                    </td>
                    <td>
                      <Chip
                        size="sm"
                        color={n.status === "online" ? "success" : "danger"}
                        variant="flat"
                      >
                        {n.status === "online"
                          ? t("common.online", "在线")
                          : t("common.offline", "离线")}
                      </Chip>
                    </td>
                    <td>
                      <div className="row-actions">
                        <Tooltip content={t("common.edit", "编辑")}>
                          <Button
                            isIconOnly
                            size="sm"
                            variant="light"
                            aria-label={t("common.edit", "编辑")}
                            onPress={() => {
                              setCurrent(n);
                              edit.onOpen();
                            }}
                          >
                            <Pencil size={15} />
                          </Button>
                        </Tooltip>
                        <Tooltip content={t("common.delete", "删除")}>
                          <Button
                            isIconOnly
                            size="sm"
                            variant="light"
                            color="danger"
                            aria-label={t("common.delete", "删除")}
                            isDisabled={busy}
                            onPress={() => remove(n.id)}
                          >
                            <Trash2 size={15} />
                          </Button>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && (
              <EmptyState
                title={nodes.length ? t("nodes.noMatches", "没有匹配节点") : t("nodes.noNodes", "暂无节点")}
                description={nodes.length ? t("nodes.adjustFilters", "调整搜索关键词或筛选条件后重试。") : t("nodes.emptyHint", "添加服务器并连接 Agent 后，节点会显示在这里。")}
              />
            )}
          </div>
        </CardBody>
      </Card>
      <NodeEditor language={language}
        node={current}
        disclosure={edit}
        onSaved={(close) => {
          if (close) edit.onClose();
          onReload();
        }}
      />
    </div>
  );
}


function CostsPage() {
  const { language, t } = useLanguage();
  const { data: nodes, error, loading, reload } = useAdminResource<CostNode[]>("/api/v1/admin/costs", []);
  if (!nodes.length && loading) return <Loading />;
  if (!nodes.length && error) return <RequestFailure error={error} retry={reload} />;
  const total = nodes.reduce((s, n) => s + monthlyCost(n), 0);
  const chart = nodes.map((n) => ({
    name: n.name,
    cost: Number(monthlyCost(n).toFixed(2)),
  }));
  return (
    <div className="page-stack">
      {error && <RequestFailure error={error} retry={reload} />}
      <div className="page-toolbar">
        <div>
          <h2>{t("page.costs", "成本中心")}</h2>
          <p>{t("page.costsHint", "按当前价格和续费周期估算节点成本，不包含历史支付记录。")}</p>
        </div>
        <Chip color="primary" variant="flat">
          {language === "zh" ? "USD 参考折算" : "USD equivalent"}
        </Chip>
      </div>
      <div className="stats-grid three">
        <StatCard
          title={t("costs.monthly", "月均成本")}
          value={money(total)}
          hint={language === "zh" ? "当前节点折算" : "Based on current nodes"}
          icon={<CircleDollarSign size={18} />}
          tone="violet"
        />
        <StatCard
          title={t("costs.annual", "年度成本")}
          value={money(total * 12)}
          hint={language === "zh" ? "未来 12 个月估算" : "Projected for the next 12 months"}
          icon={<BarChart3 size={18} />}
        />
        <StatCard
          title={t("costs.count", "节点数")}
          value={String(nodes.length)}
          hint={language === "zh" ? "纳入成本中心" : "Included in cost center"}
          icon={<Server size={18} />}
          tone="green"
        />
      </div>
      <Card className="chart-card">
        <CardHeader>
          <div>
            <h3>{t("costs.byNode", "月均成本 · 按节点")}</h3>
            <p>{language === "zh" ? "数据来自节点账单配置" : "From node billing settings"}</p>
          </div>
        </CardHeader>
        <CardBody>
          <div className="chart-wrap">
            {chart.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="var(--line)"
                  />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                  />
                  <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} />
                  <ChartTooltip
                    contentStyle={{
                      background: "var(--surface-strong)",
                      border: "1px solid var(--line)",
                      borderRadius: 12,
                    }}
                  />
                  <Bar
                    dataKey="cost"
                    name={language === "zh" ? "USD / 月" : "USD / month"}
                    fill="#8b5cf6"
                    radius={[5, 5, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                title={t("overview.noBilling", "暂无账单数据")}
                description={t("overview.addBilling", "在节点管理中填写价格和付费周期。")}
              />
            )}
          </div>
        </CardBody>
      </Card>
      <Card className="panel-card">
        <CardHeader>
          <h3>{t("costs.renewals", "近期续费")}</h3>
        </CardHeader>
        <CardBody>
          <div className="renewal-list">
            {nodes
              .filter((n) => n.renewal_date)
              .sort((a, b) => a.renewal_date.localeCompare(b.renewal_date))
              .slice(0, 8)
              .map((n) => (
                <div className={`renewal-row ${new Date(n.renewal_date+"T23:59:59").getTime()<Date.now()?"is-overdue":""}`} key={n.name}>
                  <span>
                    {n.name}
                    <small>
                      {n.provider} · {language === "zh" ? cycleLabel[n.cycle] || n.cycle : billingCyclesEn[n.cycle] || n.cycle}
                    </small>
                  </span>
                  <strong>{n.renewal_date}<small>{(()=>{const days=Math.ceil((new Date(n.renewal_date+"T23:59:59").getTime()-Date.now())/86400000);return language==="zh"?(days<0?`逾期 ${-days} 天`:`${days} 天后`):(days<0?`${-days} days overdue`:`in ${days} days`)})()}</small></strong>
                </div>
              ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function AlertHistory(){
 const {language}=useLanguage();const {data:events,error,reload}=useAdminResource<any[]>("/api/v1/admin/alerts/events?limit=100",[]);
 const labels:Record<string,string>=language==="zh"?{offline:"离线",online:"恢复",cpu_high:"CPU 超阈值",traffic_warning:"流量超阈值",login:"管理员登录",memory_high:"内存超阈值",disk_high:"磁盘超阈值",load_high:"负载超阈值",probe_loss:"TCP 探测失败率",billing_due:"续费提醒"}:{offline:"Offline",online:"Recovered",cpu_high:"High CPU",traffic_warning:"Traffic threshold",login:"Admin sign-in",memory_high:"High memory",disk_high:"High disk usage",load_high:"High load",probe_loss:"TCP probe failure rate",billing_due:"Renewal reminder"};
 return <Card className="panel-card"><CardHeader><div><h3>{language==="zh"?"告警历史":"Alert history"}</h3><p>{language==="zh"?"最近 100 条触发事件；渠道是否投递成功请查看服务日志。":"Latest 100 triggered events. Check server logs for delivery failures."}</p></div><Button size="sm" variant="flat" onPress={reload}>{language==="zh"?"刷新":"Refresh"}</Button></CardHeader><CardBody>{error&&<RequestFailure error={error} retry={reload}/>}<div className="table-scroll"><table className="data-table"><thead><tr><th>{language==="zh"?"时间":"Time"}</th><th>{language==="zh"?"节点":"Node"}</th><th>{language==="zh"?"事件":"Event"}</th><th>{language==="zh"?"详情":"Details"}</th></tr></thead><tbody>{events.map((event,index)=><tr key={index}><td>{new Date(event.created_at*1000).toLocaleString(language==="zh"?"zh-CN":"en-US",{hour12:false})}</td><td>{event.server_name||event.server_id}</td><td>{labels[event.event_type]||event.event_type}</td><td>{language==="en"?englishAlert(event.message):event.message}</td></tr>)}</tbody></table>{!events.length&&<p>{language==="zh"?"暂无触发事件":"No alert events"}</p>}</div></CardBody></Card>
}

function AlertsPage() {
  const { language, t } = useLanguage();
  const { data: config, setData: setConfig, error: loadError, reload } = useAdminResource<AlertConfig | null>("/api/v1/admin/alerts", null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; success: boolean } | null>(null);
  const set = (key: string, value: any) =>
    setConfig((c) => (c ? { ...c, [key]: value } : c));
  const saveConfig = async () => {
    if (!config) return false;
    const data = await API("/api/v1/admin/alerts/save", {
      method: "POST",
      body: JSON.stringify(config),
    });
    if (!data.success) {
      setFeedback({ message: data.message || (language === "zh" ? "保存失败" : "Save failed"), success: false });
      return false;
    }
    return true;
  };
  const save = async () => {
    if (!config) return;
    setSaving(true);
    setFeedback(null);
    try {
      if (await saveConfig()) {
        setFeedback({ message: language === "zh" ? "告警配置已保存" : "Alert settings saved", success: true });
      }
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : "Save failed", success: false });
    } finally {
      setSaving(false);
    }
  };
  const sendTest = async () => {
    if (!config) return;
    setTesting(true);
    setFeedback(null);
    try {
      if (!(await saveConfig())) return;
      const result = await API("/api/v1/admin/alerts/test", { method: "POST" });
      setFeedback({
        message: result.message || (language === "zh" ? "测试通知已发送" : "Test notification sent"),
        success: !!result.success,
      });
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : "Test notification failed", success: false });
    } finally {
      setTesting(false);
    }
  };
  if (!config) return loadError ? <RequestFailure error={loadError} retry={reload} /> : <Loading />;
  return (
    <div className="page-stack">
      <div className="page-toolbar alert-page-heading">
        <div>
          <h2>{t("page.alerts", "告警通知")}</h2>
          <p>{t("page.alertsHint", "配置通知渠道，再为每台节点选择需要接收的事件。")}</p>
        </div>
      </div>
      {loadError && <RequestFailure error={loadError} retry={reload} />}
      <Card className="alert-master-card">
        <div className="alert-master-copy">
          <span className="alert-master-indicator" data-enabled={config.enabled} />
          <div>
            <strong>{t("alerts.global", "启用全局告警")}</strong>
            <span>{config.enabled ? t("alerts.globalOn", "告警渠道已按配置运行") : t("alerts.globalOff", "当前暂停所有告警投递")}</span>
          </div>
        </div>
        <Switch
          isSelected={config.enabled}
          onValueChange={(v) => set("enabled", v)}
          aria-label={t("alerts.global", "启用全局告警")}
        />
      </Card>
      {feedback && <Alert color={feedback.success ? "success" : "danger"} title={feedback.message} />}
      <div className="settings-grid">
        <Card className={`panel-card alert-channel ${config.smtp_enabled ? "channel-enabled" : "channel-disabled"}`}>
          <CardHeader className="alert-channel-header">
            <div>
              <h3>{t("alerts.smtp", "SMTP 邮件")}</h3>
              <p>{t("alerts.smtpHint", "适合接收完整告警内容")}</p>
            </div>
            <Switch
              aria-label={t("alerts.smtp", "SMTP 邮件")}
              isSelected={config.smtp_enabled}
              onValueChange={(v) => set("smtp_enabled", v)}
            />
          </CardHeader>
          <CardBody className="form-grid">
            <Input
              label={language === "zh" ? "服务器地址" : "Server address"}
              value={config.smtp_host}
              onValueChange={(v) => set("smtp_host", v)}
            />
            <Input
              label={language === "zh" ? "端口" : "Port"}
              type="number"
              value={String(config.smtp_port)}
              onValueChange={(v) => set("smtp_port", Number(v))}
            />
            <Input
              label={language === "zh" ? "用户名" : "Username"}
              value={config.smtp_user}
              onValueChange={(v) => set("smtp_user", v)}
            />
            <Input
              label={language === "zh" ? "密码 / 授权码" : "Password / app key"}
              type="password"
              placeholder={
                config.smtp_pass_set
                  ? language === "zh" ? "已设置，留空不修改" : "Set; leave blank to keep"
                  : language === "zh" ? "尚未设置" : "Not set"
              }
              onValueChange={(v) => set("smtp_pass", v)}
            />
            <Input
              label={language === "zh" ? "发件人" : "From"}
              value={config.from}
              onValueChange={(v) => set("from", v)}
            />
            <Input
              label={language === "zh" ? "收件人" : "To"}
              value={config.to}
              onValueChange={(v) => set("to", v)}
            />
          </CardBody>
        </Card>
        <Card className={`panel-card alert-channel ${config.telegram_enabled ? "channel-enabled" : "channel-disabled"}`}>
          <CardHeader className="alert-channel-header">
            <div>
              <h3>{t("alerts.telegram", "Telegram")}</h3>
              <p>{t("alerts.telegramHint", "移动端即时通知")}</p>
            </div>
            <Switch
              aria-label={t("alerts.telegram", "Telegram")}
              isSelected={config.telegram_enabled}
              onValueChange={(v) => set("telegram_enabled", v)}
            />
          </CardHeader>
          <CardBody className="form-grid">
            <Input
              label="Bot Token"
              type="password"
              placeholder={
                config.telegram_bot_token_set
                  ? language === "zh" ? "已设置，留空不修改" : "Set; leave blank to keep"
                  : language === "zh" ? "尚未设置" : "Not set"
              }
              onValueChange={(v) => set("telegram_bot_token", v)}
            />
            <Input
              label="Chat ID"
              value={config.telegram_chat_id}
              onValueChange={(v) => set("telegram_chat_id", v)}
            />
          </CardBody>
        </Card>
        <Card className={`panel-card alert-channel ${config.webhook_enabled ? "channel-enabled" : "channel-disabled"}`}>
          <CardHeader className="alert-channel-header">
            <div>
              <h3>{t("alerts.webhook", "Webhook")}</h3>
              <p>{t("alerts.webhookHint", "发送 JSON 到你的自动化系统")}</p>
            </div>
            <Switch
              aria-label={t("alerts.webhook", "Webhook")}
              isSelected={config.webhook_enabled}
              onValueChange={(v) => set("webhook_enabled", v)}
            />
          </CardHeader>
          <CardBody className="gap-3">
            <Select label={language==="zh"?"消息格式":"Message format"} selectedKeys={[config.webhook_format||"generic"]} disallowEmptySelection onSelectionChange={keys=>set("webhook_format",String([...keys][0]))}>
              <SelectItem key="generic">{language==="zh"?"通用 JSON":"Generic JSON"}</SelectItem><SelectItem key="wecom">{language==="zh"?"企业微信":"WeCom"}</SelectItem><SelectItem key="feishu">{language==="zh"?"飞书":"Feishu / Lark"}</SelectItem><SelectItem key="dingtalk">{language==="zh"?"钉钉":"DingTalk"}</SelectItem><SelectItem key="discord">Discord</SelectItem>
            </Select>
            <Input
              label="Webhook URL"
              value={config.webhook_url}
              onValueChange={(v) => set("webhook_url", v)}
            />
          </CardBody>
        </Card>
        <Card className="panel-card alert-channel">
          <CardHeader>
            <div>
              <h3>{t("alerts.triggers", "触发条件")}</h3>
              <p>{t("alerts.triggersHint", "控制哪些事件会投递")}</p>
            </div>
          </CardHeader>
          <CardBody className="alert-trigger-body">
            <div className="alert-trigger-list">
              <div className="alert-trigger-row"><span>{language==="zh"?"管理员登录":"Admin sign-in"}</span><Switch aria-label={language==="zh"?"管理员登录通知":"Sign-in notification"} isSelected={!!config.notify_login} onValueChange={v=>set("notify_login",v)} /></div>
              <div className="alert-trigger-row">
                <span>{t("alerts.offline", "节点离线")}</span>
                <Switch aria-label={t("alerts.offline", "节点离线")} isSelected={config.notify_offline} onValueChange={(v) => set("notify_offline", v)} />
              </div>
              <div className="alert-trigger-row">
                <span>{t("alerts.online", "节点恢复")}</span>
                <Switch aria-label={t("alerts.online", "节点恢复")} isSelected={config.notify_online} onValueChange={(v) => set("notify_online", v)} />
              </div>
              <div className="alert-trigger-row">
                <span>{t("alerts.cpu", "CPU 超阈值")}</span>
                <Switch aria-label={t("alerts.cpu", "CPU 超阈值")} isSelected={config.notify_cpu} onValueChange={(v) => set("notify_cpu", v)} />
              </div>
              <div className="alert-trigger-row">
                <span>{t("alerts.traffic", "流量超阈值")}</span>
                <Switch aria-label={t("alerts.traffic", "流量超阈值")} isSelected={config.notify_traffic} onValueChange={(v) => set("notify_traffic", v)} />
              </div>
            </div>
            <div className="alert-thresholds">
            <Input
              label={t("alerts.cpuThreshold", "CPU 阈值 (%)")}
              type="number"
              value={String(config.cpu_threshold)}
              onValueChange={(v) => set("cpu_threshold", Number(v))}
            />
            <Input
              label={t("alerts.trafficThreshold", "流量阈值 (%)")}
              type="number"
              value={String(config.traffic_threshold)}
              onValueChange={(v) => set("traffic_threshold", Number(v))}
            />
            </div>
          </CardBody>
        </Card>
      </div>
      <Card className="panel-card"><CardHeader><div><h3>{language==="zh"?"资源与续费规则":"Resource and renewal rules"}</h3><p>{language==="zh"?"新增规则默认关闭，可按节点独立启用。":"New rules are off by default and can be enabled per node."}</p></div></CardHeader><CardBody><AlertRuleFields language={language} rules={config.resource_rules} onChange={rules=>set("resource_rules",rules)}/></CardBody></Card>
      <AlertHistory/>
      <div className="sticky-actions">
        <Button color="primary" onPress={save} isLoading={saving} isDisabled={testing}>
          {t("alerts.save", "保存告警配置")}
        </Button>
        <Button
          variant="flat"
          onPress={sendTest}
          isLoading={testing}
          isDisabled={saving}
        >
          {t("alerts.sendTest", "发送测试通知")}
        </Button>
      </div>
    </div>
  );
}

type ThemeMeta = {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  preview?: string | null;
  entry: string;
};

function ThemeCenterPage() {
  const { language, t } = useLanguage();
  const confirmAction=useConfirm();
  const [themes, setThemes] = useState<ThemeMeta[]>([]);
  const [active, setActive] = useState("default");
  const [repository, setRepository] = useState("");
  const [replaceExisting,setReplaceExisting]=useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; success: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [loadError, setLoadError] = useState("");
  const load = () =>
    API("/api/v1/admin/themes").then((data) => {
      setThemes(data.themes || []);
      setActive(data.active || "default");
      setLoadError("");
    }).catch(error => { setLoadError(requestError(error)); });
  useEffect(() => {
    void load();
  }, []);
  const showResult = async (result: any) => {
    if (!result.success) {
      setFeedback({ message: result.message || (language === "zh" ? "操作失败" : "Operation failed"), success: false });
      return;
    }
    setFeedback({
      message: language === "zh" ? `已安装主题：${result.theme?.name || "主题"}` : `Installed ${result.theme?.name || "theme"}`,
      success: true,
    });
    await load();
  };
  const upload = async (file?: File) => {
    if (!file) return;
    if(replaceExisting && !await confirmAction({title:language==="zh"?"更新同名主题":"Update matching theme",body:language==="zh"?`安装「${file.name}」并替换同 ID 主题的全部文件？`:`Install "${file.name}" and replace all files of a matching theme?`}))return;
    setBusy(true);
    setFeedback(null);
    const body = new FormData();
    body.set("file", file);
    try {
      await showResult(await API(`/api/v1/admin/themes/upload?replace=${replaceExisting}`, { method: "POST", body }));
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : "Upload failed", success: false });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const importGithub = async () => {
    if (!repository.trim()) return;
    if(replaceExisting && !await confirmAction({title:language==="zh"?"更新主题":"Update theme",body:language==="zh"?"下载 Release 并替换同 ID 主题的全部文件？":"Download the release and replace all files of a matching theme?"}))return;
    setBusy(true);
    setFeedback(null);
    try {
      await showResult(await API("/api/v1/admin/themes/github", {
        method: "POST",
        body: JSON.stringify({ repository, replace:replaceExisting }),
      }));
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : "Import failed", success: false });
    } finally {
      setBusy(false);
    }
  };
  const remove=async(theme:ThemeMeta)=>{
    if(!await confirmAction({title:language==="zh"?"删除主题":"Delete theme",body:language==="zh"?`删除「${theme.name}」及其全部文件？`:`Delete "${theme.name}" and all its files?`,danger:true}))return;
    setBusy(true);try{const result=await API("/api/v1/admin/themes/delete",{method:"POST",body:JSON.stringify({theme_id:theme.id})});if(!result.success)throw new Error(result.message);await load();setFeedback({success:true,message:language==="zh"?"主题已删除":"Theme deleted"})}catch(error){setFeedback({success:false,message:requestError(error)})}finally{setBusy(false)}
  };
  const activate = async (theme: ThemeMeta) => {
    const warning = language === "zh"
      ? "切换前台主题？主题在隔离环境运行，使用公开监控数据。"
      : "Switch the public theme? Themes run in an isolated environment using public monitoring data.";
    if (!await confirmAction({title:language==="zh"?"切换主题":"Switch theme",body:warning})) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await API("/api/v1/admin/theme/switch", {
        method: "POST",
        body: JSON.stringify({ theme_id: theme.id }),
      });
      if (!result.success) throw new Error(result.message || "Theme switch failed");
      setActive(theme.id);
      setFeedback({ message: language === "zh" ? `已切换到「${theme.name}」` : `Switched to ${theme.name}`, success: true });
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : "Theme switch failed", success: false });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <div>
          <h2>{language === "zh" ? "主题中心" : "Theme center"}</h2>
          <p>{language === "zh" ? "上传主题包，或导入公开 GitHub 仓库最新 Release。" : "Upload a theme package or import the latest release from a public GitHub repository."}</p>
        </div>
      </div>
      <Checkbox isSelected={replaceExisting} onValueChange={setReplaceExisting}>{language==="zh"?"允许更新同 ID 的已安装主题":"Allow updates to an installed theme with the same ID"}</Checkbox>
      <Card className="panel-card">
        <CardHeader><div><h3>{language === "zh" ? "安装主题" : "Install a theme"}</h3><p>{language === "zh" ? "ZIP 需包含 index.html；有 theme.json 时会读取名称、版本和作者。" : "ZIP must contain index.html. If theme.json is present, its name, version, and author are used."}</p></div></CardHeader>
        <CardBody className="theme-install-grid">
          <div className="theme-install-option">
            <div><strong>{language === "zh" ? "上传 ZIP" : "Upload ZIP"}</strong><span>{language === "zh" ? "选择本地构建好的主题压缩包" : "Choose a locally built theme archive"}</span></div>
            <input ref={fileInput} className="theme-file-input" type="file" accept=".zip,application/zip" onChange={(event) => void upload(event.target.files?.[0])} />
            <Button color="primary" variant="flat" startContent={<Upload size={16} />} isLoading={busy} onPress={() => fileInput.current?.click()}>
              {language === "zh" ? "选择 ZIP" : "Choose ZIP"}
            </Button>
          </div>
          <div className="theme-install-option theme-github-option">
            <div><strong>GitHub Releases</strong><span>{language === "zh" ? "自动安装最新 Release 中的 ZIP 资源" : "Install the ZIP asset from the latest release"}</span></div>
            <Input aria-label={language === "zh" ? "GitHub 仓库地址" : "GitHub repository URL"} value={repository} onValueChange={setRepository} placeholder="https://github.com/owner/repository" />
            <Button variant="flat" isLoading={busy} isDisabled={busy || !repository.trim()} onPress={importGithub}>
              {language === "zh" ? "导入 Release" : "Import release"}
            </Button>
          </div>
        </CardBody>
      </Card>
      {feedback && <Alert color={feedback.success ? "success" : "danger"} title={feedback.message} />}
      {loadError && <RequestFailure error={loadError} retry={load} />}
      <div className="theme-trust-note">
        <TriangleAlert size={17} />
        <span>{language === "zh" ? "主题会在访客浏览器中运行网页代码。请只启用你信任的主题来源。" : "Themes run code in visitors' browsers. Enable themes only from sources you trust."}</span>
      </div>
      <div className="theme-list-heading">
        <h3>{language === "zh" ? "已安装主题" : "Installed themes"}</h3>
        <span>{themes.length}</span>
      </div>
      <div className="theme-grid">
        {themes.map((theme) => (
          <Card key={theme.id} className={`panel-card theme-item ${active === theme.id ? "theme-item-active" : ""}`}>
            <CardHeader>
              <div><h3>{theme.name}</h3><p>{theme.author} · {theme.version}</p></div>
              {active === theme.id && <Chip size="sm" color="success" variant="flat">{language === "zh" ? "使用中" : "Active"}</Chip>}
            </CardHeader>
            <CardBody>
              <p className="theme-description">{theme.id==="default"?(language==="zh"?"内置监控主题":"Built-in monitoring theme"):theme.description}</p>
              <div className="theme-item-footer">
                <Code size="sm">{theme.id}</Code>
                {theme.id!=="default"&&active!==theme.id&&<Button size="sm" color="danger" variant="light" isDisabled={busy} onPress={()=>void remove(theme)}>{language==="zh"?"删除":"Delete"}</Button>}
                {active !== theme.id && <Button size="sm" color="primary" variant="flat" isLoading={busy} onPress={() => void activate(theme)}>{language === "zh" ? "启用主题" : "Activate"}</Button>}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}

function auditEnglish(action:string){
 const exact:Record<string,string>={"管理员登录失败":"Admin sign-in failed","两步验证码错误":"Invalid two-factor code","管理员修改登录密码":"Admin password changed","更新告警通知配置":"Alert notification settings updated","启用两步验证 (2FA)":"Two-factor authentication enabled","关闭两步验证 (2FA)":"Two-factor authentication disabled"};
 if(exact[action])return exact[action];
 return action.replace(/^管理员【(.*)】登录成功$/,"Administrator $1 signed in")
 .replace(/^管理员账号由【(.*)】修改为【(.*)】$/,"Administrator username changed from $1 to $2")
 .replace(/^批量设置监控目标：仅启用所选 (\d+) 项，变更 (\d+) 项$/,"Enabled only $1 selected monitoring targets; $2 changed")
 .replace(/^批量设置监控目标：启用所选 (\d+) 项，变更 (\d+) 项$/,"Enabled $1 selected monitoring targets; $2 changed")
 .replace(/^批量设置监控目标：关闭所选 (\d+) 项，变更 (\d+) 项$/,"Disabled $1 selected monitoring targets; $2 changed")
 .replace(/^添加新服务器节点【(.*)】$/,"Added node: $1").replace(/^编辑节点【(.*)】配置$/,"Updated node: $1")
 .replace(/^删除服务器节点【(.*)】$/,"Deleted node: $1").replace(/^重置节点【(.*)】的令牌$/,"Reset token for node: $1")
 .replace(/^修改网站名称为【(.*)】$/,"Site renamed to: $1").replace(/^上传主题【(.*)】$/,"Installed theme: $1")
 .replace(/^删除主题【(.*)】$/,"Deleted theme: $1").replace(/^切换(?:前台主题|激活主题)为【(.*)】$/,"Switched theme to: $1")
 .replace(/^(新增|编辑)监控目标【(.*)】(.*)$/,"Saved monitoring target $2: $3")
 .replace(/^从 GitHub 导入主题【(.*)】$/,"Imported theme from GitHub: $1")
 .replace(/^恢复默认监控目标.*$/,"Restored default targets; nodes with empty selections were paused")
 .replace(/^删除监控目标 #(\d+).*$/,"Deleted target #$1; empty selections reconciled")
 .replace(/^校准节点【(.*)】流量为 (.*) GiB$/,"Calibrated node $1 to $2 GiB")
 .replace(/^保存监控目标【(.*)】$/,"Saved monitoring target: $1");
}

function AuditPage() {
  const { language, t } = useLanguage();
  const [page,setPage]=useState(0);const [query,setQuery]=useState("");
  const { data: logs, error, loading, reload } = useAdminResource<any[]>(`/api/v1/admin/audit?limit=51&offset=${page*50}&search=${encodeURIComponent(query)}`, []);
  return (
    <div className="page-stack">
      {error && <RequestFailure error={error} retry={reload} />}
      <div className="page-toolbar">
        <div>
          <h2>{t("page.audit", "安全审计")}</h2>
          <p>{t("page.auditHint", "登录、配置修改和管理操作都会记录在这里。")}</p>
        </div>
        <Button
          variant="flat"
          startContent={<RefreshCw size={16} />}
          onPress={reload}
          isLoading={loading}
        >
          {t("common.refresh", "刷新")}
        </Button>
      </div>
      <Card className="panel-card">
        <CardBody className="p-0">
          <div className="table-toolbar"><Input aria-label={language==="zh"?"搜索审计记录":"Search audit records"} placeholder={language==="zh"?"搜索操作或 IP":"Search action or IP"} value={query} onValueChange={value=>{setQuery(value);setPage(0)}} startContent={<Search size={15}/>}/></div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("audit.time", "时间")}</th>
                  <th>{t("audit.action", "审计行为")}</th>
                  <th>{t("audit.sourceIp", "来源 IP")}</th>
                </tr>
              </thead>
              <tbody>
                {logs.slice(0,50).map((l) => (
                  <tr key={l.id}>
                    <td><time dateTime={l.created_at}>{new Date(l.created_at.endsWith("Z")?l.created_at:l.created_at.replace(" ","T")+"Z").toLocaleString(language==="zh"?"zh-CN":"en-US",{hour12:false})}</time></td>
                    <td>
                      <span className={`audit-action ${/失败|错误|拒绝|锁定|fail|denied/i.test(l.action)?"is-failure":""}`} title={l.action}>
                        {/失败|错误|拒绝|锁定|fail|denied/i.test(l.action)?<TriangleAlert size={14}/>:<Check size={14}/>}
                        {language==="en"?auditEnglish(l.action):l.action}
                      </span>
                    </td>
                    <td>
                      <Code>{l.ip}</Code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!logs.length && (
              <EmptyState
                title={language === "zh" ? "暂无审计记录" : "No audit entries"}
                description={language === "zh" ? "管理员登录或修改配置后会出现在这里。" : "Admin sign-ins and configuration changes will appear here."}
              />
            )}
          </div><div className="table-footer"><span>{language==="zh"?`第 ${page+1} 页`:`Page ${page+1}`}</span><div className="toolbar-actions"><Button size="sm" variant="flat" isDisabled={page===0||loading} onPress={()=>setPage(page-1)}>{language==="zh"?"上一页":"Previous"}</Button><Button size="sm" variant="flat" isDisabled={logs.length<=50||loading} onPress={()=>setPage(page+1)}>{language==="zh"?"下一页":"Next"}</Button></div></div>
        </CardBody>
      </Card>
    </div>
  );
}

function SettingsPage({
  siteName,
  onSaved,
  passwordFocusRequest = 0,
}: {
  siteName: string;
  onSaved: (name: string) => void;
  passwordFocusRequest?: number;
}) {
  const { language, t } = useLanguage();
  const passwordSection = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (!passwordFocusRequest) return;
    passwordSection.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    passwordSection.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }, [passwordFocusRequest, reduceMotion]);
  const [name, setName] = useState(siteName);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [securityMessage, setSecurityMessage] = useState("");
  const [twoFa, setTwoFa] = useState(false);
  const [twoFaSecret, setTwoFaSecret] = useState("");
  const [twoFaQr, setTwoFaQr] = useState("");
  const [twoFaCode, setTwoFaCode] = useState("");
  const [securityBusy, setSecurityBusy] = useState(false);
  const { data: twoFaStatus, error: twoFaError, loading: twoFaLoading, reload: reloadTwoFa } = useAdminResource<{ enabled: boolean } | null>("/api/v1/admin/2fa/status", null);
  useEffect(() => { if (twoFaStatus) setTwoFa(!!twoFaStatus.enabled); }, [twoFaStatus]);
  const performSecurity = async (operation: () => Promise<void>) => {
    if (securityBusy) return;
    setSecurityBusy(true); setSecurityMessage("");
    try { await operation(); } catch (error) { setSecurityMessage(requestError(error)); }
    finally { setSecurityBusy(false); }
  };
  const save = async () => {
    setSaving(true); setMessage("");
    try {
    const data = await API("/api/v1/admin/site-settings", {
      method: "POST",
      body: JSON.stringify({ site_name: name.trim() }),
    });
    if (!data.success) throw new Error(data.message || (language === "zh" ? "保存失败" : "Save failed"));
    setMessage(language === "zh" ? "网站名称已更新" : "Site name updated");
    onSaved(data.site_name || name.trim());
    } catch (error) { setMessage(requestError(error)); }
    finally { setSaving(false); }
  };
  const changePassword = () => performSecurity(async () => {
    const result = await API("/api/v1/admin/password", {
      method: "POST",
      body: JSON.stringify({
        old_password: oldPassword,
        new_password: newPassword,
      }),
    });
    const message = result.message || (language === "zh" ? "密码已更新" : "Password updated");
    setSecurityMessage(language === "en" ? englishMessage(message) : message);
    if (result.success) {
      setOldPassword("");
      setNewPassword("");
      localStorage.removeItem("aegis_admin_token");
      location.href = "/admin/login";
    }
  });
  const setupTwoFa = () => performSecurity(async () => {
    const result = await API("/api/v1/admin/2fa/setup", { method: "POST" });
    if (result.success) {
      setTwoFaSecret(result.secret);
      setTwoFaQr(result.qr_svg);
    } else setSecurityMessage(result.message || "无法生成验证器密钥");
  });
  const enableTwoFa = () => performSecurity(async () => {
    const result = await API("/api/v1/admin/2fa/enable", {
      method: "POST",
      body: JSON.stringify({ secret: twoFaSecret, code: twoFaCode }),
    });
    setSecurityMessage(result.message || "");
    if (result.success) {
      setTwoFa(true);
      setTwoFaQr("");
      setTwoFaCode("");
    }
  });
  const disableTwoFa = () => performSecurity(async () => {
    const password = prompt(language === "zh" ? "请输入当前管理员密码以关闭两步验证" : "Enter the current admin password to disable two-factor authentication");
    if (!password) return;
    const result = await API("/api/v1/admin/2fa/disable", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    setSecurityMessage(result.message || "");
    if (result.success) setTwoFa(false);
  });
  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <div>
          <h2>{t("page.settings", "网站设置")}</h2>
          <p>{t("page.settingsHint", "名称会应用到登录页、前台标题、后台标题和品牌区域。")}</p>
        </div>
      </div>
      <Card className="settings-card settings-page-card">
        <CardBody className="settings-page-body p-0">
          <section className="settings-row">
            <div className="settings-row-copy">
              <div className="settings-row-icon"><Server size={17} /></div>
              <div>
                <h3>{t("settings.brand", "品牌设置")}</h3>
                <p>{language === "zh" ? "名称会同步到登录页、页面标题和品牌标识。" : "Used on the sign-in page, page title, and brand mark."}</p>
              </div>
            </div>
            <div className="settings-row-fields">
              <Input label={t("settings.siteName", "网站名称")} maxLength={48} value={name} onValueChange={setName} />
              <div className="preview-brand"><Brand siteName={name || "Moniter"} compact /></div>
              {message && <Alert color="primary" title={message} />}
              <div className="settings-row-actions"><Button color="primary" onPress={save} isLoading={saving}>{t("settings.saveName", "保存网站名称")}</Button></div>
            </div>
          </section>
          <Divider />
          <VersionSettings />
          <Divider />
          <AccountSettings />
          <Divider />
          <section className="settings-row" id="admin-password" ref={passwordSection}>
            <div className="settings-row-copy">
              <div className="settings-row-icon"><ShieldCheck size={17} /></div>
              <div>
                <h3>{t("settings.password", "修改管理员密码")}</h3>
                <p>{language === "zh" ? "修改后当前会话会退出，需要用新密码重新登录。" : "This session ends after the password changes."}</p>
              </div>
            </div>
            <div className="settings-row-fields">
              <Input id="admin-current-password" autoComplete="current-password" label={t("settings.currentPassword", "当前密码")} type="password" value={oldPassword} onValueChange={setOldPassword} />
              <Input autoComplete="new-password" label={t("settings.newPassword", "新密码")} type="password" value={newPassword} onValueChange={setNewPassword} />
              <div className="settings-row-actions"><Button color="primary" onPress={changePassword} isDisabled={securityBusy || !!twoFaError || twoFaLoading}>{t("settings.updatePassword", "更新密码")}</Button></div>
            </div>
          </section>
          <Divider />
          <section className="settings-row">
            <div className="settings-row-copy">
              <div className="settings-row-icon"><ShieldCheck size={17} /></div>
              <div>
                <h3>{t("settings.twoFactor", "两步验证")}</h3>
                <p>{language === "zh" ? "使用验证器应用为管理员登录增加一道验证。" : "Add an authenticator check to admin sign-in."}</p>
              </div>
            </div>
            <div className="settings-row-fields">
              {twoFaError && <RequestFailure error={twoFaError} retry={reloadTwoFa} />}
              <div className="settings-twofa-status">
                <span>{language === "zh" ? "验证器状态" : "Authenticator status"}</span>
                <Chip color={twoFa ? "success" : "default"} variant="flat">{twoFaLoading ? (language === "zh" ? "加载中" : "Loading") : twoFaError ? (language === "zh" ? "读取失败" : "Unavailable") : twoFa ? t("common.enabled", "已启用") : t("common.disabled", "未启用")}</Chip>
              </div>
              {twoFa ? (
                <Button className="settings-action-button" color="warning" variant="flat" onPress={disableTwoFa} isDisabled={securityBusy || !!twoFaError || twoFaLoading}>{language === "zh" ? "关闭两步验证" : "Disable two-factor authentication"}</Button>
              ) : !twoFaQr ? (
                <Button className="settings-action-button" variant="flat" onPress={setupTwoFa} isDisabled={securityBusy || !!twoFaError || twoFaLoading}>{t("settings.generateQr", "生成验证器二维码")}</Button>
              ) : (
                <div className="settings-twofa-setup">
                  <div className="twofa-qr" dangerouslySetInnerHTML={{ __html: twoFaQr }} />
                  <Code>{twoFaSecret}</Code>
                  <Input label={language === "zh" ? "输入 6 位验证码" : "Enter 6-digit code"} value={twoFaCode} onValueChange={setTwoFaCode} maxLength={6} inputMode="numeric" />
                  <Button color="primary" onPress={enableTwoFa} isDisabled={securityBusy || !!twoFaError || twoFaLoading}>{language === "zh" ? "启用两步验证" : "Enable two-factor authentication"}</Button>
                </div>
              )}
              {securityMessage && <Alert color="primary" title={securityMessage} />}
            </div>
          </section>
        </CardBody>
      </Card>
    </div>
  );
}

// Providers live here so the public status page never loads the component library.
export default function ConsoleRoute(){const siteName=useSiteName();const {language}=useLanguage();const reduced=useReducedMotion();
  return <HeroUIProvider disableRipple disableAnimation={!!reduced}><MotionConfig reducedMotion="user"><ConfirmProvider language={language}>
    {location.pathname==="/admin/login"?<LoginPage siteName={siteName}/>:<VersionProvider><AdminApp siteName={siteName}/></VersionProvider>}
  </ConfirmProvider></MotionConfig></HeroUIProvider>;}
