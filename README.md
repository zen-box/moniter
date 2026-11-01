# Moniter · 服务器探针与网络监控

Rust 主控、轻量 Agent 和 React / HeroUI 控制台。SQLite 保存节点、最近 30 天监控历史、告警和登录会话。网站名称在后台设置，前台、登录页和浏览器标题同步应用。

## 版本与自动构建

首版为 **0.1.0**，官方仓库为 `zen-box/moniter`。后台「网站设置 → 版本更新」显示当前版本、最新正式版和上次检查时间，可手动检查。主控启动后异步检查，此后每 6 小时检查 GitHub Releases；有新版本时后台顶栏出现入口。检查失败保留上次成功结果，60 秒内的重复检查合并。尚未发布正式版时显示「尚未发布正式版」。仅提示更新，不自动覆盖或重启程序。

主控与 Agent 在同一 `main` 分支维护，**通过不同标签独立构建、独立发布**：

| 标签 | 工作流 | 发布产物 |
| --- | --- | --- |
| `v0.1.0` | `release-server.yml` | 主控 Linux amd64、Linux arm64、Windows amd64，各自包含 React 前端、内置主题、国旗与三平台 Agent |
| `agent-v0.1.0` | `release-agent.yml` | Agent 的同样三种平台安装包 |

Linux 采用原生 amd64 / arm64 runner 和 musl 静态链接，Windows 使用 MSVC。标签必须与对应 `Cargo.toml` 版本一致。仅推送源码不会发布；主控标签不触发 Agent 编译，Agent 标签也不触发主控编译。Agent Release 不标为主控最新版本，更新检测同时过滤 Agent、草稿与预发布标签。

**首次发布先推 `agent-v0.1.0`，等 Agent Release 成功后再推 `v0.1.0`。** 主控从 `server/agent-version.txt` 指定的既有 Agent Release 下载三平台产物打包；该 Release 缺失则明确失败，不会临时重编或偷偷换版本。以后只改主控时，更新 `server/Cargo.toml` 与前端包版本，再打主控标签；Agent 无变动无需发新版本。Agent 升级时先发布新的 `agent-vX.Y.Z`，再按需修改主控的 `agent-version.txt`。

发布文件命名为 `moniter-0.1.0-<平台>.tar.gz`（Windows 为 `.zip`），Agent 为 `moniter-agent-0.1.0-<平台>`。主控解压后在该目录运行 `./moniter` 或 `moniter.exe`；Agent 可运行 `./moniter-agent`。包内 `release.json` 记录组件、平台和所含 Agent 版本。发布包采用目录白名单，不含 `data`、日志、凭据或用户上传的主题。

## 构建与启动

需要 Rust 1.88 或以上、Node.js 和 npm。使用锁文件安装：

```bash
cd web/app
npm ci
npm run build
cd ../..
cargo build --release --locked --workspace
./target/release/aegis-server
```

Windows 运行 `target\release\aegis-server.exe`。工作目录应为项目根目录，随主控发布 `web/dist`、`web/assets`、`web/themes` 和所需的 `binaries`。只复制二进制会回退到内嵌旧页面，不能得到 React 控制台。

- 前台：`http://127.0.0.1:8080/`
- 后台：`http://127.0.0.1:8080/admin`
- 健康检查：`GET /api/v1/ping`

首次启动生成 32 位复杂密码，只在当次标准输出显示，请保存到密码管理器。后续启动不重复显示、不重置自定义密码。首次启动也可指定 `AEGIS_ADMIN_PASSWORD`，至少 12 个字符；已有账号不受这个变量影响。新站没有示例节点。

开发时分别使用 `cargo run -p aegis-server` 和 `cargo run -p aegis-agent -- <参数>`。前端使用 `cd web/app && npm run dev`，代理到 8080 主控。生产使用 Rust 托管构建产物，不要暴露 Vite 开发服务。

## 接入节点

后台添加节点只需名称、标签、监控和告警设置；其余资料在编辑中补充。新节点默认关闭延迟与回程诊断。

```bash
curl -fsSL -H 'Authorization: Bearer <节点令牌>' https://monitor.example.com/install.sh | sudo bash
```

安装接口校验真实节点令牌。安装脚本依赖 `binaries/aegis-agent-<平台>`，没有对应产物会返回 404。在装好 Rust target 与交叉链接器的构建机上运行：

```bash
bash scripts/build-agent.sh linux-amd64
bash scripts/build-agent.sh linux-arm64
bash scripts/build-agent.sh windows-amd64
```

Windows 分发文件故意没有 `.exe` 后缀，安装脚本会以 `.exe` 保存；也可复制本机 release Agent 到 `binaries/aegis-agent-windows-amd64`。

本次本地分发目录已生成 Windows x86_64、Linux x86_64 和 Linux ARM64 Agent；Linux 两种产物使用 musl 静态链接。Windows 开发机可使用已安装的 `cargo-zigbuild` 与 Zig 交叉构建：

```powershell
cargo zigbuild --release --locked -p aegis-agent --target x86_64-unknown-linux-musl --target-dir target-review
cargo zigbuild --release --locked -p aegis-agent --target aarch64-unknown-linux-musl --target-dir target-review
```

将对应产物复制为 `binaries/aegis-agent-linux-amd64` 和 `binaries/aegis-agent-linux-arm64`。后台的节点编辑页一直提供 Linux / Windows 安装或重装命令，在线节点也可直接获取，无需重置令牌。Linux 安装先暂存下载、停服务后替换，启动失败恢复旧程序和配置；Windows 安装使用 SYSTEM 开机任务，取消默认执行时限。

Agent 使用权限受限的令牌文件和 WebSocket 首帧认证：

```bash
./aegis-agent --server wss://monitor.example.com/ws/agent --token-file /etc/moniter/node-token
```

回环地址可用 `ws://`；其他明文内网连接需显式加 `--allow-insecure`。重置节点令牌后旧安装凭据失效，旧连接在下一次消息时关闭，需要更新 Agent 配置或重新安装。升级会撤销旧版公开固定的示例令牌，保留节点资料并写安全审计，可从后台重新获取安装命令。

## 监控、流量和成本

- Agent 每秒上报，历史指标和目标结果按节点约每 60 秒落库。
- **节点性能、延迟、目标历史只保留最近 30 天，没有一年窗口**；旧日聚合历史也会清理。
- 默认目标为 31 个省市 × 3 家运营商，共 93 个 TCP 80 落点；支持删除、编辑、确认后重置。删除全部目标后重启不会自动恢复。
- 启用延迟后每 30 秒探测一轮、每 30 秒刷新配置；回程结果每 6 小时刷新。每节点可选全部或指定目标。
- 三网基准是**上海电信 / 联通 / 移动的 TCP 80 落点**，不是公共 DNS，也不代表国内所有线路。DNS 解析不计入握手耗时；TCP 超时预算 999 ms，未测和失败独立处理。旧 Agent 的公共 DNS 基准不会继续混入三网历史，需更新 Agent 才能产生新的三网基准；原有系统指标与自定义目标仍兼容。
- 重置默认目标按地址与端口合并并保留原 ID；删除最后一个指定目标会明确暂停该节点的探测并提示。已删除目标的 30 天历史保留且带删除标记。
- 离线节点仍显示，没有采集到的读数用 `—`。详情保留系统信息、CPU、内存、磁盘、网络、连接、负载、进程、三网延迟、回程和自定义目标。

流量支持仅出站和双向计费，用量为「服务商校准值 + 此后已观测网卡增量」，按节点持久化。每月在主控系统时区的指定日期自动重置，短月按月末；计数回退不丢失之前已记录的增量。离线校准等待新基准后再累计，避免把开机以来的流量再次计入。跨周期离线间隙无法准确归属到某个月，重新连接时建立新基准，需要时以服务商账单校准。

界面统一使用 GiB / TiB（1024 进制），现有 `*_gb` API 字段保留兼容。Agent 默认过滤回环、容器桥接和常见虚拟网卡；特殊网络可用 `AEGIS_NETWORK_INTERFACES=eth0,ens3` 指定实际计费接口。多层转发、VPN 等机器应明确选择计费出口。Linux 磁盘按设备去重并排除内存、伪文件系统。成本按内置参考汇率估算，不是实时汇率或实际扣费记录。到期日需在确认付款后手动更新，系统不会自行假定已续费。Windows 不提供 Linux 式负载均值。

Agent 发现的连接地址与手动地址分别保存；手动设置不会被心跳覆盖。节点 IP **默认不对前台公开**，公开 REST、WebSocket 与初始页面均遵循节点的 IP 公开开关；已有第三方主题也受此约束。

## 告警和登录

SMTP、Telegram、Webhook 可独立启用，SMTP 关闭后不会因保留了服务器地址而继续发送。全局事件包括离线、恢复、CPU、流量、内存、磁盘、负载、TCP 探测失败与续费提醒；每节点另有总开关和各类规则开关。新增规则默认关闭。CPU / 内存 / 磁盘 / 负载需连续 3 次检查超限，30 分钟内不重复投递；流量每计费周期与阈值仅通知一次。TCP 失败率按目标统计最近 5 分钟至少 3 次存储采样，包含连接失败与超时，不能等同于 ICMP 丢包率。续费在指定天数内和进入逾期时各提醒一次。通知记录在后台「告警历史」。

测试通知使用已启用的渠道，便于在全局告警暂停时调试；部分渠道失败会明确报告成功渠道和错误。SMTP 465 使用隐式 TLS，其他端口使用 STARTTLS。Webhook 支持通用 JSON、企业微信、飞书、钉钉与 Discord 格式预设；机器人额外的关键词、签名或权限规则由接收平台配置。通用 JSON 包含 `title`、`content`、`source`，站名取自网站设置；允许内部接收器，不跟随重定向。外部请求均有超时。登录成功可单独启用通知；成功、失败与来源 IP 都记入安全审计，时间按浏览器本地时区显示。

管理员密码使用 Argon2id 哈希，支持 TOTP。会话持久化、绑定来源 IP，**30 天滑动有效期**：同浏览器、同 IP 重启无需重登，IP 变化需重新登录。退出撤销当前会话，改密码撤销全部会话；旧永久会话平滑转换。连续 5 次登录失败锁定来源 IP 15 分钟。

TOTP 目前没有一次性恢复码，请备份验证器；改密码本身不会关闭两步验证。

## 主题中心

上传构建后的 ZIP，或输入公开 GitHub 仓库地址获取最新 Release 的 ZIP。包需包含 `index.html`，可选 `theme.json` 提供名称、版本与作者。

同 ID 的主题更新需显式允许替换并确认，验证失败保留旧主题；可删除未激活的外部主题，内置主题受保护。

第三方主题运行在不共享管理端来源权限的 sandbox iframe，只使用公开监控 API，不能读取管理令牌或调用管理接口。localStorage 是按主题隔离的偏好存储：64 个键、每值 4096 字符、合计 32 KiB；sessionStorage 仅在当前页面内存中保存。支持 hash 深链接与偏好刷新持久化。

资源需能在 `/themes/<id>/` 下运行，推荐相对路径与 hash 路由。依赖同源 Cookie、管理接口、Service Worker 或浏览器原生存储权限的主题需要适配。ZIP 限 32 MiB、实际解压限 50 MiB，拒绝路径穿越和符号链接。只启用可信来源的主题。

## 生产部署

使用 HTTPS 反向代理，限制源站仅被代理访问。单机 Nginx 例子：

```nginx
server {
    listen 443 ssl;
    server_name monitor.example.com;
    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;
    client_max_body_size 32m;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 90s;
    }
}
```

对应设置 `AEGIS_BIND=127.0.0.1:8080`、`AEGIS_TRUST_PROXY=1`、`AEGIS_PUBLIC_URL=https://monitor.example.com`。多层代理只将实际控制的代理 CIDR 加入白名单，不要信任所有地址。转发 IP 从右向左检查，遇到首个不可信节点即停止。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AEGIS_BIND` | `0.0.0.0:8080` | 监听地址，反代建议绑定回环 |
| `AEGIS_DB_PATH` | `data/probe.db` | SQLite 路径 |
| `AEGIS_ADMIN_PASSWORD` | 随机生成 | 仅初始化管理员，至少 12 字符 |
| `AEGIS_PUBLIC_URL` | 校验后的请求来源 | 安装脚本的外部 HTTP(S) 来源，不含路径或参数 |
| `AEGIS_TRUST_PROXY` | 关闭 | `1` 或 `true` 开启可信代理头 |
| `AEGIS_TRUSTED_PROXIES` | `127.0.0.0/8,::1/128` | 逗号分隔的可信代理 CIDR |
| `AEGIS_AGENT_TOKEN_FILE` | 未设置 | Agent 令牌文件路径 |
| `MONITER_UPDATE_CHECK` | 开启 | 设为 `0` 或 `false` 关闭 GitHub 版本检查；离线部署或隔离测试可关闭 |

管理接口禁止缓存，不开放跨域；公开数据允许主题跨来源读取。响应包含防嵌入、nosniff、Referrer-Policy 等安全头。

历史读取使用独立只读 SQLite 连接，在阻塞线程执行；有并发、执行时间、点数与缓存限制，相同窗口请求合并。时序写入按事务提交，定时清理分批释放写连接。实时全表快照最多每秒广播一次，无订阅者时不序列化。公开页面通过 `/ws/client` 接收推送，节点卡片和详情当前指标随报告更新；连接正常时不再每 5 秒轮询列表。断线保留当前数据、暂用 HTTP 刷新并自动重连；没有推送超过 10 秒会重建连接。隐藏标签页断开推送并暂停列表请求，回到前台时自动恢复。历史曲线在分钟级历史记录上追加当前页面接收的实时样本，延迟和回程仍按各自探测周期更新。前台、详情图表与后台按路由拆包；静态 hash 资源长缓存，主控启用 gzip。

## 备份与升级

升级前备份数据库、主题、前端产物和当前二进制。在线数据库使用 SQLite backup API；离线备份先停主控，再同时保存 `probe.db` 及存在的 `-wal` / `-shm`，不要在写入时只复制主数据库。

一起更新主控和前端，使用原工作目录及数据路径启动，再检查健康接口、前台、登录和 Agent。恢复前先停止主控，还原匹配的数据库、二进制、静态目录，不要混入旧 WAL。

主控和 Agent 可独立更新，日常界面改动不要求重装 Agent；构建分发可按路径分别触发。

前端构建保留旧 hash 资源，避免已打开的页面在部署后加载旧分包时出现 404；发布时保留可回滚版本，确定旧客户端不再引用后再清理过期资源。

## 验证

```bash
cargo test --workspace --locked
cd web/app
npm run build
npm audit --registry https://registry.npmjs.org
```

`web/app/scripts/verify-production.cjs` 用临时数据库与回环端口验证主题隔离、登录会话、安装鉴权、通知和后台交互，不改生产数据库；环境变量 `MONITER_TEST_SERVER`、`MONITER_TEST_AGENT` 可指定待测二进制。`verify-round2.cjs` 验证断线、重叠连接、流量校准、目标重置、规则投递、真实 Agent 和约 402 万行历史并发读取。`verify-public.cjs` 连接本地 8080 检查前台，模拟数据仅在浏览器中。浏览器和 Playwright 路径按当前开发机配置。

源码：`server/src`、`agent/src`、`web/app/src`。静态产物：`web/dist`、`web/assets`、`web/themes`。分发产物：`binaries`。数据库：`data/probe.db`。

修复验收记录见 `.ui-review/fixes-2026-11-01-round2.md`；第一轮历史记录保留在 `.ui-review/fixes-2026-11-01.md`。Windows 安装脚本的 AST 检查不能代替真实开机、重装和长时间运行测试；Linux / ARM 交叉构建成功也不能代替目标系统运行验证。
