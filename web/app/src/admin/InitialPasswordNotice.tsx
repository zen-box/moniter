import { Alert, Button } from "@heroui/react";
import { useLanguage } from "../runtime";
import { useAdminResource } from "../useAdminResource";

type AdminStatus = { logged_in: boolean; password_change_recommended: boolean };

export function InitialPasswordNotice({ onChangePassword }: { onChangePassword: () => void }) {
  const { language } = useLanguage();
  const { data } = useAdminResource<AdminStatus | null>("/api/v1/admin/status", null);
  if (!data?.password_change_recommended) return null;

  return (
    <Alert
      color="warning"
      variant="flat"
      className="initial-password-notice"
      classNames={{ iconWrapper: "initial-password-icon", mainWrapper: "initial-password-copy" }}
      title={language === "zh" ? "建议修改初始密码" : "Change your initial password"}
      description={language === "zh" ? "请设置你自己的管理员密码。修改后将不再提示。" : "Set your own administrator password to clear this reminder."}
      endContent={
        <Button color="warning" variant="flat" size="sm" className="initial-password-action shrink-0" onPress={onChangePassword}>
          {language === "zh" ? "修改密码" : "Change password"}
        </Button>
      }
    />
  );
}
