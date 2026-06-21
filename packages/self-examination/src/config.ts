// ============================================================
// @cortex/self-examination/config — 实验配置接口 + 验证
// ============================================================

export type ReasoningEffort = "none" | "low" | "high" | "max";
export type ExamMetric = "exitCode" | "api429Count" | "apiErrorRate" | "reportFalsePositiveRate" | "eventEmitCount" | "pipelineLatency";
export type ExamScope = "full" | { packages: string[]; dirs?: string[] };

export interface AgentOverrides {
  model: string;
  reasoning: ReasoningEffort;
}

export interface ExamConfig {
  id: string;
  name: string;
  task: string;
  memoryDir: string;
  outputDir: string;
  agentOverrides: AgentOverrides | null;
  parallel: boolean;
  seedMemories: string[];
  scope: ExamScope;
  metrics: ExamMetric[];
  /** 工作区根目录（自动填入，不需要手写） */
  workspaceRoot?: string;
}

export interface ExamResult {
  config: ExamConfig;
  startTime: number;
  endTime: number;
  exitCode: number;
  events: any[];
  plan: any;
  auditResults: any[];
  crossCheck: any[];
  consensus: any;
  archive: any;
  error?: string;
}

export interface ExamReport {
  id: string;
  name: string;
  duration: number;
  exitCode: number;
  metrics: Partial<Record<ExamMetric, number>>;
  findings: any[];
  summary: string;
  errors: string[];
}

// ── 默认配置 ───────────────────────────────

export const DEFAULT_CONFIG: ExamConfig = {
  id: "verify",
  name: "快速回归门禁",
  task: "审查当前代码库，检查是否存在编译错误、lint 违规、测试失败、记忆系统不一致",
  memoryDir: ".cortex/self-exam",
  outputDir: "self-exam-output/verify",
  agentOverrides: { model: "deepseek-v4-flash", reasoning: "none" },
  parallel: true,
  seedMemories: [],
  scope: "full",
  metrics: ["exitCode", "api429Count"],
};

// ── 配置验证 ───────────────────────────────

export function validateConfig(config: ExamConfig): string[] {
  const errors: string[] = [];
  if (!config.id) errors.push("id 不能为空");
  if (!config.name) errors.push("name 不能为空");
  if (!config.task || config.task.length < 10) errors.push("task 至少 10 个字符");
  if (config.agentOverrides?.model && !config.agentOverrides.model.startsWith("deepseek")) {
    errors.push("agentOverrides.model 必须是 deepseek 系列模型");
  }
  return errors;
}

// ── JSON 配置加载 ───────────────────────────

export function loadConfigFromJson(json: any): ExamConfig {
  return { ...DEFAULT_CONFIG, ...json } as ExamConfig;
}
