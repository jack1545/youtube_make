import { getDb } from "./mongodb";
import fs from "fs/promises";
import path from "path";

export type LocalSettings = {
  key: string;
  value: string;
  updated_at: Date;
};

const SETTINGS_COLLECTION = "app_settings";
const LOCAL_ROOT_KEY = "local_projects_root_path";
// 默认值：Windows 路径，带盘符冒号并使用反斜杠
const DEFAULT_LOCAL_ROOT = process.env.LOCAL_PROJECTS_DIR || "G:\\Downloads\\ytb_project";

export async function getLocalRootPath(): Promise<string> {
  const db = await getDb();
  const doc = await db.collection<LocalSettings>(SETTINGS_COLLECTION).findOne({ key: LOCAL_ROOT_KEY });
  const configured = doc?.value;
  return configured || DEFAULT_LOCAL_ROOT;
}

export async function setLocalRootPath(newRoot: string): Promise<{ ok: boolean; error?: string; root: string }>{
  try {
    const normalized = normalizeWindowsPath(newRoot);
    // 校验存在且可读
    await fs.access(normalized);
    const db = await getDb();
    await db.collection<LocalSettings>(SETTINGS_COLLECTION).updateOne(
      { key: LOCAL_ROOT_KEY },
      { $set: { key: LOCAL_ROOT_KEY, value: normalized, updated_at: new Date() } },
      { upsert: true }
    );
    return { ok: true, root: normalized };
  } catch (err: any) {
    return { ok: false, error: err?.message || "路径不可用", root: newRoot };
  }
}

export function normalizeWindowsPath(p: string): string {
  // 统一为绝对路径，并将正斜杠转为反斜杠
  const abs = path.isAbsolute(p) ? p : path.resolve(p);
  return abs.replace(/\//g, "\\");
}