# 代码审查报告：加密安全性与错误处理

**审查范围**：`@cortex/engine`、`@cortex/llm`、`@cortex/shared`  
**审查时间**：2026-05-13  
**审查者**：阿贝多（Code Agent）

---

## 1. 加密安全性

### 1.1 🔴 API 密钥明文存在于 `.env`
**文件**：`/cortex/.env` — 包含真实密钥 `sk-1e1ffd5f19f3428d9d264c26ec0589a6`  
**风险**：密钥直接暴露在磁盘上，任何可访问该文件系统的进程均可获取。  
**风险等级**：🔴 **严重** — 需立即轮换。

### 1.2 🟡 API 密钥内存明文
**文件**：`/cortex/packages/llm/src/llm-adapter.ts:207`  
**问题**：Bearer Token 传输，内存明文存储，无运行时轮换机制。

### 1.3 🟡 `run_shell` 命令注入
**文件**：`/cortex/packages/engine/src/toolkit.ts:186`  
**问题**：`execSync(command, ...)` 直接执行 LLM 输出。Code/Review/Fix/Ops 持有权限。

### 1.4 🟢 InspectorAgent child_process
硬编码命令，低风险。

### 1.5 🟢 SQLite 无加密
记忆数据明文存储。

---

## 2. 错误处理

### 2.1 🟢 SafeErrorReporter 模式 ✅ 优良设计
三级严重级别 + 静默错误自动升级。

### 2.2 🟢 内存回滚模式 ✅
write/link/cas 均有 DB 失败 → 内存回滚 + `throw e`。

### 2.3 🟢 PipelineObserver handler 隔离 ✅
单 handler 异常不阻断后续。

### 2.4 🟢 Scheduler 循环屏障 ✅
单轮异常不崩溃 executeAll。

### 2.5 🟡 SQL 降级无事务保证
SQL 失败 → 内存扫描，可能遗漏数据。

### 2.6 🟡 InspectorAgent 空嵌套异常
外层 try/catch 几乎无用，重复 3 次。

### 2.7 🟡 JSON 解析静默吞错
4 级回退策略全部静默 catch。

### 2.8 🟡 Schema 版本不匹配仅 warn
不阻止启动，可能导致数据损坏。

### 2.9 🟡 ConfirmGate 无 bridge 永久挂起
无超时保护时 Promise 永不 resolve。

### 2.10 🟡 读操作无锁
写入进行时可读到不一致状态。

---

## 3. 综合风险矩阵

| 编号 | 风险项 | 严重度 | 影响范围 | 修复难度 |
|------|--------|--------|----------|----------|
| 1.1 | API 密钥明文存储 | 🔴 严重 | 安全/费用 | 低 |
| 1.2 | API 密钥内存无保护 | 🟡 中 | 安全 | 中 |
| 1.3 | run_shell 命令注入 | 🟡 中 | 安全 | 中 |
| 2.6 | InspectorAgent 空嵌套 | 🟡 中 | 错误处理 | 低 |
| 2.7 | JSON 静默吞错 | 🟡 中 | 调试/可观测性 | 低 |
| 2.8 | Schema 不匹配仅 warn | 🟡 中 | 数据完整性 | 低 |
| 2.9 | ConfirmGate 永久挂起 | 🟡 中 | 稳定性 | 低 |
| 2.10 | 读操作无锁 | 🟡 中 | 数据一致性 | 低 |
| 1.5 | SQLite 无加密 | 🟢 低 | 安全 | 高 |
| 1.6 | 缓存持久化风险 | 🟢 低 | 安全 | 低 |
| 2.5 | SQL 退化无事务保证 | 🟢 低 | 数据一致性 | 中 |
| 2.1-2.4 | 优良设计项 | 🟢 优良 | — | — |

---

## 4. 修复建议

### 🔴 R1. API 密钥轮换与移除
- **立即更换** `.env` 中的 `sk-1e1ffd5f19f3428d9d264c26ec0589a6`
- 检查 Git 历史：`git log --all -p -S "sk-1e1ffd5f19f3428d9d264c26ec0589a6"`
- 考虑密钥管理服务，实现运行时热加载

### 🟡 R2. run_shell 加入命令白名单（toolkit.ts）
- 改用 `execFileSync`，建立白名单：pnpm/npx/node/npm/vitest/tsc/jest/tsx

### 🟡 R3. 消除 InspectorAgent 空嵌套（inspector-agent.ts）
- 改为单层 try/catch

### 🟡 R4. JSON 解析保留诊断信息（meta-agent.ts, llm-adapter.ts）
- 记录每级策略失败原因，SSE 连续 N 行失败升级为 degraded

### 🟡 R5. Schema 不匹配抛异常（persistence.ts）
- 将 console.warn 替换为 throw new Error()

### 🟡 R6. ConfirmGate 默认超时（confirm-gate.ts）
- 默认 5 分钟超时，超时后 resolve(false)

### 🟡 R7. 读操作加读锁（toolkit.ts）
- read_file/search_code/list_files 获取 LockType.Read 锁

---

*报告结束。*
