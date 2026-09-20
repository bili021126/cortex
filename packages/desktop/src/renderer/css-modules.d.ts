// CSS 副作用导入环境声明
//
// 本文件刻意不含任何顶层 import / export，使其成为「全局脚本」而非模块，
// 从而让 `declare module "*.css"` 生效为全局环境声明，消除 TS2882。
// （global.d.ts 因含顶层 import type 属于模块文件，其内的 declare module
//  不会作为全局环境声明生效。）
//
// 样式实际由打包器（Vite）处理，TS 侧仅需声明消除类型报错。
declare module "*.css";
