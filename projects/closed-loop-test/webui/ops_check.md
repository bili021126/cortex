# ⚓ 死兆星号 Ops Check — 运行环境 & CLI 部署

**检查者**: 北斗 @南十字船队  
**时间**: 2026-05-13 17:05 UTC  
**项目**: cortex（closed-loop-test monorepo）

---

## 1. 运行时环境

| 项目 | 版本 | 状态 |
|------|------|:----:|
| Node.js | **v24.12.0** | ✅ |
| npm | **11.6.2** | ✅ |
| npx | **11.6.2**（路径: `D:\Program Files\nvm\nodejs\npx`） | ✅ |
| OS | Windows (Win32, x64) | ⚠️ 跨平台兼容需留意 shell 参数 |

### 依赖安装状态
| 项目 | 状态 | 说明 |
|------|:----:|------|
| `node_modules` | ❌ 未安装 | 依赖未本地安装，需执行 `npm install` |
| 锁文件（lock） | ❌ 不存在 | `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock` 均缺失 |
| `npm install --dry-run` | ✅ 通过 | 将安装 **135 个包**（devDependencies 全部正常可解析） |

---

## 2. CLI 工具部署检查

项目中有 **2 个 TypeScript CLI 脚本**，设计为通过 `npx tsx` 直接执行：

### 2.1 `tools/monorepo-analyzer.ts`

| 检查项 | 结果 |
|--------|:----:|
| Shebang | ✅ `#!/usr/bin/env tsx` |
| `npx tsx tools/monorepo-analyzer.ts` | ✅ 正常退出，输出人类可读报告 |
| `npx tsx tools/monorepo-analyzer.ts --json` | ✅ 输出合法 JSON |
| `--output <path>` 写入文件 | ✅ 支持 |
| `--ignore`, `--verbose`, `--include-dev` | ✅ 全部支持 |
| CI 退出码 | ✅ `0`=干净 / `1`=漂移或循环 / `2`=异常 |
| 依赖 | 零运行时依赖（仅使用 Node 内置模块 `fs`, `path`, `process`） |

### 2.2 `tools/configuration-drift.ts`

| 检查项 | 结果 |
|--------|:----:|
| Shebang | ❌ 无（但不影响 `npx tsx` 执行） |
| `npx tsx tools/configuration-drift.ts` | ✅ 正常退出，输出人类可读报告 |
| `npx tsx tools/configuration-drift.ts --json` | ✅ 输出合法 JSON |
| CI 退出码 | ✅ `0`=干净 / `1`=漂移 / `2`=异常 |
| 依赖 | 零运行时依赖（仅使用 Node 内置模块 `fs`, `path`, `process`） |

> 📌 **建议**: 给 `configuration-drift.ts` 补上 shebang `#!/usr/bin/env tsx`，与 `monorepo-analyzer.ts` 保持一致。

---

## 3. 项目结构扫描

| 维度 | 结果 |
|------|:----:|
| 包总数 | **5**（root + 4 子包：engine / llm / shared / testing） |
| 层级结构 | `shared (L0)` ← `llm / testing (L1)` ← `engine (L2)` |
| 循环依赖 | ✅ 未发现 |
| 版本漂移 | ✅ 未发现（所有跨包同名依赖版本一致） |
| 依赖去重后数量 | **13** 项（monorepo-analyzer 口径）/ **16** 项（含 workspace:*，configuration-drift 口径） |

### 依赖快照（跨包出现 ≥2 次的依赖）

```
eslint          ^10.3.0   root, engine, testing
vitest          ^2.1.0    root, engine, llm, shared, testing
typescript      ^5.7.0    engine, llm, shared, testing
@types/node     ^22.0.0   engine, llm
```

---

## 4. 风险 & 建议

| # | 风险项 | 严重度 | 建议 |
|:-:|--------|:------:|------|
| 1 | 无锁文件 | 🟡 中 | 生成并提交 `package-lock.json`（或迁移至 pnpm 后提交 `pnpm-lock.yaml`），确保 CI 可复现安装 |
| 2 | 依赖未安装 | 🟡 中 | CI 流水线需添加 `npm install` 步骤；本地开发首次需 `npm install` |
| 3 | `configuration-drift.ts` 缺 shebang | 🟢 低 | 补充 `#!/usr/bin/env tsx` 开头行，确保直接 `chmod +x` 可执行 |
| 4 | Windows shell 兼容 | 🟢 低 | `execFileSync` 系列调用注意 Win 上需显式 `{ shell: true }`（当前脚本未使用，仅备忘） |

---

## 5. 总结

```
  死兆星号 环境就绪确认

  Node.js   │ v24.12.0  ✅  一切就绪
  npm/npx   │ 11.6.2    ✅  工具链可用
  tsx       │ 4.21.0    ✅  npx tsx CLI 畅通
  依赖安装  │ 未安装    ⚠️  跑 npm install 即可
  锁文件    │ 无        ⚠️  建议补上
  CLI 脚本  │ 2/2 通过  ✅  零依赖，纯 Node 标准库
  版本漂移  │ 0 处      ✅  干净
  循环依赖  │ 0 处      ✅  干净

  结论：环境可部署，CI 可集成。补锁、补 shebang 后可出航。
```

---

*此日志已归档至 MemoryStore。下一位值班水手如需回溯，可搜索「ops_check」「北斗」「死兆星号」。*
