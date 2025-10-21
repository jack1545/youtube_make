# 部署方案（方案A）：Vercel + MongoDB Atlas + Cloudflare

本项目（creative-workbench，Next.js App Router）在 Vercel 部署，MongoDB Atlas 存储任务/历史元数据，Cloudflare 做 DNS/CDN 与可选前置代理。整体复杂度中等，关键在数据库连接策略和缓存规则。

## 架构概览
- 前端与接口：Vercel 托管 Next.js；API 位于 `src/app/api/*`。
- 数据层：MongoDB Atlas。项目已有封装：`src/lib/mongodb.ts`、`src/lib/db.ts`。
- 第三方能力：`src/lib/veo3.ts`、`doubao.ts`、`gemini.ts` 等按需调用；服务器端可使用 API Key fallback，前端可选本地缓存 Token。

## 环境变量（Vercel 项目设置）
- `MONGODB_URI`：Atlas 连接串（`mongodb+srv://...`）。
- `MONGODB_DB_NAME`：数据库名（如 `workbench`）。
- `VEO3_API_KEY`、`SORA2_API_KEY`：服务端备用密钥（避免在浏览器持久化主密钥）。
- 可选：`NEXT_PUBLIC_BASE_URL`（如需在前端用绝对地址）。

## 运行时与连接复用
- API Route 顶部声明运行时：
  ```ts
  export const runtime = 'nodejs'
  ```
- 连接复用（示例，项目已具备，可校验）：
  ```ts
  // src/lib/mongodb.ts
  import { MongoClient } from 'mongodb'
  const uri = process.env.MONGODB_URI!
  const options = { maxPoolSize: 5 }
  globalThis._mongoClientPromise ??= new MongoClient(uri, options).connect()
  export default globalThis._mongoClientPromise
  ```
- 在 API 中使用：
  ```ts
  import clientPromise from '@/src/lib/mongodb'
  const client = await clientPromise
  const db = client.db(process.env.MONGODB_DB_NAME || 'workbench')
  const jobs = db.collection('jobs')
  ```

## Atlas 准备与索引
1. 创建集群，选择靠近 Vercel 的区域；创建数据库用户与 Network Access。
2. 创建集合 `jobs` 存 taskId/status/video_url/prompt/createdAt。
3. TTL 索引（示例：一周自动清理）：
   ```
   db.jobs.createIndex({ createdAt: 1 }, { expireAfterSeconds: 604800 })
   ```

## Cloudflare 建议
- DNS：CNAME 到 Vercel，按文档开启 CNAME Flattening。
- 缓存规则：
  - `/_next/static/*`、`/public/*` 强缓存（`immutable, max-age`）。
  - `/api/*` 与 SSR 页面绕过缓存，避免旧状态和鉴权问题。
- 代理与安全：可启用 WAF/速率限制；不需二次 CDN 时设为 `DNS only`。

## 部署步骤
1. Atlas：完成集群、用户、Network Access 与连接串；创建 `jobs` 集合与 TTL 索引。
2. Vercel：导入项目、配置环境变量（见上），绑定域名。
3. 代码检查：API Route 使用 `export const runtime = 'nodejs'`；数据库访问统一经 `src/lib/mongodb.ts`。
4. 外部接口：所有对外请求使用 `https://`（如 `yunwu.ai` 已切换为 HTTPS）。
5. Cloudflare：按上方缓存/代理规则配置。
6. 部署并在 Vercel Logs 与 Atlas Metrics 验证读写与性能。

## 测试清单
- 创建任务接口与查询接口可用；服务端密钥 fallback 生效。
- Atlas 中 `jobs` 文档写入成功；TTL 自动清理。
- Cloudflare 代理时，`/api/*` 无缓存；静态资源命中缓存。

## 常见注意
- 不在 Edge Runtime 使用 MongoDB Node 驱动；需要 Edge 时用 Atlas Data API（HTTP）。
- 连接复用必须开启；避免 serverless 冷启动反复握手导致延迟与连接占满。
- 文档体积上限 16MB；视频等大文件存外链或对象存储（如 Cloudflare R2）。
- Atlas 与 Vercel 区域尽量靠近，降低网络时延。

---

## Atlas 设置清单（详细）
- 组织与项目：创建 Project -> Cluster（Shared/Serverless 均可）。
- 数据库用户：创建 `workbench_user`，角色 `readWrite@workbench`；保存用户名/密码。
- Network Access：
  - 开启 IP 访问：临时可用 `Allow access from anywhere (0.0.0.0/0)`，生产建议固定 egress 或使用 VPC Peering。
  - 允许 `TLS/SSL`；连接字符串使用 `mongodb+srv://` SRV 格式。
- 连接字符串：在 Atlas 控制台 `Connect -> Drivers` 获取 `MONGODB_URI`，形如：
  - `mongodb+srv://workbench_user:<PASSWORD>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority&appName=<APP_NAME>`
- 数据库与集合：
  - 数据库：`workbench`（或自定义）。
  - 集合：`jobs`（必需）以及可选 `scripts`、`images` 等。
- 索引建议：
  - `jobs`: `{ createdAt: 1 }` TTL；`{ taskId: 1 }` 唯一或普通索引。
  - `scripts`: `{ projectId: 1, createdAt: -1 }`；`{ title: 'text' }` 可选。
- 监控与限额：开启 Metrics/Profiler；池大小 `maxPoolSize: 5-10` 足以应对 serverless 并发。

## Cloudflare 设置清单（详细）
- DNS：将域名 CNAME 到 `cname.vercel-dns.com`；开启 CNAME Flattening。
- SSL/TLS：选择 `Full` 或 `Full (strict)`；确保源站证书可用（Vercel 默认开启）。
- Cache Rules：
  - `/_next/static/*` -> Cache Level: Cache Everything, Edge TTL: 1y。
  - `/public/*` -> 同上；加 `immutable`。
  - `/api/*`、`/workflows/*`（SSR）-> Bypass Cache。
- Security/WAF：
  - Rate Limiting：对 `/api/*` 设置每分钟请求阈值与惩罚策略。
  - Bot Fight/Firewall Rules：必要时启用基础保护。
- 可选：Workers/R2 如需自定义转发或对象存储；本项目暂不依赖。

## Vercel 项目设置清单
- 环境变量：`MONGODB_URI`、`MONGODB_DB_NAME`、后端备用密钥如 `VEO3_API_KEY`。
- 构建与运行：Next.js 15；确保 API Routes 标注 `runtime = 'nodejs'`。
- 域名绑定：上传证书由 Vercel 托管；Cloudflare 侧仅做 DNS/缓存。
- 监控：使用 Vercel Logs 与 Atlas Metrics 联合观察错误与慢查询。

## 安全与合规建议
- 浏览器端仅在“缓存模式”持有密钥，生产环境建议使用“数据库模式”+ 服务器端密钥注入。
- 避免在客户端打包真实主密钥；对外接口统一走 `/api/*` 由服务器侧读取密钥。
- 对写入接口增加简易鉴权（JWT 或简单 token），配合 Cloudflare 速率限制降低滥用。