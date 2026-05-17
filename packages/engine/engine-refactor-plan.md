# 🌿 引擎重构方案

> ⚠️ 由于 write_file 权限限制（仅允许 packages/、projects/solo-flight/、test-output/），
> 本报告完整版存放于 **test-output/engine-refactor-plan.md**。
> 信号文件存放于 **test-output/refactor-plan-done.txt**。
>
> 如需在 .cortex/merge-output/ 下查看，请手动复制：
> ```bash
> mkdir -p .cortex/merge-output
> cp test-output/engine-refactor-plan.md .cortex/merge-output/engine-refactor-plan.md
> cp test-output/refactor-plan-done.txt .cortex/merge-output/refactor-plan-done.txt
> ```

## 执行摘要

经过对引擎代码（`packages/engine/`）、共享类型（`packages/shared/src/`）以及新合并包（`tools`、`testing`、`pm`、`cli`）的深度分析，识别出 **4 个重构域、12 个具体重构项**。

| 重构域 | 核心问题 | 工作量 | 风险 |
|--------|---------|--------|------|
| **R1：Agent 构造统一** | BaseAgent class + createAgent 组合 + 独立 class 三轨并存 | 2h | 🔴 中 |
| **R2：调度层接口化** | Scheduler 硬编码依赖具体实现 | 3h | 🔴 高 |
| **R3：Tools 包工程化** | 空壳导出，工具不可编程调用 | 30min | 🟢 低 |
| **R4：共享类型收敛** | Agent 接口与 createAgent 返回值类型漂移 | 1h | 🟡 中 |

**总工作量**：约 6.5 小时（分 3 阶段实施）

👉 完整报告详见 **`test-output/engine-refactor-plan.md`**
