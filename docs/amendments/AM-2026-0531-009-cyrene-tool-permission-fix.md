# AM-2026-0531-009：昔涟工具权限对齐——list_dir → list_files

**提案编号**：AM-2026-0531-009  
**提案日期**：2026-05-31  
**优先级**：P3（低风险，配置修正）  
**来源**：昔涟（提案+评判）+ 开拓者（裁决）  
**状态**：✅ 已入宪（v2.5.37）

---

## 一、问题描述

`cortex-agents.json` 中 cyrene（butler 类型）的 `toolPermissions` 包含 `"list_dir"`，但 Cortex 有效工具注册表（REAL_TOOLS）中该工具名实际为 `"list_files"`。每次 `bootstrapEngine()` 执行时，跨字段校验逻辑输出配置警告：

```
跨字段校验警告: agents.cyrene.toolPermissions 包含未知工具: "list_dir"。
有效工具: read_file, write_file, search_code, web_search, run_shell, list_files, delete_file, parse_ast, browser_do
```

## 二、根因

toolPermissions 字段与 REAL_TOOLS 注册名不一致。`list_dir` 从未作为有效工具名定义过，自始即为 `list_files`。

## 三、修复

### 3.1 cortex-agents.json

```diff
- "toolPermissions": ["read_file", "search_code", "list_dir"],
+ "toolPermissions": ["read_file", "search_code", "list_files"],
```

### 3.2 宪法 §5.1 Agent 类型表

ButlerAgent 的"允许工具"列与实际配置对齐：

```diff
- | **ButlerAgent** | web_search（管家信息检索） |
+ | **ButlerAgent** | read_file + search_code + list_files（管家信息检索与项目探查） |
```

## 四、宪法变更摘要

| 位置 | 变更 |
|------|------|
| §5.1 ButlerAgent 行 | 允许工具 `web_search` → `read_file + search_code + list_files` |
| 版本号 | v2.5.36 → v2.5.37 |
| §16 版本演进链 | 新增 v2.5.36→v2.5.37 条目 |

## 五、验证

- 修复后 `cortex agent spawn code` 不再输出 `list_dir` 配置警告
- `cortex-agents.json` cyrene toolPermissions 字段与 REAL_TOOLS 注册表一致
