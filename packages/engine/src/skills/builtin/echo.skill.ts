// ============================================================
// 🌿 Cortex 技能注册表 — 内置：回声技能
// 设计：纳西妲 | 实现：阿贝多
//
// 一个简单的测试技能——原样返回输入
//
// @moved-from projects/solo-flight/src/builtin/echo.skill.ts
// ============================================================

import { BaseSkill } from '../../registry/executable-skill/base-skill.js';
import { SkillCategory, type ExecutionContext, type SkillResult } from '../../registry/executable-skill/types.js';
import { createSkillId, createSkillVersion } from '../../registry/executable-skill/utils/id.js';

interface EchoInput {
  message: string;
}

interface EchoOutput {
  message: string;
  timestamp: number;
}

export class EchoSkill extends BaseSkill<EchoInput, EchoOutput> {
  meta = {
    id: createSkillId('builtin-echo'),
    name: '回声技能',
    version: createSkillVersion('1.0.0'),
    description: '原样返回输入消息，用于测试技能注册表',
    author: '阿贝多',
    tags: ['builtin', 'test', 'echo'],
    dependencies: [],
    category: SkillCategory.DATA,
  };

  run(context: ExecutionContext): Promise<SkillResult<EchoOutput>> {
    const input = context.input.params as EchoInput;

    return Promise.resolve({
      success: true,
      data: {
        message: input.message,
        timestamp: Date.now(),
      },
    });
  }

  validate(input: unknown): input is EchoInput {
    return (
      typeof input === 'object' &&
      input !== null &&
      'message' in input &&
      typeof (input as Record<string, unknown>).message === 'string'
    );
  }
}
