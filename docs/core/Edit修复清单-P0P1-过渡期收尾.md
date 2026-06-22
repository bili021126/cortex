# Edit 修复清单——过渡期 P0/P1 收尾

**交付日期**：2026-06-22
**来源**：全仓深度审查 + 系统级诊断
**执行者**：Edit 昔涟（Flash 模型）
**验收标准**：每个修复后 `pnpm exec vitest run --no-color` 无新增失败

---

## P0——安全/治理（今天）

### P0-0：清理编译泄漏产物（前置——先做这个，否则 TS5055 干扰其他修复）
**文件**：全仓
**现状**：690 个在 `src/` + 677 个在 `tests/` + 153 个 vitest config 编译产物 + 40 个 .tsbuildinfo + 3 个 dist-test 目录 + 4 个 packages/ 根目录
**修复**：一条 PowerShell 命令全清
```powershell
# src/ 下所有编译产物
Get-ChildItem -Recurse packages/*/src/ -Include *.js,*.js.map,*.d.ts,*.d.ts.map | Remove-Item -Force
# tests/ 下所有编译产物（保留 .test.ts 源文件）
Get-ChildItem -Recurse packages/*/tests/ -Include *.js,*.js.map,*.d.ts,*.d.ts.map | Remove-Item -Force
# 根目录 vitest config 编译产物
Get-ChildItem packages/*/vitest*.js,packages/*/vitest*.js.map,packages/*/vitest*.d.ts,packages/*/vitest*.d.ts.map -File | Remove-Item -Force
# 根目录零散编译产物
Get-ChildItem packages/*/ -Include *.js,*.js.map,*.d.ts.map -File | Where-Object { $_.DirectoryName -notmatch "src|dist|tests|node_modules" } | Remove-Item -Force
# tsbuildinfo 缓存
Get-ChildItem -Recurse -Filter *.tsbuildinfo | Where-Object { $_.FullName -notmatch "node_modules|.pnpm-store" } | Remove-Item -Force
# 废弃 dist-test 目录
Get-ChildItem -Recurse -Directory -Filter dist-test | Remove-Item -Recurse -Force
```
**改动**：0 行代码——只清理构建缓存
**验收**：`pnpm exec tsc -b packages/tui/tsconfig.json --force` 零 TS5055

### P0-1：ConfirmGate fail-open → fail-closed
**文件**：`packages/scheduler/src/core/confirm-gate.ts:251`
**现状**：`bridge.confirm()` 异常时 `catch { return true }`——放行
**修复**：`catch` 块内 `return false`——拒绝。1 行。
**验收**：无需新测试——逻辑翻转，行为修正

### P0-2：HardVerificationGate 4 规则 fail-open → fail-closed
**文件**：`packages/engine/src/core/hard-verification-gate.ts`
**现状**：barrel-export(L142) / cross-package(L170) / git-diff(L185) / eslint(L203) 在 I/O 失败时 catch 块返回 `passed:true` 或空数组——放行
**修复**：
- barrel-export + cross-package：catch 块返回 `{ passed: false, reason: "I/O 故障: ..." }`
- git-diff + eslint：catch 块返回 `{ passed: false, reason: "命令不可用: ..." }`
**改动**：~15 行
**验收**：`pnpm exec vitest run --no-color` 无新增失败

### P0-3：run-shell 换行符命令注入
**文件**：`packages/platform/src/tools/run-shell.ts:31`
**现状**：元字符正则 `/[;&|\`$(){}<>]/` 不包含 `\n` `\r`
**修复**：正则在末尾加 `\n\r`——`/[;&|\`$(){}<>\n\r]/`
**改动**：4 字符
**验收**：`pnpm exec vitest run --no-color`

### P0-4：符号链接沙箱绕过
**文件**：`packages/platform/src/toolkit.ts:283-294`
**现状**：`_resolvePath` 只用 `path.resolve()`，不解析符号链接的真实路径
**修复**：`path.resolve()` 之后加 `fs.realpathSync.native()` 调用，再和 `workspaceRoot` 比较
**改动**：~5 行
**⚠️ 注意**：`fs.realpathSync.native()` 在文件不存在时抛异常——需 try/catch
**验收**：`pnpm exec vitest run --no-color`

---

## P1——可观测性（本周）

### P1-1：AbstractMemoryStore 接入 PipelineObserver，emit 记忆事件
**文件**：`packages/memory/src/implementations/AbstractMemoryStore.ts`
**现状**：`shared/infra.ts` 定义了 `MemoryPersistFailed` / `MemoryDbWriteFailed` / `MemoryWriteBlocked` / `MemoryFlushSkipped` 四个事件类型，但核心实现中零次 emit
**修复**：
1. 在 `AbstractMemoryStore` 构造函数中加入可选的 `observer?: IPipelineObserver` 参数
2. 在每个 `_be.persist()` 失败处 emit `MemoryPersistFailed`
3. 在 `flushAll` 失败处 emit `MemoryFlushSkipped`
4. 在并发写入被阻塞处 emit `MemoryWriteBlocked`
**改动**：~30 行
**不改**：外部调用方——observer 可选，不传 = 向后兼容
**验收**：写 1 个测试——`write` 模拟 persister 失败 → 断言 `MemoryPersistFailed` 被 emit

### P1-2：FileBackend.load() 区分空存储/索引损坏
**文件**：`packages/memory/src/implementations/FileBasedMemoryStore.ts:85-89`
**现状**：索引文件读取失败（损坏/权限错误）→ 静默从空存储启动——与"首次使用"无法区分
**修复**：
- `catch` 块内：如果文件存在但解析失败 → emit `MemoryDbWriteFailed`（索引损坏）
- 如果文件不存在 → 静默（首次使用）
**改动**：~10 行
**验收**：写 1 个测试——写入损坏的 index.json → 断言 emit `MemoryDbWriteFailed`

### P1-3：plan 模式改为零工具
**文件**：`packages/tui/src/query-loop.ts:237-240`
**现状**：plan 模式过滤了 4 个 L0 只读工具（read_file/list_files/glob_find/search_symbol）
**修复**：plan 模式走 talk/party 路径——空工具数组
```typescript
const tools = mode === "plan" || mode === "talk" || mode === "party" ? [] : rawTools;
```
**改动**：2 行（合并 plan 到已有空工具逻辑）
**验收**：`pnpm exec vitest run --no-color`（已有 plan 模式测试需同步更新期望）

---

## P2——韧性（本周可选）

### P2-1：15 个工具加内部超时
**文件**：`packages/platform/src/tools/` 下全部 15 个无超时工具
**修复**：`ctx.toolTimeouts` 中新增 `defaultMs = 30000`，每个 `LocalTool.execute()` 包装 `Promise.race(timeout)`
**改动**：~50 行，分散在 15 个文件
**优先级**：可选——调度器已有 `NODE_DISPATCH_TIMEOUT_MS` 兜底

### P2-2：query-loop.ts plan→talk→party 空工具路径统一
**文件**：`packages/tui/src/query-loop.ts:237-240`
**现状**：packed into P1-3 above

---

## 不改清单

| 项 | 原因 |
|------|------|
| scheduling-implementations.ts 拆分为 7 文件 | 重构，不改行为——Core-3 |
| TUI `EngineBridge = any` → `ITuiEngineBridge` | 接口契约——Core-3 |
| 20 个静默 catch 全部接入 healthCollector | 需先建 healthCollector——Core-3 |
| governance 测试断言更新 | F2/F3 测试漂移——P2 统一处理 |
| tsup 构建迁移 | 基建——Core-3 |

---

## 验收流程

```powershell
# 每修完一个 P0/P1 项
pnpm exec vitest run --no-color

# 全部修完后
pnpm run lint
pnpm exec vitest run --no-color
pnpm exec tsc -b packages/tui/tsconfig.json --force
```

**验收标准**：vitest 无**新增**失败 + lint 零 error

---

*Edit 修复清单 v1.0。P0 4 项 ~25 行。P1 3 项 ~45 行。不改架构，只补安全兜底和可观测性。*
