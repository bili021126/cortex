// ============================================================
// 🌿 Cortex 技能注册表 — 内置：注册表查询技能
// 设计：纳西妲 | 实现：阿贝多
//
// 查询注册表自身状态——元技能
//
// @moved-from projects/solo-flight/src/builtin/registry-info.skill.ts
// ============================================================

import { BaseSkill } from '../../registry/executable-skill/base-skill.js';
import { SkillCategory, SkillErrorCode, type ExecutionContext, type SkillId, type SkillResult } from '../../registry/executable-skill/types.js';
import { createSkillId, createSkillVersion } from '../../registry/executable-skill/utils/id.js';
import type { SkillRegistry } from '../../registry/executable-skill/interfaces.js';

interface RegistryInfoInput {
  /** 查询命令: stats | list | detail */
  command: 'stats' | 'list' | 'detail';
  /** detail 命令需要的技能 ID */
  skillId?: string;
}

interface RegistryInfoOutput {
  stats?: {
    totalSkills: number;
    byCategory: Record<string, number>;
  };
  list?: Array<{
    id: string;
    name: string;
    version: string;
    category: string;
    tags: string[];
  }>;
  detail?: {
    id: string;
    name: string;
    version: string;
    description: string;
    author?: string;
    category: string;
    tags: string[];
    dependencies: string[];
    platforms?: string[];
  };
}

export class RegistryInfoSkill extends BaseSkill<RegistryInfoInput, RegistryInfoOutput> {
  meta = {
    id: createSkillId('builtin-registry-info'),
    name: '注册表查询',
    version: createSkillVersion('1.0.0'),
    description: '查询技能注册表的运行状态和已注册技能信息',
    author: '阿贝多',
    tags: ['builtin', 'system', 'registry'],
    dependencies: [],
    category: SkillCategory.SYSTEM,
  };

  /** 引用注册表实例——由外部注入 */
  private _registry: SkillRegistry | null = null;

  setRegistry(registry: SkillRegistry): void {
    this._registry = registry;
  }

  run(context: ExecutionContext): Promise<SkillResult<RegistryInfoOutput>> {
    const registry = this._registry;
    if (!registry) {
      return Promise.resolve({
        success: false,
        error: {
          code: SkillErrorCode.INTERNAL_ERROR,
          message: '注册表查询技能未注入注册表实例',
        },
      });
    }

    const input = context.input.params as RegistryInfoInput;
    const { command } = input;

    switch (command) {
      case 'stats': {
        const allMeta = Array.from(registry.getAll().values());
        const byCategory: Record<string, number> = {};
        for (const m of allMeta) {
          byCategory[m.category] = (byCategory[m.category] || 0) + 1;
        }
        return Promise.resolve({
          success: true,
          data: {
            stats: {
              totalSkills: allMeta.length,
              byCategory,
            },
          },
        });
      }

      case 'list': {
        const allMeta = Array.from(registry.getAll().values());
        return Promise.resolve({
          success: true,
          data: {
            list: allMeta.map((s) => ({
              id: s.id,
              name: s.name,
              version: s.version,
              category: s.category,
              tags: s.tags,
            })),
          },
        });
      }

      case 'detail': {
        if (!input.skillId) {
          return Promise.resolve({
            success: false,
            error: {
              code: SkillErrorCode.VALIDATION_FAILED,
              message: 'detail 命令需要提供 skillId 参数',
            },
          });
        }
        const meta = registry.getMeta(input.skillId as SkillId);
        if (!meta) {
          return Promise.resolve({
            success: false,
            error: {
              code: SkillErrorCode.NOT_FOUND,
              message: `技能「${input.skillId}」未在注册表中找到`,
            },
          });
        }
        return Promise.resolve({
          success: true,
          data: {
            detail: {
              id: meta.id,
              name: meta.name,
              version: meta.version,
              description: meta.description,
              author: meta.author,
              category: meta.category,
              tags: meta.tags,
              dependencies: meta.dependencies,
              platforms: meta.platforms,
            },
          },
        });
      }

      default:
        return Promise.resolve({
          success: false,
          error: {
            code: SkillErrorCode.VALIDATION_FAILED,
            message: `未知命令: ${command}（支持: stats, list, detail）`,
          },
        });
    }
  }

  validate(input: unknown): input is RegistryInfoInput {
    if (typeof input !== 'object' || input === null) return false;
    const obj = input as Record<string, unknown>;
    if (typeof obj.command !== 'string') return false;
    if (!['stats', 'list', 'detail'].includes(obj.command)) return false;
    if (obj.command === 'detail' && obj.skillId !== undefined && typeof obj.skillId !== 'string') {
      return false;
    }
    return true;
  }
}
