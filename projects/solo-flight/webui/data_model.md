# Markdown 解析 · 内部数据模型

> **维护者**：艾尔海森（Data Agent）  
> **关联文档**：[design.md](./design.md)  
> **状态**：定稿 · v1.0  
> **变更记录**：见文末附表  

---

## 1. 概述

本文档定义 Markdown→HTML 编译工具中全部**内部数据结构**的精确 schema。  
覆盖两个核心数据形态及其转换关系：

```
原始文本 ──[Lexer]──→ Token[] ──[Parser]──→ AstNode ──[Renderer]──→ HTML
                      扁平流        嵌套树
```

**关键约定**：
- 所有字段均为必填，除非标注 `?`（optional）。
- 枚举值一律使用 `snake_case` 字符串字面量。
- 禁止在运行时向数据结构附加未声明的属性。

---

## 2. Token — 词法单元

### 2.1 TokenType 枚举

Token 分为两类：**内容型**（携带有效负载）和**结构型**（标记容器边界）。

```
TokenType = 
  │ 内容型
  │ "heading"              │ 标题行   │ # ~ ######
  │ "paragraph"            │ 段落行   │ 默认降级
  │ "code_block"           │ 缩进代码 │ 4 空格 / 1 tab
  │ "fence_code_block"     │ 围栏代码 │ ``` 或 ~~~
  │ "blockquote_line"      │ 引用行   │ > 开头
  │ "unordered_list_item"  │ 无序项   │ - / * 开头
  │ "ordered_list_item"    │ 有序项   │ 数字. 开头
  │ "horizontal_rule"      │ 水平线   │ --- / *** / ___
  │ "blank_line"           │ 空行     │ 仅空白 / 空字符串
  │ "table_row"            │ 表格行   │ | 分隔
  │─── 结构型 ───
  │ "unordered_list_open"  │ 列表开始 │
  │ "unordered_list_close" │ 列表结束 │
  │ "ordered_list_open"    │ 列表开始 │
  │ "ordered_list_close"   │ 列表结束 │
  │ "blockquote_open"      │ 引用开始 │
  │ "blockquote_close"     │ 引用结束 │
```

### 2.2 Token 结构

```typescript
interface Token {
  /** 词法类型 — 决定该行在解析阶段的角色 */
  type: TokenType;

  /** 
   * 原始文本（不含行尾换行符 \n）。
   * 对于结构型 Token（*_open / *_close），raw 固定为空字符串 ''。
   */
  raw: string;

  /**
   * 类型相关的附加信息。
   * 不同 type 下 meta 的结构不同（见下方明细表）。
   * 无附加信息时值为 {}。
   */
  meta?: TokenMeta;
}
```

### 2.3 TokenMeta 分型明细

| TokenType            | meta 字段                  | 类型                  | 说明                          |
|----------------------|---------------------------|-----------------------|-------------------------------|
| `heading`            | `{ level: number }`       | 1 ≤ level ≤ 6        | `#` 数量                      |
| `fence_code_block`   | `{ lang?: string }`       | 开：`{ lang: "ts" }`  | 闭合时为 `{}`                 |
| `ordered_list_item`  | `{ start?: number }`      | 序号起始值，默认 1    | `1.` → start=1                |
| `blockquote_line`    | `{ depth: number }`       | 1 ≤ depth ≤ 10       | `>` 嵌套层数                  |
| `table_row`          | `{ is_header: boolean }`  | 是否为表头行          | 第二行 `|---|---|` 之后判定   |
| 其他类型              | `{}`                      | —                     | 空对象                        |

```typescript
type TokenMeta =
  | { level: number }                              // heading
  | { lang?: string }                              // fence_code_block
  | { start?: number }                             // ordered_list_item
  | { depth: number }                              // blockquote_line
  | { is_header: boolean }                         // table_row
  | Record<string, never>;                         // 其他
```

### 2.4 Token 流约束

1. **结构型 Token 必须成对出现**：`*_open` 之后必须匹配对应的 `*_close`，且不可交叉。
2. **列表 Token 序列规则**：
   ```
   unordered_list_open
     unordered_list_item  (1..n)
     [blank_line]         (0..1, 标记松散/紧凑)
     unordered_list_item  (1..n)
   unordered_list_close
   ```
3. **`blank_line`** 不出现在 `fence_code_block` 内部。
4. `table_row` 仅在启用 `tables` 选项时产生。

---

## 3. AST — 抽象语法树

### 3.1 AstNodeType 枚举

```
AstNodeType = 
  │─── 块级容器（可含子节点） ───
  │ "document"         │ 根节点
  │ "blockquote"       │ 引用块
  │ "list"             │ 列表（ul / ol）
  │ "list_item"        │ 列表项
  │─── 块级叶节点（含 value） ───
  │ "heading"          │ 标题
  │ "paragraph"        │ 段落
  │ "code_block"       │ 缩进代码块
  │ "fence_code_block" │ 围栏代码块
  │ "horizontal_rule"  │ 水平线
  │ "table"            │ 表格
  │ "table_row"        │ 表格行
  │ "table_cell"       │ 表格单元格
  │─── 行内容器 ───
  │ "strong"           │ 加粗
  │ "emphasis"         │ 斜体
  │ "delete"           │ 删除线
  │ "link"             │ 链接
  │─── 行内叶节点 ───
  │ "text"             │ 纯文本
  │ "inline_code"      │ 行内代码
  │ "image"            │ 图片
  │ "line_break"       │ 硬换行
```

### 3.2 AstNode 结构

```typescript
interface AstNode {
  /** 节点类型 */
  type: AstNodeType;

  /**
   * 子节点列表。
   * 仅容器型节点（document, blockquote, list, list_item, 
   * paragraph, strong, emphasis, delete, link, table, 
   * table_row, table_cell）持有。
   * 叶节点（text, inline_code, code_block, fence_code_block, 
   * horizontal_rule, line_break, image）的 children 为 undefined。
   */
  children?: AstNode[];

  /**
   * 文本值。
   * 仅 text / inline_code / code_block / fence_code_block 持有。
   * 其余节点 value 为 undefined。
   */
  value?: string;

  /**
   * 结构化属性。
   * 不同 type 下 attrs 字段不同（见下方明细表）。
   */
  attrs?: NodeAttrs;
}
```

### 3.3 NodeAttrs 分型明细

| AstNodeType         | attrs 字段                              | 说明                          |
|---------------------|----------------------------------------|-------------------------------|
| `heading`           | `{ level: number }`                    | 1–6                           |
| `list`              | `{ ordered: boolean, start?: number }` | 有序/无序，起始序号            |
| `link`              | `{ href: string, title?: string }`     | 目标 URL，可选 title           |
| `image`             | `{ src: string, alt: string }`         | 图片地址、替代文本             |
| `fence_code_block`  | `{ lang?: string }`                    | 围栏语言标识                   |
| `table`             | `{ align?: ('left'\|'center'\|'right')[] }` | 各列对齐方式（可选）     |
| `table_cell`        | `{ is_header: boolean }`               | th / td 判定                   |
| `line_break`        | `{ tight?: boolean }`                  | true = 行尾双空格, false = \   |
| 其他                | `undefined`                            | —                              |

```typescript
type NodeAttrs =
  | { level: number }                                         // heading
  | { ordered: boolean; start?: number }                      // list
  | { href: string; title?: string }                          // link
  | { src: string; alt: string }                              // image
  | { lang?: string }                                         // fence_code_block
  | { align?: ('left' | 'center' | 'right')[] }              // table
  | { is_header: boolean }                                    // table_cell
  | { tight?: boolean }                                       // line_break
  | undefined;                                                // 其他
```

### 3.4 节点关系约束

```
document
  └── block* (以下任意，顺序排列)

heading ─── children: [InlineNode*]     // 标题文本内可含行内标记
paragraph ─ children: [InlineNode*]     // 同上
blockquote ─ children: [BlockNode*]     // 引用内可含任意块级
list ─────── children: [list_item*]     // 列表只含列表项
list_item ── children: [BlockNode*]     // 列表项内可含任意块级

// 行内嵌套规则
strong ──── children: [InlineNode*]     // 可嵌套 emphasis 等
emphasis ── children: [InlineNode*]     // 可嵌套 strong 等
link ────── children: [InlineNode*]     // 链接文本内允许行内标记
inline_code ─ 无 children, 仅有 value   // 代码内不解析任何标记
text ─────── 无 children, 仅有 value    // 叶节点
```

---

## 4. 数据流转换规约

### 4.1 Token → AST 映射

```
heading              →  heading        (meta.level → attrs.level)
paragraph            →  paragraph
code_block           →  code_block     (raw → value)
fence_code_block     →  fence_code_block (meta.lang → attrs.lang, raw → value)
blockquote_open      →  blockquote (子树开始)
blockquote_close     →  blockquote (子树结束)
unordered_list_open  →  list (ordered=false, 子树开始)
unordered_list_close →  list (子树结束)
ordered_list_open    →  list (ordered=true, 子树开始)
ordered_list_close   →  list (子树结束)
unordered_list_item  →  list_item (子树节点)
ordered_list_item    →  list_item (子树节点)
horizontal_rule      →  horizontal_rule (无 children/value)
blank_line           →  在 AST 中不保留节点，仅控制 list 紧凑/松散
table_row            →  table > table_row > table_cell
```

### 4.2 行内解析前后对比

**解析前（Parser 输出）**：
```
paragraph
  └── text "Hello **world**."
```

**解析后（InlineParser 输出）**：
```
paragraph
  ├── text      "Hello "
  ├── strong
  │    └── text "world"
  └── text      "."
```

**执行规则**：
1. 遍历 AST，找到所有 `type === "text"` 的叶节点。
2. 对其 value 执行行内扫描，替换为行内 AST 子树。
3. 行内代码（`` `code` ``）内的文本**不进入**递归扫描。
4. 转义序列（`\*`）在行内扫描阶段转换为普通字符。

---

## 5. 数据完整性校验断言

以下断言在 `parse()` 和 `compile()` 的执行路径中隐式保证。  
测试套件应覆盖这些断言。

```
断言 1： Token 流的结构型标记严格配对
  ∀ t ∈ tokens: t.type ∈ StructureTokens →
    ∃ 匹配的 close token，且嵌套深度正确。

断言 2： AST 根节点类型恒为 "document"
  parse(tokens).type === "document"

断言 3： 容器节点必有 children，叶节点必无 children
  ∀ n ∈ AstNode: 
    isContainer(n.type) → Array.isArray(n.children) ∧ n.children.length > 0
    isLeaf(n.type) → n.children === undefined

断言 4： 文本类叶节点必有 value
  ∀ n ∈ {text, inline_code, code_block, fence_code_block}:
    typeof n.value === "string"

断言 5： link / image 节点必有对应 attrs
  n.type === "link"  → typeof n.attrs.href === "string"
  n.type === "image" → typeof n.attrs.src === "string" 
                     ∧ typeof n.attrs.alt === "string"

断言 6： heading level 在 1..6 范围内
  n.type === "heading" → 1 ≤ n.attrs.level ≤ 6

断言 7： blockquote depth 在 1..10 范围内
  t.type === "blockquote_line" → 1 ≤ t.meta.depth ≤ 10

断言 8： fence_code_block 的 lang 不为空字符串
  t.type === "fence_code_block" ∧ t.meta.lang !== undefined
    → t.meta.lang.length > 0
```

---

## 6. 类型定义文件索引

实现时，将以下结构定义放置在独立文件中，供所有模块 import。

| 文件路径                           | 导出内容                          |
|-----------------------------------|-----------------------------------|
| `src/token.ts`                    | `TokenType`, `Token`, `TokenMeta` |
| `src/ast.ts`                      | `AstNodeType`, `AstNode`, `NodeAttrs` |
| `src/options.ts`                  | `MdToHtmlOptions`, `LexerOptions`, `ParserOptions`, `InlineOptions` |

> `src/token.ts` 和 `src/ast.ts` **零依赖**（不引用项目中任何其他模块）。  
> `src/options.ts` 可引用 `token.ts` 和 `ast.ts`。

---

## 附录 A：变更记录

| 版本   | 日期       | 变更内容                                      |
|--------|------------|-----------------------------------------------|
| v1.0   | 2026-05-13 | 初始定稿。定义 Token 流 + AST 完整 schema。   |

---

## 附录 B：与 design.md 的对照索引

| design.md 章节     | data_model.md 对应章节 | 差异说明                    |
|--------------------|------------------------|-----------------------------|
| 3.2 Token 类型定义  | §2.1 TokenType 枚举    | 补充了 `table_row` 类型     |
| 3.2 Token interface | §2.2 Token 结构        | 明确 TypeScript interface   |
| 3.4 AST 节点类型    | §3.1 AstNodeType 枚举  | 补充了 `table` 系列节点     |
| 3.4 AstNode interface | §3.2 AstNode 结构     | 拆分 `value` 与 `attrs`     |
| —                   | §5 完整性校验断言       | 新增，非 design.md 原有内容 |

---

> **书记官备注**  
> 数据结构是编译工具的骨架。骨架不正，肌肉（解析逻辑）和皮肤（渲染输出）都会歪。  
> 所有后续代码实现必须严格遵循此文档定义的类型，任何 schema 变更必须先更新本文档，再改代码。
