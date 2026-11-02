#!/usr/bin/env bash
set -euo pipefail
TOKEN=__TOKEN__
BASE=__BASE__
WS_BASE=__WS_BASE__
[[ $(id -u) -eq 0 ]] || { echo '请使用 root 或 sudo 执行安装' >&2; exit 1; }
command -v systemctl >/dev/null || { echo '需要 systemd，请手动部署 Agent' >&2; exit 1; }
case "$(uname -m)" in x86_64|amd64) PLATFORM=linux-amd64;; aarch64|arm64) PLATFORM=linux-arm64;; *) echo '不支持此架构' >&2; exit 1;; esac
INSTALL_DIR=/opt/aegis-agent
UNIT=/etc/systemd/system/aegis-agent.service
TOKEN_FILE=/etc/aegis-agent.token
mkdir -p "$INSTALL_DIR"
umask 077
STAGING=$(mktemp -d "$INSTALL_DIR/.update.XXXXXX")
CHANGED=0
HAD_BINARY=0; HAD_TOKEN=0; HAD_UNIT=0; WAS_ACTIVE=0; WAS_ENABLED=0
[[ ! -f "$INSTALL_DIR/aegis-agent" ]] || { cp -p "$INSTALL_DIR/aegis-agent" "$STAGING/previous"; HAD_BINARY=1; }
[[ ! -f "$TOKEN_FILE" ]] || { cp -p "$TOKEN_FILE" "$STAGING/token.previous"; HAD_TOKEN=1; }
[[ ! -f "$UNIT" ]] || { cp -p "$UNIT" "$STAGING/unit.previous"; HAD_UNIT=1; }
systemctl is-active --quiet aegis-agent >/dev/null 2>&1 && WAS_ACTIVE=1
systemctl is-enabled --quiet aegis-agent >/dev/null 2>&1 && WAS_ENABLED=1
cleanup() {
  result=$?
  if [[ $result -ne 0 && $CHANGED -eq 1 ]]; then
    systemctl stop aegis-agent >/dev/null 2>&1 || true
    [[ $WAS_ENABLED -eq 1 ]] || systemctl disable aegis-agent >/dev/null 2>&1 || true
    if [[ $HAD_BINARY -eq 1 ]]; then mv -f "$STAGING/previous" "$INSTALL_DIR/aegis-agent"; else rm -f "$INSTALL_DIR/aegis-agent"; fi
    if [[ $HAD_TOKEN -eq 1 ]]; then mv -f "$STAGING/token.previous" "$TOKEN_FILE"; else rm -f "$TOKEN_FILE"; fi
    if [[ $HAD_UNIT -eq 1 ]]; then mv -f "$STAGING/unit.previous" "$UNIT"; else rm -f "$UNIT"; fi
    systemctl daemon-reload || true
    [[ $WAS_ACTIVE -ne 1 ]] || systemctl start aegis-agent || true
    if [[ $HAD_UNIT -eq 1 ]]; then echo '更新失败，已恢复更新前的 Agent 和配置' >&2
    else echo '安装失败，已撤销本次安装；启动错误见上方日志' >&2; fi
  fi
  rm -rf -- "$STAGING"
  exit "$result"
}
trap cleanup EXIT
curl --fail --silent --show-error --location --connect-timeout 10 --max-time 120 "$BASE/download/agent/$PLATFORM" -o "$STAGING/agent"
[[ $(od -An -tx1 -N4 "$STAGING/agent" | tr -d ' \n') == 7f454c46 ]] || { echo '下载文件不是有效的 Linux 程序' >&2; exit 1; }
chmod 755 "$STAGING/agent"
printf '%s' "$TOKEN" > "$STAGING/token"
cat > "$STAGING/unit" <<UNITFILE
[Unit]
Description=Moniter Agent
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
ExecStart=$INSTALL_DIR/aegis-agent --server $WS_BASE/ws/agent --token-file $TOKEN_FILE
Restart=always
RestartSec=5
LimitNOFILE=65535
[Install]
WantedBy=multi-user.target
UNITFILE
CHANGED=1
systemctl stop aegis-agent >/dev/null 2>&1 || true
# Replace the inode after stopping; never write through an executing ELF file.
mv -f "$STAGING/agent" "$INSTALL_DIR/aegis-agent"
mv -f "$STAGING/token" "$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"
mv -f "$STAGING/unit" "$UNIT"
chmod 644 "$UNIT"
systemctl daemon-reload
systemctl enable aegis-agent >/dev/null
STARTED_AT=$(date +%s)
startup_failed() {
  journalctl -u aegis-agent --since "@$STARTED_AT" -n 20 --no-pager >&2 || true
  exit 1
}
systemctl restart aegis-agent || startup_failed
sleep 2
systemctl is-active --quiet aegis-agent || startup_failed
CHANGED=0
echo '安装完成，Agent 已启动并设置开机自启'
