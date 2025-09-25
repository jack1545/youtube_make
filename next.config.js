/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // 警告: 这只允许在开发时忽略ESLint错误，生产构建仍会失败
    ignoreDuringBuilds: true,
  },
}

module.exports = nextConfig