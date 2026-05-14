# Crucix 中文增强版

Crucix 是一个开源情报 OSINT 与宏观市场信号终端。这个中文增强版保留原项目的本地 Node + Express 运行方式，同时新增 Cloudflare Workers + Assets + KV 的一键部署路径，可在 Cloudflare Dashboard 管理普通环境变量和 Secrets，并通过 Cron Triggers 定时执行“情报扫描”。

## 功能说明

- 聚合 GDELT、OpenSky、FIRMS、FRED、EIA、BLS、WHO、OFAC、ACLED、Telegram 公共频道、CISA KEV、Cloudflare Radar 等公开数据源。
- 将原始数据合成为可视化 dashboard 数据，展示宏观、市场、冲突、热异常、空域、海事、卫生、网络安全等信号。
- 支持 delta engine，对比最近几次扫描并标记 risk-off（避险）/ risk-on（风险偏好）/ mixed（混合）方向。
- 本地模式保留 Express、SSE、Docker 和文件存储。
- Cloudflare 模式新增 Worker module 入口、Assets 静态托管、KV 存储、Cron Triggers、手动扫描 API、中文界面和轮询刷新。

## 本地运行

```bash
npm install
cp .env.example .env
npm run dev
```

访问：

- `http://localhost:3117/`
- `http://localhost:3117/api/health`
- `http://localhost:3117/api/data`

本地运行仍使用 `runs/latest.json`、`runs/memory/hot.json`、`runs/memory/cold/*.json`，不会依赖 Cloudflare KV。

## Cloudflare 部署

推荐使用 Workers + Assets，而不是 Pages + Functions。原因是 Crucix 需要 Cron Triggers 定时执行情报扫描，Workers 可以同时承载静态资源、API、KV 和定时任务。

```bash
npm install
npx wrangler login
npm run cf:setup
npm run cf:secret
npm run cf:deploy
```

本地测试 Worker：

```bash
npm run cf:dev
```

查看线上日志：

```bash
npm run cf:tail
```

## 一键创建 KV

执行：

```bash
npm run cf:setup
```

脚本会：

- 检查 Wrangler 是否可用。
- 检查 Cloudflare 是否已登录。
- 创建 `CRUCIX_KV` 生产 namespace。
- 创建 `CRUCIX_KV` preview namespace。
- 自动写入 `wrangler.jsonc` 的 `kv_namespaces`。
- 不覆盖已有真实 KV 绑定。

## 设置 Cloudflare Secrets

执行：

```bash
npm run cf:secret
```

脚本会逐项询问是否设置 secret，并调用 `npx wrangler secret put KEY`。Secret 不会写入文件。

必填建议：

- `ADMIN_TOKEN`：生产环境手动触发 `/api/sweep` 的保护令牌。

按数据源选择填写：

- `FRED_API_KEY`
- `FIRMS_MAP_KEY`
- `EIA_API_KEY`
- `ACLED_EMAIL`
- `ACLED_PASSWORD`
- `CLOUDFLARE_API_TOKEN`

可选增强：

- `LLM_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `DISCORD_WEBHOOK_URL`

## 普通环境变量

普通变量可以放在 `wrangler.jsonc` 的 `vars` 或 Cloudflare Dashboard 的 Variables 中：

```text
LANGUAGE=zh-CN
REFRESH_INTERVAL_MINUTES=15
PUBLIC_APP_NAME=Crucix 中文版
PUBLIC_POLLING_INTERVAL_SECONDS=15
ENABLE_LLM=false
ENABLE_TELEGRAM=false
ENABLE_DISCORD=false
ENABLE_TELEGRAM_SOURCE=true
ENABLE_REDDIT_SOURCE=false
```

不要把 API key 写进 `wrangler.jsonc`。

## 手动触发情报扫描

生产环境建议设置 `ADMIN_TOKEN`，然后：

```bash
curl -X POST https://你的域名/api/sweep \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

本地 `wrangler dev` 可在未设置 `ADMIN_TOKEN` 时从 localhost 触发。

## API 路由

- `GET /`：有 KV 数据时返回 dashboard，否则返回 loading 页面。
- `GET /api/data`：返回 KV 中最新 dashboard 数据。
- `GET /api/health`：返回 Worker 状态、KV 状态、最近扫描、语言、启用数据源与功能开关。
- `GET /api/locales`：返回当前语言和支持语言。
- `GET /api/config`：返回前端安全配置，不包含 secret。
- `POST /api/sweep`：手动触发一次后台情报扫描。

## KV key 设计

- `latest`：最新 dashboard 数据。
- `memory:hot`：最近 3 次精简扫描记忆和 delta 上下文。
- `memory:cold:YYYY-MM-DD`：归档的冷记忆。
- `meta:last-sweep`：最近一次扫描结果。
- `meta:health`：Worker 健康状态和最近错误。
- `config:user`：预留给未来用户配置。

## 绑定自定义域名

Cloudflare Dashboard 中进入 Workers & Pages，选择部署后的 Worker：

1. 打开 `Settings`。
2. 进入 `Domains & Routes`。
3. 添加自定义域名或 Route。
4. 等待证书签发完成。

## GitHub Actions 自动部署

项目已新增 `.github/workflows/cloudflare-deploy.yml`。在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions` 中添加：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

之后 push 到 `main` 或 `master` 会自动执行：

- `npm ci`
- 基础语法检查
- `npx wrangler deploy`

## Cloudflare 模式限制

- Worker 不运行 Express，也不使用 `server.mjs`。
- Worker 不使用本地 `fs/path/child_process` 存储，所有运行数据写入 KV。
- 前端在 Cloudflare 模式下使用轮询 `/api/data`，不使用 Express SSE `/events`。
- Telegram/Discord 长驻 bot 不在 Worker 中运行；Cloudflare 模式只保留 dashboard 核心与可选 webhook/LLM 扩展。
- Reddit OAuth 源默认关闭，避免 Worker 中引入不必要的 Basic Auth/Buffer 依赖。
- 单次扫描受 Worker 运行时和外部 API 响应影响，个别 source 失败会降级，不会拖垮整个 dashboard。

## 常见问题

**`/api/data` 返回 503？**  
说明 KV 中还没有首次扫描结果。执行 `POST /api/sweep` 或等待 Cron Triggers 自动运行。

**`cf:setup` 无法创建 KV？**  
先执行 `npx wrangler login`，并确认账号有 Workers KV 权限。

**部署后 dashboard 没有更新？**  
检查 `npm run cf:tail`，并访问 `/api/health` 查看 `lastSweep` 和 `kv.ok`。

**可以只用 Pages 吗？**  
不推荐。Pages 更适合纯静态站点，Crucix 需要定时任务，所以首选 Workers + Assets。

## 后续优化建议

- 将扫描任务拆分为多批队列，进一步降低 Worker 单次执行压力。
- 增加 Durable Object 锁，避免手动扫描和 Cron 同时运行。
- 为 KV 数据增加版本迁移和压缩策略。
- 将 source 开关细化到每一个数据源，并在 dashboard 提供只读状态页。
