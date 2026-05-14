# 🔐 密码管理器 — 可复用加密存储模式

> 水镜映照范围：`solo-flight/src/`, `solo-flight/packages/`, `solo-flight/test/`
> 映照时间：2026-05-13
> 水占术士：莫娜·梅姬斯图斯
>
> 以下模式均源自实际执行过的代码波纹。每个模式至少出现两次才被收录，
> 三次以上视为成熟模式。源自只出现一次的东西——那是你自己的幻觉。

---

## 目录

1. [加密密钥派生与包封](#1-加密密钥派生与包封)
2. [加密文件仓库](#2-加密文件仓库)
3. [CLI 子命令分发](#3-cli-子命令分发)
4. [段落感知单遍扫描解析](#4-段落感知单遍扫描解析)
5. [健壮文件 I/O 守卫](#5-健壮文件-io-守卫)
6. [内联测试断言框架](#6-内联测试断言框架)

---

## 1. 🔑 加密密钥派生与包封

**触发标签**: `encryption`, `aes-gcm`, `scrypt`, `key-derivation`, `crypto`

**触发条件**: 需要以主密钥（来自环境变量或配置文件）为种子，通过密钥派生函数生成加密密钥，对明文进行认证加密，并以确定的二进制包封格式序列化。

**出现次数**: 2 次（`encrypt()` 编码 + `decrypt()` 解码，形成完整加密周期）

### 步骤序列

1. **从环境变量读取主密钥** — `process.env.PM_MASTER_KEY`，不足 8 字符时回退默认密钥（仅开发环境允许）
2. **生成随机盐值** — `crypto.randomBytes(SALT_LENGTH)`，每次加密独立，确保同一明文每次密文不同
3. **密钥派生** — `crypto.scryptSync(masterKey, salt, KEY_LENGTH, { N, r, p })`，将主密钥 + 盐值转换为固定长度的 AES 密钥
4. **生成随机 IV** — `crypto.randomBytes(IV_LENGTH)`，AES-256-GCM 需要 12 字节初始化向量
5. **加密并获取认证标签** — `crypto.createCipheriv(ALGORITHM, key, iv)` → `cipher.update(plaintext)` + `cipher.final()` + `cipher.getAuthTag()`
6. **二进制包封** — 按固定偏移拼接缓冲区：`salt(16B) + iv(12B) + authTag(16B) + ciphertext`
7. **Base64 编码** — `Buffer.concat([...]).toString('base64')`，便于文本文件存储
8. **解密逆向** — `Buffer.from(ciphertext, 'base64')` → 按偏移切分 salt/iv/tag/ciphertext → `scryptSync` 恢复密钥 → `createDecipheriv` + `setAuthTag` → `decipher.update` + `decipher.final()`

### 关键参数

| 参数 | 值 | 说明 |
|------|-----|------|
| `ALGORITHM` | `aes-256-gcm` | 认证加密，提供机密性 + 完整性 |
| `KEY_LENGTH` | 32 | AES-256 密钥长度 |
| `IV_LENGTH` | 12 | GCM 推荐 IV 长度 |
| `TAG_LENGTH` | 16 | GCM 认证标签长度 |
| `SALT_LENGTH` | 16 | scrypt 盐值长度 |
| `scrypt N` | 2^14 | 计算成本参数（2026 年推荐 2^17） |
| `scrypt r` | 8 | 块大小参数 |
| `scrypt p` | 1 | 并行度参数 |

### 二进制布局

```
| salt (16B) | iv (12B) | authTag (16B) | ciphertext (可变) |
|----------偏移 0-------|----偏移 16-----|----偏移 28--------|--偏移 44----------|
```

### 预期产出

一个可独立使用的 `encrypt(plaintext: string): string` / `decrypt(ciphertext: string): string` 加密原语，输出为 base64 字符串，可直接写入文本文件或数据库文本字段。

---

## 2. 🏦 加密文件仓库

**触发标签**: `vault`, `file-storage`, `encrypted-persistence`, `json-store`

**触发条件**: 需要将结构化数据（JSON）加密后持久化到磁盘文件，支持读取、修改、写回的全生命周期管理，且解密失败时有安全降级。

**出现次数**: 3 次（`loadStore` + `saveStore` + `ensureStoreDir` 组成完整仓库生命周期）

### 步骤序列

1. **定义数据结构接口** — `StoreData { version: number; entries: Entry[] }`，包含版本号字段，便于未来迁移
2. **解析存储路径** — `fileURLToPath(import.meta.url)` 获取当前模块绝对路径，相对路径定位到项目根目录的 `.pm-data/vault.enc`
3. **确保目录存在** — `fs.existsSync(dir)` 检查 → `fs.mkdirSync(dir, { recursive: true })` 创建，幂等安全
4. **加载（loadStore）**：
   - 文件不存在 → 返回 `{ version: 1, entries: [] }`（首次启动）
   - 文件为空 → 返回空数据结构（文件创建后未写入）
   - 读取并解密 → `decrypt(encrypted)` → `JSON.parse(raw)` → 返回
   - **解密失败** → `console.error` 警告 + 返回空数据结构（防止密钥变更后全量数据丢失）
5. **保存（saveStore）**：
   - `JSON.stringify(data, null, 2)` → 格式化 JSON，便于人类可读
   - `encrypt(raw)` → 加密
   - `fs.writeFileSync(storePath, encrypted, 'utf-8')` → 原子写入
6. **条目操作模式** — 加载 → 内存修改（查重/新增/过滤）→ 保存，读写分离

### 错误处理语义

| 场景 | 行为 | 风险 |
|------|------|------|
| 文件不存在 | 返回空数据 | 🟢 安全 |
| 文件为空 | 返回空数据 | 🟢 安全 |
| 解密失败（密钥变更） | 返回空数据 + 警告 | 🟡 后续 `saveStore` 可能覆盖原始加密文件 |
| JSON 格式错误 | 返回空数据 + 警告 | 🟡 同上 |
| 磁盘写入失败 | 抛出异常 | 🟢 调用方捕获 |

### 预期产出

一个通用的加密 JSON 文件仓库：`loadStore<T>() → T` + `saveStore(data: T) → void`。替换数据类型即可复用于其他敏感配置的加密持久化。

---

## 3. 🎮 CLI 子命令分发

**触发标签**: `cli`, `commander`, `command-pattern`, `argument-parsing`

**触发条件**: 需要构建命令行工具，支持多个子命令（add/get/list）或选项驱动的单命令（Markdown → HTML 转换器），统一输入验证、错误处理和输出格式。

**出现次数**: 2 次（`src/index.ts` 使用 Commander + `packages/cli/src/cli.ts` 手动解析）

### 步骤序列

**方案 A — Commander 库（推荐多子命令场景）**

1. **初始化** — `new Command().name('pm').description('...').version('1.0.0')`
2. **定义子命令** — `.command('add').description('添加密码条目').requiredOption('-n, --name <name>', '条目名称')`
3. **注册 action 回调** — `.action((options) => { try { ... } catch(err) { process.exit(1) } })`
4. **解析** — `program.parse(process.argv)`

**方案 B — 手动解析（轻量单命令场景）**

1. **定义选项接口** — `interface CliOptions { input: string; output?: string; title?: string }`
2. **遍历 argv** — 从 `process.argv.slice(2)` 开始，按 `-o/--output` 等模式匹配
3. **输入验证** — 检查文件存在性、扩展名合法性、参数完整性
4. **执行核心逻辑** — `try { ... } catch(err) { console.error('✗ 错误: ' + err.message); process.exit(1) }`
5. **输出结果** — `✓ 转换完成: input.md → output.html` + 统计信息

### 输出格式约定

| 类型 | 格式 | 示例 |
|------|------|------|
| 成功 | `✓ 消息` | `✓ 已添加条目: my-account` |
| 失败 | `✗ 错误: 描述` | `✗ 错误: 条目 "my-account" 已存在` |
| 警告 | `⚠  警告: 描述` | `⚠  警告: 输入文件扩展名为 ".txt"` |
| 信息 | `字段: 值` | `  用户名:   admin` |

### 预期产出

一个 CLI 入口文件，用户可通过子命令或选项与系统交互。输出格式统一（✓/✗/⚠），便于脚本解析和人工阅读。

---

## 4. 📜 段落感知单遍扫描解析

**触发标签**: `parser`, `markdown`, `block-level`, `single-pass`, `inline-parser`

**触发条件**: 需要将结构化文本（Markdown）转换为 HTML，要求单遍扫描、按优先级识别块级元素、递归解析行内元素。

**出现次数**: 3 次（`convert()` 主解析循环 + `convertToDocument()` 包装 + `parseInline()` 递归解析）

### 步骤序列

1. **切分行** — `markdown.split('\n')`，获得行数组和当前指针 `i`
2. **优先级排序的块级识别** — 每行按以下顺序检查（高优先级优先）：
   - **代码围栏** ` ``` ` → 收集直到结束围栏，`escapeHtml` 包裹 `<pre><code>`
   - **分割线** `---` / `***` → `<hr>`
   - **标题** `# ~ ######` → `<h1>~<h6>`
   - **引用块** `>` → 收集连续引用行，`<blockquote><p>`
   - **无序列表** `- / * / +` → 收集连续列表项，`<ul><li>`
   - **有序列表** `1. 2. 3.` → 收集连续列表项，`<ol start="n"><li>`
   - **段落** → 收集连续非空行直到下一个块级标记
3. **行内解析** — 每段文本传递给 `parseInline()`，单次扫描按优先级处理：
   - 转义字符 `\<char>` → 字面量
   - 行内代码 `` `code` `` → `<code>`
   - 图片 `![alt](url)` → `<img>`
   - 链接 `[text](url)` → `<a>`（内容递归解析内联元素）
   - 加粗 `**text** / __text__` → `<strong>`
   - 斜体 `*text* / _text_` → `<em>`
   - 普通字符 → 直接追加
4. **HTML 转义** — `escapeHtml()` 处理 `& < >`，`escapeAttr()` 处理属性中的 `& " ' < >`
5. **文档包装（可选）** — `convertToDocument()` 将 body HTML 注入 `<!DOCTYPE html><html><head><style>...</style></head><body>...</body></html>`

### 优先级设计原则

| 优先级 | 块级元素 | 理由 |
|--------|---------|------|
| 最高 | 代码围栏 | 围栏内所有内容不解析，优先独占 |
| 高 | 分割线 | 仅一行，快速判定 |
| 中高 | 标题 | 仅一行，无多行延续 |
| 中 | 引用块 | 支持多行连续 |
| 中低 | 列表 | 支持多行连续，需区分有序/无序 |
| 最低 | 段落 | 收集到下一个块级标记为止 |

### 预期产出

一个纯函数 `convert(markdown: string): string`，无状态、无副作用、无外部依赖。输入 Markdown 输出 HTML，可嵌入 `convertToDocument()` 生成完整文档。

---

## 5. 🛡️ 健壮文件 I/O 守卫

**触发标签**: `file-io`, `error-handling`, `guard`, `defensive`

**触发条件**: 需要读取或写入文件，要求在文件不存在、空文件、权限不足、磁盘满等异常场景下有明确的降级策略，且错误信息对用户友好。

**出现次数**: 4 次（`store.ts` 加载/保存 + `cli.ts` 读取/写入 + `converter.test.ts` 文件读取 + `test-input.md` 读取）

### 步骤序列

1. **路径解析** — `path.resolve(inputPath)` 将相对路径转为绝对路径，消除工作目录歧义
2. **存在性检查** — `fs.existsSync(path)` 前置检查（非写入场景）
   - 不存在 → 返回默认值/空数据（存储场景）或 `console.error('✗ 错误: 文件不存在') + exit(1)`（CLI 场景）
3. **格式预检** — `path.extname(inputPath)` 检查扩展名，非预期返回警告但不阻断
4. **读取操作包裹 try/catch**：
   - 成功 → 处理内容
   - 失败 → `err instanceof Error ? err.message : String(err)`，输出友好错误信息
5. **空内容检查** — 读取后检查 `content.length === 0`，空文件按初始化状态处理
6. **目录提前创建（写入场景）** — `fs.mkdirSync(dir, { recursive: true })`，确保写入路径存在
7. **写入操作包裹 try/catch**：
   - 成功 → 输出确认信息 + 文件路径 + 字节数
   - 失败 → 格式化错误信息 + `exit(1)`

### 错误信息模板

```typescript
// 读取失败
console.error(`✗ 错误: 读取文件失败 — ${errMsg}`);

// 写入失败
console.error(`✗ 错误: 写入文件失败 — ${errMsg}`);

// 文件不存在
console.error(`✗ 错误: 文件不存在 — "${resolvedPath}"`);

// 空文件
console.error('✗ 错误: 输入文件为空');

// 格式警告
console.error(`⚠  警告: 输入文件扩展名为 "${ext}"，预期为 .md 或 .markdown`);

// 成功
console.log(`✓ 转换完成: ${inputFile} → ${outputFile}`);
console.log(`  输出路径: ${outputPath}`);
```

### 预期产出

一组可复用的文件操作辅助函数：`safeReadFile(path, fallback?)`、`safeWriteFile(path, content)`、`ensureDir(path)`，统一错误处理逻辑，避免每个文件操作重复 try/catch。

---

## 6. 🧪 内联测试断言框架

**触发标签**: `test`, `assertion`, `test-framework`, `report-generation`

**触发条件**: 需要在无外部测试框架（Jest/Vitest）依赖的环境中编写结构化测试，支持测试用例组织、断言收集和 Markdown 格式测试报告输出。

**出现次数**: 2 次（测试用例定义 + 测试执行流程；14 个测试用例共享同一框架）

### 步骤序列

1. **定义断言辅助函数** — `assert(condition: boolean, message: string): string`
   - 返回格式化字符串：`✅ ${message}` 或 `❌ ${message}`
2. **定义测试用例接口** — `interface TestCase { name: string; run: () => string[] }`
   - `name`：用例名称，作为报告节标题
   - `run()`：执行测试逻辑，返回断言结果字符串数组
3. **注册测试用例** — `const testCases: TestCase[] = []` → `testCases.push({ name: '...', run: () => [...] })`
4. **实现测试运行器** — `runAllTests()`:
   - 遍历 `testCases`
   - 对每个用例调用 `run()`，累加断言计数
   - 生成 Markdown 报告：`# 测试报告` → `## 用例名称` → `断言结果列表` → `## 汇总` → 表格
5. **执行并输出** — `const { total, passed, failed, report } = runAllTests()` → `fs.writeFileSync(reportPath, report)` → `console.log(report)` → `process.exit(failed > 0 ? 1 : 0)`

### 报告格式

```markdown
# 转换器测试报告

**测试时间**: 2026-05-13T10:30:00.000Z
**测试框架**: tsx

---

## 段落转换

  ✅ 段落被 <p> 包裹
  ✅ 段落文本内容正确

---

## 汇总

| 指标 | 数值 |
|------|------|
| 总断言数 | 76 |
| 通过 | 76 |
| 失败 | 0 |
| 通过率 | 100.0% |

**结论**: ✅ 全部通过
```

### 预期产出

一个零外部依赖的测试基础设施。新测试用例 = 定义 `TestCase` 对象 + 推入数组，测试运行器自动收集、执行、报告。报告为 Markdown 文件，可直接在 GitHub/Code Review 中展示。

---

## 📌 模式索引速查

| # | 模式 | 核心文件 | 复用方式 | 出现次数 |
|---|------|---------|---------|---------|
| 1 | 加密密钥派生与包封 | `src/crypto.ts` | 复制 `encrypt/decrypt`，修改密钥来源和 scrypt 参数 | 2 |
| 2 | 加密文件仓库 | `src/store.ts` | 复制 `loadStore/saveStore`，替换数据结构类型 | 3 |
| 3 | CLI 子命令分发 | `src/index.ts` / `packages/cli/src/cli.ts` | 按需选方案 A（Commander）或方案 B（手动） | 2 |
| 4 | 段落感知单遍扫描解析 | `packages/parser/src/parser.ts` | `convert()` 纯函数，零依赖嵌入 | 3 |
| 5 | 健壮文件 I/O 守卫 | 散落 4 处 | 提取 `safeReadFile/safeWriteFile/ensureDir` 工具函数 | 4 |
| 6 | 内联测试断言框架 | `test/converter.test.ts` | 复制 `TestCase` 接口 + `runAllTests()` 运行器 | 2 |

---

## ⚠️ 已知风险（水镜警示）

以下为水镜观测到的潜在波纹断裂点，尚未形成模式，但值得标记：

1. **解密失败静默降级风险**（`store.ts:37-42`） — `loadStore` 解密失败返回空数据，后续 `saveStore` 可能覆盖原始加密文件。这是**数据丢失**路径，建议在解密失败时立即备份原始文件再降级。

2. **默认主密钥硬编码**（`crypto.ts:12-15`） — 回退密钥 `'password-manager-default-master-key-2024'` 是公开字符串。生产环境应 `if (!envKey) throw new Error('PM_MASTER_KEY 未设置')`。

3. **无文件锁** — `loadStore → 修改 → saveStore` 非原子操作，并发写入导致数据竞争。建议引入 `proper-lockfile` 或 `fcntl` 锁。

4. **scrypt N=2^14 偏低** — 2026 年推荐值 2^17。参数应可配置（环境变量 `PM_SCRYPT_N`）。

5. **测试命令配置错误** — `package.json` 缺少 `"test"` 脚本，`calculator.test.ts` 不存在而 `converter.test.ts` 存在。应在 `scripts` 中明确注册测试入口。

---

*水镜终。以上 6 个模式已写入 SkillRegistry 候选。*
