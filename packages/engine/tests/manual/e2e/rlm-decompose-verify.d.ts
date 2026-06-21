/**
 * RLM decompose 真实 LLM 验证
 *
 * 用法: npx tsx tests/manual/e2e/rlm-decompose-verify.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 验证内容:
 *   1. 复杂任务拆解——payload > 200 字的任务能否被正确拆解为原子子任务
 *   2. 简单任务回退——简短任务是否正确地回退到直接执行
 *   3. 密度标注——子任务是否自标注了合理的 density 级别
 *   4. 信心评分——LLM 是否给出了合理的 confidence
 *   5. depends_on 依赖——子任务间的依赖关系是否合理
 */
export {};
//# sourceMappingURL=rlm-decompose-verify.d.ts.map