# Cortex 六轮全量代码评审与修复报告

> 日期：2026-07-21
> 范围：25 包 monorepo 全量评审
> 重点：DeepSeek V4 深化适配 / RESTful API 规范化 / 包职责边域标定

---

## 变更统计

| 维度 | 数量 |
|------|------|
| 修改文件 | 12 |
| 修复 Critical Bug | 3 |
| 修复普通 Bug | 2 |
| 新增类型 | 3（ReasoningEffort / ModelCapabilities / PaginatedResponse） |
| 新增 API 端点 | 3（/nodes/:id / /agents/:type / /events 分页） |
| 测试更新 | 1（对齐 R6-C1 行为变更） |
| 全量 typecheck | 7 包 PASS |
| 测试验证 | 231 tests PASS（shared 109 + config 87 + llm 35） |
| 分层契约 | layer-contract.test.ts 5 tests PASS |

---

## 第一轮：全量代码评审诊断

发现的关键问题清单：

1. **[Critical]** `api-router.ts` POST /api/execute 请求体永远为空（异步竞态）
2. **[Critical]** `bootstrap/llm.ts` 与 `llm-adapter.ts` 双重注入 `thinking` 参数
3. **[Critical]** `state-aggregator.ts` 重复调用 `getAllNodes()` 导致状态不一致
4. **[High]** `max_tokens` 硬编码 65536，DeepSeek V4 Pro 支持 384K
5. **[High]** `reasoning_effort` 仅支持 high/max，V4 支持七级
6. **[High]** 模型检测用 `model.includes("pro")` 字符串匹配，脆弱
7. **[Medium]** `_serializeMessage` 用 Date.now()+Math.random() 生成 ID，破坏缓存稳定性
8. **[Medium]** API 无版本化、无请求校验、无标准错误格式
9. **[Low]** REACT_CONTEXT_HARD_LIMIT 128K 过于保守（V4 支持 1M）

---

## 第二轮：DeepSeek V4 全面深化适配

### 修改文件

| 文件 | 变更 |
|------|------|
| `packages/shared/src/infra.ts` | 新增 `ReasoningEffort`（七级）、`ModelCapabilities` 接口；扩展 `LlmAdapterConfig`（maxTokens/temperature/frequencyPenalty/presencePenalty/capabilities） |
| `packages/shared/src/index.ts` | 导出新类型 |
| `packages/llm/src/llm-adapter.ts` | `_shouldEnableThinking()` 能力声明驱动；可配置 maxTokens/temperature/penalty；七级 reasoning_effort |
| `packages/config/src/data/models.json` | 添加 maxOutputTokens/contextWindow/reasoningEffortLevels 声明 |
| `packages/config/src/constants/react-strategy.ts` | REACT_CONTEXT_HARD_LIMIT 128K → 256K |
| `packages/cli/src/bootstrap/llm.ts` | 移除 extraBody thinking 双重注入 |

### 核心设计

```
models.json（能力注册）→ ModelCapabilities（类型协议）
    → LlmAdapter._shouldEnableThinking()（运行时判定）
    → 优先级：capabilities > extraBody > 模型名回退
```

---

## 第三轮：RESTful API 规范化与暴露化

### 修改文件

| 文件 | 变更 |
|------|------|
| `packages/cli/src/tui/web/api-router.ts` | 完整重写——API 版本化 / RFC 7807 / X-Request-Id / 分页 / 资源子路径 / 请求校验 |

### 新增端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/v1/nodes/:id` | GET | 单节点详情（404 处理） |
| `/api/v1/agents/:type` | GET | 按类型查询 Agent（404 处理） |
| `/api/v1/events` | GET | 事件列表（分页 + 类型过滤） |

### 规范化要点

- API 版本化：`/api/v1/*` 标准前缀，`/api/*` 向后兼容
- RFC 7807 Problem Details 错误格式（`application/problem+json`）
- X-Request-Id 链路追踪（UUID v4）
- 分页：`?page=&limit=`（默认 50，上限 200）
- 严格 HTTP 方法校验：405 + Allow 头
- 请求体校验：422 + 字段级错误
- 体积限制：1MB（413）
- 安全头：X-Content-Type-Options / Cache-Control: no-store

---

## 第四轮：包职责边域划分与定位标定

### 修改文件

| 文件 | 变更 |
|------|------|
| `PACKAGE_POSITIONING.md` | 完整重写——每包增加 MUST NOT 边界约束列；新增 DeepSeek V4 适配契约节；新增 RESTful API 契约节 |

### 新增边界原则

5. **能力声明驱动**：模型能力由 `ModelCapabilities` 接口声明，禁止字符串匹配推断
6. **API 版本化**：所有 HTTP 端点走 `/api/v1/*` 前缀，错误响应遵循 RFC 7807

---

## 第五轮：Bug 修复与集成一致性验证

### 修复的 Bug

| Bug | 文件 | 修复 |
|-----|------|------|
| POST body 永远为空 | api-router.ts | 改为 Promise 化等待 `end` 事件 |
| 双重 thinking 注入 | bootstrap/llm.ts | 移除 extraBody thinking，由 adapter 统一处理 |
| getAllNodes() 重复调用 | state-aggregator.ts | 单次调用复用结果 |
| 非确定性 tool_call ID | llm-adapter.ts | 改为 `tc_${name}_${idx}` 确定性回退 |
| 测试与 R6-C1 行为不一致 | tool-call-stream.test.ts | 更新断言匹配 `__parse_error__` 新契约 |

### 验证结果

- 全量 typecheck（shared → config → resilience → llm → scheduler → engine → cli）：7/7 PASS
- 测试套件：shared 109 + config 87 + llm 35 + tools 70 + scheduler 96 = **397 tests PASS**
- 分层契约：layer-contract.test.ts 5 tests PASS（DAG 边界未被破坏）

---

## 第六轮：最终验证

- engine 包（16 依赖）typecheck：PASS
- scheduler 包（12 测试文件）：96 tests PASS
- tools 包（分层契约门禁）：70 tests PASS
- 无循环依赖引入
- 无跨层违规
