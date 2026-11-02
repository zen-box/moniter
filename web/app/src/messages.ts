/** Translate application messages, preserving user names and unknown diagnostic text. */
const messages:Record<string,string>={
  "账号或密码错误":"Incorrect username or password", "密码错误":"Incorrect password", "当前密码错误":"Current password is incorrect",
  "请输入两步验证码":"Enter your two-factor code", "验证码不正确":"Incorrect verification code", "登录信息格式无效":"Invalid sign-in details",
  "登录请求较多，请稍后重试":"Too many sign-in requests. Try again later.", "登录已失效，请重新登录":"Your session expired. Please sign in again.",
  "无法保存登录会话，请稍后重试":"Could not save your session. Please try again.", "登录成功":"Signed in",
  "网站名称需为 1 到 48 个字符":"Site name must contain 1–48 characters", "节点名称不能为空且不超过 64 字符":"Node name must contain 1–64 characters",
  "名称不能为空且不超过 64 字符":"Name must contain 1–64 characters", "价格和流量配额不能为负数":"Price and traffic quota cannot be negative",
  "IPv4 或 IPv6 地址无效":"Invalid IPv4 or IPv6 address", "节点不存在":"Node not found", "目标不存在":"Target not found",
  "已用流量不能为负数":"Traffic usage cannot be negative", "流量数值无效":"Invalid traffic value", "IP / 域名格式不正确":"Invalid IP address or hostname",
  "端口必须在 1-65535 之间":"Port must be between 1 and 65535", "新密码至少 8 位":"New password must contain at least 8 characters",
  "密码已更新，请重新登录":"Password updated. Please sign in again.", "两步验证已启用，请先关闭":"Disable two-factor authentication first",
  "新密码不能与当前密码相同":"Choose a password different from your current password.",
  "密码保存失败，请稍后重试":"Could not save the password. Please try again.",
  "验证码不正确，请确认手机时间是否准确":"Incorrect code. Check the time on your authenticator device.", "两步验证已启用":"Two-factor authentication enabled",
  "两步验证已关闭":"Two-factor authentication disabled", "非法的主题标识":"Invalid theme ID", "主题不存在":"Theme not found",
  "无法删除内置主题或无效主题":"Cannot delete the built-in theme or an invalid theme", "请先切换到其他主题，再删除当前主题":"Switch to another theme before deleting the active theme",
  "请选择一个 ZIP 主题包":"Select a theme ZIP file", "读取主题压缩包失败":"Could not read the theme archive", "主题目录不能为符号链接":"Theme directories cannot be symbolic links",
  "请输入有效的 GitHub 仓库地址，例如 https://github.com/owner/theme":"Enter a GitHub repository URL, e.g. https://github.com/owner/theme",
  "仓库没有公开的最新 Release，或仓库不存在":"No public latest release was found for this repository", "最新 Release 没有 .zip 主题资源":"The latest release has no theme ZIP asset",
  "GitHub Release 信息格式无效":"Invalid GitHub release metadata", "GitHub Release 提供的下载地址无效":"Invalid GitHub release download URL",
  "GitHub Release 下载地址必须来自 github.com":"Release download URLs must originate from github.com", "GitHub 主题压缩包不能超过 32 MB":"Theme ZIP files cannot exceed 32 MiB",
  "没有启用任何告警渠道":"No notification channels are enabled", "未配置 SMTP 服务器":"SMTP server is not configured", "未配置发件人地址":"Sender address is not configured",
  "未配置收件人地址":"Recipient address is not configured", "未配置 Telegram Bot Token 或 Chat ID":"Telegram bot token or chat ID is missing",
  "SMTP 发送超时":"SMTP delivery timed out", "没有有效的收件人地址":"No valid recipient address", "未配置 Webhook URL":"Webhook URL is not configured",
};
export function englishMessage(message:string):string {
  if(messages[message])return messages[message];
  return message.replace(/^登录失败过多，请 (\d+) 秒后再试$/,"Too many failed sign-ins. Try again in $1 seconds.")
    .replace(/^测试告警已发送到 /,"Test notification sent to ").replace(/^已发送到 /,"Delivered to ")
    .replace(/；以下渠道失败：/,"; failed channels: ").replace(/^保存失败[:：] ?/,"Save failed: ")
    .replace(/^写入失败[:：] ?/,"Database write failed: ").replace(/^请求参数无效[:：] ?/,"Invalid request: ")
    .replace(/^无法访问 GitHub[:：] ?/,"Could not access GitHub: ").replace(/^Webhook 连接失败[:：] ?/,"Webhook connection failed: ")
    .replace(/^Webhook 返回 HTTP /,"Webhook returned HTTP ").replace(/^GitHub 返回 HTTP /,"GitHub returned HTTP ")
    .replace(/^同名主题已存在.*$/,"A theme with this ID already exists. Enable replacement to update it.");
}

export function englishAlert(message:string):string {
  return message.replace(/^节点已恢复在线，心跳重新接收。$/,"The node is online and reporting again.")
    .replace(/^节点已离线（超过 (\d+) 秒未收到心跳）。地区：(.*)，服务商：(.*)$/,"No heartbeat for over $1 seconds. Region: $2; provider: $3")
    .replace(/^CPU 使用率 (.*)%，已连续 9 秒超过阈值 (.*)%。$/,"CPU usage $1%, above the $2% threshold for 9 seconds.")
    .replace(/^流量已用 (.*)（(.*)%），超过阈值 (.*)%。$/,"Traffic used $1 ($2%), above the $3% threshold.")
    .replace(/^内存使用率 (.*)%，连续 3 次检查达到阈值 (.*)%。$/,"Memory usage $1%, above $2% for 3 checks.")
    .replace(/^磁盘使用率 (.*)%，连续 3 次检查达到阈值 (.*)%。$/,"Disk usage $1%, above $2% for 3 checks.")
    .replace(/^每核心 1 分钟负载 (.*)，连续 3 次检查达到阈值 (.*)。$/,"1-minute load per CPU core $1, above $2 for 3 checks.")
    .replace(/^管理员 (.*) 登录成功；来源 IP：(.*)$/,"Administrator $1 signed in. Source IP: $2")
    .replace(/^节点将于 (.*) 到期，剩余 (.*) 天。$/,"Renewal date $1, in $2 days.")
    .replace(/^节点续费日期 (.*)，已逾期 (.*) 天。请确认是否已付款并更新续费日期。$/,"Renewal date $1, overdue by $2 days. Confirm payment and update the renewal date.")
    .replace(/^目标 (.*) 最近 5 分钟 TCP 探测失败率 (.*)%（(.*) 次），达到阈值 (.*)%。$/,"Target $1: $2% TCP failures ($3 samples) over 5 minutes; threshold $4%.");
}
