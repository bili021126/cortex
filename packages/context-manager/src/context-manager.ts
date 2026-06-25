/**
 * @cortex/context-manager — ContextManager
 *
 * Phase 3 上下文管理层核心。
 * 根据场景和人物选择策略，返回已解析的上下文配置。
 *
 * 依赖：
 *   - @cortex/config (ConfigRegistry)
 *   - @cortex/shared (RetrievalScene, PersonaId)
 *
 * Phase 4 扩展：动态策略热加载、env override。
 */

import type { ConfigRegistry } from "@cortex/config";
import type { PersonaId, RetrievalScene } from "@cortex/shared";

// ─── 公开类型 ─────────────────────────────────────

export interface ContextResolveInput {
  scene: RetrievalScene;
  persona?: PersonaId;
  task?: { type: string; tags: string[] };
}

export interface ResolvedContext {
  policyId: string;
  tokenBudget: { critical: number; support: number; reference: number };
  retrieval: { mode: "HCA" | "CSA"; weighting: Record<string, number> };
  pipeline: { assemble: string; sort: string };
  reason: string;
}

// ─── ContextManager ───────────────────────────────

export class ContextManager {
  private registry: ConfigRegistry;

  constructor(registry: ConfigRegistry) {
    this.registry = registry;
  }

  /**
   * 根据输入场景和人物解析上下文策略。
   *
   *  匹配规则：
   *    1. scene 精确命中预注册策略的 key
   *    2. 回退到 "single-step" 策略
   *    3. 兜底使用第一个注册策略
   */
  resolve(input: ContextResolveInput): ResolvedContext {
    const policiesMap = this.registry.get<Record<string, unknown>>("context-policies");
    const entries = Object.entries(policiesMap ?? {});
    const policies = entries.map(([key, val]) => ({
      ...(val as Record<string, unknown>),
      scene: key,
    }));

    const match =
      policies.find((p) => p.scene === input.scene) ??
      policies.find((p) => p.id === "single-step") ??
      policies[0];

    if (!match) {
      return {
        policyId: "single-step",
        tokenBudget: { critical: 4000, support: 2000, reference: 1000 },
        retrieval: { mode: "HCA", weighting: {} },
        pipeline: { assemble: "default", sort: "default" },
        reason: `scene:${input.scene} (fallback: no policies registered)`,
      };
    }

    return {
      policyId: (match.id as string) ?? "single-step",
      tokenBudget: (match.tokenBudget as ResolvedContext["tokenBudget"]) ?? {
        critical: 4000,
        support: 2000,
        reference: 1000,
      },
      retrieval: (match.retrieval as ResolvedContext["retrieval"]) ?? {
        mode: "HCA",
        weighting: {},
      },
      pipeline: (match.pipeline as ResolvedContext["pipeline"]) ?? {
        assemble: "default",
        sort: "default",
      },
      reason: `scene:${input.scene}` +
        (input.persona ? ` persona:${input.persona}` : ""),
    };
  }
}
