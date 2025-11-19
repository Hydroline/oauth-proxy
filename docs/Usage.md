# OAuth Proxy Serverless

基于 Node.js + Express 的 OAuth 中转服务，实现统一的 `POST` JSON 接口，适配腾讯云 Serverless。

## 功能概述

- 接收后端发来的 OAuth 请求描述（URL、方法、头部、Body）。
- 在 Serverless 环境中转发到真实 OAuth Provider（如 Google、Microsoft）。
- 将上游响应包装为规范化 JSON：`ok/status/headers/bodyType/body`。
- 支持 JSON / 文本 / 二进制(Base64) 响应。
- 通过 `x-proxy-key` 请求头进行鉴权。

## 本地运行

```bash
npm install
export OAUTH_PROXY_KEY=your-secret-key
npm start
```

然后通过如下请求测试：

```bash
curl -X POST http://localhost:9000/ \
  -H "Content-Type: application/json" \
  -H "x-proxy-key: your-secret-key" \
  -d '{
    "url": "https://httpbin.org/get",
    "method": "GET",
    "headers": {},
    "bodyType": "raw",
    "body": null
  }'
```

## 部署到腾讯云 Serverless

1. 全局安装或在项目中安装 Tencent Serverless Framework：

```bash
npm install -g serverless
# 或
npm install --save-dev serverless
```

2. 配置腾讯云密钥（根据官方文档配置 `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY` 等环境变量）。

3. 部署：

```bash
export OAUTH_PROXY_KEY=your-secret-key
npx serverless deploy
```

部署完成后，会在输出中得到访问域名，将其配置为后端的 `OAUTH_PROXY_URL`，并保持同一个 `OAUTH_PROXY_KEY`。
