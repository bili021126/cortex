# 修复报告 — NG-AUDIT-2026-005

## 症状

根 `package.json` 缺少 `"type": "module"` 声明。

## 根因

项目已全面迁移至 ESM 体系：
- `tsconfig.base.json` 使用 `"module": "Node16"`
- 全部 11 个子包均已声明 `"type": "module"`
- 但根 `package.json` 未同步更新

违反宪法 §2 模块化一致性契约。

## 影响评估

| 维度 | 评级 | 说明 |
|------|------|------|
| 运行时 | 🟢 低 | pnpm workspace 子包独立加载，根配置不影响子包 ESM 行为 |
| 根目录脚本 | 🟡 中 | 新增根目录 ESM 脚本时 Node.js 默认 CJS 模式导致 `import` 语法报错 |
| 工具链升级 | 🟡 中 | 未来工具链可能检查根配置一致性 |

## 修复操作

在根 `package.json` 的 `"name"` 字段后插入一行 `"type": "module"`。

**修复脚本**: `scripts/fix-root-type-module.ts`
**运行方式**: `npx tsx scripts/fix-root-type-module.ts`

## 验证方法

```bash
# 方法 1：直接检查
grep '"type": "module"' package.json

# 方法 2：运行时验证 ESM 可用
npx tsx -e "console.log(typeof import.meta.resolve)"
```

## 状态

- [x] 诊断完成
- [x] 修复脚本就位（`scripts/fix-root-type-module.ts`）
- [ ] 修复已应用（需运行脚本或手动修改根 `package.json`）

---

*病历编号: NG-AUDIT-2026-005*
*登记时间: 2026-07-20*
*登记护士: 希格雯*
