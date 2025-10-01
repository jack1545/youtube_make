Creative Workbench 部署指南（MongoDB 缓存版，小白友好）

**你将获得什么**
- 在本机或服务器上跑起“创意工作台”。
- 使用 MongoDB 做数据缓存（图片、脚本、项目、参考素材等）。
- 可选接入 Supabase（不接也能跑，默认走演示模式）。

**适用场景**
- 个人本机使用（推荐）。
- 局域网共享（小团队）。
- 服务器部署（正式环境）。

—

**一、准备工作（必备）**
- 安装 Node.js（推荐 18+）。
- 准备 MongoDB：任选其一。
  - 方式 A：本地安装 MongoDB Community Server（Windows 可直接安装）。
    - 安装后默认地址通常是 `mongodb://127.0.0.1:27017`。
  - 方式 B：使用 MongoDB Atlas（云端）。
    - 创建免费集群，获取连接串（形如 `mongodb+srv://<user>:<pass>@<cluster>/`）。
    - 将你的 IP 加入白名单（或临时设置 `0.0.0.0/0` 用于测试）。

—

**二、获取代码并安装依赖**
- 打开终端，进入项目目录：
  - `cd creative-workbench`
- 安装依赖：
  - `npm install`

—

**三、配置环境变量（关键）**
- 在 `creative-workbench` 目录创建文件：`.env.local`
- 复制粘贴以下内容并按需修改：
```
# —— MongoDB（必填，用于数据缓存）——
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DBNAME=creative_workbench

# —— Supabase（可选；不配则进入演示模式）——
NEXT_PUBLIC_SUPABASE_URL=https://你的项目.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=你的-anon-key

# —— 管理员（可选）——
ADMIN_ID=admin_001

# —— 本地素材根目录（可选，默认 G:\\Downloads\\ytb_project）——
LOCAL_PROJECTS_DIR=F:\\素材根路径
```

说明：
- `MONGODB_URI` 与 `MONGODB_DBNAME` 必须正确，否则接口会报错（代码中会提示“未配置或无效”）。
- Supabase 不填也能跑，多数数据会走 Mongo 或演示存储；填了可获得更多云端表能力。
- `LOCAL_PROJECTS_DIR` 决定“本地项目”索引的根文件夹（可在页面里修改）。

—

**四、启动开发模式（本机调试）**
- 在终端中运行：
  - `npm run dev`
- 终端会打印地址（如 `http://localhost:3000` 或 `3001/3002`）。
- 浏览器打开：
  - `http://localhost:3000/workflows/storyboard`（主要工作流）。
  - `http://localhost:3000/workflows/local-projects/settings`（设置本地素材根路径）。

—

**五、第一次使用的检查清单**
- 页面能打开且菜单正常显示。
- 在“本地路径设置”页填写一个存在的素材根目录（如 `F:\\素材根路径`）。
- 试着在工作流里上传参考图或生成图片：
  - MongoDB 中将自动出现这些集合（首次使用时自动创建）：
    - `projects`、`scripts`、`generated_images`、`generated_videos`
    - `reference_images`、`reference_videos`
    - `app_settings`（保存本地根路径）
    - `local_projects`、`local_assets`（用于本地文件索引）

—

**六、常见问题与快速解决**
- 报错“`MONGODB_URI 未配置或无效`”：
  - 检查 `.env.local` 是否填写了 `MONGODB_URI` 与 `MONGODB_DBNAME`；修改后重启 `npm run dev`。
- Atlas 连接失败：
  - 为你的 IP 开启访问白名单；确认用户名、密码正确；连接串中 DBName 不必预建，程序会自动创建集合。
- Windows 路径问题：
  - 确认 `LOCAL_PROJECTS_DIR` 指向存在且可读的目录；路径使用反斜杠 `\\`。
- 端口占用：
  - 开发服务器会自动换端口；按照终端显示的地址访问即可。

—

**七、服务器部署（生产模式）**
- 前提：服务器已装 Node.js、可访问 MongoDB（本机或云端）。
- 步骤：
  1) 上传项目到服务器并进入目录：`cd creative-workbench`
  2) 安装依赖：`npm install`
  3) 配置环境：在服务器上创建 `.env.production`，内容与 `.env.local` 相同（改为正式连接串）。
  4) 构建生产包：`npm run build`
  5) 启动生产服务：
     - `npm run start`（Next.js 生产模式）
     - 如需指定端口：`PORT=3000 npm run start`
  6) 可选：使用 PM2 常驻：
     - `npm i -g pm2`
     - `pm2 start npm --name creative-workbench -- run start`

—

**八、数据与索引（了解即可）**
- 集合会在首次写入时自动创建；无需手动建表。
- 某些环境可能为 `generated_images.id` 建了唯一索引（`id_1`），代码已为批量写入生成唯一 ID，避免冲突。
- 如需提升查询速度，可为常用字段建索引（如 `script_id`、`user_id`、`created_at`）。

—

**九、安全与分享建议**
- 不要把 `.env.*` 文件提交到仓库或随包分发。
- 若要分享给他人使用，提供一个模板文件（如 `.env.local.template`），让对方自己填连接串。
- 生产环境建议使用反向代理（Nginx）与 HTTPS，并限制服务器 IP 访问 MongoDB。

—

**十、快速回顾（三步跑起来）**
1) 安装 Node.js 与 MongoDB（或用 Atlas 连接）。
2) 在 `creative-workbench` 里创建 `.env.local`，至少填好 `MONGODB_URI` 和 `MONGODB_DBNAME`。
3) 运行 `npm install`，再 `npm run dev`，浏览器打开 `/workflows/storyboard`。

搞定！如需按你的实际环境进一步细化（Docker、Nginx、域名、HTTPS 等），告诉我你的目标环境，我可继续给出对应脚本和配置示例。