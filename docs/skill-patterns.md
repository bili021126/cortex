# Skill 系统模式参考（from Cyrene-Agent）

> **来源**: `d:\cortex\_extraneous\Cyrene-Agent-master\src\main\skills\`
> **目的**: 提取 Cyan Skill 系统的扫描/注册/调用模式，供 Cortex Skill 系统可选增强。
> **不覆盖**: 不修改现有 `packages/skill-kit/` 代码。本文档仅作参考。

---

## 1. 整体架构

Cyrene-Agent Skill 系统分三层：

```
扫描层 (scanSkills)
  ↓
注册层 (SkillRegistry)
  ↓
调用层 (meta-tool: invoke_skill / read_skill_reference)
```

- **扫描层**：纯函数，从文件系统扫描 SKILL.md → 解析 YAML frontmatter → 产出 `SkillEntry[]`
- **注册层**：Map 单例，持有所有 Skill 的元数据 + 懒加载正文/附件缓存
- **调用层**：两个 meta-tool（`invoke_skill` / `read_skill_reference`）通过 ToolRegistry 暴露给 LLM

---

## 2. Skill 文件格式（YAML Frontmatter）

每个 Skill 是一个目录，`SKILL.md` 包含 YAML frontmatter：

```markdown
---
name: my-skill          # 必填，通常 = 目录名（kebab-case）
description: 一句话描述  # 必填，供 LLM 路由判断
tools: ["tool-a"]       # 可选，关联的工具 id
version: 1.0.0          # 可选，语义版本
---

SKILL.md 正文（详细的执行指令）...
```

**目录结构**：
```
skills/
  my-skill/
    SKILL.md            # frontmatter + 正文
    references/         # 可选，附件文件
      template.yaml
      example.txt
```

**合规校验规则**：
1. 目录必须含 `SKILL.md`
2. frontmatter 必须有 `name`（string, 非空）
3. frontmatter 必须有 `description`（string, 非空）
4. `tools` 若存在必须是 array
5. `name` 可以不等于目录名，但 id 统一用目录名（warn 但不阻止）

---

## 3. 与 Cortex Skill 系统的对比

| 维度 | Cyrene-Agent（本文档） | Cortex 现有（skill-kit） |
|------|----------------------|------------------------|
| **Skill 载体** | 文件系统：SKILL.md + references/ | 内存：SkillTemplate（IndexedRegistry） |
| **来源** | builtin（内置）/ user（用户）双源 | Pipeline 内生 + 外源 JSON |
| **身份标识** | id = 目录名（kebab-case） | id = UUID（template.id） |
| **元数据格式** | YAML frontmatter（gray-matter） | JSON Schema 校验 |
| **匹配方式** | LLM 通过"可用 Skill"清单 + invoke_skill | Agent 通过标签查询（queryByTags） |
| **启用/禁用** | 持久化到 skills-enabled.json | 运行时状态（registry.unregister） |
| **内容注入** | 拼到 system prompt 的 catalog 段 | Pipeline 事件驱动的技能提取 |
| **生命周期** | 文件存在即注册 | trial → active → deprecated |
| **评价系统** | 无 | 有（feedbackHistory, weight） |

---

## 4. 可选的增强方向（selective enhancement）

以下列出 Cortex 当前 skill-kit 可以借鉴的 Cyrene 模式。每一项标注建议优先级。

### 4.1 [P2] Skill Catalog 注入模式

Cyrene 将 enabled skill 清单拼入 system prompt，让 LLM 知道「有什么 skill 可用」。

**参考文件**: `skill-catalog.ts` — `buildSkillCatalog(skills: SkillEntry[])`

```typescript
// 生成模板
## 可用 Skill
当某 skill 适用于当前任务时，先调用 invoke_skill(skill_id) 取详细指令，再按指令用工具执行。

- my-skill: 一句话描述 [tools: tool-a, tool-b]
```

**Cortex 参考实现**：
- 可在 `SkillRegistry` 上加一个 `buildPromptCatalog()` 方法
- 按 tag 权重排序，只输出 `deriveStatus() === "active"` 的 skill
- 注入时机：system prompt 组装时

### 4.2 [P2] 文件系统 Skill 扫描

Cyrene 从文件系统目录扫描 SKILL.md，天然支持 git 版本管理。Cortex 目前依赖 pipeline 内生产生。

**参考文件**: `skill-scanner.ts` — `scanSkills(dir, source)`

```
skills/
  skill-a/SKILL.md
  skill-b/SKILL.md
  skill-c/SKILL.md
```

**Cortex 参考实现**：可在 `@cortex/skill-kit` 新增 `scanSkillDirectory()` 纯函数，将文件系统 SKILL.md 转为 `SkillTemplate[]`，适配到现有 Schema 校验管道。

### 4.3 [P3] 懒加载正文缓存

Cyrene 的 `SkillRegistry.getBody()` 只在首次调用时读文件，后续命中缓存。对大 body（33KB+）有截断保护。

**参考文件**: `skill-registry.ts` — `bodyCache` + `truncateForContext()`

### 4.4 [P3] 路径穿越防护

`getReference()` 校验 ref 必须命中扫描阶段缓存的 references 清单，拒绝含 `../` 的路径。

```typescript
// 路径穿越防护模式
if (!s.references.includes(ref)) return null  // 白名单校验
if (ref.includes("/") || ref.includes("\\") || ref.includes("..")) return null  // 路径分隔符拦截
```

---

## 5. 关键类型定义（参考）

```typescript
/** Skill 完整条目 */
interface SkillEntry {
  id: string;            // = 目录名，kebab-case，唯一对外标识
  name: string;          // frontmatter.name，仅展示用
  description: string;   // 注入 prompt 清单用
  tools?: string[];      // 关联的 tool id
  version?: string;      // 语义版本
  dirPath: string;       // skill 目录绝对路径
  bodyPath: string;      // SKILL.md 绝对路径
  references: string[];  // references/ 下文件名清单
  enabled: boolean;      // 运行时状态
  source: "builtin" | "user";
}

/** Frontmatter 解析结果 */
interface ParsedSkill {
  name: string;
  description: string;
  tools?: string[];
  version?: string;
  body: string;  // 正文（去掉 frontmatter）
}

/** /命令解析结果 */
interface SlashParseResult {
  hit: boolean;
  skillId?: string;
}
```

---

## 6. 文件索引

| 文件 | 用途 | 纯函数？ | 依赖 |
|------|------|---------|------|
| `types.ts` | 类型定义 | ✅ | 无 |
| `skill-scanner.ts` | 目录扫描 + frontmatter 解析 | ✅ | fs, gray-matter |
| `skill-registry.ts` | 注册表（Map + 懒加载缓存） | ❌（单例） | fs, skill-scanner |
| `skill-catalog.ts` | 生成注入 prompt 的 skill 清单 | ✅ | 无 |
| `skill-commands.ts` | `/skill-id` 命令解析 | ✅ | 无 |
| `skill-tools.ts` | 注册 invoke_skill / read_skill_reference meta-tool | ❌（单例） | toolRegistry, skillRegistry |
| `index.ts` | 启动入口：initSkills（唯一碰 Electron 的模块） | ❌ | app.getPath, scanner, registry, tools |
