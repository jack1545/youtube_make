import { NextResponse } from 'next/server'
import { getDb } from '@/lib/mongodb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/reference-folders?user_id=...&limit=10&before=ISO8601
// 返回聚合后的目录（按 label 分组）与显式创建的空目录，并提供封面与数量
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const userId = url.searchParams.get('user_id')
    const limitStr = url.searchParams.get('limit')
    const before = url.searchParams.get('before') // 目录游标：使用 latest 时间
    const limit = Math.max(1, Math.min(Number(limitStr) || 10, 50))

    if (!userId) {
      return NextResponse.json({ error: '缺少 user_id 参数' }, { status: 400 })
    }

    const db = await getDb()
    const imgColl = db.collection('reference_images')
    const folderColl = db.collection('reference_folders')

    // 聚合参考图目录：支持 labels 数组与旧字段 label
    const agg = await imgColl
      .aggregate([
        { $match: { user_id: userId } },
        { $sort: { created_at: -1 } },
        {
          $project: {
            url: 1,
            created_at: 1,
            // 合并 labels 与旧字段 label
            mergedLabels: {
              $cond: [
                { $gt: [ { $size: { $ifNull: [ '$labels', [] ] } }, 0 ] },
                '$labels',
                { $cond: [ { $ne: [ '$label', null ] }, [ '$label' ], [] ] }
              ]
            }
          }
        },
        {
          $project: {
            url: 1,
            created_at: 1,
            mergedLabels: {
              $cond: [
                { $gt: [ { $size: '$mergedLabels' }, 0 ] },
                '$mergedLabels',
                [ null ] // 空数组映射为 [null] 以便后续归类为未归类
              ]
            }
          }
        },
        { $unwind: { path: '$mergedLabels', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: '$mergedLabels',
            count: { $sum: 1 },
            latest: { $first: '$created_at' },
            cover_url: { $first: '$url' }
          }
        }
      ])
      .toArray()

    const aggItems = (agg || []).map((g: any) => {
      const isUncategorized = g._id === null || typeof g._id === 'undefined'
      return {
        id: isUncategorized ? 'uncategorized' : `label:${String(g._id)}`,
        user_id: userId,
        name: isUncategorized ? '未归类' : String(g._id),
        label: isUncategorized ? null : String(g._id),
        created_at: typeof g.latest === 'string' ? g.latest : new Date(g.latest).toISOString(),
        cover_url: g.cover_url || null,
        count: g.count || 0
      }
    })

    // 显式创建的目录（可能为空）：需要查询对应封面（取该 label 最新一张）
    const explicitDocs = await folderColl
      .find({ user_id: userId })
      .sort({ created_at: -1 })
      .toArray()
    const explicitItems = [] as any[]
    for (const f of explicitDocs || []) {
      const label = f.name
      const latestImg = await imgColl
        .find({ user_id: userId, $or: [ { labels: label }, { label } ] })
        .sort({ created_at: -1 })
        .limit(1)
        .toArray()
      const coverUrl = latestImg[0]?.url || null
      const count = await imgColl.countDocuments({ user_id: userId, $or: [ { labels: label }, { label } ] })
      explicitItems.push({
        id: f.id || (f._id ? String(f._id) : `folder:${label}`),
        user_id: userId,
        name: label,
        label,
        created_at: typeof f.created_at === 'string' ? f.created_at : new Date(f.created_at).toISOString(),
        cover_url: coverUrl,
        count
      })
    }
    // 仅显示非空显式目录；当目录无图片时等同自动删除（不再展示）
    const explicitNonEmpty = explicitItems.filter(item => (item.count ?? 0) > 0)

    // 合并并按 created_at 排序；同名去重（以聚合结果为准，若不存在则显式保留）
    const byName = new Map<string, any>()
    for (const item of [...aggItems, ...explicitNonEmpty]) {
      if (!byName.has(item.name)) {
        byName.set(item.name, item)
      }
    }
    let items = Array.from(byName.values())

    // 游标过滤
    if (before) {
      items = items.filter(i => new Date(i.created_at).getTime() < new Date(before).getTime())
    }

    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    items = items.slice(0, limit)

    return NextResponse.json({ items })
  } catch (err: any) {
    console.error('API:get reference-folders exception', err)
    return NextResponse.json({ error: err?.message || '服务端错误' }, { status: 500 })
  }
}

// POST /api/reference-folders
// body: { name: string, user_id: string }
export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: '无效请求体' }, { status: 400 })
    }
    const { name, user_id } = payload as { name?: string; user_id?: string }
    if (!name || typeof name !== 'string' || !user_id || typeof user_id !== 'string') {
      return NextResponse.json({ error: '缺少必要字段 name 或 user_id' }, { status: 400 })
    }

    const db = await getDb()
    const coll = db.collection('reference_folders')
    const nowIso = new Date().toISOString()

    // 去重：同一用户同名目录只保留一个
    const exist = await coll.findOne({ user_id, name })
    if (exist) {
      const item = {
        id: exist.id || (exist._id ? String(exist._id) : `folder:${name}`),
        user_id,
        name,
        label: name,
        created_at: typeof exist.created_at === 'string' ? exist.created_at : new Date(exist.created_at).toISOString(),
        cover_url: null,
        count: 0
      }
      return NextResponse.json({ item })
    }

    const result = await coll.insertOne({ user_id, name, created_at: nowIso })
    const id = result.insertedId ? String(result.insertedId) : undefined
    const item = { id: id || `folder:${name}`, user_id, name, label: name, created_at: nowIso, cover_url: null, count: 0 }
    return NextResponse.json({ item })
  } catch (err: any) {
    console.error('API:post reference-folders exception', err)
    return NextResponse.json({ error: err?.message || '服务端错误' }, { status: 500 })
  }
}

// PATCH /api/reference-folders
// body: { old_name?: string, old_label?: string, new_name: string, user_id: string }
// 将目录名从 old → new，并将参考图的 label 一并改为 new
export async function PATCH(req: Request) {
  try {
    const payload = await req.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: '无效请求体' }, { status: 400 })
    }
    const { old_name, old_label, new_name, user_id } = payload as { old_name?: string; old_label?: string; new_name?: string; user_id?: string }
    if (!user_id || typeof user_id !== 'string') {
      return NextResponse.json({ error: '缺少 user_id' }, { status: 400 })
    }
    const from = (old_label || old_name || '').trim()
    const to = (new_name || '').trim()
    if (!from || !to) {
      return NextResponse.json({ error: '缺少旧目录或新目录名称' }, { status: 400 })
    }
    if (to === '未归类') {
      return NextResponse.json({ error: '不可重命名为系统保留名' }, { status: 400 })
    }

    const db = await getDb()
    const imgColl = db.collection('reference_images')
    const folderColl = db.collection('reference_folders')

    // 参考图：将 label = from 的全部改为 to
    const relabel = await imgColl.updateMany({ user_id, label: from }, { $set: { label: to } })

    // 显式目录：若存在 new_name，则删除旧纪录；否则重命名旧纪录
    const existNew = await folderColl.findOne({ user_id, name: to })
    if (existNew) {
      await folderColl.deleteOne({ user_id, name: from })
    } else {
      await folderColl.updateOne({ user_id, name: from }, { $set: { name: to } })
    }

    return NextResponse.json({ relabeled: relabel.modifiedCount || 0, renamed: true })
  } catch (err: any) {
    console.error('API:patch reference-folders exception', err)
    return NextResponse.json({ error: err?.message || '服务端错误' }, { status: 500 })
  }
}

// DELETE /api/reference-folders
// body: { name?: string, label?: string, user_id: string }
// 删除显式目录，并将该目录下参考图统一置为未归类（label=null）
export async function DELETE(req: Request) {
  try {
    const payload = await req.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: '无效请求体' }, { status: 400 })
    }
    const { name, label, user_id } = payload as { name?: string; label?: string; user_id?: string }
    if (!user_id || typeof user_id !== 'string') {
      return NextResponse.json({ error: '缺少 user_id' }, { status: 400 })
    }
    const folderLabel = (label || name || '').trim()
    if (!folderLabel) {
      return NextResponse.json({ error: '缺少目录名或标签' }, { status: 400 })
    }

    const db = await getDb()
    const imgColl = db.collection('reference_images')
    const folderColl = db.collection('reference_folders')

    // 1) 清空主标签 label
    const clearMain = await imgColl.updateMany({ user_id, label: folderLabel }, { $set: { label: null } })
    // 2) 从多标签数组 labels 中移除该目录标签
    const pullFromLabels = await imgColl.updateMany({ user_id, labels: folderLabel }, { $pull: { labels: folderLabel } })
    // 3) 删除显式目录记录
    const del = await folderColl.deleteOne({ user_id, name: folderLabel })

    return NextResponse.json({
      relabeled: clearMain.modifiedCount || 0,
      labelsPulled: pullFromLabels.modifiedCount || 0,
      folderDeleted: del.deletedCount === 1
    })
  } catch (err: any) {
    console.error('API:delete reference-folders exception', err)
    return NextResponse.json({ error: err?.message || '服务端错误' }, { status: 500 })
  }
}