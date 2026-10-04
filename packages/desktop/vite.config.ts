// eslint-disable-next-line 
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { copyFileSync, existsSync, mkdirSync } from "fs";

// ── Windows 构建稳定性：把 esbuild 临时目录挪出 %TEMP% ──
// vite 的 commonjs 插件用 esbuild 转译 monaco-editor 各语言 worker，会在系统临时目录建/删
// esbuild-<random> 子目录。Windows 上两个叠加故障常让"删"失败、进而中止整个 build：
//   ① 上次失败构建残留的 esbuild.exe 服务仍占着那个临时目录的句柄；
//   ② 实时防护（Windows Defender 等）扫 %TEMP% 时抓着文件不放。
// 症状：`[commonjs--resolver] remove <Temp>\esbuild-xxxx: Access is denied.`
// 对策：TMP/TEMP/TMPDIR 统一指到项目内 .etmp（已在 .gitignore），绕开 %TEMP% 与杀软热区。
// 本配置模块在 vite 启动、esbuild 子进程 spawn 之前求值，故此处改 process.env 对 esbuild 生效。
const ETMP = resolve(__dirname, "../../.etmp");
try {
  if (!existsSync(ETMP)) mkdirSync(ETMP, { recursive: true });
  process.env.TMP = ETMP;
  process.env.TEMP = ETMP;
  process.env.TMPDIR = ETMP;
} catch {
  /* 建目录失败则退回默认临时目录，至少不比现状更差 */
}

export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  base: "./",
  plugins: [
    react(),
    {
      name: "copy-live2d-core",
      transformIndexHtml(html) {
        return html.replace(
          "<head>",
          '<head>\n  <script>window.process=window.process||{env:{NODE_ENV:"production"}}</script>\n  <script src="./live2dcubismcore.min.js"></script>',
        );
      },
      closeBundle() {
        const dst = resolve(__dirname, "dist/renderer");
        if (!existsSync(dst)) mkdirSync(dst, { recursive: true });
        copyFileSync(
          resolve(__dirname, "src/renderer/public/live2dcubismcore.min.js"),
          resolve(dst, "live2dcubismcore.min.js"),
        );
      },
    },
  ],
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/renderer/index.html"),
        chat: resolve(__dirname, "src/renderer/chat/index.html"),
      },
    },
  },
  server: { port: 5173, strictPort: false },
});
