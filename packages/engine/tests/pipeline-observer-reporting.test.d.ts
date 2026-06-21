/**
 * 测试文件: PipelineObserver SafeErrorReporter 上报测试 (方案A)
 *
 * 测试范围:
 * - createSafeReporter() 返回可调用函数
 * - silent 错误 <3 次连续发生时不 emit 事件
 * - silent 错误 =3 次连续发生时 emit error.silent_upgraded 事件
 * - non-silent 错误立即 emit error.reported 事件
 * - non-silent 错误重置 silent 计数器
 * - fatal 级别以 CRITICAL 优先级发送
 * - degraded 级别以 HIGH 优先级发送
 *
 * 治理判例: NG-2026-0509-Persist-False-Positive
 *
 * 测试数据用例:
 *   用例1: createSafeReporter() 返回可调用 SafeErrorReporter
 *   用例2: silent 错误连续 2 次不触发升级
 *   用例3: silent 错误连续 3 次触发 error.silent_upgraded 事件
 *   用例4: degraded 错误触发 error.reported 事件（HIGH 优先级）
 *   用例5: fatal 错误触发 error.reported 事件（CRITICAL 优先级）
 *   用例6: non-silent 错误重置 silent 计数器
 */
export {};
//# sourceMappingURL=pipeline-observer-reporting.test.d.ts.map