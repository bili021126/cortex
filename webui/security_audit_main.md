# ⚖️ 天权裁定：packages/cli/src/main.ts 安全审计报告

**审计日期**：2026-06-11  
**审计人**：凝光（DocGovernAgent）  
**审计范围**：`packages/cli/src/main.ts`  
**关联判例**：NG-2026-0515-Self-Modification、NG-2026-0606-SelfRef-Gap  
**宪法版本**：v2.5.16  

---

## 裁定摘要

| 审计维度 | 判定 | 最严重发现 |
|---------|:----:|-----------|
| 合规性（Compliance） | ❌ **未通过** | 违反原则五——所有可观测事件未走 PipelineObserver |
| 一致性（Consistency） | ⚠️ 有保留通过 | CLI 设计文档引用缺失、参数解析逻辑含潜在缺陷 |
| 完整性（Completeness） | ❌ **未通过** | 环境变量注入无白名单约束、路径越界防护缺失、API Key 暴露风险 |

**综合裁定**：❌ **未通过**。须修复 P0 违规项后方可进入下一阶段。

---

## 审计一：合规性（Compliance）

### 依据条款

| 条款 | 内容 | 等级 |
|------|------|:----:|
| 原则一 | 确认动作永远在用户手里。任何 L2/L3 不可逆操作必须经用户确认 | 不可变 |
| 原则三 | 安全边界在 Toolkit 调用层。Toolkit 按 Agent 类型集中校验权限 | 不可变 |
| 原则五 | 所有可观测事件走 PipelineObserver 统一管道，杜绝静默吞错 | 不可变 |
| §7.5 | L0 工具在非隔离部署（CLI/管家/Electron）中须实施路径越界防护——白名单制，默认拒绝越界访问 | 宪法级 |
| §14 | 编译时治理——`no-console` warn，console.log/warn/error 绕过统一管道，不允许 | 工程化强制 |

---

### 发现 C-01 🔴 高：违反原则五 —— console.* 直接输出代替 PipelineObserver

**位置**：main.ts L141–L147（catch 块）、L165–L175（outputResult）、L186–L190（顶级 catch）

**代码**：
```typescript
// L141-147
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`✗ 未预期错误: ${msg}`);
  return 8;
}

// L165-175
function outputResult(result: CommandResult, format: OutputFormat): void {
  const fmt = getFormatter(format);
  if (result.success) {
    console.log(fmt.formatSuccess(result));
  } else {
    console.error(fmt.formatError(result));
  }
}

// L186-190
main().then((code) => {
  process.exit(code);
}).catch((err) => {
  console.error(`✗ 致命错误: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(8);
});
```

**违规分析**：
- 原则五要求"所有可观测事件走 PipelineObserver 统一管道"
- §14 编译时治理将 `no-console` 设为 warn，确认 console.* 绕过统一管道
- 三处 console.error 和一处 console.log 均直接写入 stdout/stderr，未经过 PipelineObserver
- 错误信息既不入 SafeErrorReporter 的三档语义（fatal/degraded/silent），也不入通知管线的三轨分层（FYI/WARNING/DECISION_REQUIRED）

**合规依据**：原则五（不可变）、§14 编译时治理

---

### 发现 C-02 🔴 高：违反原则三 + §7.5 —— 路径越界防护缺失

**位置**：main.ts L48（loadEnv 使用 process.cwd()）、L30–L43（loadEnv 直接使用 node:fs）

**代码**：
```typescript
function loadEnv(projectRoot: string): void {
  const envPath = nodePath.join(projectRoot, ".env");  // 无路径规范化
  if (!nodeFs.existsSync(envPath)) return;
  const content = nodeFs.readFileSync(envPath, "utf-8");  // 绕过 Toolkit
  ...
}

loadEnv(process.cwd());  // projectRoot 未经越界检查
```

**违规分析**：
- §7.5 明确规定 CLI 作为非隔离部署，L0 操作必须实施白名单路径越界防护
- `projectRoot` 直接采用 `process.cwd()`，未经过 `path.resolve` 规范化，未做白名单校验
- 若当前工作目录通过符号链接或 `..` 构造，`.env` 的读取路径可越界至任意系统目录
- `node:fs.readFileSync` 直接调用文件系统，绕过了 Toolkit 的安全边界（原则三）
- §7.5 引用的闭环协作实验已实证 Agent 可通过 `..` 穿出 PROJECT_DIR

**合规依据**：§7.5（v2.5.8 新增）、原则三（不可变）

---

### 发现 C-03 🟡 中：违反原则一 —— ConfirmGate 配置不完整

**位置**：main.ts L52–L65（LLM 配置段）

**代码**：
```typescript
const toolkit = new Toolkit();
engineBridge.setBootstrapConfig({
    llm,
    toolkit,
    projectRoot: process.cwd(),
});
```

**违规分析**：
- 原则一要求 L2/L3 不可逆操作必须经用户确认
- `new Toolkit()` 使用默认构造，未显式传入 ConfirmGate 实例或超时策略
- engineBridge 的轻量模式（ensureInitialized）中 ConfirmGate 虽有创建，但未配置超时默认行为
- 宪法 §7.2 要求 L2/L3 超时阻塞等待（不替用户决策），L1 超时默认拒绝——这些策略在 main.ts 入口未显式配置

**合规依据**：原则一（不可变）、§7.2

---

### 发现 C-04 🟡 中：违反 §14 编译时治理 —— 直接使用 node:fs 绕过程序安全层

**位置**：main.ts L17–L18（import）

**代码**：
```typescript
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
```

**违规分析**：
- CLI 入口可直接使用 `node:fs` 和 `node:path` 属于设计允许（启动阶段），但 `loadEnv` 和 `ConfigManager` 的文件读取操作未经过任何安全校验层
- 没有文件大小限制、没有编码校验、没有路径白名单
- 与宪法 §7.5 要求的"白名单制、默认拒绝越界访问"精神不符

**建议**：至少在启动路径上添加路径白名单校验，或将 .env 读取委托给安全层

---

## 审计二：一致性（Consistency）

### 发现 S-01 🟢 低：CLI 设计文档引用缺失

**位置**：main.ts L4

**代码**：
```typescript
/**
 * main.ts — Cortex CLI 统一入口
 *
 * @see CLI 设计文档 v0.2
```

**分析**：
- 文档头引用了 `CLI 设计文档 v0.2`，但在 `docs/` 目录下未找到此文档
- 审计时搜索 `packages/` 和 `docs/`，均未发现该设计文档
- 该引用无法溯源，不符合宪法 §15 修正记录的可追溯要求

**裁定**：文档引用断裂。建议补充 CLI 设计文档或修正引用路径。

---

### 发现 S-02 🟡 中：--format 参数解析逻辑含残留值风险

**位置**：main.ts L107–L123

**代码**：
```typescript
const cleanArgs = argv.filter((a) =>
  !["--quiet", "-q", "--verbose", "-v", "--no-color"].includes(a) &&
  !a.startsWith("--format=") && a !== "--format" && a !== "-f"
);

const fmtIdx = cleanArgs.indexOf("--format");
if (fmtIdx !== -1) {
  cleanArgs.splice(fmtIdx, 2);
}
const shortFmtIdx = cleanArgs.indexOf("-f");
if (shortFmtIdx !== -1) {
  cleanArgs.splice(shortFmtIdx, 2);
}
```

**分析**：
1. 先过滤掉 `--format` 字符串，再在 cleanArgs 中 splice——如果 `--format` 的值恰为 `--quiet`，则该值先被过滤掉，splice 时移除的是错误的值
2. 两次 splice 操作未考虑索引偏移——第一次 splice 后数组长度改变，第二次 indexOf 可能找到错误位置
3. `--format=json` 形式被 `!a.startsWith("--format=")` 过滤掉了，但与 `--format json`（空格分隔）的处理逻辑不一致

**裁定**：参数解析逻辑存在竞态残留风险，建议统一使用选项解析器（如 `_parseOptions`）替代手动 splice。

---

### 发现 S-03 🟢 低：全局选项 -v 与 --verbose 冲突

**位置**：main.ts L104

**代码**：
```typescript
const globalVerbose = argv.includes("--verbose") || argv.includes("-v");
```

**分析**：
- `-v` 被定义为 `--verbose` 的短别名
- 但 `version` 命令的别名也是 `-v`（见 L149: `alias: "v"`）
- 在 main.ts 中，如果输入 `cortex -v`，会先匹配到 `--version` 检查（L94），不会走到全局选项解析
- 但在全局选项解析中 `-v` 又被当作 `--verbose`，语义不一致
- 若用户输入 `cortex config -v`，预期是 version 但可能被解析为 verbose
- 实际上由于早期 return，`cortex -v` 不会到达此处，但作为设计文档一致性检查，别名冲突应记录

**裁定**：别名设计存在歧义风险，建议将 version 的短别名改为 `-V`（大写），与 `--version` 对应。

---

## 审计三：完整性（Completeness）

### 发现 I-01 🔴 高：环境变量注入无白名单约束

**位置**：main.ts L30–L43（loadEnv）

**代码**：
```typescript
function loadEnv(projectRoot: string): void {
  const envPath = nodePath.join(projectRoot, ".env");
  if (!nodeFs.existsSync(envPath)) return;
  const content = nodeFs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
```

**漏洞分析**：
1. **无 key 白名单**：任意环境变量名均可被写入 `process.env`，包括 `PATH`、`LD_PRELOAD`、`NODE_OPTIONS` 等敏感变量
2. **只覆盖未设置值**：`if (!process.env[key])` 策略可防止已存在环境变量被覆盖，但无法阻止恶意 `.env` 文件注入新变量
3. **`NODE_OPTIONS` 风险**：若 `.env` 中包含 `NODE_OPTIONS=--experimental-loader=malicious.js`，Node.js 进程行为可被劫持
4. **值未转义**：值直接原样注入，若包含 shell 特殊字符，在后续调用 `run_shell` 时可能被利用
5. **文件读取无大小限制**：大文件可能造成内存压力

**攻击向量**：
```
# 恶意 .env 文件
NODE_OPTIONS=--require=./malicious.js
DEEPSEEK_API_KEY=sk-1234
CORTEX_CLI_DEFAULT_FORMAT=json
```

**裁定**：需至少实施白名单机制——只允许写入 `CORTEX_*`、`DEEPSEEK_*` 前缀的环境变量。

---

### 发现 I-02 🟡 中：API Key 暴露风险

**位置**：main.ts L55–L65

**代码**：
```typescript
if (process.env.DEEPSEEK_API_KEY) {
  const llm = new LlmAdapter({
    apiKey: process.env.DEEPSEEK_API_KEY,
    ...
  });
```

**漏洞分析**：
- API Key 从环境变量读取后直接传递给 LlmAdapter
- 若 `console.error` 输出的错误信息包含 `process.env` 的内容（如通过 `String(err)` 间接暴露），API Key 可能泄漏到日志文件或终端
- 在 L141 的 catch 块中，错误信息通过 `console.error` 输出到 stderr
- LlmAdapter 构造函数调用若抛出异常（如无效 API Key 格式），错误消息可能包含 key 片段
- 无运行时 mask/脱敏机制

**裁定**：建议在日志输出中对 API Key 进行脱敏处理（如 `sk-****1234`），或确保错误路径不暴露凭据。

---

### 发现 I-03 🟡 中：process.exit() 可能导致资源泄漏

**位置**：main.ts L186–L190

**代码**：
```typescript
main().then((code) => {
  process.exit(code);
}).catch((err) => {
  console.error(`✗ 致命错误: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(8);
});
```

**漏洞分析**：
- `process.exit()` 强制终止进程，不等待 pending 的异步操作完成
- `main()` 函数中的 `finally` 块调用 `engineBridge.shutdown()`，但 `.then()` 中的 `process.exit()` 可能在 shutdown 完成前触发
- 若 EngineBridge 正在刷新 MemoryStore 写入（SQLite WAL flush），强行退出可能导致数据丢失
- 违反宪法 §9.3 委托模式安全写架构中"DB 故障时内存回滚"的保障前提——写入未完成就被截断

**裁定**：建议使用 `process.exitCode = code` 替代 `process.exit(code)`，让 Node.js 自然完成 pending 操作后退出。

---

### 发现 I-04 🟢 低：未使用 SafeErrorReporter 三档语义

**位置**：main.ts L141–L147（catch 块）

**代码**：
```typescript
catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`✗ 未预期错误: ${msg}`);
  return 8; // 内部错误
}
```

**漏洞分析**：
- 错误未分类为 fatal/degraded/silent
- 错误未通过 SafeErrorReporter 上报
- 错误信息不入 PipelineObserver，下游监控无法感知
- 宪法 §8.1 要求"杜绝静默吞错"，但这里的错误虽非静默，却绕过了统一管道

**裁定**：启动阶段的错误至少应通过 observer.emit 以 CRITICAL 优先级上报。

---

## 四、综合风险矩阵

| ID | 发现 | 维度 | 等级 | 宪法依据 | 修复难度 |
|:--:|------|:----:|:----:|---------|:-------:|
| C-01 | console.* 代替 PipelineObserver | 合规 | 🔴 高 | 原则五、§14 | 中 |
| C-02 | 路径越界防护缺失 | 合规 | 🔴 高 | §7.5、原则三 | 低 |
| I-01 | 环境变量注入无白名单 | 完整 | 🔴 高 | — | 低 |
| C-03 | ConfirmGate 配置不完整 | 合规 | 🟡 中 | 原则一、§7.2 | 低 |
| C-04 | 直接使用 node:fs 无校验 | 合规 | 🟡 中 | §7.5 精神 | 低 |
| S-02 | --format 参数解析缺陷 | 一致 | 🟡 中 | — | 低 |
| I-02 | API Key 暴露风险 | 完整 | 🟡 中 | — | 低 |
| I-03 | process.exit() 资源泄漏 | 完整 | 🟡 中 | §9.3 | 低 |
| S-01 | CLI 设计文档引用缺失 | 一致 | 🟢 低 | — | 低 |
| S-03 | 别名冲突（-v） | 一致 | 🟢 低 | — | 低 |
| I-04 | 未使用 SafeErrorReporter | 完整 | 🟢 低 | §8.1 | 中 |

---

## 五、裁定行动项

### P0 —— 必须修复（阻塞性）

1. **P0-R1**：将 `console.error`/`console.log` 替换为 PipelineObserver 的 emit 调用，至少确保启动阶段的 CRITICAL 错误通过 SafeErrorReporter 上报
2. **P0-R2**：为 `loadEnv` 添加环境变量 key 白名单——仅允许 `CORTEX_*` 和 `DEEPSEEK_*` 前缀写入 `process.env`
3. **P0-R3**：为 `loadEnv` 的 `projectRoot` 添加路径规范化（`path.resolve`）和白名单校验，确保 `.env` 读取路径不越界

### P1 —— 建议修复（重要）

4. **P1-R1**：将 `process.exit(code)` 改为 `process.exitCode = code`，让异步资源（MemoryStore flush）自然完成
5. **P1-R2**：修复 `--format` 参数解析逻辑，改用统一的 `_parseOptions` 方法
6. **P1-R3**：在错误输出中对 API Key 等敏感信息进行脱敏处理

### P2 —— 后续优化

7. **P2-R1**：补充 CLI 设计文档 v0.2 或修正引用路径
8. **P2-R2**：统一别名冲突（version 的 `-v` → `-V`）
9. **P2-R3**：在 main.ts 入口显式配置 ConfirmGate 超时策略

---

## 六、判例记录

```
判例 ID: NG-2026-0611-CLI-Security-Audit
审计标的: packages/cli/src/main.ts
审计人: 凝光（DocGovernAgent）
审计日期: 2026-06-11
宪法版本: v2.5.16
发现数量: 11（🔴 高 3 / 🟡 中 5 / 🟢 低 3）
综合裁定: ❌ 未通过
有效引用: 是——对 CLI 入口文件的安全审计判例，
          后续审计同一模块或同类入口文件（如 cli.ts、index.ts）
          时可引用此判例作为安全基线参照
有效期: 至 P0 项全部修复并通过验证后，此判例转为历史参考
```

---

## 七、备注

1. 本审计仅针对 `packages/cli/src/main.ts` 单一文件，不覆盖 `commands/`、`services/`、`formatters/` 等子模块的内部安全实现
2. 部分违规项（如直接使用 `node:fs`）属于 CLI 启动阶段的合理模式，但缺少安全校验层包裹，建议抽取为 `safeLoadEnv` 统一入口
3. 环境变量注入漏洞（I-01）的修复优先级最高——它影响的是所有后续依赖 `process.env` 的系统行为
4. CLI 设计文档缺失（S-01）反映了文档与代码的同步断裂，建议在修复代码的同时补全设计文档

---

*天权定论，不得上诉。*
*凝光签印。*
