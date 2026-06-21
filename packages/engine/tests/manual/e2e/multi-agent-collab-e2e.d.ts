/**
 * multi-agent-collab-e2e.ts — 十人协作全链路自主修复验证 v2
 *
 * 参与者: 甘雨(meta), 希格雯(fix), 刻晴(review), 纳西妲(analysis),
 *         凝光(doc-govern), 莫娜(loop), 久岐忍(api), 艾尔海森(data),
 *         钟离(strategist), 霜凝(strategist)
 *
 * 原则:
 *   - 策略不定: 不指定 preferredStrategy, 由 Agent 自行决定
 *   - 调度不定: 不手动编排 Phase, 由 Scheduler + MetaAgent 自主协同
 *   - 源码只读: 工具层限制 write_file 仅在 tests/ 目录
 *   - 独立记忆库: memory-multi-agent-collab.db
 *
 * v2 验证目标:
 *   多 Agent 协作修复 e2e 测试文件编译错误 → npx tsc --noEmit 零报错
 *   目标目录: packages/engine/tests/manual/e2e/ (11 个 .ts 文件)
 *   要求: 编译通过即可，无需运行
 *
 * 用法: npx tsx tests/manual/e2e/multi-agent-collab-e2e.ts [--verbose]
 */
export {};
//# sourceMappingURL=multi-agent-collab-e2e.d.ts.map