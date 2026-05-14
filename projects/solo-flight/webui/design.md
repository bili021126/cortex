# Markdown → HTML 编译工具 · 设计文档

> **探索者**：纳西妲（Analysis Agent）  
> **探索日期**：2026-05-13  
> **目标版本**：v1.0.0  
> **状态**：初稿 · 待评审  

---

## 目录

1. [概述](#1-概述)
2. [功能规格](#2-功能规格)
3. [解析策略](#3-解析策略)
4. [技术栈](#4-技术栈)
5. [架构设计](#5-架构设计)
6. [模块说明](#6-模块说明)
7. [API 设计](#7-api-设计)
8. [边界与约束](#8-边界与约束)
9. [风险与前瞻](#9-风险与前瞻)
10. [参考资料](#10-参考资料)

---

## 1. 概述

### 1.1 动机

在 solo-flight 项目中，存在将结构化文本（Markdown）转换为 Web 展示内容（HTML）的需求。当前代码库（密码管理器 CLI）无任何文本渲染能力。设计一个独立的 Markdown→HTML 编译工具，可为未来 Web UI 模块提供底层渲染引擎。

### 1.2 设计目标

| 维度 | 目标 |
|------|------|
| **正确性** | 输出的 HTML 语义与 Markdown 语义一致，无信息丢失 |
| **可扩展** | 语法解析器与渲染器分离，新增语法无需修改核心流程 |
| **无外部依赖** | 核心解析器零依赖，仅 Node.js 内置模块 + TypeScript |
| **可观测** | 解析过程暴露 token 流和 AST，便于调试 |
| **可测试** | 每个阶段独立可测，支持快照测试 |

### 1.3 非目标

- ❌ 不处理 HTML 转义外的 XSS 防护（由上层调用方负责）
- ❌ 不做语法校验外的 Markdown 规范校验（如 CommonMark 完整合规是长期目标，v1 覆盖常用语法即可）
- ❌ 不包含 CSS 样式输出（仅输出语义 HTML，样式由消费方决定）
- ❌ 不处理非 UTF-8 编码输入

---

## 2. 功能规格

### 2.1 支持的语法（v1.0）

#### 块级元素

| 语法 | 示例 | 输出 HTML |
|------|------|-----------|
| 标题 | `# h1` ~ `###### h6` | `<h1>~<h6>` |
| 段落 | 连续文本，空行分隔 | `<p>` |
| 无序列表 | `- item` / `* item` | `<ul><li>` |
| 有序列表 | `1. item` | `<ol><li>` |
| 引用块 | `> text`（支持嵌套） | `<blockquote>` |
| 代码块 | 缩进 4 空格 / 围栏 ` ``` ` | `<pre><code>` |
| 水平线 | `---` / `***` / `___` | `<hr>` |
| 空行 | 连续空行压缩为单个 `<br>` 或忽略 | — |

#### 行内元素

| 语法 | 示例 | 输出 HTML |
|------|------|-----------|
| 加粗 | `**text**` / `__text__` | `<strong>` |
| 斜体 | `*text*` / `_text_` | `<em>` |
| 删除线 | `~~text~~` | `<del>` |
| 行内代码 | `` `code` `` | `<code>` |
| 链接 | `[text](url)` | `<a href="url">` |
| 图片 | `![alt](src)` | `<img src="src" alt="alt">` |
| 转义 | `\*` | 输出字面字符 |

#### 扩展语法（v1.0 可选）

| 语法 | 说明 | 优先级 |
|------|------|--------|
| 表格 | `\| col1 \| col2 \|` | P1 — 常见需求 |
| 任务列表 | `- [ ] task` / `- [x] done` | P2 |
| 围栏代码块语言标识 | ```` ```ts ```` | P1 — 代码高亮必备 |
| 自动链接 | `<https://example.com>` | P2 |

### 2.2 输出规格

- **HTML5 DOCTYPE**：可选（可通过配置关闭完整文档包裹）
- **段落包裹**：所有块级内容包裹在语义标签中
- **代码块**：围栏代码块自动添加 `data-language` 属性
- **自闭合标签**：`<img>`、`<hr>`、`<br>` 符合 HTML5 规范
- **属性转义**：`&`、`<`、`>`、`"`、`'` 在属性和文本中正确转义

### 2.3 配置选项

```typescript
interface MdToHtmlOptions {
  /** 是否输出完整的 HTML 文档（包含 <!DOCTYPE> 和 <html>） */
  fullDocument?: boolean;        // 默认 false
  
  /** 是否启用表格扩展语法 */
  tables?: boolean;              // 默认 true
  
  /** 是否启用任务列表扩展语法 */
  taskLists?: boolean;           // 默认 false
  
  /** 代码块自定义 CSS 类名前缀 */
  codeBlockClassPrefix?: string; // 默认 'language-'
  
  /** 标题 ID 生成策略：'auto' | 'none' | ((text:string)=>string) */
  headingIds?: 'auto' | 'none' | ((text: string) => string); // 默认 'auto'
}
```

---

## 3. 解析策略

### 3.1 整体流程

```
  原始 Markdown 文本
         │
         ▼
  ┌──────────────┐
  │   Lexer      │  第一阶段：词法分析 → Token 流
  │  (词法分析)  │  按行 + 状态机识别块级类型
  └──────┬───────┘
         │ Token[]
         ▼
  ┌──────────────┐
  │   Parser     │  第二阶段：语法分析 → AST
  │  (语法分析)  │  构建嵌套结构（列表嵌套、引用嵌套）
  └──────┬───────┘
         │ AST Node[]
         ▼
  ┌──────────────┐
  │ InlineParser │  第三阶段：行内解析
  │  (行内分析)  │  在文本节点内解析加粗/链接/代码等
  └──────┬───────┘
         │ AST Node[] (完整)
         ▼
  ┌──────────────┐
  │  Renderer    │  第四阶段：HTML 渲染
  │  (渲染器)    │  AST → HTML 字符串
  └──────┬───────┘
         │ HTML string
         ▼
    输出
```

### 3.2 阶段一：Lexer（词法分析）

**策略：逐行扫描 + 块级状态机**

每一行经过以下判定，确定其块级类型：

```
输入行 → 空行检测 → 标题检测 → 围栏代码块 → 引用块检测 → 
列表项检测 → 水平线检测 → 段落（默认）
```

关键设计决策：

1. **围栏代码块作为状态切换**：遇到 ` ``` `（或 `~~~`），切换到代码块模式，此模式下所有行不参与其他匹配，直到闭合围栏。
2. **引用块嵌套计数**：`>` 的嵌套深度由 `>` 的连续数量决定（`>>` 表示嵌套两层）。
3. **列表延续规则**：松散列表（列表项间有空行）每个 `<li>` 包裹 `<p>`；紧凑列表（无空行）不包裹。
4. **缩进处理**：代码块缩进（4 空格或 1 tab）在词法层标记。

**Token 类型定义**：

```typescript
type TokenType =
  | 'heading' | 'paragraph' | 'code_block' | 'fence_code_block'
  | 'blockquote' | 'unordered_list_item' | 'ordered_list_item'
  | 'horizontal_rule' | 'blank_line' | 'table_row'
  | 'unordered_list_open' | 'unordered_list_close'
  | 'ordered_list_open' | 'ordered_list_close'
  | 'blockquote_open' | 'blockquote_close';

interface Token {
  type: TokenType;
  raw: string;         // 原始文本
  meta?: Record<string, unknown>; // 如 heading 级别、列表序号等
}
```

### 3.3 阶段二：Parser（语法分析 — 块级）

**策略：递归下降构建 AST**

Lexer 输出的 Token 流是扁平的。Parser 负责将扁平的 Token 流转换为嵌套的 AST。

核心规则：

```
root        → block*
block       → heading | paragraph | code_block | fence_code_block
            | blockquote | list | horizontal_rule | table

blockquote  → blockquote_open block* blockquote_close
list        → list_open list_item+ list_close
list_item   → list_item_open block* list_item_close
```

**为什么不用正则替代**：Markdown 的嵌套结构（引用套列表、列表套引用、套代码块）是**上下文敏感**的，正则无法正确处理。递归下降解析器可自然处理无限嵌套。

### 3.4 阶段三：InlineParser（行内解析）

**策略：扫描 + 匹配 + 递归**

在文本内容中识别行内标记。采用从左到右扫描、匹配最短闭合模式的方式。

优先级（从高到低）：
1. 转义字符 `\X`
2. 行内代码 `` `...` ``
3. 图片 `![...](...)`
4. 链接 `[...](...)`
5. 加粗 `**...**`
6. 斜体 `*...*`
7. 删除线 `~~...~~`
8. 自动链接 `<...>`

**嵌套处理**：加粗内可含斜体（`**a *b* c**`），但代码内不解析任何标记。

**AST 节点类型**：

```typescript
type AstNodeType =
  | 'document' | 'heading' | 'paragraph' | 'code_block' | 'fence_code_block'
  | 'blockquote' | 'list' | 'list_item' | 'table' | 'table_row' | 'table_cell'
  | 'text' | 'strong' | 'emphasis' | 'delete' | 'inline_code' | 'link' | 'image'
  | 'line_break' | 'horizontal_rule';

interface AstNode {
  type: AstNodeType;
  children?: AstNode[];
  value?: string;              // 文本节点的值
  attrs?: Record<string, string>; // 如 href, src, alt, level
  meta?: Record<string, unknown>;
}
```

### 3.5 阶段四：Renderer（渲染器）

**策略：AST 递归遍历 → 拼接 HTML**

从根节点（document）开始，对每个节点类型执行对应的渲染函数：

```typescript
function renderNode(node: AstNode): string {
  switch (node.type) {
    case 'paragraph':
      return `<p>${renderChildren(node)}</p>`;
    case 'strong':
      return `<strong>${renderChildren(node)}</strong>`;
    case 'link':
      return `<a href="${escapeAttr(node.attrs!.href)}">${renderChildren(node)}</a>`;
    // ...
  }
}
```

**转义规则**：
- 文本节点：`&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`
- 属性值：额外转义 `"` → `&quot;`, `'` → `&#39;`
- 行内代码 / 代码块：仅转义 `<` 和 `>`（保持 `&` 原样）

---

## 4. 技术栈

### 4.1 核心

| 技术 | 版本 | 用途 |
|------|------|------|
| Node.js | ≥ 20 LTS | 运行时 |
| TypeScript | ≥ 5.5 | 类型安全 + ESM 输出 |
| — | — | **零运行时依赖**（核心解析器） |

### 4.2 开发 & 测试

| 工具 | 用途 |
|------|------|
| tsx | 开发时直接运行 TypeScript |
| vitest / node:test | 单元测试 + 快照测试 |
| tsc | 类型检查 + 构建 |
| glob | 批量测试用例发现 |

### 4.3 为什么不选 marked / remark / unified

- **marked**：成熟但解析流程不可拆解，无法独立获取 AST 和 Token 流。作为参考实现对比验证。
- **remark / unified**：功能强大但依赖树庞大（~30+ 包），与本项目"轻量、可观测"目标冲突。
- **自行实现**：核心语法解析约 600-800 行 TypeScript，维护成本可控；且完全可控的 AST 结构对后续 Web UI 场景（如实时预览、局部渲染）更友好。

> **折中方案**：如果未来需要完整 CommonMark 合规，可在不改变 API 的前提下将核心解析器替换为 `marked` 的 lexer/parser，保留 Renderer 层。

---

## 5. 架构设计

### 5.1 包结构

```
packages/
  md-to-html/          # 核心编译工具包
    src/
      index.ts         # 公共入口，导出 MdToHtml
      lexer.ts         # 词法分析器
      lexer.test.ts    # 词法分析测试
      parser.ts        # 块级语法分析器
      parser.test.ts
      inline-parser.ts # 行内解析器
      inline-parser.test.ts
      renderer.ts      # HTML 渲染器
      renderer.test.ts
      ast.ts           # AST 类型定义
      token.ts         # Token 类型定义
      options.ts       # 配置类型与默认值
      escape.ts        # HTML 转义工具
      utils.ts         # 通用工具（缩进检测等）
    fixtures/          # 测试用例（.md + 期望输出 .html）
      headings/
      lists/
      code-blocks/
      ...
    README.md
    package.json
```

### 5.2 数据流

```
输入字符串
    │
    ▼
MdToHtml.compile(input, options?)
    │
    ├──→ lexer.lex(input)           → Token[]
    │      逐行扫描，状态机识别块级类型
    │
    ├──→ parser.parse(tokens)       → AstNode (document)
    │      构建嵌套结构
    │
    ├──→ inlineParser.parse(ast)    → AstNode (完善行内节点)
    │      遍历 AST，在文本节点上解析行内标记
    │
    └──→ renderer.render(ast)       → string (HTML)
           递归生成 HTML 字符串
```

### 5.3 公共 API

```typescript
// packages/md-to-html/src/index.ts

export class MdToHtml {
  constructor(options?: Partial<MdToHtmlOptions>);
  
  /** 编译 Markdown 到 HTML */
  compile(input: string): string;
  
  /** 仅解析 → 获取 AST（用于预览/检查） */
  parse(input: string): AstNode;
  
  /** 获取 Token 流（用于调试） */
  tokenize(input: string): Token[];
}

export { AstNode, AstNodeType } from './ast.js';
export { Token, TokenType } from './token.js';
export { MdToHtmlOptions } from './options.js';
```

---

## 6. 模块说明

### 6.1 lexer.ts — 词法分析器

```
职责：
  - 将原始 Markdown 文本按行分割
  - 通过状态机识别每行的块级类型
  - 输出 Token[]

核心状态机：

  INITIAL ──→ FENCE_CODE (遇到 ```)
     │                      │
     └──→ BLOCKQUOTE (遇到 >)  │
     └──→ LIST (遇到 -/*/1.)  │
     └──→ PARAGRAPH (默认)    │
                              │
  FENCE_CODE ──→ INITIAL (遇到闭合 ```)
  
接口：
  function lex(input: string, options: LexerOptions): Token[]
```

### 6.2 parser.ts — 块级语法分析器

```
职责：
  - 消费 Token[] 流
  - 识别块级嵌套结构（list-in-list, blockquote-in-list 等）
  - 输出根 AstNode（type: 'document'）

核心算法：
  递归下降解析（Recursive Descent），每个块类型对应一个解析函数

  parseBlock(tokens, pos):
    peek token type
    → 'heading'       → parseHeading(tokens, pos)
    → 'blockquote_open' → parseBlockquote(tokens, pos)
    → 'unordered_list_open' → parseList(tokens, pos)
    → ...
    
接口：
  function parse(tokens: Token[], options: ParserOptions): AstNode
```

### 6.3 inline-parser.ts — 行内解析器

```
职责：
  - 遍历 AST，找到所有文本节点
  - 在文本节点内解析行内标记（加粗、链接、代码等）
  - 用新的行内 AST 节点替换纯文本节点

核心策略：
  从左到右扫描字符串，用正则或字符遍历找到最近的标记边界
  遇到行内代码 `` ` `` 时进入代码模式，内部不解析其他标记
  
接口：
  function parseInline(ast: AstNode, options: InlineOptions): void
  // 注意：原地修改 AST，不返回新树
```

### 6.4 renderer.ts — HTML 渲染器

```
职责：
  - 递归遍历 AST
  - 对每个节点类型应用对应的 HTML 模板
  - 拼接成 HTML 字符串

接口：
  function render(node: AstNode): string
  
渲染映射表（核心）：

  document     → 拼接子节点
  heading      → <h{level}>{children}</h{level}>
  paragraph    → <p>{children}</p>
  strong       → <strong>{children}</strong>
  emphasis     → <em>{children}</em>
  delete       → <del>{children}</del>
  inline_code  → <code>{value}</code>
  link         → <a href="{href}">{children}</a>
  image        → <img src="{src}" alt="{alt}">
  code_block   → <pre><code>{value}</code></pre>
  fence_code   → <pre><code class="language-{lang}">{value}</code></pre>
  blockquote   → <blockquote>{children}</blockquote>
  list         → <ul>/<ol>{children}</ul>/</ol>
  list_item    → <li>{children}</li>
  table        → <table>...</table>
  table_row    → <tr>...</tr>
  table_cell   → <td>/<th>{children}</td>/</th>
  horizontal_rule → <hr>
  line_break   → <br>
  text         → {escaped_value}
```

---

## 7. API 设计

### 7.1 核心类

```typescript
// 使用示例
import { MdToHtml } from '@solo-flight/md-to-html';

const converter = new MdToHtml({
  fullDocument: false,
  tables: true,
  headingIds: 'auto',
});

const html = converter.compile('# Hello\n\nThis is **bold** text.');
// → '<h1 id="hello">Hello</h1>\n<p>This is <strong>bold</strong> text.</p>'

// 调试支持
const tokens = converter.tokenize('# Hello');
const ast = converter.parse('# Hello');
```

### 7.2 CLI 接口（可选，v1.1）

```bash
# 将 markdown.md 编译为 markdown.html
$ md-to-html input.md -o output.html

# 输出到 stdout
$ md-to-html input.md

# 监视模式
$ md-to-html input.md -o output.html --watch

# 生成 AST 快照（调试）
$ md-to-html input.md --ast
```

---

## 8. 边界与约束

### 8.1 已知限制（v1.0）

| 限制 | 原因 | 后续方向 |
|------|------|----------|
| 不支持定义列表 | 使用率低 | v1.1 可加 |
| 不支持脚注 | 需后处理 pass | v1.2 |
| 不支持 Emoji 短代码 | 非标准 Markdown | 由上层处理 |
| 不支持数学公式 | 需 LaTeX 解析器 | 独立插件 |
| 无 HTML 内部解析 | 不处理内嵌 HTML 标签 | 可选 RawHTML 插件 |
| 输入大小 ≤ 1MB | 防止内存溢出 | 可配置上限 |

### 8.2 错误处理

| 场景 | 行为 |
|------|------|
| 围栏代码块未闭合 | 将未闭合部分视为代码块，发出警告 |
| 引用块无限嵌套 | 最大嵌套深度 10 层，超限截断 |
| 空输入 | 返回空字符串 `''` |
| 非法 UTF-8 | 抛出 `SyntaxError` |
| 配置无效 | 在构造时 throw `ValidationError` |

### 8.3 安全约束

- **XSS 防护**：Renderer 对所有文本内容和属性值做 HTML 转义
- **链接安全**：`<a>` 的 `href` 不做限制（由消费方配合 CSP）
- **输入大小**：建议外层调用方限制输入长度（如 1MB）

---

## 9. 风险与前瞻

### 9.1 风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| CommonMark 合规差距大 | 中 | 中 | v1 仅覆盖常用语法，后续逐步补齐 |
| 嵌套解析性能瓶颈 | 低 | 低 | 递归深度限制 + 可选的尾递归优化 |
| 与 marked 输出不一致 | 中 | 低 | 建立 fixture 对比测试，标记差异 |
| 行内解析歧义（`***`） | 低 | 中 | 参考 CommonMark 规范决定优先级 |
| 团队无解析器经验 | 中 | 中 | 设计文档 + 注释驱动 + 测试覆盖 |

### 9.2 未来扩展方向

- **v1.1**：表格、任务列表、CLI 工具
- **v1.2**：自动链接、脚注、定义列表
- **v2.0**：插件系统（自定义语法块）、HTML 内嵌支持
- **v3.0**：流式解析（大文件分块渲染）、实时预览 WebSocket 集成

---

## 10. 参考资料

| 资料 | 说明 |
|------|------|
| [CommonMark Spec 0.31.2](https://spec.commonmark.org/0.31.2/) | Markdown 规范官方标准 |
| [marked.js 源码](https://github.com/markedjs/marked) | 成熟实现，作为对比参考 |
| [unified / remark](https://github.com/remarkjs/remark) | 基于 AST 的生态，设计理念参考 |
| [solo-flight 现有代码](file:///src/) | 本项目密码管理器，技术栈参考 |
| [前次代码审查报告](file:///reports/code-review.md) | 团队报告风格参考 |

---

## 附录 A：解析示例

### A.1 简单段落

**输入**：
```
Hello **world**.
```

**Token 流**：
```
[{ type: 'paragraph', raw: 'Hello **world**.' }]
```

**AST**：
```
document
  └── paragraph
       ├── text        "Hello "
       ├── strong
       │    └── text   "world"
       └── text        "."
```

**输出**：
```html
<p>Hello <strong>world</strong>.</p>
```

### A.2 嵌套引用 + 列表

**输入**：
```
> - item 1
> - item 2
>
> 继续引用
```

**AST**：
```
document
  └── blockquote
       ├── list (unordered)
       │    ├── list_item
       │    │    └── paragraph
       │    │         └── text "item 1"
       │    └── list_item
       │         └── paragraph
       │              └── text "item 2"
       └── paragraph
            └── text "继续引用"
```

---

> **设计小结**  
> 这是一个"够用、可拆、能长"的 Markdown→HTML 编译工具。  
> v1 覆盖 80% 日常语法，解析流程全透明，核心零依赖。  
> 后续可以逐层叠加语法支持，也可以整体替换为 marked 引擎而不影响 API 消费者。  
> 下一阶段：在 `packages/md-to-html` 下实现 Lexer + Parser 原型，建立 fixture 测试基线。
