#!/usr/bin/env bash
# Moniter server installer. Agent installation remains available in node management.
set -Eeuo pipefail
ACTION=install; VERSION=''; PORT=''
ROOT=${MONITER_INSTALL_DIR:-/opt/moniter}
UNIT_DIR=${MONITER_SYSTEMD_DIR:-/etc/systemd/system}
BIN_DIR=${MONITER_BIN_DIR:-/usr/local/bin}
fail() { printf '%s\n' "$*" >&2; exit 1; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    install|update) ACTION=$1; shift;;
    --version) [[ $# -ge 2 ]] || fail '--version 缺少版本号'; VERSION=${2#v}; shift 2;;
    --port) [[ $# -ge 2 ]] || fail '--port 缺少端口号'; PORT=$2; shift 2;;
    -h|--help) printf '%s\n' '用法：install.sh [install|update] [--version 0.1.0] [--port 8080]' '再次执行安装命令或 moniter update 即可更新，数据库与已安装主题保留。'; exit 0;;
    *) fail "未知参数：$1";;
  esac
done
[[ $(id -u) -eq 0 ]] || fail '请使用 root 或 sudo bash 执行'
[[ $(uname -s) == Linux ]] || fail '此脚本用于 Linux；Windows 请使用 install.ps1'
command -v systemctl >/dev/null || fail '需要 systemd；此系统请手动部署'
case $(uname -m) in x86_64|amd64) PLATFORM=linux-amd64;; aarch64|arm64) PLATFORM=linux-arm64;; *) fail '仅支持 Linux amd64 / arm64';; esac
[[ -z $VERSION || $VERSION =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || fail '版本号格式应为 0.1.0'
[[ -z $PORT || $PORT =~ ^[0-9]+$ && ${#PORT} -le 5 ]] || fail '端口必须是 1–65535'
if [[ -n $PORT ]]; then PORT=$((10#$PORT)); [[ $PORT -ge 1 && $PORT -le 65535 ]] || fail '端口必须是 1–65535'; fi
for tool in curl python3 flock; do
  if ! command -v "$tool" >/dev/null; then
    if command -v apt-get >/dev/null; then apt-get update -qq; apt-get install -y curl ca-certificates python3 util-linux;
    elif command -v dnf >/dev/null; then dnf install -y curl ca-certificates python3 util-linux;
    elif command -v yum >/dev/null; then yum install -y curl ca-certificates python3 util-linux;
    else fail '请先安装 curl、python3 与 util-linux'; fi
    break
  fi
done
[[ $ROOT == /* && $ROOT != *[^a-zA-Z0-9/_.-]* && ${#ROOT} -gt 5 ]] || fail '安装目录必须是无空格的绝对路径'
umask 077
mkdir -p "$ROOT"; ROOT=$(cd "$ROOT" && pwd -P)
case "$ROOT" in /|/etc|/usr|/usr/local|/var|/opt|/home|/root|/tmp) fail '不能将系统目录本身作为安装目录';; esac
exec 9>"$ROOT/.install.lock"; flock -n 9 || fail '另一个安装或更新正在运行'
UNIT="$UNIT_DIR/moniter.service"; CONFIG="$ROOT/moniter.env"
if [[ -f $UNIT ]] && ! grep -Fq "ExecStart=$ROOT/moniter" "$UNIT"; then fail '已有其他 moniter.service，请先手动迁移，安装器不会覆盖它'; fi
STAGING=$(mktemp -d "$ROOT/.install.XXXXXX")
CHANGED=0; STOPPED=0; WAS_ACTIVE=0; WAS_ENABLED=0; HAD_UNIT=0; HAD_CONFIG=0; HAD_DB=0; BACKUP=''
REPLACED=(); SAVED=()
MANAGED=(moniter web/dist web/assets binaries release.json install.sh install.ps1)
systemctl is-active --quiet moniter && WAS_ACTIVE=1
systemctl is-enabled --quiet moniter && WAS_ENABLED=1
[[ ! -f $UNIT ]] || HAD_UNIT=1
[[ ! -f $CONFIG ]] || HAD_CONFIG=1
cleanup() {
  local result=$?
  trap - EXIT
  if [[ $result -ne 0 && $STOPPED -eq 1 ]]; then
    systemctl stop moniter >/dev/null 2>&1 || true
    if [[ $CHANGED -eq 1 ]]; then
      for item in "${REPLACED[@]}"; do rm -rf -- "$ROOT/$item"; done
      for item in "${SAVED[@]}"; do mkdir -p "$(dirname "$ROOT/$item")"; mv "$BACKUP/payload/$item" "$ROOT/$item"; done
      for suffix in '' -wal -shm; do rm -f -- "$ROOT/data/probe.db$suffix"; [[ ! -f "$BACKUP/database/probe.db$suffix" ]] || cp -p "$BACKUP/database/probe.db$suffix" "$ROOT/data/"; done
      if [[ $WAS_ENABLED -eq 0 ]]; then systemctl disable moniter >/dev/null 2>&1 || true; fi
      if [[ $HAD_UNIT -eq 1 ]]; then cp -p "$BACKUP/service" "$UNIT"; else rm -f "$UNIT"; fi
      if [[ $HAD_CONFIG -eq 1 ]]; then cp -p "$BACKUP/config" "$CONFIG"; else rm -f "$CONFIG"; fi
    fi
    systemctl daemon-reload || true
    if [[ $WAS_ACTIVE -eq 1 ]]; then systemctl start moniter || printf '%s\n' '旧服务未能启动，请检查 systemctl status moniter' >&2; fi
    printf '%s\n' "安装/更新失败，已撤销本次变更；备份：$BACKUP" >&2
  fi
  rm -rf -- "$STAGING"
  exit "$result"
}
trap cleanup EXIT
FETCH=(curl --fail --silent --show-error --location --proto '=https' --connect-timeout 10 --max-time 180 --retry 2)
API=https://api.github.com/repos/zen-box/moniter/releases/latest
[[ -z $VERSION ]] || API="https://api.github.com/repos/zen-box/moniter/releases/tags/v$VERSION"
printf '%s\n' '正在查询 Moniter 正式版…'
"${FETCH[@]}" -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' -H 'User-Agent: Moniter-installer' "$API" -o "$STAGING/release.json" || fail '无法获取正式版：请确认仓库已有主控 Release，且 GitHub 可访问'
python3 - "$STAGING/release.json" "$PLATFORM" "$VERSION" > "$STAGING/selected" <<'PY'
import json,re,sys
release=json.load(open(sys.argv[1])); tag=release.get('tag_name','')
if release.get('draft') or release.get('prerelease') or not re.fullmatch(r'v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)',tag):
    sys.exit('不是主控正式版（Agent Release 不用于安装主控）')
version=tag[1:]
if sys.argv[3] and sys.argv[3]!=version: sys.exit('返回的版本不匹配')
name=f'moniter-{version}-{sys.argv[2]}.tar.gz'
url=f'https://github.com/zen-box/moniter/releases/download/{tag}/{name}'
if not any(a.get('name')==name and a.get('browser_download_url')==url for a in release.get('assets',[])): sys.exit('Release 缺少当前平台的主控安装包')
print(version); print(url)
PY
mapfile -t SELECTED < "$STAGING/selected"; VERSION=${SELECTED[0]}
printf '正在下载 Moniter %s (%s)…\n' "$VERSION" "$PLATFORM"
"${FETCH[@]}" "${SELECTED[1]}" -o "$STAGING/package.tar.gz"
python3 - "$STAGING/package.tar.gz" "$STAGING/package" "$VERSION" "$PLATFORM" <<'PY'
import json,pathlib,shutil,struct,sys,tarfile
target=pathlib.Path(sys.argv[2]); target.mkdir()
with tarfile.open(sys.argv[1],'r:gz') as archive:
    members=archive.getmembers()
    if sum(m.size for m in members)>512*1024*1024: sys.exit('解压内容超过大小限制')
    for m in members:
        path=pathlib.PurePosixPath(m.name)
        if path.is_absolute() or '..' in path.parts or not (m.isfile() or m.isdir()): sys.exit('安装包含有不安全的路径或链接')
        if not path.parts or not (path.parts[0] in ('moniter','release.json','README.md','install.sh','install.ps1','binaries') or path.parts[:2] in (('web','dist'),('web','assets')) or m.name=='web'): sys.exit('安装包含有未允许的文件')
        out=target.joinpath(*path.parts)
        if m.isdir(): out.mkdir(parents=True,exist_ok=True); out.chmod(0o755)
        else:
            out.parent.mkdir(parents=True,exist_ok=True)
            with archive.extractfile(m) as source,open(out,'wb') as dest: shutil.copyfileobj(source,dest)
            out.chmod(0o755 if m.name=='moniter' or m.name.startswith('binaries/') or m.name=='install.sh' else 0o644)
meta=json.loads((target/'release.json').read_text())
if (meta.get('component'),meta.get('version'),meta.get('platform'))!=('server',sys.argv[3],sys.argv[4]): sys.exit('安装包版本或平台不匹配')
for file in ('moniter','web/dist/index.html','web/assets/world-map-paths.svg','install.sh','install.ps1'):
    if not (target/file).is_file(): sys.exit('安装包缺少 '+file)
for platform in ('linux-amd64','linux-arm64','windows-amd64'):
    if not (target/f'binaries/aegis-agent-{platform}').is_file(): sys.exit('安装包缺少 Agent: '+platform)
with (target/'moniter').open('rb') as binary: header=binary.read(64)
if header[:6]!=b'\x7fELF\x02\x01' or struct.unpack_from('<H',header,18)[0]!=(183 if sys.argv[4]=='linux-arm64' else 62): sys.exit('主控二进制架构不匹配')
PY
if [[ -d $ROOT/web/dist ]]; then
  # Existing browser tabs may still request the previous build's hashed chunks.
  python3 - "$ROOT/web/dist" "$STAGING/package/web/dist" <<'PY'
import pathlib,re,shutil,sys
source,target=map(pathlib.Path,sys.argv[1:])
for file in source.iterdir():
    if file.is_file() and not file.is_symlink() and re.fullmatch(r'.+-[\w-]{8,}\.(js|css|woff2?|svg|png)',file.name) and not (target/file.name).exists():
        shutil.copyfile(file,target/file.name)
        (target/file.name).chmod(0o644)
PY
fi
if [[ -f $CONFIG ]]; then
  cp -p "$CONFIG" "$STAGING/config"
else
  printf 'AEGIS_BIND=0.0.0.0:%s\nAEGIS_DB_PATH=%s/data/probe.db\n' "${PORT:-8080}" "$ROOT" > "$STAGING/config"
fi
python3 - "$STAGING/config" "$ROOT" "$PORT" > "$STAGING/health" <<'PY'
import pathlib,re,sys
path=pathlib.Path(sys.argv[1]); lines=path.read_text().splitlines(); values={}
for line in lines:
    if '=' in line and not line.lstrip().startswith('#'):
        key,value=line.split('=',1); values[key.strip()]=value.strip().strip('"\'')
if values.get('AEGIS_DB_PATH',sys.argv[2]+'/data/probe.db')!=sys.argv[2]+'/data/probe.db': sys.exit('请保持安装器管理的 AEGIS_DB_PATH；其他数据库路径请手动部署')
bind=values.get('AEGIS_BIND','0.0.0.0:8080'); host,port=bind.rsplit(':',1)
if sys.argv[3]:
    port=sys.argv[3]; lines=[line for line in lines if not line.startswith('AEGIS_BIND=')]; lines.append(f'AEGIS_BIND={host}:{port}')
if not port.isdigit() or not 1<=int(port)<=65535: sys.exit('配置中的监听端口无效')
path.write_text('\n'.join(lines)+'\n')
health='127.0.0.1' if host in ('0.0.0.0','[::]','::') else host
print(f'http://{health}:{port}/api/v1/ping');print(port)
PY
mapfile -t HEALTH < "$STAGING/health"
if [[ $HAD_UNIT -eq 0 ]]; then
  python3 - "${HEALTH[1]}" <<'PY'
import socket,sys
with socket.socket() as connection:
    try: connection.bind(('0.0.0.0',int(sys.argv[1])))
    except OSError: sys.exit('监听端口已被占用；请使用 --port 指定其他端口')
PY
fi
BACKUP="$ROOT/backups/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$BACKUP/payload" "$BACKUP/database" "$ROOT/data" "$ROOT/web/themes" "$UNIT_DIR" "$BIN_DIR"
[[ $HAD_UNIT -eq 0 ]] || cp -p "$UNIT" "$BACKUP/service"
[[ $HAD_CONFIG -eq 0 ]] || cp -p "$CONFIG" "$BACKUP/config"
if [[ $HAD_UNIT -eq 1 ]]; then systemctl stop moniter; fi
STOPPED=1
for suffix in '' -wal -shm; do [[ ! -f "$ROOT/data/probe.db$suffix" ]] || cp -p "$ROOT/data/probe.db$suffix" "$BACKUP/database/"; done
[[ ! -f "$ROOT/data/probe.db" ]] || HAD_DB=1
CHANGED=1
for item in "${MANAGED[@]}"; do
  if [[ -e "$ROOT/$item" ]]; then mkdir -p "$(dirname "$BACKUP/payload/$item")"; mv "$ROOT/$item" "$BACKUP/payload/$item"; SAVED+=("$item"); fi
  mkdir -p "$(dirname "$ROOT/$item")"; mv "$STAGING/package/$item" "$ROOT/$item"; REPLACED+=("$item")
done
mv "$STAGING/config" "$CONFIG"; chmod 600 "$CONFIG"
getent passwd moniter >/dev/null || useradd --system --home-dir "$ROOT" --shell /usr/sbin/nologin moniter
chmod 755 "$ROOT" "$ROOT/web"
chown -R moniter:moniter "$ROOT/data" "$ROOT/web/themes"
cat > "$UNIT" <<UNITFILE
# Managed by Moniter installer.
[Unit]
Description=Moniter Server
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=moniter
Group=moniter
WorkingDirectory=$ROOT
EnvironmentFile=$CONFIG
ExecStart=$ROOT/moniter
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$ROOT/data $ROOT/web/themes
[Install]
WantedBy=multi-user.target
UNITFILE
chmod 644 "$UNIT"
STARTED_AT=$(date +%s)
systemctl daemon-reload; systemctl enable moniter >/dev/null; systemctl restart moniter
READY=0
for ((i=0;i<30;i++)); do
  if systemctl is-active --quiet moniter && [[ $(curl --silent --noproxy '*' --connect-timeout 1 --max-time 2 "${HEALTH[0]}" || true) == pong ]]; then READY=1; break; fi
  sleep 1
done
[[ $READY -eq 1 ]] || fail '新版本启动检查失败，正在恢复旧版本'
printf '#!/usr/bin/env bash\nexport MONITER_INSTALL_DIR=%q MONITER_SYSTEMD_DIR=%q MONITER_BIN_DIR=%q\nexec bash %q "$@"\n' "$ROOT" "$UNIT_DIR" "$BIN_DIR" "$ROOT/install.sh" > "$BIN_DIR/.moniter.new.$$"
chmod 755 "$BIN_DIR/.moniter.new.$$"; mv -f "$BIN_DIR/.moniter.new.$$" "$BIN_DIR/moniter"
CHANGED=0; STOPPED=0
printf 'Moniter %s 已%s并启动，已设置开机自启\n' "$VERSION" "$([[ $ACTION == update || $HAD_DB -eq 1 ]] && echo 更新 || echo 安装)"
printf '前台：http://<服务器IP>:%s/\n后台：http://<服务器IP>:%s/admin\n' "${HEALTH[1]}" "${HEALTH[1]}"
if [[ $HAD_DB -eq 0 ]]; then journalctl -u moniter --since "@$STARTED_AT" --no-pager -o cat | grep -E '^管理员(账号|密码):' || true; fi
printf '更新：sudo moniter update\n配置：%s\n日志：sudo journalctl -u moniter -f\n备份：%s\n' "$CONFIG" "$BACKUP"
