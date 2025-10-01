import { getDb } from "./mongodb";
import { getLocalRootPath, normalizeWindowsPath } from "./local-settings";
import chokidar from "chokidar";
import path from "path";
import fs from "fs/promises";

// Collections
const LOCAL_PROJECTS = "local_projects";
const LOCAL_ASSETS = "local_assets";

export type LocalProject = {
  id: string; // derived from folder name
  name: string;
  full_path: string; // absolute path
  asset_count: number;
  updated_at: Date;
};

export type LocalAsset = {
  id: string; // original filename
  filename: string;
  project_id: string;
  full_path: string;
  type: "image" | "video" | "other";
  size: number;
  mtime: Date;
  created_at: Date;
};

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".mkv"]);

function getAssetTypeByExt(filePath: string): LocalAsset["type"] {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  return "other";
}

function toIdFromPath(fullPath: string): string {
  // 使用原文件名作为可读的稳定 ID（避免包含反斜杠导致 URL 解析问题）
  return path.basename(fullPath);
}

export async function scanOnce(): Promise<void> {
  const db = await getDb();
  const root = await getLocalRootPath();
  const dirEntries = await fs.readdir(root, { withFileTypes: true });

  // 清理不存在于当前磁盘目录中的旧项目及其资产，避免重复项目残留
  const currentProjectIds = dirEntries.filter(d => d.isDirectory()).map(d => d.name);
  const existing = await db.collection(LOCAL_PROJECTS).find({}).project({ id: 1 }).toArray();
  const existingIds = existing.map((p: any) => p.id);
  const toDelete = existingIds.filter((id: string) => !currentProjectIds.includes(id));
  if (toDelete.length) {
    await db.collection(LOCAL_ASSETS).deleteMany({ project_id: { $in: toDelete } });
    await db.collection(LOCAL_PROJECTS).deleteMany({ id: { $in: toDelete } });
  }

  for (const entry of dirEntries) {
    if (!entry.isDirectory()) continue;
    const projectPath = path.join(root, entry.name);
    const files = await listFilesRecursive(projectPath);
    const assets: LocalAsset[] = [];

    for (const f of files) {
      const stat = await fs.stat(f);
      const type = getAssetTypeByExt(f);
      if (type === "other") continue; // 仅索引图像与视频
      const filename = toIdFromPath(f);
      assets.push({
        id: filename,
        filename,
        project_id: entry.name,
        full_path: normalizeWindowsPath(f),
        type,
        size: stat.size,
        mtime: new Date(stat.mtime),
        created_at: new Date(),
      });
    }

    await db.collection(LOCAL_ASSETS).deleteMany({ project_id: entry.name });
    if (assets.length) {
      await db.collection(LOCAL_ASSETS).insertMany(assets);
    }

    await db.collection(LOCAL_PROJECTS).updateOne(
      { id: entry.name },
      {
        $set: {
          id: entry.name,
          name: entry.name,
          full_path: normalizeWindowsPath(projectPath),
          asset_count: assets.length,
          updated_at: new Date(),
        },
      },
      { upsert: true }
    );
  }
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = await listFilesRecursive(full);
      out.push(...sub);
    } else {
      out.push(full);
    }
  }
  return out;
}

let watcherInitialized = false;

export async function initWatcher(): Promise<void> {
  if (watcherInitialized) return;
  const root = await getLocalRootPath();
  const watcher = chokidar.watch(root, {
    ignored: /(^|[/\\])\./, // ignore dotfiles
    ignoreInitial: true,
    depth: 5,
  });

  const db = await getDb();

  const handleAddOrChange = async (fullPath: string) => {
    const normalized = normalizeWindowsPath(fullPath);
    const type = getAssetTypeByExt(normalized);
    if (type === "other") return;
    try {
      const stat = await fs.stat(normalized);
      const projectId = getProjectIdByPath(normalized, root);
      if (!projectId) return;
      const filename = toIdFromPath(normalized);
      const asset: LocalAsset = {
        id: filename,
        filename,
        project_id: projectId,
        full_path: normalized,
        type,
        size: stat.size,
        mtime: new Date(stat.mtime),
        created_at: new Date(),
      };
      await db.collection(LOCAL_ASSETS).updateOne(
        { project_id: projectId, id: asset.id },
        { $set: asset },
        { upsert: true }
      );
      await db.collection(LOCAL_PROJECTS).updateOne(
        { id: projectId },
        { $set: { updated_at: new Date() } },
        { upsert: true }
      );
    } catch {}
  };

  const handleUnlink = async (fullPath: string) => {
    const normalized = normalizeWindowsPath(fullPath);
    const projectId = getProjectIdByPath(normalized, root);
    if (!projectId) return;
    const filename = toIdFromPath(normalized);
    await db.collection(LOCAL_ASSETS).deleteOne({ project_id: projectId, id: filename });
    await db.collection(LOCAL_PROJECTS).updateOne(
      { id: projectId },
      { $set: { updated_at: new Date() } }
    );
  };

  watcher
    .on("add", handleAddOrChange)
    .on("change", handleAddOrChange)
    .on("unlink", handleUnlink)
    // 目录删除：移除项目与其资产
    .on("unlinkDir", async (dirPath) => {
      const normalized = normalizeWindowsPath(dirPath)
      const projectId = getProjectIdByPath(normalized, root)
      if (!projectId) return
      await db.collection(LOCAL_ASSETS).deleteMany({ project_id: projectId })
      await db.collection(LOCAL_PROJECTS).deleteMany({ id: projectId })
    })
    // 目录新增（包含重命名后新目录）：确保项目记录存在
    .on("addDir", async (dirPath) => {
      const normalized = normalizeWindowsPath(dirPath)
      const projectId = getProjectIdByPath(normalized, root)
      if (!projectId) return
      const stat = await fs.stat(normalized).catch(() => null)
      await db.collection(LOCAL_PROJECTS).updateOne(
        { id: projectId },
        { $set: { id: projectId, name: projectId, full_path: normalized, updated_at: new Date() } },
        { upsert: true }
      )
    })
    .on("error", (err) => {
      console.error("local watcher error", err);
    });

  watcherInitialized = true;
}

function getProjectIdByPath(fullPath: string, root: string): string | null {
  // root\project\file -> projectId = project
  const rel = path.relative(root, fullPath);
  if (rel.startsWith('..')) return null; // 超出根目录，拒绝
  const parts = rel.split(/\\|\//);
  return parts.length > 0 ? parts[0] : null;
}

export async function getProjects(): Promise<LocalProject[]> {
  const db = await getDb();
  const arr = await db.collection<LocalProject>(LOCAL_PROJECTS).find({}).sort({ name: 1 }).toArray();
  return arr as any;
}

export async function getAssets(projectId: string, page = 1, pageSize = 30): Promise<{ items: LocalAsset[]; total: number }>{
  const db = await getDb();
  const filter = { project_id: projectId };
  const total = await db.collection(LOCAL_ASSETS).countDocuments(filter);
  const items = await db.collection<LocalAsset>(LOCAL_ASSETS)
    .find(filter)
    .sort({ mtime: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .toArray();
  return { items: items as any, total };
}