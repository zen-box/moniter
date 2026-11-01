#!/usr/bin/env bash
#
# 交叉编译 Moniter Agent 到 binaries/ 目录。
#
# 主控的 /download/agent/:platform 接口就是从这个目录读文件，
# install.sh / install.ps1 都靠它拿二进制 —— 所以这个脚本跑完之后，
# 后台生成的一键安装命令才是真的能用。
#
# 用法：
#   bash scripts/build-agent.sh            # 构建全部可用目标
#   bash scripts/build-agent.sh linux-amd64  # 只构建一个
#
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p binaries

# 逻辑平台名 -> Rust target
# 注意：Windows 产物故意不加 .exe 后缀，因为 /download/agent/windows-amd64
# 这个 URL 是固定的，下载端会自己存成 aegis-agent.exe。
declare -A TARGETS=(
  [linux-amd64]=x86_64-unknown-linux-musl
  [linux-arm64]=aarch64-unknown-linux-musl
  [windows-amd64]=x86_64-pc-windows-gnu
)

WANTED=("$@")
if [ ${#WANTED[@]} -eq 0 ]; then
  WANTED=(linux-amd64 linux-arm64 windows-amd64)
fi

ok=0
skip=0

for name in "${WANTED[@]}"; do
  target="${TARGETS[$name]:-}"
  if [ -z "$target" ]; then
    echo "!! 未知平台: $name"
    continue
  fi

  echo "==> 构建 $name ($target)"

  if ! rustup target list --installed 2>/dev/null | grep -qx "$target"; then
    echo "   跳过：未安装该 target。先执行 rustup target add $target"
    skip=$((skip + 1))
    continue
  fi

  if ! cargo build --release -p aegis-agent --target "$target"; then
    echo "   失败：交叉编译出错（通常是缺少链接器，例如 musl-gcc / mingw-w64）"
    skip=$((skip + 1))
    continue
  fi

  src="target/$target/release/aegis-agent"
  [ -f "${src}.exe" ] && src="${src}.exe"
  dst="binaries/aegis-agent-$name"

  cp "$src" "$dst"
  chmod +x "$dst" 2>/dev/null || true
  echo "   -> $dst ($(du -h "$dst" | cut -f1))"
  ok=$((ok + 1))
done

echo
echo "完成：成功 $ok 个，跳过 $skip 个"
if [ "$ok" -eq 0 ]; then
  echo "没有任何产物，install 脚本会 404。请先安装对应的 rust target 和交叉链接器。"
  exit 1
fi
