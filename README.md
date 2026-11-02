# Moniter Agent

这是 `zen-box/moniter` 的 **`agent` 分支**，只维护轻量 Agent。主控、React 前端、网站设置和主控一键安装脚本位于 `main` 分支。两个分支分别维护 Cargo 工作区与锁文件，不要相互合并。

## 安装到被监控服务器

在 Moniter 后台添加节点，然后复制该节点提供的 Linux 或 Windows 安装命令。主控分发固定版本的 Agent，并自动填入主控地址和节点令牌；不需要在被监控服务器上编译 Rust。

手动运行发布包中的 Agent：

```bash
./moniter-agent --server wss://monitor.example.com/ws/agent --token-file /etc/moniter/node-token
```

Windows 使用 `moniter-agent.exe`。令牌文件请限制读取权限。回环地址可用 `ws://`；其他明文内网连接需显式加 `--allow-insecure`。常驻运行与开机自启请使用后台提供的安装脚本。

## 开发与构建

```bash
git clone --branch agent --single-branch https://github.com/zen-box/moniter.git moniter-agent
cd moniter-agent
cargo test --locked
cargo build --release --locked
```

需要 Rust 1.88 或以上。当前工作区只有 `aegis-agent`，可直接 `cargo run -- --server <地址> --token-file <路径>`。源码位于 `agent/src`；编译产物为 `target/release/aegis-agent`，Windows 带 `.exe`。

`scripts/build-agent.sh <linux-amd64|linux-arm64|windows-amd64>` 可在准备好 Rust target 和对应链接器后交叉构建到 `binaries`，供自建主控手动分发。正式发行使用 GitHub Actions 的原生构建 runner。

## 独立发布

当前版本为 **0.1.2**。在本分支修改 `agent/Cargo.toml` 版本及锁文件、测试并提交后，创建对应标签：

```bash
git switch agent
git push origin agent
git tag agent-v0.1.2
git push origin agent-v0.1.2
```

`release-agent.yml` 只响应 `agent-v*` 标签，校验标签属于 `agent` 分支且版本匹配，再测试、编译并发布：

| 平台 | 安装包 |
| --- | --- |
| Linux amd64 | `moniter-agent-0.1.2-linux-amd64.tar.gz` |
| Linux arm64 | `moniter-agent-0.1.2-linux-arm64.tar.gz` |
| Windows amd64 | `moniter-agent-0.1.2-windows-amd64.zip` |

Linux 使用 musl 静态链接，Windows 使用 MSVC。包内仅含 Agent、README 和 `release.json`，不含令牌、数据库或主控。Agent Release 不设为仓库最新主控版本。

主控 `main` 根据 `server/agent-version.txt` 从已发布的 Agent Release 获取三个二进制；主控更新不会重新构建 Agent。Agent 没有变动时不必发新版本。更新 Agent 时，先发布本分支的 Agent Release，成功后再修改 `main` 的版本引用并发布主控。

普通代码推送与 PR 不触发构建。只有推送 `agent-v*` 标签，才会执行三平台测试、构建和 Release 发布。
