import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { isDemoMode } from "@/lib/supabase";
import Link from "next/link";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "创意工作台",
  description: "AI驱动的创意内容生成工具",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh">
      <body className={inter.className}>
        <div className="min-h-screen bg-gray-50">
          <header className="bg-white shadow-sm border-b">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center py-4">
                <h1 className="text-2xl font-bold text-gray-900">
                  <Link href="/" className="hover:text-blue-600 transition-colors">创意工作台</Link>
                </h1>
                <nav className="flex items-center gap-4 text-sm">
                  <Link href="/" className="text-gray-700 hover:text-blue-600">首页</Link>
                  <Link href="/workflows/storyboard" className="text-gray-700 hover:text-blue-600">Storyboard</Link>
                  <Link href="/veo3" className="text-gray-700 hover:text-blue-600">Veo3提交</Link>
                  <Link href="/history" className="text-gray-700 hover:text-blue-600">历史项目</Link>
                </nav>
                <div className="text-sm text-gray-500">
                  {isDemoMode ? '演示模式' : '管理员模式'}
                </div>
              </div>
            </div>
          </header>
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}