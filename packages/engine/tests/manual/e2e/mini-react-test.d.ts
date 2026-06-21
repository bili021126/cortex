/**
 * 超级复杂场景 —— 7 Agent 归入 + 全链路压力测试
 *
 * 用法: npx tsx tests/manual/mini-react-test.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 参与 Agent（9 个）:
 *   MetaAgent    —— 规划拆解
 *   InspectorAgent —— 纯事实采集（文件/导出/行数）
 *   AnalysisAgent  —— 架构分析 + 模块地图
 *   ReviewAgent    —— 代码审查 4 个核心文件
 *   DocGovernAgent —— 宪法合规审计
 *   CodeAgent      —— 汇总发现，修复小问题
 *   LoopAgent      —— 模式提炼，生成技能模板
 *   OpsAgent       —— 环境诊断 + 运维收尾
 *   ButlerAgent    —— 旁观事件总线，格式化输出
 *
 * 验证点：
 *   1. MetaAgent 能否为 7 种意图产出正确类型的 TaskNode
 *   2. Scheduler 能否正确派发到全部 7 种 Agent
 *   3. MemoryStore 与 Agent 共享记忆（探针采集→铁锤修复引用）
 *   4. 多视角节点（review + audit 并行跑同一批文件）
 *   5. 依赖排序（analysis →fix 有序执行）
 *   6. ButlerAgent 事件格式化不丢消息
 *   7. sql.js 持久化重启不丢
 */
export {};
//# sourceMappingURL=mini-react-test.d.ts.map