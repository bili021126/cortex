# Cortex 标准化检查清单

> 每次代码变更必须通过以下检查。

## 提交前（pre-commit）

- [ ] `npx tsc -b packages/engine/tsconfig.src.json --force` — 零错
- [ ] `npx vitest run --no-color` — 零失败
- [ ] `npx eslint packages/engine/src --max-warnings 999` — 零 error

## 新增文件

- [ ] `@ci: unit|llm|integration|e2e|manual` 标签
- [ ] `@covers` / `@e2e` / `@since` 注释（E2E 必须）
- [ ] 零 `as any`（生产代码）
- [ ] 零 `!` 非空断言
- [ ] JSON.parse 必须有 try-catch
- [ ] console.log 必须有 `[telemetry]` 前缀或 `// eslint-disable-next-line`
- [ ] try-catch 必须有 observer.emit 或诊断日志
- [ ] TUI 三原则：无阻塞确认（L0/L1）、批量操作合并、输出流优先

## 类型更新联动

- [ ] 新增 MemState/Event → 同步更新 defineFsm 定义
- [ ] 新增 AgentType → 更新 agents.json + agent-registry.ts
- [ ] 新增 PipelineEventType → 更新 EventPayloadMap

## 架构约束

- [ ] core/ 不引用 execution/ 或 planning/
- [ ] memory-bridge/ 不反向引用 core/
- [ ] shared 不引用 config
- [ ] 状态变更走 observer.emit

## E2E

- [ ] push: core-smoke 通过
- [ ] PR: +memory-write + skill-e2e 通过
- [ ] 新 E2E 有 @covers 注释

## PR 审批

- [ ] CI 全绿（tsc + vitest + lint）
- [ ] 无新增 P0
- [ ] 无新增预存 flaky
- [ ] 包定位文档更新（如涉及新包）
