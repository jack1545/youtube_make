# Creative Workbench（创意工作台）

一个用于脚本创作与图像/视频生成的 AI 工具集。你可以在这里编写提示词、生成图片，并将素材提交到 Veo3 生成视频。

目前全程使用云雾API，Geimini按量计费（模块未完成），doubao生图1毛3一张，veo3生视频6毛。

## 手册目录
1. 功能说明
2. 安装说明

## 适用人群
- 编程小白：按照下面的步骤一步一步来，就能跑起来。
- 创作者/设计师：快速把想法变成图像和视频。

## 功能说明

### 主要功能 Storyboard 的使用

#### Step 1 - Load storyboard JSON/CSV 支持JSON和CSV（一卒大佬提示词）两种格式导入

```csv
分镜数,分镜提示词
1,"[主体]
角色：角色A
表情：开心
动作：角色A坐在桌前，双手放在桌上。
[环境]
一个现代风格的厨房，背景是橱柜和灶台。
[时间]
白天
[天气]
无
[视角]
平视
[景别]
中景"
2,"[主体]
角色：角色B
表情：愤怒
动作：角色B站在角色A的后面，举起一只手。
[环境]
一个现代风格的厨房，角色A坐在前景的桌子旁。
[时间]
白天
[天气]
无
[视角]
平视
[景别]
全景"
```

```json
[
    {
        "shot_number": 1,
        "duration": "2-3s",
        "prompt": {
            "subject": {
                "characters_present": "参考图1",
                "expression": "参考图1：开心",
                "action": "参考图1蹲在沙滩上，伸出右手食指，指尖触碰着面前一个由蓝色光线构成的、复杂的城堡光雕投影的顶部。",
                "props": "蓝色光线构成的城堡光雕投影"
            },
            "environment": "一个阳光明媚的午后沙滩，沙滩上游客稀少，远处是平静的海面和城市天际线。",
            "time_of_day": "白天",
            "weather": "晴天",
            "camera_angle": "平视",
            "shot_size": "中景"
        }
    }
]
```
#### Step 2 - Preview shots
1. 调整参考图的顺序（支持每个分镜调整参考图，逐个分镜生成模式）
2. 替换分镜提示词里的关键词

#### Step 3 - Generate Doubao images
1. 设置图片尺寸
2. 设置分辨率（4K生成时间可能有点长）
3. 设置参考图，支持图片Url和上传（会保存到数据库）

#### Step 4 - Submit Veo3 videos
1. 勾选Veo3即可使用Veo3生成视频
2. 批量下载图片
3. 预览分镜图片

### Veo3提交模块
1. 单独生成Veo3视频（Veo3不支持首尾帧）
2. 支持复制粘贴图片（在输入框中粘贴图片）、图片上传、图片Url

### 历史项目
1. 查看之前生成的视频和图片及提示词。
2. 复制提示词和下载图片
---

## 环境要求（必备）
- 安装 Node.js（推荐 18 及以上版本）。
- 具备 npm（随 Node.js 一起安装）。
- 准备好 API Key（后面会教你如何获取并填写）。

> 不需要会编程；只要能打开命令行并粘贴几条命令即可。

---

## 安装与运行（一步一步）

1) 获取项目代码
- 从你的代码仓库或压缩包中拿到本项目文件夹。
- 进入项目根目录：`creative-workbench`。

2) 安装依赖
- 打开命令行（Windows 下可使用 PowerShell 或终端）。
- 执行：
  ```bash
  npm install
  ```

3) 配置环境变量（非常重要）
- 在 `creative-workbench` 根目录创建一个文件：`.env.local`
- 打开并粘贴如下内容（把占位值换成你自己的真实值）：
  ```env
  # Supabase 配置
  NEXT_PUBLIC_SUPABASE_URL=https://你的-supabase-项目地址.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=你的-supabase-anon-key
  SUPABASE_SERVICE_ROLE_KEY=你的-supabase-service_role-key
  ```
- 如何获取：
  - Supabase：注册并创建项目，进入项目找到 `Project Settings`。
    - Project Settings > Data API 找到 `URL`
    - Project Settings > API Keys 找到 `anon key` 和 `service_role`
  - Gemini API：在 Google AI Studio 申请或在 云雾AI（yunwu.ai）平台申请。
  - Doubao API：在 云雾AI（yunwu.ai）平台申请。
  - Veo3 API：在 云雾AI（yunwu.ai）平台申请。

4) 初始化数据库（Supabase）
- 打开 Supabase 项目的 SQL 编辑器。
- 将本项目根目录下的 `supabase_schema.sql` 文件内容全部复制到编辑器里并执行。
- 这会创建本项目所需的数据表（例如：生成视频记录等）。

5) 启动开发服务器
- 执行：
  ```bash
  npm run dev
  ```
- 终端会打印一个本地地址（例如 `http://localhost:3000` 或 `http://localhost:3001/3002`），用浏览器打开即可。
- 如果 3000 端口被占用，开发服务器会自动选择其他端口（如 3001 或 3002），请以终端显示的地址为准。

---

## 项目使用快速说明
- 首页：`/`，工作流记录，未完成。
- 工作流页面：`/workflows/storyboard` 主要工作流
- 历史项目记录：`/history` 项目历史记录：包括提示词、图片和视频
- Veo3 提交页：`/veo3`
  - 支持上传首帧图片（或粘贴图片 URL）。
  - 提示词支持自动翻译（可选）。
  - 提交后 30 秒自动查询一次任务进度，生成后会显示视频链接和本页内预览。30秒后需要手动刷新页面。
  - 你可以在顶部切换到“历史视频”Tab，查看已生成的视频并直接播放预览。

- 你可以编辑 `src/app/page.tsx` 来调整首页，页面会自动热更新。

---

## 常见问题（FAQ）
- 端口被占用怎么办？
  - 正常情况下会自动换端口；如果打不开，请看终端打印的实际地址。
- 页面空白或接口报错？
  - 检查 `.env.local` 是否填写了正确的 `Supabase` 与 `API Keys`。
  - 确认你已在 Supabase 执行了 `supabase_schema.sql`。
- 如何停止开发服务器？
  - 在终端里按 `Ctrl + C` 即可。
- Node.js 版本问题？
  - 建议使用 18+，版本过低可能导致依赖无法安装或运行报错。

---

## 目录结构（简要）
- `src/app/`：Next.js 前端页面与 API 路由。
- `src/lib/`：各类服务与工具封装（如数据库访问、模型调用）。
- `supabase_schema.sql`：数据库表结构。
- `package.json`：项目依赖与脚本（开发服务器、构建等）。

---

## 仅本地部署的分享方式（不考虑云端部署）

- 模式 A：源码压缩包分享
  - 将 `creative-workbench` 整个目录压缩为 zip，分享给对方。
  - 对方解压后：安装依赖（`npm install`）并运行开发服务器（`npm run dev`）。
  - 适用：需要可读源码、可修改、可二次开发的场景。

- 模式 B：便携运行包分享（可选）
  - 使用 `npm run build` 进行构建，然后打包 `.next`、`node_modules`（必要时）和运行脚本。
  - 可提供一个简单的 `start.bat` 或 `start.ps1` 脚本，双击即可启动。
  - 适用：对方不需要修改源码，只需本地运行即可。

- 模式 C：桌面应用封装（可选进阶）
  - 借助 Electron/Tauri 将前端与 Node 服务封装为桌面应用。
  - 适用：需要更好的分发体验，自动更新、图标、双击运行。

注意事项：
- 分享时不要包含任何私密的环境变量或 API Key；建议提供 `.env.local.template` 由对方填写。
- 路径相关的本地配置（如本地素材根路径）已支持在“本地路径设置”页面修改，请在对方电脑上打开 `/workflows/local-projects/settings` 进行配置。
- 文件监听依赖 `chokidar` 已集成，默认仅监听配置的根路径，避免越权访问其他目录。

## 远程部署方案（Creative Workbench / Storyboard / API）

本项目的主应用位于 `creative-workbench/`，支持两种典型部署方式：独立服务器（自管）与 Vercel（Serverless）。以下方案以“图片 URL 存储 + MongoDB”为核心，避免把 Base64 `data:image` 直接写库。

### 一、独立服务器部署（推荐使用 MongoDB Atlas 托管）
- 前置要求：
  - 安装 `Node.js >= 18`
  - 使用 MongoDB Atlas（推荐）或自建 MongoDB（需开启认证、TLS、备份）
  - 反向代理与 HTTPS：`nginx` + `certbot`（Let’s Encrypt）
  - 进程守护：`pm2`
- 目录与构建：
  - 切换到 `creative-workbench/`
  - 构建：`npm ci && npm run build`
  - 启动（生产）：`npm run start`（或 `pm2 start "npm run start" --name creative-workbench --cwd ./`）
- 必要环境变量（在服务器上设置，不要写入仓库）：
  - `MONGODB_URI`、`MONGODB_DB`
  - 可选（对象存储与直传）：
    - Cloudflare Images：`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`、`NEXT_PUBLIC_CF_IMAGES_ACCOUNT_HASH`
    - Cloudflare R2：`R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET`
  - 如使用其他存储（如 Supabase）：`SUPABASE_URL`、`SUPABASE_ANON_KEY`
- 反向代理（示例 `nginx` 配置）：
  ```nginx
  server {
    listen 80;
    server_name your.domain.com;

    location / {
      proxy_pass http://127.0.0.1:3001; # Next.js 生产端口
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    client_max_body_size 20M; # 控制上传大小
  }
  ```
- 图片直传与 URL 存储（二选一）：
  - Cloudflare Images（便捷，内置裁剪/变体/CDN）：
    - 服务端生成直传链接：`POST https://api.cloudflare.com/client/v4/accounts/{account_id}/images/v2/direct_upload`
    - 前端用返回的 `uploadURL` 直接上传图片，得到 `image_id`
    - 写库时仅保存 `https://imagedelivery.net/{account_hash}/{image_id}/{variant}`
    - 在 `creative-workbench/next.config.ts` 的 `images.remotePatterns` 中加入 `imagedelivery.net`
  - Cloudflare R2（S3 兼容，更通用）：
    - 服务端生成 `PUT` 预签名 URL，前端直传文件到 R2
    - 写库保存公共访问 URL（自定义 CDN 域或 `r2.dev` 公共桶）
    - 在 `next.config.ts` 白名单中加入你的图片域名
- 安全与性能：
  - 仅保存 URL 到 MongoDB，避免 Base64 存库（文档最大 16MB）
  - 添加基础速率限制与输入校验，设置 CSP（允许的图片域）
  - 连接池复用 MongoDB 客户端，减少连接开销

### 二、Vercel + MongoDB Atlas 部署
- 连接仓库自动构建：Vercel 选择项目根为 `creative-workbench/`
- 环境变量：在 Vercel 项目设置中配置 `MONGODB_URI`、`MONGODB_DB`，以及对象存储相关变量（参考上文）
- Serverless 约束与建议：
  - 函数无状态、短生命周期；请求体有大小限制
  - 前端直传图片（Cloudflare Images / R2），服务端仅生成直传链接与保存 URL
  - 复用 Mongo 客户端（在 `getDb` 使用全局缓存）以减少冷启动连接压力
  - 不可写本地磁盘；图片等文件必须走外部存储
  - 在 `next.config.ts` 配置 `images.remotePatterns`，确保 `<Image>` 能加载外域图片
- 区域与延迟：选择与 Atlas 同区域或邻近区域，降低延迟与尾时延

### 运行与脚本
- 本地开发：
  - 在 `creative-workbench/`：`npm run dev`（默认端口 3001）
- 数据迁移与同步（可选）：
  - 参考 `creative-workbench/scripts/`：
    - `migrate-reference-images.mjs`
    - `sync-reference-images-to-mongo.mjs`
    - `sync-supabase-to-mongo.mjs`
  - 示例运行：`node scripts/sync-reference-images-to-mongo.mjs`

### 配置检查清单
- MongoDB：`MONGODB_URI`、`MONGODB_DB` 正确；使用连接池复用
- 图片域：`next.config.ts` 中已加入 Cloudflare Images 或 R2 自定义域
- 上传路径：使用直传（前端）+ 服务端签名/直传 URL 生成，避免服务端接收大文件
- 安全：开启 HTTPS、CSP、速率限制、输入校验，日志与备份到位

### 常见问题
- 413（请求体过大）：
  - 独服：调整 `nginx` 的 `client_max_body_size`
  - Vercel：改用前端直传到外部存储
- 图片不显示：未在 `next.config.ts` 配置外链图片域
- Mongo 文档过大：避免 Base64 存库，仅保存对象存储 URL
- 并发与速率限制：在 Serverless（尤其免费套餐）添加应用层限流与重试策略