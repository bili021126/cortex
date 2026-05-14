# 🔐 密码存储 JSON 结构审查报告

> **探索者**: 纳西妲（Analysis Agent · 结构洞察）
> **探索时间**: 2026-05-14
> **探索范围**: `solo-flight/src/store.ts`, `solo-flight/src/crypto.ts`, `solo-flight/docs/`, `solo-flight/packages/`
> **前人之鉴**: 莫娜（patterns.md）→ 加密文件仓库模式；安柏（verification.md）→ 功能验证；阿贝多（code-review.md）→ 安全审查；刻晴（governance-report.md）→ 合规审计

---

## 目录

1. [数据结构全景](#1-数据结构全景)
2. [字段级分析](#2-字段级分析)
3. [序列化与存储流](#3-序列化与存储流)
4. [发现的风险与矛盾](#4-发现的风险与矛盾)
5. [改进建议](#5-改进建议)
6. [扩展性评估](#6-扩展性评估)

---

## 1. 数据结构全景

### 1.1 当前结构（`src/store.ts:10-20`）

```
StoreData
├── version: 1 (字面量)
└── entries: PasswordEntry[]
      ├── id: string          ← UUID，技术主键
      ├── name: string        ← 业务唯一标识（查重依据）
      ├── username: string    ← 登录用户名
      ├── password: string    ← 密码（明文存储在内存中）
      ├── createdAt: string   ← ISO 8601 字符串
      └── updatedAt: string   ← ISO 8601 字符串
```

### 1.2 序列化后形态（加密前 JSON）

```json
{
  "version": 1,
  "entries": [
    {
      "id": "a1b2c3d4-...",
      "name": "github",
      "username": "developer@example.com",
      "password": "s3cret!",
      "createdAt": "2026-05-14T10:00:00.000Z",
      "updatedAt": "2026-05-14T10:00:00.000Z"
    }
  ]
}
```

### 1.3 加密后形态（磁盘上）

```
文件: .pm-data/vault.enc
格式: base64 编码的二进制包封
布局: | salt (16B) | iv (16B) | authTag (16B) | ciphertext (可变) |
```

---

## 2. 字段级分析

### 2.1 `version: 1` — 字面量而非可枚举值

**现状**：
```typescript
interface StoreData {
  version: 1;          // 字面量类型，固定为 1
  entries: PasswordEntry[];
}
```

**问题**：
- 这是一个 TypeScript 字面量类型约束，不是运行时约束。运行时的值由 `JSON.parse` 决定，可以是任何数字。
- 没有版本迁移逻辑。如果未来要添加 `version: 2` 的 schema（比如新增 `category` 字段），**没有任何代码处理旧版本的升级**。
- `loadStore` 的解密失败降级直接返回 `{ version: 1, entries: [] }`，丢失了原始文件的版本信息。

**根因**：版本号声明了但从未被读取或校验。它是一个"声明了但没用"的字段。
- `loadStore()` 返回后，调用方从未检查 `data.version`
- `saveStore()` 写入时，永远写死 `version: 1`

### 2.2 `id` — UUID 主键 vs `name` 业务键

**现状**：
- `id` 由 `crypto.randomUUID()` 生成，是真正的唯一标识
- `name` 在 `addEntry()` 中作为唯一性检查依据（查重）

**问题**：
- 两层键并存但没有明确的主次约束关系。`name` 查重用的是线性 `find()` 搜索，O(n) 复杂度，条目增多时性能退化。
- `name` 不可重名但不可修改——没有 `rename` 或 `updateEntry` 函数。想改名只能删除重建。
- `id` 暴露在 `listEntries()` 的输出中（截取前 8 位），但没有任何通过 `id` 查找的公开 API。

### 2.3 `password` — 内存明文存储

**现状**：
```typescript
const entry: PasswordEntry = {
  id: crypto.randomUUID(),
  name,
  username,
  password,       // ← 明文字符串，在内存中常驻
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
```

**问题**：
- 密码在解密后以 JavaScript 字符串形式存在于堆内存中。字符串是不可变的，无法主动清除。
- 直到 `store` 变量离开作用域（被 GC 回收）之前，密码字符串一直在内存中可被读取。
- V8 的 GC 不会主动覆写回收的内存，密码可能在内存中残留更长时间。

### 2.4 `createdAt` / `updatedAt` — ISO 字符串而非时间戳

**现状**：使用 `new Date().toISOString()` 生成字符串。

**问题**：
- 字符串比较和排序效率低于数字时间戳。
- 没有时区信息（ISO 字符串隐含 UTC，但未显式标注）。
- `updatedAt` 在创建时与 `createdAt` 相同，但没有更新操作来维护它——目前没有任何 API 修改已有条目，所以 `updatedAt` 永远不会变化。

### 2.5 缺失的字段

与主流密码管理器（1Password, Bitwarden, KeePass）对比，当前结构缺少：

| 字段 | 用途 | 缺失影响 |
|------|------|----------|
| `url` / `uris` | 关联网站地址 | 无法自动填充或关联登录页面 |
| `category` / `folder` | 分类组织 | 条目多了之后难以管理 |
| `notes` | 备注信息 | 无法存储安全提示、问题等上下文 |
| `favorite` | 标记常用条目 | 快速访问能力缺失 |
| `otp` / `totp` | 二步验证密钥 | 不支持 TOTP 自动生成 |
| `expiresAt` | 密码过期时间 | 无法提醒定期更换密码 |
| `passwordStrength` | 密码强度评估 | 用户不知道密码是否足够安全 |
| `tags` | 标签系统 | 灵活的过滤器缺失 |

---

## 3. 序列化与存储流

### 3.1 完整数据流

```
用户输入 (name, username, password)
    │
    ▼
addEntry()
    ├── loadStore()           ← 读取并解密 vault.enc
    │       │
    │       ├── 文件不存在 → 返回空数据
    │       ├── 文件为空   → 返回空数据
    │       ├── 解密成功   → JSON.parse → StoreData
    │       └── 解密失败   → console.error + 返回空数据 ⚠️
    │
    ├── 查重 (store.entries.find by name)
    │       └── 重复 → throw Error
    │
    ├── 创建 PasswordEntry (UUID + 时间戳)
    │
    └── saveStore()
            ├── JSON.stringify(data, null, 2)   ← 格式化 JSON
            ├── encrypt(raw)                    ← AES-256-GCM 加密
            └── fs.writeFileSync(vault.enc)     ← 覆写文件
```

### 3.2 关键观察

**序列化选择**：
- `JSON.stringify(data, null, 2)` 输出格式化 JSON（2 空格缩进）
- 加密后是 base64 字符串，格式化与否无意义（最终文件是连续 base64 文本）
- 格式化增加了 ~15-20% 的序列化体积，加密前有意义但加密后浪费

**文件操作模式**：
- `loadStore` 读取全部内容到内存
- 修改完成后 `saveStore` 全量写出
- 没有增量更新、没有 WAL（Write-Ahead Log）、没有备份

---

## 4. 发现的风险与矛盾

### 4.1 🔴 解密失败导致数据永久丢失（已知风险，严重）

**位置**：`src/store.ts:37-42`

```typescript
catch {
  console.error('警告：存储文件读取失败，可能密钥已变更或文件已损坏');
  return { version: 1, entries: [] };  // ← 返回空数据
}
```

**触发路径**：
1. 用户变更了 `PM_MASTER_KEY` 环境变量
2. `loadStore()` 用新密钥解密旧密文 → 失败
3. 返回空 `StoreData`
4. 用户执行 `add` 命令 → `saveStore()` 用新密钥写回
5. **原始加密文件被覆盖 — 数据永久丢失**

**前人之鉴**：莫娜在 patterns.md 中标记为"数据丢失路径"，安柏在 verification.md 中标记为 ERR-01（严重）。**三次标记仍未修复**。

**建议修复**：解密失败时备份原始文件再降级。

### 4.2 🟡 IV 长度代码与文档矛盾

**位置**：
- 代码：`src/crypto.ts:9` → `const IV_LENGTH = 16;`
- 文档：`reports/patterns.md` → 二进制布局写 iv 为 **12B**，但表格中 `IV_LENGTH` 标为 **12**

**事实**：
- 代码实际使用 16 字节 IV（`crypto.randomBytes(IV_LENGTH)` 且 `IV_LENGTH = 16`）
- AES-256-GCM 的推荐 IV 长度是 **12 字节**（96 位）
- Node.js 的 `crypto.createCipheriv` 接受 12 字节以外的 IV，但：
  - 大于 12 字节的 IV 会被 GCM 内部通过 GHASH 哈希处理，计算开销增加
  - NIST SP 800-38D 推荐 12 字节 IV 以确保最佳性能和安全性
  - 使用 16 字节 IV 不是错误，但**不符合最佳实践**

**矛盾影响**：如果未来有人按照 patterns.md 的 12B 布局实现兼容的解密器，会解析失败。

### 4.3 🟡 `scrypt N = 2^14` 偏低

**位置**：`src/crypto.ts:12` → `N: 2 ** 14`

- 2^14 = 16384，这是 2017 年左右的推荐值
- 2026 年的推荐值应为 2^17（131072）或更高
- 参数不可配置，无法适应不同安全等级的需求

### 4.4 🟡 `listEntries()` 信息泄露不一致

**位置**：`src/store.ts:93-99`

```typescript
export function listEntries(): Pick<PasswordEntry, 'id' | 'name' | 'createdAt'>[] {
```

- 返回 `id`、`name`、`createdAt`——但隐藏了 `updatedAt`、`username`、`password`
- 隐藏 `password` 是正确的，隐藏 `username` 和 `updatedAt` 有些过度
- `listEntries` 的名称暗示是列表展示，但调用者无法判断哪个条目最近更新过

### 4.5 🟢 对抗性设计亮点

不是所有发现都是批评——以下设计值得保留：

| 亮点 | 位置 | 说明 |
|------|------|------|
| 加密与存储分离 | `crypto.ts` ↔ `store.ts` | 加密逻辑独立，可单独测试和复用 |
| 空文件安全降级 | `store.ts:33-36` | 空文件返回空数据而非崩溃 |
| UUID 主键 | `store.ts:75` | 不依赖自增 ID，无冲突风险 |
| 格式化的 JSON 序列化 | `store.ts:86` | 加密前人类可读，便于调试 |

---

## 5. 改进建议

### 5.1 P0 — 解密失败保护（数据安全）

**问题**：解密失败 → 静默返回空数据 → saveStore 覆盖原始文件

**方案**：
```typescript
catch {
  const backupPath = storePath + '.bak';
  fs.copyFileSync(storePath, backupPath);  // 先备份
  console.error(`警告：解密失败，原始文件已备份至 ${backupPath}`);
  return { version: 1, entries: [] };
}
```

### 5.2 P1 — 版本迁移机制

**问题**：`version` 字段存在但不使用

**方案**：
```typescript
interface StoreData {
  version: number;    // 改为 number，非字面量
  entries: PasswordEntry[];
}

function migrateStore(data: StoreData): StoreData {
  let { version, entries } = data;
  // 未来版本迁移链
  // if (version === 1) { /* 迁移到 v2 */; version = 2; }
  // if (version === 2) { /* 迁移到 v3 */; version = 3; }
  return { version, entries };
}

// 在 loadStore 返回值之后调用 migrateStore
```

### 5.3 P1 — 修正 IV 长度

**问题**：IV_LENGTH = 16，不符合 GCM 推荐

**方案**：
```typescript
const IV_LENGTH = 12;  // GCM 推荐值
```
同步更新 `patterns.md` 中的文档说明。

### 5.4 P2 — 数据结构扩展

为后续发展预留的字段扩展方案：

```typescript
export interface PasswordEntry {
  id: string;
  name: string;
  username: string;
  password: string;
  url?: string;           // 关联网站
  category?: string;      // 分类
  notes?: string;         // 备注
  favorite?: boolean;     // 收藏标记
  createdAt: string;
  updatedAt: string;
}

interface StoreData {
  version: number;
  entries: PasswordEntry[];
  metadata?: {            // 仓库元数据
    lastBackupAt?: string;
    entryCount?: number;
  };
}
```

### 5.5 P2 — 内存密码保护

短期方案（标记密码内存区域）：
```typescript
// 使用完后手动置空（虽然不彻底，但降低风险窗口）
entry.password = '';
```

长期方案：使用 `Buffer` 或 `ArrayBuffer` 存储敏感数据，利用 `buffer.fill(0)` 主动清除。

### 5.6 P3 — scrypt 参数可配置

```typescript
const SCRYPT_N = parseInt(process.env.PM_SCRYPT_N || '', 10) || 2 ** 17;
```

### 5.7 P3 — 备份与原子写入

```typescript
function saveStore(data: StoreData): void {
  const storePath = ensureStoreDir();
  const raw = JSON.stringify(data);  // 移除格式化，减少体积
  const encrypted = encrypt(raw);
  
  // 先写临时文件，再重命名，实现类原子写入
  const tmpPath = storePath + '.tmp';
  fs.writeFileSync(tmpPath, encrypted, 'utf-8');
  fs.renameSync(tmpPath, storePath);
}
```

---

## 6. 扩展性评估

### 6.1 当前架构的扩展边界

| 扩展方向 | 当前支持度 | 改造难度 | 说明 |
|----------|-----------|----------|------|
| 新增字段 | 🟢 容易 | 低 | JSON Schema 天然宽松，新增可选字段不影响旧数据 |
| 版本迁移 | 🔴 不支持 | 中 | 需要实现 `migrateStore` 链 |
| 搜索过滤 | 🟡 有基础 | 低 | `getEntry` 按 name 搜索，扩展为 filter 即可 |
| 分类/标签 | 🟢 容易 | 低 | 新增 `category`/`tags` 字段即可 |
| 多用户 | 🔴 不支持 | 高 | 当前设计为单用户本地工具 |
| 数据导出 | 🟡 有基础 | 低 | 在解密后提供 JSON/CSV 格式化输出即可 |
| 密码轮换提醒 | 🟡 有基础 | 低 | 利用 `updatedAt` 判断上次修改时间 |
| Web UI | 🟡 有基础 | 中 | `store.ts` 纯数据层，可被任意前端调用 |
| 云同步 | 🔴 不支持 | 高 | 需要冲突解决策略和远程存储适配层 |

### 6.2 核心模式总结

```
┌─────────────────────────────────────────────────────┐
│              密码存储 JSON 结构                        │
│                                                      │
│  核心契约：                                          │
│  ┌──────────────────────────────────────────────┐    │
│  │  StoreData = { version, entries[] }          │    │
│  │  PasswordEntry = { id, name, username,       │    │
│  │                   password, createdAt,        │    │
│  │                   updatedAt }                 │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  序列化链：JSON.stringify → encrypt → base64 → 文件   │
│  反序列化链：文件 → base64解码 → decrypt → JSON.parse  │
│                                                      │
│  安全边界：AES-256-GCM 认证加密                        │
│  密钥派生：scrypt(N=2^14, r=8, p=1)                   │
│                                                      │
│  最大风险：解密失败时无备份保护 → 数据永久丢失           │
│  最需关注：version 字段存在但不参与任何逻辑               │
└─────────────────────────────────────────────────────┘
```

### 6.3 未来改进路线图

```
Phase 1（安全加固）        Phase 2（功能扩展）        Phase 3（生态建设）
├── 解密失败备份           ├── 版本迁移机制           ├── 数据导入/导出
├── IV 长度修正           ├── 新增 url/category     ├── TOTP 支持
├── scrypt 参数升配        ├── 搜索/过滤 API         ├── 浏览器扩展适配
└── 原子写入              └── 密码强度评估           └── 云同步适配
```

---

## 附：数据流图（DFD Level 0）

```
                    ┌───────────┐
                    │  用户/CLI  │
                    └─────┬─────┘
                          │ name, username, password
                          ▼
┌─────────────────────────────────────────┐
│              addEntry()                  │
│  ┌──────────┐    ┌──────────────────┐   │
│  │ loadStore │    │  创建 PasswordEntry│  │
│  │ (解密)    │    │  + 查重           │   │
│  └────┬─────┘    └────────┬─────────┘   │
│       │                   │              │
│       ▼                   ▼              │
│  ┌──────────────────────────────────┐   │
│  │          saveStore()              │   │
│  │  JSON.stringify → encrypt → 文件  │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
                          │
                          ▼
                   ┌──────────────┐
                   │ .pm-data/    │
                   │ vault.enc    │
                   └──────────────┘
                          │
                          ▼
                   ┌──────────────┐
                   │ crypto.ts    │
                   │ scrypt派生   │
                   │ AES-256-GCM  │
                   └──────────────┘
```

---

*分析结束。雨林的根系已经看清——入口在哪里、风险聚集在哪个角落、未来要动这里最需要注意的三件事，都已写在这份报告中。下一任探索者，请从 Phase 1 开始。*
