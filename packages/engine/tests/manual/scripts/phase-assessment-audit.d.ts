/**
 * Cortex v2.6.9 阶段研判——宪法-代码一致性审计
 *
 * 用法: npx tsx packages/engine/tests/manual/scripts/phase-assessment-audit.ts
 *
 * 审查范围（全确定性，零 LLM 依赖）:
 *   1. 包数量验证（27）
 *   2. 新包存在性（fsm-compiler/plugin-runner/policy-validator/telemetry）
 *   3. Engine 纯净度（governance/platform 目录是否已从 engine 拆出）
 *   4. 拆出包独立性（governance/platform/memory-store/consistency 有独立 package.json）
 *   5. 依赖链宪法对齐（逐包验证 workspace 依赖与宪法声明一致）
 *   6. 旧 REPL 清除验证
 *   7. Config 子目录结构验证
 *   8. 编译验证（tsc --noEmit）
 *
 * 产出: 结构化审计报告 → 输出至 test-output/phase-assessment/
 */
export {};
//# sourceMappingURL=phase-assessment-audit.d.ts.map