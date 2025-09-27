import Link from 'next/link'
import { getProjects, getScripts, getGeneratedImages, getGeneratedVideos, deleteProject } from '@/lib/db'
import type { Project, Script, GeneratedImage, GeneratedVideo } from '@/lib/types'
import { CopyButton, DeleteProjectButton } from './Controls'

interface ScriptBundle {
  script: Script
  images: GeneratedImage[]
  videos: GeneratedVideo[]
}

interface ProjectBundle {
  project: Project
  scripts: ScriptBundle[]
}

export const dynamic = 'force-dynamic'

export default async function HistoryPage() {
  const projects = await getProjects()

  const bundles: ProjectBundle[] = await Promise.all(
    projects.map(async (project) => {
      const scripts = await getScripts(project.id)
      const scriptBundles: ScriptBundle[] = await Promise.all(
        scripts.map(async (script) => {
          const [images, videos] = await Promise.all([
            getGeneratedImages(script.id),
            getGeneratedVideos(script.id)
          ])
          return { script, images, videos }
        })
      )
      return { project, scripts: scriptBundles }
    })
  )

  const hasAnyMedia = bundles.some(b =>
    b.scripts.some(s => s.images.length > 0 || s.videos.length > 0)
  )

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-gray-900">历史项目</h2>
        <Link href="/" className="text-sm text-blue-600 hover:underline">返回首页</Link>
      </div>

      {bundles.length === 0 && (
        <div className="rounded-md border border-dashed p-8 text-center text-gray-500">
          暂无项目数据。
        </div>
      )}

      {bundles.map(({ project, scripts }) => (
        <section key={project.id} className="bg-white rounded-lg shadow-sm border p-6">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="text-xl font-medium text-gray-900">{project.name}</h3>
              <p className="text-sm text-gray-500 mt-1">{project.description || '—'}</p>
              <p className="text-xs text-gray-400 mt-1">创建时间：{new Date(project.created_at).toLocaleString()}</p>
            </div>
            <DeleteProjectButton projectId={project.id} projectName={project.name} action={deleteProjectAction} />
          </div>

          {scripts.length === 0 ? (
            <p className="text-sm text-gray-500">该项目暂无脚本与生成内容。</p>
          ) : (
            <div className="space-y-6">
              {scripts.map(({ script, images, videos }) => (
                <div key={script.id} className="border-t pt-4 first:border-t-0 first:pt-0">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-gray-800">脚本 {script.id}</h4>
                    <span className="text-xs text-gray-500">片段数：{script.content?.length ?? 0}</span>
                  </div>

                  {/* Images */}
                  <div className="mt-3">
                    <h5 className="text-sm font-semibold text-gray-700">生成图片</h5>
                    {images.length === 0 ? (
                      <p className="text-sm text-gray-500 mt-2">暂无图片</p>
                    ) : (
                      <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                        {images.map(img => (
                          <div key={img.id} className="group rounded overflow-hidden border bg-gray-50 hover:shadow">
                            <a
                              href={img.image_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block"
                              title={img.prompt}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={img.image_url}
                                alt={img.prompt.slice(0, 80)}
                                className="aspect-square w-full object-cover transition-transform duration-200 group-hover:scale-105"
                              />
                            </a>
                            <div className="p-2">
                              <p className="line-clamp-2 text-xs text-gray-600">{img.prompt}</p>
                              <p className="text-[10px] text-gray-400 mt-1">{new Date(img.created_at).toLocaleString()}</p>
                              <div className="mt-1">
                                <CopyButton text={img.prompt} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Videos */}
                  <div className="mt-4">
                    <h5 className="text-sm font-semibold text-gray-700">生成视频</h5>
                    {videos.length === 0 ? (
                      <p className="text-sm text-gray-500 mt-2">暂无视频</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {videos.map(v => (
                          <li key={v.id} className="flex items-center justify-between rounded border p-3 hover:bg-gray-50">
                            <div className="min-w-0 pr-4">
                              <p className="text-sm text-gray-800 truncate">{v.prompt}</p>
                              <p className="text-xs text-gray-500 mt-1">
                                状态：{v.status} · {new Date(v.created_at).toLocaleString()}
                              </p>
                              <div className="mt-1">
                                <CopyButton text={v.prompt} />
                              </div>
                            </div>
                            {v.video_url ? (
                              <a
                                href={v.video_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 text-sm text-blue-600 hover:underline"
                              >
                                打开链接
                              </a>
                            ) : (
                              <span className="shrink-0 text-xs text-gray-400">无链接</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}

      {bundles.length > 0 && !hasAnyMedia && (
        <div className="rounded-md border border-dashed p-8 text-center text-gray-500">
          已加载项目，但尚未生成任何图片或视频。
        </div>
      )}
    </div>
  )
}


export async function deleteProjectAction(formData: FormData) {
  'use server'
  const projectId = String(formData.get('projectId') || '')
  if (projectId) {
    await deleteProject(projectId)
  }
}