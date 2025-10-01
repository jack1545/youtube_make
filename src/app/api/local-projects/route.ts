import { NextRequest } from "next/server";
import { getProjects, scanOnce, initWatcher } from "@/lib/local-index";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rescan = url.searchParams.get("rescan") === "true";
  if (rescan) {
    await scanOnce();
  }
  await initWatcher(); // 确保监听已启动（幂等）
  const projects = await getProjects();
  return Response.json({ items: projects });
}