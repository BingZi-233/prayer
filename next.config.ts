import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "better-sqlite3",
    "sqlite-vec",
    "@huggingface/transformers",
    "grammy",
  ],
  // 构建产物目录可用 NEXT_DIST_DIR 覆盖(默认 .next 不变):
  // 生产实例由 pm2 跑 `next start` 直接服务 .next,验证构建时指到别的目录,
  // 避免边跑边覆写在跑实例的产物。
  distDir: process.env.NEXT_DIST_DIR || ".next",
}

export default nextConfig
