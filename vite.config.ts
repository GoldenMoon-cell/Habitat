import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri 期望固定端口，失败即报错，避免悄悄换端口导致桌面壳连不上
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],

  /* 相对路径。
     dev 模式和浏览器 PWA 都不受影响，但 Electron 生产模式用
     `loadFile(dist/index.html)` 走的是 file:// 协议——绝对路径
     `/assets/...` 在那里会解析成 `file:///assets/...`（磁盘根）而 404。 */
  base: "./",

  // Tauri CLI 才能读到的环境变量，避免 Vite 泄漏到前端
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      ignored: [
        "**/src-tauri/**",
        "**/electron/**",
        "**/dist/**",
        "**/.npm-cache/**",
        "**/.shots/**",
        // 编辑器/工具链的原子写临时目录，不应被监听（会 EBUSY 打死 dev server）
        "**/*.tmpdir/**",
        "**/.tmp/**",
        "**/.*.tmpdir/**",

        /* 非源码文件不该触发整页刷新。
           改 README / 脚本 / 图标时浏览器闪一下、状态全丢，很烦人。 */
        "**/*.md",
        "**/*.cmd",
        "**/*.ps1",
        "**/*.mjs",
        "**/*.log",
        "**/node_modules/**",
      ],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: "chrome110",
    chunkSizeWarningLimit: 1200,
  },
});
