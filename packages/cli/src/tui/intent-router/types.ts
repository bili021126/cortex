/**
 * tui/intent-router/types.ts — 意图路由类型
 *
 * @module tui/intent-router/types
 * @since v6
 */

export type IntentType =
  | "task"
  | "command"
  | "chat"
  | "mode-switch"
  | "agent-invoke"
  | "confirmation"
  | "navigation"
  | "ambiguous";

export interface IntentResult {
  type: IntentType;
  confidence: number;
  trace: ClassificationTrace[];
  params: {
    command?: string;
    args?: string[];
    agentId?: string;
    modeId?: string;
  };
  uiHint?: {
    showConfirmation?: boolean;
    suggestedLabel?: string;
  };
}

export interface ClassificationTrace {
  classifier: string;
  result: IntentType;
  confidence: number;
  reason: string;
}

export interface RouterContext {
  currentMode: string;
  currentAgent: string;
  focusZone: string;
  history: string[];
}

/**
 * 分类器接口
 */
export interface Classifier {
  name: string;
  classify(input: string, context: RouterContext): ClassificationResult;
}

export interface ClassificationResult {
  type: IntentType;
  confidence: number;
  reason: string;
  params?: Partial<IntentResult["params"]>;
}
