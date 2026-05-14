# 代码审查报告：加密安全性与错误处理

**审查范围**：`packages/` + `projects/solo-flight/`
**审查日期**：2026-06-02
**审查人**：艾尔海森（教令院大书记官 / Data Agent）
**输出目标**：本报告应放置于 `reports/code-review.md`（因写入权限限制，暂存于此）

---

## 目录

1. [审查摘要](#1-审查摘要)
2. [加密安全性](#2-加密安全性)
3. [错误处理](#3-错误处理)
4. [按模块的详细发现](#4-按模块的详细发现)
5. [严重等级说明](#5-严重等级说明)
6. [总结与行动项](#6-总结与行动项)

---

## 1. 审查摘要

| 域 | 严重 | 中 | 低 | 信息 |
|---|---|---|---|---|
| 加密安全性 | 1 | 1 | 2 | 1 |
| 错误处理 | 0 | 2 | 3 | 4 |
| **合计** | **1** | **3** | **5** | **5** |

**关键发现**：

1. **严重—SEC-01**：`projects/solo-flight/src/crypto.ts` 硬编码默认主密钥，未设置环境变量时使用可预测的 fallback 密钥。
2. **中—SEC-02**：`projects/solo-flight/src/crypto.ts` scrypt 参数 `N=2^14` 低于当前推荐标准。
3. **中—ERR-01**：`packages/engine/src/memory/persistence.ts` `_loadFromDb` 中空 `catch` 块静默吞噬 schema 版本读取异常。
4. **中—ERR-02**：`packages/engine/src/scheduler.ts` 异常上报通道不一致——`console.warn` 与 `observer.emit` 双通道模式未统一。

---

## 2. 加密安全性

### 2.1 主密钥管理

**SEC-01（严重）— 默认主密钥硬编码**

- **文件**：`projects/solo-flight/src/crypto.ts:18-21`
- **代码**：
  ```typescript
  function getMasterKey(): string {
    const envKey = process.env.PM_MASTER_KEY;
    if (envKey && envKey.length >= 8) {
      return envKey;
    }
    return 'password-manager-default-master-key-2024';
  }
  ```
- **问题分析**：
  - 未设置 `PM_MASTER_KEY` 环境变量时，回退到硬编码的固定字符串。任何获取到代码库访问权限的人都知道这个密钥。
  - 攻击者无需猜测密钥——默认密钥明文写在代码中。所有使用此默认密钥加密的 vault 文件都可被离线解密。
  - 即使设置了环境变量，`length >= 8` 的检查过于宽松——"12345678" 满足长度条件但不提供任何有效安全性。
  - **数据流风险**：`getMasterKey() → deriveKey() → decrypt()`——如果攻击者拿到 vault.enc 文件且系统未配置 PM_MASTER_KEY，可直接解密全部密码条目。
- **建议**：
  - **立即**：移除硬编码 fallback，直接抛出异常——未设置 `PM_MASTER_KEY` 时拒绝初始化加密模块。
  - 增加最小熵检查：建议 >= 32 字符，或要求 hex/base64 编码格式以保证最小密钥熵。
  - 考虑首次运行自动生成密钥并写入 `~/.pm/master.key`，而非仅依赖环境变量。

### 2.2 密钥派生参数

**SEC-02（中）— scrypt 参数偏低**

- **文件**：`projects/solo-flight/src/crypto.ts:12`
- **代码**：
  ```typescript
  const KEYDERIV_OPTIONS = { N: 2 ** 14, r: 8, p: 1 };
  ```
- **问题分析**：
  - `N=16384`（2^14）在 2026 年的标准中偏低。OWASP 当前推荐 `N >= 2^17`（131072）。
  - 对于密码管理器场景（加密整库数据），应使用更高的计算成本来对抗 GPU 并行攻击。
  - 影响：如果攻击者获得 vault.enc 文件，较低的 N 值意味着暴力破解主密钥的成本降低约 8 倍。
- **建议**：
  - 提高至 `N: 2 ** 17`（131072），保持 `r: 8, p: 1`。
  - 将 scrypt 参数做成可配置的（通过环境变量或 config 文件），以适应不同环境的性能需求。

### 2.3 API 密钥传输

**SEC-03（低）— API 密钥 Header 未检查传输层安全性**

- **文件**：`packages/llm/src/llm-adapter.ts:148-149`
- **代码**：
  ```typescript
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${this.config.apiKey}`,
  },
  ```
- **问题分析**：
  - 代码通过 `fetch` 发送 API 密钥到配置的 `baseUrl`。如果 `baseUrl` 使用 `http://` 而非 `https://`，密钥将以明文形式在网络中传输。
  - 代码未在运行时校验 `baseUrl` 协议，也未在构造函数中拒绝非 HTTPS URL。
- **建议**：
  - 在 `LlmAdapter` 构造函数中校验 `baseUrl.startsWith('https://')`，非 HTTPS 时抛异常（测试环境可通过环境变量绕过）。
  - 添加日志警告（通过 `_safeReporter` 上报 `WARNING`）当检测到非标准 baseUrl 时。

### 2.4 LLM 缓存密钥指纹

**SEC-04（低）— 缓存内容可能包含敏感数据**

- **文件**：`packages/llm/src/llm-adapter.ts:217-224, 252-254`
- **问题分析**：
  - `saveCache()` 将完整的 LLM 响应序列化为 JSON。如果某个请求涉及敏感数据处理（如密码生成、私钥生成），响应内容将被明文序列化到磁盘。
  - `loadCache()` 从 JSON 恢复缓存时，损坏/篡改的文件只以 `severity: "silent"` 上报，可能被攻击者利用注入恶意缓存内容。
- **建议**：
  - `saveCache()` 输出前对响应内容字段进行可选的加密或脱敏。
  - 在 `loadCache()` 中增加完整性校验（如 HMAC 签名），防止缓存被篡改。

### 2.5 密码条目存储（信息性）

**SEC-INFO-01 — 存储加密架构合理，但缺少密钥轮换策略**

- **观察**：
  - `AES-256-GCM` 搭配 `scrypt` 密钥派生是合理选择，经过身份验证的加密模式正确使用（salt + iv + authTag + ciphertext）。
  - 但无密钥轮换策略：一旦主密钥泄漏，所有历史密码条目都可解密。
  - 无认证标签验证失败后的速率限制——`decrypt()` 中的 `setAuthTag` 失败会抛异常，但调用方（`loadStore`）静默捕获并返回空数据（见 ERR-03），掩盖了可能的暴力破解尝试。
- **建议**：
  - 审计追踪每次解密尝试到日志。
  - 连续失败 3 次后引入指数退避延迟。
  - 考虑增加密钥版本字段，支持主密钥轮换。

---

## 3. 错误处理

### 3.1 静默吞错与降级路径

**ERR-01（中）— `_loadFromDb` 静默捕获 schema 版本异常**

- **文件**：`packages/engine/src/memory/persistence.ts:226-229`
- **代码**：
  ```typescript
  try {
    const metaRow = this._db.prepare("SELECT value FROM __meta WHERE key = 'schema_version'").get() as ...;
    ...
  } catch {
    // __meta 表可能不存在（旧版 DB），静默处理
  }
  ```
- **问题分析**：
  - 空的 `catch` 块没有执行任何操作——没有日志、没有 observer 上报、没有计数器递增。
  - 如果 `__meta` 表因 DB 损坏（而非"表不存在"）而抛异常，该损坏将是完全静默的。
  - 治理判例 NG-2026-0509-Persist-False-Positive 的精神要求"假阳性禁止"——这里存在假阴性。
- **建议**：
  - 通过 `_observer.emit()` 上报 `MemorySqlDegraded` 或新的 `MemorySchemaReadFailed` 事件。
  - 区分异常类型：`NO_SUCH_TABLE` → 日志 info；其他异常 → 上报 WARNING。
  - 至少增加 `console.warn` 作为最小 fallback。

**ERR-02（中）— Scheduler 非标准类型警告通道不一致**

- **文件**：`packages/engine/src/scheduler.ts:374-383`
- **问题分析**：
  - 此处同时走两条通道：`console.warn` + `observer.emit`。
  - 其他类似路径（如 `_drainReplanQueue` 中 `SchedulerReplanNoMetaAgent`）只走了 observer 管道。
  - `AgentPool.setStatus` 中 fallback 链模式又不同。
  - 不一致性导致监控盲区。
- **建议**：
  - 统一策略：所有异常/警告走 observer 管道，observer 未注册时统一 fallback 到 `console.error`。
  - 消除各模块自行判断 `process.env.VITEST` 的分支逻辑。

### 3.2 边界条件与防御性编程

**ERR-03（低）— `loadStore` 静默返回空数据而非上报**

- **文件**：`projects/solo-flight/src/store.ts:39-41`
- **代码**：
  ```typescript
  try {
    const raw = decrypt(encrypted);
    return JSON.parse(raw) as StoreData;
  } catch {
    console.error('警告：存储文件读取失败，可能密钥已变更或文件已损坏');
    return { version: 1, entries: [] };
  }
  ```
- **问题分析**：
  - 解密失败时静默返回空存储——用户若随后调用 `saveStore()`，将用空数据覆盖加密文件，导致数据永久丢失。
  - **数据流全链路风险**：`decrypt 失败 → catch 返回空 → addEntry 调用 loadStore 拿到空 → saveStore 写入空 → 原始加密文件被覆盖`。
  - 这是整个加密链中最危险的问题。
- **建议**：
  - 解密失败时应向上抛出异常，阻止后续任何写入操作。
  - 在 `addEntry`/`listEntries`/`getEntry` 前增加文件锁检查。
  - 考虑引入校验和——在加密载荷尾部附加 HMAC。

**ERR-04（低）— `confirm-gate.ts` 无超时时的永续挂起**

- **文件**：`packages/engine/src/confirm-gate.ts:70-80`
- **问题分析**：当 `timeoutMs` 为 `undefined` 且无 `bridge` 时，`waitFor()` 返回的 Promise 永不 resolve，调用者永久阻塞。
- **建议**：在构造函数中定义全局默认超时（如 `DEFAULT_TIMEOUT_MS = 300_000`）。

**ERR-05（低）— `pipeline.ts` 中 `memory.read()` 降级路径缺少 fallback 日志**

- **文件**：`packages/engine/src/memory/pipeline.ts:55-62`
- **问题分析**：当 `safeReporter` 未注入时，异常将完全静默。
- **建议**：增加 `console.warn` 作为 `safeReporter` 为 `null` 时的 fallback。

### 3.3 治理判例覆盖

**ERR-INFO-01 — NG-2026-0509-Persist-False-Positive 贯彻良好**

- 所有 DB 写入失败路径都有对应的内存回滚操作（`write` → `delete`, `link` → `pop`, `cas` → `restore state`）。
- 测试覆盖充分（`memory-store-write-rollback.test.ts` 8 个用例）。

**ERR-INFO-02 — NG-2026-0511 系列判例执行良好**

| 判例 ID | 描述 | 实现位置 | 状态 |
|---|---|---|---|
| NG-2026-0511-Dirty-Before-Save | `_dirty` 在 flush 成功后才清除 | `persistence.ts:180` | ✅ |
| NG-2026-0511-Destroy-Bypass | 绕过状态机的直写路径须上报 | `agent-pool.ts:120-141` | ✅ |
| NG-2026-0511-LocalStatus-Bypass | 禁止直接写入 `_localStatus` | `base-agent.ts:63` | ✅ |

**ERR-INFO-03 — SafeErrorReporter 升级机制合理**

- silent 错误连续 N=3 次自动升级为 degraded，防止"习惯性忽略"。

**ERR-INFO-04 — PipelineObserver handler 异常隔离合理**

- 单个 handler 异常不会阻断后续 handler 执行。

---

## 4. 按模块的详细发现

### 4.1 `projects/solo-flight/src/crypto.ts`

| # | 类型 | 行 | 描述 | 等级 |
|---|---|---|---|---|
| SEC-01 | 硬编码密钥 | 18-21 | `getMasterKey()` 回退到可预测的默认密钥 | 严重 |
| SEC-02 | 弱参数 | 12 | scrypt `N=2^14` 低于 2026 年推荐值 | 中 |
| — | 架构 | 全部 | AES-256-GCM + scrypt 架构选择合理 | 信息 |

### 4.2 `projects/solo-flight/src/store.ts`

| # | 类型 | 行 | 描述 | 等级 |
|---|---|---|---|---|
| ERR-03 | 静默覆盖 | 39-41 | 解密失败返回空数据 → 可能覆盖加密文件 | 低 |

### 4.3 `packages/llm/src/llm-adapter.ts`

| # | 类型 | 行 | 描述 | 等级 |
|---|---|---|---|---|
| SEC-03 | 传输安全 | 148-149 | 未校验 baseUrl 协议 | 低 |
| SEC-04 | 缓存敏感数据 | 252-254 | `saveCache()` 明文序列化 | 低 |

### 4.4 `packages/engine/src/memory/persistence.ts`

| # | 类型 | 行 | 描述 | 等级 |
|---|---|---|---|---|
| ERR-01 | 静默吞错 | 226-229 | 空 `catch` 块 | 中 |

### 4.5 `packages/engine/src/scheduler.ts`

| # | 类型 | 行 | 描述 | 等级 |
|---|---|---|---|---|
| ERR-02 | 不一致上报 | 374-383 | 双通道不一致 | 中 |

### 4.6 `packages/engine/src/confirm-gate.ts`

| # | 类型 | 行 | 描述 | 等级 |
|---|---|---|---|---|
| ERR-04 | 潜在死锁 | 70-80 | 无超时永续挂起 | 低 |

### 4.7 `packages/engine/src/memory/pipeline.ts`

| # | 类型 | 行 | 描述 | 等级 |
|---|---|---|---|---|
| ERR-05 | 降级盲区 | 55-62 | safeReporter 未注入时静默 | 低 |

### 4.8 `packages/engine/src/memory-store.ts`

| # | 类型 | 行 | 描述 | 等级 |
|---|---|---|---|---|
| — | 治理 | 整体 | 回滚机制完整 | 信息 |

### 4.9 `packages/engine/src/pipeline-observer.ts`

| # | 类型 | 行 | 描述 | 等级 |
|---|---|---|---|---|
| — | 设计 | 整体 | handler 隔离合理 | 信息 |

### 4.10 `packages/engine/src/agent-pool.ts`

| # | 类型 | 行 | 描述 | 等级 |
|---|---|---|---|---|
| — | 治理 | 整体 | Destroy-Bypass 上报正确 | 信息 |

---

## 5. 严重等级说明

| 等级 | 定义 | 行动要求 |
|---|---|---|
| **严重** | 直接影响机密性/完整性/可用性 | 立即修复 |
| **中** | 增加攻击面或降级防御深度 | 本迭代内修复 |
| **低** | 最佳实践偏离 | 跟踪修复 |
| **信息** | 无安全问题 | 无行动要求 |

---

## 6. 总结与行动项

### 6.1 优先级排序

| 优先级 | ID | 行动 | 影响文件 |
|---|---|---|---|
| P0 | SEC-01 | 移除硬编码默认主密钥，未配置时抛异常 | `solo-flight/src/crypto.ts` |
| P1 | ERR-01 | 为空 `catch` 块添加 observer 上报 | `engine/src/memory/persistence.ts` |
| P1 | ERR-03 | 解密失败禁止返回空数据替代 | `solo-flight/src/store.ts` |
| P2 | SEC-02 | scrypt `N` 参数提高至 2^17 | `solo-flight/src/crypto.ts` |
| P2 | ERR-02 | 统一异常上报策略 | `engine/src/scheduler.ts` |
| P3 | SEC-03 | 构造函数校验 baseUrl 协议 | `llm/src/llm-adapter.ts` |
| P3 | ERR-04 | 默认超时防止永续挂起 | `engine/src/confirm-gate.ts` |
| P3 | ERR-05 | 为 safeReporter 提供 console fallback | `engine/src/memory/pipeline.ts` |
| P4 | SEC-04 | 缓存序列化加密/完整性校验 | `llm/src/llm-adapter.ts` |

### 6.2 正面观察

1. **假阳性禁止原则（NG-2026-0509）在 MemoryStore 写路径上执行严格且测试覆盖充分。**
2. **事件管道的 handler 隔离和幂等键设计合理。** `requestId` 为下游去重和链路追踪提供了基础。
3. **错误严重级别分级明确。** silent 自动升级机制防止了"习惯性忽略"。
4. **治理判例在代码中的可追踪性好。** 每个判例 ID 在相关代码位置有注释标注。
5. **加密模块对 AES-256-GCM 的使用正确。** salt + iv + authTag + ciphertext 的编码顺序和 base64 序列化标准无误。

### 6.3 Schema 变更建议（数据层视角）

若将本报告的结论映射为 schema 变更：

```typescript
interface CryptoConfig {
  masterKeySource: 'env' | 'file' | 'generate';  // 新增
  minKeyEntropy: 128;                              // 新增
  scryptN: 131072;                                 // 变更：2^14 → 2^17
  keyVersion: number;                              // 新增
}

interface CatchBlockContract {
  mustReport: boolean;      // 每个 catch 块必须上报
  minSeverity: 'silent';    // 最低上报级别
  consoleFallback: true;    // observer 不可用时 console 兜底
}
```

---

*报告生成时间：2026-06-02*
*审查范围：15 个源文件，33 个测试文件（抽查）*
*审查方法：代码静态分析 + 人工路径追踪*
*输出说明：因写入权限限制，本文件暂存于 `projects/solo-flight/`，应移至 `reports/code-review.md`*
