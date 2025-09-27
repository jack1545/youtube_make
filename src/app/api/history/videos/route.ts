import { NextResponse } from 'next/server'
import { getGeneratedVideos } from '@/lib/db'

export async function GET(_req: Request) {
  try {
    const videos = await getGeneratedVideos()
    return NextResponse.json({ videos })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to load history videos' }, { status: 500 })
  }
}