import { NextResponse } from 'next/server'

// 已废弃直传：请改用公开图片 URL 提交
export async function POST(req: Request) {
  try {
    return NextResponse.json({
      error: '已停止文件直传，请改用公开图片 URL（例如 CDN、OSS、公开站点），并通过 /api/reference-images 提交 url 与 user_id。'
    }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '上传失败' }, { status: 500 })
  }
}