# 杂项归档 — 2026-07-04

## 来源
本目录中的文件来源于 `d:\cortex` 根目录，为项目开发过程中产生的**杂项/临时/非核心**内容。

## 迁移日期
2026-07-04

## 内容清单

### 目录
| 原路径 | 说明 |
|---|---|
| `StarRailData_repo/` | 外部数据仓库克隆 |
| `tmp/` | 临时目录 |
| `bili_frames/` | 昔涟语音素材 — 帧图片 **（个人素材，可找回）** |
| `bili_images/` | 昔涟语音素材 — 图片 **（个人素材，可找回）** |
| `bili_videos/` | 昔涟语音素材 — 视频 **（个人素材，可找回）** |
| `scripts/` | 归档脚本（原 `.archived/scripts/`） |
| `projects/` | 实验性项目 |
| `cli-test-docs/` | CLI 测试文档 |
| `.tsbuildinfo/` | TypeScript 构建缓存 |

### 文件
| 文件名 | 说明 |
|---|---|
| `architecture-report.md` | 架构报告 |
| `_tmp_build.cjs` | 临时构建脚本 |
| `_tmp_build_check.cjs` | 临时构建检查脚本 |
| `_tmp_build_order.cjs` | 临时构建顺序脚本 |
| `_tmp_build_root.cjs` | 临时根构建脚本 |
| `_tmp_clean.cjs` | 临时清理脚本 |

## 不动的内容（保留在根目录）
- `node_modules/`, `.pnpm-store/` — 包管理器缓存
- `test-output/` — 自审视报告
- `.cortex/` — 运行时数据
- `.qoder/` — Qoder 配置
- `packages/`, `scripts/`, `docs/`, `src/` — 项目核心

## 备注
- `BiliBiliCCSubtitle/`、`workspace/` 及清单中大部分散落文件（`calc.json`, `data.json`, `lint-audit*.txt` 等）在迁移时**不存在于根目录**，未创建空目录/文件
- 如有需要可从此目录移回原位置
