import { useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Input } from "@heroui/react";
import { UserRound } from "lucide-react";
import { API, requestError } from "../lib";
import { englishMessage } from "../messages";
import { useLanguage } from "../runtime";
import { useAdminResource } from "../useAdminResource";

export function AccountSettings() {
  const { language } = useLanguage();
  const tr = (zh: string, en: string) => language === "zh" ? zh : en;
  const { data, error, loading, reload } = useAdminResource<{ username: string } | null>("/api/v1/admin/account", null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setUsername(data.username); }, [data]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !data) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await API("/api/v1/admin/account", {
        method: "POST", body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!result.success) {
        setMessage(result.message || tr("账号保存失败，请稍后重试", "Could not save the username. Please try again."));
        return;
      }
      localStorage.removeItem("aegis_admin_token");
      location.href = "/admin/login";
    } catch (error) { setMessage(requestError(error)); }
    finally { setPassword(""); setBusy(false); }
  };

  return (
    <section className="settings-row" id="admin-account">
      <div className="settings-row-copy">
        <div className="settings-row-icon"><UserRound size={17} /></div>
        <div>
          <h3>{tr("管理员账号", "Administrator account")}</h3>
          <p>{tr("修改后所有会话会退出，需要使用新账号重新登录。", "Changing the username signs out all sessions. Sign in again with your new username.")}</p>
        </div>
      </div>
      <form className="settings-row-fields" onSubmit={save}>
        {error && <Alert color="danger" title={error} endContent={<Button size="sm" variant="flat" onPress={() => void reload()}>{tr("重试", "Retry")}</Button>} />}
        <Input label={tr("登录账号", "Username")} value={username} onValueChange={setUsername}
          autoComplete="username" autoCapitalize="none" spellCheck="false" maxLength={64} pattern="[A-Za-z0-9._\-]{1,64}" isRequired
          isDisabled={loading || busy || !data} description={tr("1–64 位字母、数字、点、下划线或连字符", "1–64 letters, numbers, periods, underscores, or hyphens")} />
        <Input label={tr("验证当前密码", "Confirm current password")} type="password" autoComplete="current-password"
          value={password} onValueChange={setPassword} isRequired isDisabled={loading || busy || !data} />
        {message && <Alert color="danger" title={language === "en" ? englishMessage(message) : message} />}
        <div className="settings-row-actions">
          <Button type="submit" color="primary" isLoading={busy}
            isDisabled={loading || !data || username.trim() === data.username || !username.trim() || !password}>
            {tr("更新账号", "Update username")}
          </Button>
        </div>
      </form>
    </section>
  );
}
