// ============================================================
// 🌿 Cortex 技能注册表 — 内置：计算器技能
// 设计：纳西妲 | 实现：阿贝多
//
// 支持四则运算的计算器技能
//
// @moved-from projects/solo-flight/src/builtin/calculator.skill.ts
// ============================================================

import { BaseSkill } from '../../registry/executable-skill/base-skill.js';
import { SkillCategory, SkillErrorCode, type ExecutionContext, type SkillResult } from '../../registry/executable-skill/types.js';
import { createSkillId, createSkillVersion } from '../../registry/executable-skill/utils/id.js';

type Operator = 'add' | 'subtract' | 'multiply' | 'divide';

interface CalculatorInput {
  operator: Operator;
  a: number;
  b: number;
}

interface CalculatorOutput {
  operator: Operator;
  a: number;
  b: number;
  result: number;
  expression: string;
}

export class CalculatorSkill extends BaseSkill<CalculatorInput, CalculatorOutput> {
  meta = {
    id: createSkillId('builtin-calculator'),
    name: '计算器',
    version: createSkillVersion('1.0.0'),
    description: '支持四则运算（加、减、乘、除）',
    author: '阿贝多',
    tags: ['builtin', 'tool', 'calculator'],
    dependencies: [],
    category: SkillCategory.TOOL,
  };

  run(context: ExecutionContext): Promise<SkillResult<CalculatorOutput>> {
    const input = context.input.params as CalculatorInput;
    const { operator, a, b } = input;

    let result: number;
    let expression: string;

    switch (operator) {
      case 'add':
        result = a + b;
        expression = `${a} + ${b} = ${result}`;
        break;
      case 'subtract':
        result = a - b;
        expression = `${a} - ${b} = ${result}`;
        break;
      case 'multiply':
        result = a * b;
        expression = `${a} × ${b} = ${result}`;
        break;
      case 'divide':
        if (b === 0) {
          return Promise.resolve({
            success: false,
            error: {
              code: SkillErrorCode.VALIDATION_FAILED,
              message: '除数不能为 0',
            },
          });
        }
        result = a / b;
        expression = `${a} ÷ ${b} = ${result}`;
        break;
      default:
        return Promise.resolve({
          success: false,
          error: {
            code: SkillErrorCode.VALIDATION_FAILED,
            message: `不支持的操作符: ${operator}（支持: add, subtract, multiply, divide）`,
          },
        });
    }

    return Promise.resolve({
      success: true,
      data: {
        operator,
        a,
        b,
        result,
        expression,
      },
    });
  }

  validate(input: unknown): input is CalculatorInput {
    if (typeof input !== 'object' || input === null) return false;
    const obj = input as Record<string, unknown>;
    return (
      typeof obj.operator === 'string' &&
      ['add', 'subtract', 'multiply', 'divide'].includes(obj.operator) &&
      typeof obj.a === 'number' &&
      typeof obj.b === 'number'
    );
  }
}
