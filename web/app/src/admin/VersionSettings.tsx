import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Alert, Button, Chip } from "@heroui/react";
import { ArrowUpRight, PackageCheck, RefreshCw } from "lucide-react";
import { API, requestError } from "../lib";
import { useLanguage } from "../runtime";
import { useAdminResource } from "../useAdminResource";

type UpdateStatus = {
  current_version: string;
  latest_version: string | null;
  update_available: boolean;
  enabled: boolean;
  release_url: string | null;
  checked_at: number | null;
  last_attempt_at: number | null;
  error: string | null;
};
const VersionContext = createContext<{
  data: UpdateStatus | null;
  error: string;
  checking: boolean;
  check: () => Promise<void>;
}>({ data: null, error: "", checking: false, check: async () => {} });

export function VersionProvider({ children }: { children: ReactNode }) {
  const { data, setData, error, reload } = useAdminResource<UpdateStatus | null>("/api/v1/admin/updates", null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  useEffect(() => {
    const refresh = () => { if (!document.hidden) void reload(); };
    const timer = setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [reload]);
  const check = async () => {
    if (checking) return;
    setChecking(true); setCheckError("");
    try { setData(await API("/api/v1/admin/updates/check", { method: "POST" })); }
    catch (cause) { setCheckError(requestError(cause)); }
    finally { setChecking(false); }
  };
  return <VersionContext.Provider value={{ data, error: checkError || error, checking, check }}>{children}</VersionContext.Provider>;
}

export function UpdateNotice() {
  const { data } = useContext(VersionContext);
  const { language } = useLanguage();
  if (!data?.update_available) return null;
  return <Button as="a" role="link" href="#settings" className="update-notice" color="primary" variant="flat" aria-label={language === "zh" ? `新版本 ${data.latest_version}` : `Update ${data.latest_version}`} startContent={<PackageCheck size={16} />}>
    <span>{language === "zh" ? `新版本 ${data.latest_version}` : `Update ${data.latest_version}`}</span>
  </Button>;
}

export function VersionSettings() {
  const { data, error, checking, check } = useContext(VersionContext);
  const { language } = useLanguage();
  const zh = language === "zh";
  const errors: Record<string, string> = zh ? {
    network: "无法连接 GitHub，请稍后重试。",
    rate_limited: "GitHub 请求额度已用完，请稍后重试。",
    github_unavailable: "GitHub 暂时无法提供发布信息。",
    invalid_response: "GitHub 返回的发布信息无效。",
    release_limit: "发布记录过多，暂时无法确认最新版本。",
  } : {
    network: "Could not reach GitHub. Try again later.",
    rate_limited: "GitHub rate limit reached. Try again later.",
    github_unavailable: "GitHub release information is temporarily unavailable.",
    invalid_response: "GitHub returned invalid release information.",
    release_limit: "Too many release records to confirm the latest version.",
  };
  const failure = error || (data?.error ? errors[data.error] || data.error : "");
  return <section className="settings-row" data-testid="version-settings">
    <div className="settings-row-copy">
      <div className="settings-row-icon"><PackageCheck size={17} /></div>
      <div><h3>{zh ? "版本更新" : "Software updates"}</h3>
        <p>{zh ? "每 6 小时检查官方正式版本，有新版本时提醒。" : "Checks official stable releases every 6 hours and notifies you of updates."}</p>
      </div>
    </div>
    <div className="settings-row-fields version-settings-fields">
      <dl className="version-facts">
        <div><dt>{zh ? "当前版本" : "Current version"}</dt><dd>{data ? <Chip size="sm" variant="flat">v{data.current_version}</Chip> : "—"}</dd></div>
        <div><dt>{zh ? "最新版本" : "Latest version"}</dt><dd>{data?.latest_version ? `v${data.latest_version}` : data?.checked_at ? (zh ? "尚未发布正式版" : "No stable release yet") : "—"}</dd></div>
        <div><dt>{zh ? "上次检查" : "Last checked"}</dt><dd>{data?.checked_at ? new Date(data.checked_at * 1000).toLocaleString(zh ? "zh-CN" : "en-US") : "—"}</dd></div>
      </dl>
      {data && !data.enabled && <p className="version-status">{zh ? "版本检测已通过环境配置关闭。" : "Update checks are disabled by the server configuration."}</p>}
      {data?.checked_at && !data.update_available && data.latest_version && !failure && <p className="version-status">{zh ? "已是最新版本" : "You're up to date"}</p>}
      {failure && <Alert color="warning" title={failure} />}
      <div className="settings-row-actions">
        <Button variant="flat" startContent={!checking && <RefreshCw size={16} />} isLoading={checking} isDisabled={data?.enabled === false} onPress={() => void check()}>{zh ? "检查更新" : "Check for updates"}</Button>
        {data?.update_available && data.release_url && <Button as="a" role="link" color="primary" href={data.release_url} target="_blank" rel="noopener noreferrer" endContent={<ArrowUpRight size={16} />}>
          {zh ? `查看 v${data.latest_version}` : `View v${data.latest_version}`}
        </Button>}
      </div>
    </div>
  </section>;
}
