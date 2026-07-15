import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { copyFileSync, existsSync, mkdirSync } from "fs";

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
