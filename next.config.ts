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
  poweredByHeader: false,
  // Proxy 会为路由复制请求体；把其内存缓冲上限与 route-level bounded
  // reader 对齐。proxy 本身遇到超限会截断，真正的 413 由 proxy/route guard 返回。
  experimental: {
    proxyClientMaxBodySize: "1mb",
  },
  headers: async () => {
    const dev = process.env.NODE_ENV !== "production"
    const headers = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
      { key: "X-DNS-Prefetch-Control", value: "off" },
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'none'",
          "object-src 'none'",
          "img-src 'self' data: blob: https:",
          "media-src 'self' data: blob: https:",
          "font-src 'self' data:",
          `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
          "style-src 'self' 'unsafe-inline'",
          "connect-src 'self' ws: wss:",
        ].join("; "),
      },
      ...(dev
        ? []
        : [
            {
              key: "Strict-Transport-Security",
              value: "max-age=31536000; includeSubDomains",
            },
          ]),
    ]
    return [
      { source: "/:path*", headers },
      // API responses include operational state and credentials-derived
      // metadata; never let a browser/proxy cache them across admin sessions.
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ]
  },
}

export default nextConfig
