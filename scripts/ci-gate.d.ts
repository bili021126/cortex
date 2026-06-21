#!/usr/bin/env npx tsx
/**
 * CI 门禁脚本 —— 薄壳
 *
 *   @ci 标签扫描 + 按包串行 vitest 调用 + 结果汇总
 *
 * vitest 2.1.9 + Node 24 下 workspace 模式存在启动错误，
 * 根级聚合 config 会导致单进程 OOM。改用按包逐个跑，简单可靠。
 *
 * 用法:
 *   npx tsx scripts/ci-gate.ts                正常门禁（只跑 @ci: unit）
 *   npx tsx scripts/ci-gate.ts --all          全量（包括 @ci: llm / integration）
 *   npx tsx scripts/ci-gate.ts --dry-run      仅扫描 @ci 标签，不执行
 *   npx tsx scripts/ci-gate.ts --json         机器可读 JSON 输出
 *
 * @ci 标签规范（写在测试文件第一行注释中）:
 *   // @ci: unit         CI 必跑（默认值）
 *   // @ci: llm          需要 LLM API，CI 跳过
 *   // @ci: integration  需要外部服务，CI 跳过
 *   // @ci: e2e          端到端测试，CI 跳过
 *   // @ci: manual       人工触发，永远不自动跑
 */
export {};
//# sourceMappingURL=ci-gate.d.ts.map