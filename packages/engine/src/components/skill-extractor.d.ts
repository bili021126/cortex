import { type SkillTemplate } from "@cortex/shared";
/** 解析 outputFile 模板变量：{date} → YYYY-MM-DD, {time} → HH-MM-SS */
export declare function resolveOutputFile(template: string): string;
/** 提取结果：成功提取的技能 + 解析诊断信息 */
export interface SkillExtractResult {
    skills: SkillTemplate[];
    diagnostics: string[];
}
/**
 * 从 LoopAgent 的 LLM 输出中提取 SkillTemplate JSON。
 *
 * 支持两种输出格式：
 *   1. 单个 SkillTemplate JSON 对象
 *   2. SkillTemplate JSON 数组
 *
 * 提取策略：
 *   1. 优先匹配 ```json ... ``` 围栏
 *   2. 回退到最外层平衡 { } 或 [ ] 结构
 *   3. 验证必需字段完整性
 *   4. 为缺失字段填充安全默认值
 */
export declare function extractSkillsFromOutput(raw: string): SkillExtractResult;
//# sourceMappingURL=skill-extractor.d.ts.map