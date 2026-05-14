# Cloudflare Workers 部署新手教程

这份教程从零开始，把 Crucix 中文增强版部署到 Cloudflare Workers。推荐使用 Workers + Assets，因为项目需要 Cron Triggers 定时执行情报扫描。

## 1. Fork 仓库

在 GitHub 打开你的 Crucix 仓库，点击 `Fork`，复制到自己的账号下。

## 2. 安装依赖

```bash
git clone https://github.com/你的账号/Crucix.git
cd Crucix
npm install
```

## 3. 登录 Cloudflare

```bash
npx wrangler login
```

浏览器会打开 Cloudflare 授权页。授权成功后回到终端。

## 4. 绑定 KV

如果你是在 Cloudflare Dashboard 里用 GitHub 一键部署，推荐直接在绑定界面创建/选择 KV：

1. 打开当前 Worker。
2. 进入 **Settings > Bindings**。
3. 添加 **KV namespace**。
4. 变量名填写 `CRUCIX_KV`。
5. 选择已有 KV 空间，或者在这里新建一个 KV 空间。

这就是 Dashboard 的一键绑定 KV 空间方式。仓库里的 `wrangler.jsonc` 默认不会提交占位 `kv_namespaces`，否则 Cloudflare CI 会把 `REPLACE_WITH_KV_NAMESPACE_ID` 当成真实 id 并导致部署失败。

如果你使用本地命令行部署，也可以执行：

```bash
npm run cf:setup
```

脚本会自动创建：

- `CRUCIX_KV`
- `CRUCIX_KV` preview namespace

并写入本地 `wrangler.jsonc`：

```jsonc
"kv_namespaces": [
  {
    "binding": "CRUCIX_KV",
    "id": "...",
    "preview_id": "..."
  }
]
```

如果你已经手动绑定了真实 KV，脚本不会覆盖。

## 5. 本地测试

```bash
npm run cf:dev
```

打开 Wrangler 提示的本地地址，测试：

- `/api/health`
- `/api/data`
- `/api/config`

如果还没有数据，`/api/data` 返回 503 是正常的。可以手动触发：

```bash
curl -X POST http://localhost:8787/api/sweep
```

## 6. 设置 Secrets

```bash
npm run cf:secret
```

建议至少设置：

- `ADMIN_TOKEN`

按需设置：

- `FRED_API_KEY`
- `FIRMS_MAP_KEY`
- `EIA_API_KEY`
- `ACLED_EMAIL`
- `ACLED_PASSWORD`
- `CLOUDFLARE_API_TOKEN`
- `LLM_API_KEY` (例如: nvapi-xxxxxxxx)
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `DISCORD_WEBHOOK_URL`

不要把这些值写入 `wrangler.jsonc`、`.env` 或 GitHub。

## 7. 部署

```bash
npm run cf:deploy
```

部署完成后，Wrangler 会输出 Worker URL。

## 8. 在 Cloudflare Dashboard 设置变量

进入 Cloudflare Dashboard：

1. 打开 `Workers & Pages`。
2. 选择 `crucix-cloudflare`。
3. 进入 `Settings -> Variables`。
4. 添加或确认普通变量：

```text
LANGUAGE=zh-CN
REFRESH_INTERVAL_MINUTES=15
PUBLIC_APP_NAME=Crucix 中文版
PUBLIC_POLLING_INTERVAL_SECONDS=15
ENABLE_LLM=true
LLM_PROVIDER=nvidia
LLM_MODEL=minimaxai/minimax-m2.7
LLM_BASE_URL=https://integrate.api.nvidia.com/v1
ENABLE_TELEGRAM=false
ENABLE_DISCORD=false
ENABLE_TELEGRAM_SOURCE=true
ENABLE_REDDIT_SOURCE=false
```

敏感变量请放在 Secrets，不要放在普通 Variables。

## 9. 绑定自定义域名

在 Worker 的 `Settings -> Domains & Routes` 中添加域名：

- 如果是 Cloudflare 托管 DNS 的域名，直接添加 Custom Domain。
- 如果使用 Route，确保路由指向当前 Worker。

等待证书签发后访问你的域名。

## 10. 测试

健康检查：

```bash
curl https://你的域名/api/health
```

读取最新数据：

```bash
curl https://你的域名/api/data
```

手动触发情报扫描：

```bash
curl -X POST https://你的域名/api/sweep \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

查看日志：

```bash
npm run cf:tail
```

## 11. GitHub Actions 自动部署

仓库已经包含 `.github/workflows/cloudflare-deploy.yml`。你需要在 GitHub 中设置 Actions Secrets：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

获取方式：

- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare Dashboard 右侧账号信息或 Workers 页面可见。
- `CLOUDFLARE_API_TOKEN`：创建 API Token，至少需要 Workers Scripts 编辑权限、Workers KV 读写权限，以及 Account 读取权限。

之后 push 到 `main` 或 `master` 会自动部署。

## 安全检查清单

- `.dev.vars` 已加入 `.gitignore`。
- API key 只通过 Wrangler Secrets 设置。
- `POST /api/sweep` 在生产环境必须使用 `ADMIN_TOKEN`。
- `/api/config` 不返回 secret。
- `/api/health` 只显示 enabled/configured，不显示敏感值。
- 默认同源访问，不开放 `Access-Control-Allow-Origin: *`。
- KV 写入会检查 JSON 结构和大小。
- `lang` 参数只允许 `zh-CN`、`en`、`fr`。

## Cloudflare 模式限制

- 不运行本地 Express server。
- 不使用本地文件系统保存运行结果。
- 不支持 Express SSE，前端改为 15 秒轮询。
- Telegram/Discord 长驻 bot 在 Worker 中自动关闭。
- Reddit OAuth 源默认关闭，可后续单独适配。
- 外部 API 失败时会降级，dashboard 继续显示最近一次可用数据。
