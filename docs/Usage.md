# OAuth Proxy

基于 Cloudflare Workers 的 OAuth 中转服务，实现统一的 `POST` JSON 接口，适合作为前端 / 插件的安全代理层。

## 功能概述

- 接收后端或客户端发来的 OAuth 请求描述（URL、方法、头部、Body）。
- 由 Cloudflare Worker 代为请求真实 OAuth Provider（当前允许 GitHub、Google 的 token/profile 端点）。
- 将上游响应包装为规范化 JSON：`ok/status/headers/bodyType/body`。
- 支持 JSON / 文本 / 二进制(Base64) 响应。
- 通过 POST JSON 请求体内的 `key` 字段进行鉴权，保护代理端点。

## 本地开发（Cloudflare Workers + pnpm）

前置条件：本机安装好 `pnpm` 和 `wrangler` 登录过 Cloudflare 账号。

```bash
cd oauth-proxy

# 安装依赖
pnpm install

# 本地启动 Worker（默认 http://127.0.0.1:8787）
pnpm cf:dev
```

本地测试请求示例：

```bash
curl -X POST http://127.0.0.1:8787/ \
  -H "Content-Type: application/json" \
  -d '{
    "key": "your-secret-key",
    "url": "https://oauth2.googleapis.com/token",
    "method": "POST",
    "headers": {
      "Accept": "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    "bodyType": "raw",
    "body": "client_id=your-client-id&client_secret=your-client-secret&code=your-code&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fauth%2Foauth%2Fgoogle%2Fcallback&grant_type=authorization_code"
  }'
```

> 注意：`your-secret-key` 需要与 Cloudflare 环境变量 `OAUTH_PROXY_KEY` 保持一致。

当前 Worker 只允许以下 HTTPS 上游，避免代理变成开放转发器：

- `POST https://github.com/login/oauth/access_token`
- `GET https://api.github.com/user`
- `POST https://oauth2.googleapis.com/token`
- `GET https://www.googleapis.com/oauth2/v3/userinfo`

## 在 Cloudflare 上部署

1. 配置 `wrangler.toml`（仓库已提供一个基础版本），确保 `main = "src/worker.js"`。
2. 在 Cloudflare 控制台或通过 wrangler 为 Worker 设置环境变量：
   - 名称：`OAUTH_PROXY_KEY`
   - 值：你的代理密钥（建议使用随机长字符串）。
3. 运行部署命令：

```bash
cd oauth-proxy
pnpm cf:deploy
```

部署完成后，Cloudflare 会返回 Worker 的访问 URL，将其配置为后端或插件中的 `OAUTH_PROXY_URL`，并在请求时把相同的 `key` 放在请求体中。
