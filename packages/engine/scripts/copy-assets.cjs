// 编译后拷贝 .mjs / .json 等非 TS 资源到 dist
const fs = require('fs');
const path = require('path');

const assets = [
  ['src/core/worker-script.mjs', 'dist/core/worker-script.mjs'],
];

for (const [src, dest] of assets) {
  const srcPath = path.resolve(__dirname, '..', src);
  const destPath = path.resolve(__dirname, '..', dest);
  if (fs.existsSync(srcPath)) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    console.log('[copy-assets]', src, '→', dest);
  }
}
