# Creative Workbench（创意工作台）

一个用于脚本创作与图像/视频生成的 AI 工具集。你可以在这里编写提示词、生成图片，并将素材提交到 Veo3 生成视频。

## 适用人群
- 编程小白：按照下面的步骤一步一步来，就能跑起来。
- 创作者/设计师：快速把想法变成图像和视频。

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

  # API Keys
  GEMINI_API_KEY=你的-gemini-api-key
  DOUBAO_API_KEY=你的-云雾AI-doubao-api-key
  ```
- 如何获取：
  - Supabase：注册并创建项目，在项目设置里可以找到 `URL` 和 `anon key`。
  - Gemini API：在 Google AI Studio 申请或在 云雾AI（yunwu.ai）平台申请。
  - Doubao API：在 云雾AI（yunwu.ai）平台申请。

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
  - 支持上传首尾帧图片（或粘贴图片 URL）。
  - 提示词支持自动翻译（可选）。
  - 提交后 30 秒自动查询一次任务进度，生成后会显示视频链接和本页内预览。
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

## 进一步学习
- 想了解 Next.js 的更多能力（如路由、数据获取、优化等），可在网上搜索 Next.js 文档与教程。

祝使用愉快！
