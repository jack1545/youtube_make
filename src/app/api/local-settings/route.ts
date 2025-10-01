import { NextRequest } from "next/server";
import { getLocalRootPath, setLocalRootPath } from "@/lib/local-settings";
import { scanOnce, initWatcher } from "@/lib/local-index";

export async function GET() {
  const root = await getLocalRootPath();
  return Response.json({ root });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const newRoot = body?.root as string;
  if (!newRoot || typeof newRoot !== "string") {
    return new Response(JSON.stringify({ error: "root 必须是字符串" }), { status: 400 });
  }
  const res = await setLocalRootPath(newRoot);
  if (!res.ok) {
    return new Response(JSON.stringify({ error: res.error || "保存失败" }), { status: 400 });
  }
  // 路径更新后做一次全量扫描并初始化监听
  await scanOnce();
  await initWatcher();
  return Response.json({ ok: true, root: res.root });
}