import { getAssets } from '@/lib/local-index'

export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const url = new URL(req.url)
  const page = Number(url.searchParams.get('page') || 1)
  const pageSize = Number(url.searchParams.get('pageSize') || 30)
  const { projectId } = await params
  const { items, total } = await getAssets(projectId, page, pageSize)
  return Response.json({ items, total, page, pageSize })
}