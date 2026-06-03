// ============================================================
// 🌿 Cortex 技能注册表 — 基础技能抽象类
// 设计：纳西妲 | 实现：阿贝多
//
// 提供技能接口的默认实现，技能作者只需继承此类并实现 run()
//
// @moved-from projects/solo-flight/src/skill/base-skill.ts
// ============================================================

import type {
  Skill,
  SkillMeta,
  SkillResult,
  ExecutionContext,
} from './types.js';

/**
 * 基础技能抽象类
 *
 * 用法:
 * ```ts
 * class MySkill extends BaseSkill<{ input: string }, { output: string }> {
 *   meta = {
 *     id: createSkillId('my-skill'),
 *     name: '我的技能',
 *     version: createSkillVersion('1.0.0'),
 *     description: '这是一个示例技能',
 *     tags: ['example'],
 *     dependencies: [],
 *     category: SkillCategory.DATA,
 *   };
 *
 *   async run(ctx: ExecutionContext): Promise<SkillResult<{ output: string }>> {
 *     const input = ctx.input.params as { input: string };
 *     return { success: true, data: { output: `Hello, ${input.input}!` } };
 *   }
 * }
 * ```
 */
export abstract class BaseSkill<TInput = unknown, TOutput = unknown>
  implements Skill<TInput, TOutput>
{
  /** 技能元信息——子类必须覆盖 */
  abstract meta: SkillMeta;

  /** 执行技能——子类必须实现 */
  abstract run(context: ExecutionContext): Promise<SkillResult<TOutput>>;

  /** （可选）输入校验 */
  validate?(input: unknown): input is TInput;

  /** （可选）技能初始化 */
  onInit?(): Promise<void>;

  /** （可选）技能销毁 */
  onDestroy?(): Promise<void>;
}
