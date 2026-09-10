import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    // .next* 覆盖自定义 distDir(NEXT_DIST_DIR=.next-verify / .next-ui-dev),
    // 这些构建产物不该被当成源码 lint。
    ".next*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 运行时产物,非源码(gitignored):
    "data/**",
    "logs/**",
    "docs/kb/**",
  ]),
])

export default eslintConfig
