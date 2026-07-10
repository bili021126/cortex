import { PipelineEventType } from "./vocabularies/event-types.js";

/**
 * 治理事件 → 通知类型映射表。
 *
 * 可扩展——新增治理事件类型时在此表中追加条目即可，
 * 无需修改 ButlerAgent 或 NotificationRuntime。
 */
export const GOVERNANCE_EVENT_ROUTING: Record<string, {
  notificationType: "FYI" | "WARNING" | "DECISION_REQUIRED";
  suggestedAction?: "fix" | "ignore" | "escalate";
}> = {
  [PipelineEventType.GovernanceAmendmentProposed]: {
    notificationType: "DECISION_REQUIRED",
    suggestedAction: "escalate",
  },
  [PipelineEventType.GovernanceAuditReport]: {
    notificationType: "FYI",
  },
  [PipelineEventType.GovernanceComplianceViolation]: {
    notificationType: "WARNING",
    suggestedAction: "fix",
  },
  [PipelineEventType.GovernanceRoundtableConsensus]: {
    notificationType: "FYI",
  },
  [PipelineEventType.ConstitutionViolation]: {
    notificationType: "DECISION_REQUIRED",
    suggestedAction: "escalate",
  },
  [PipelineEventType.ConstitutionSessionConvened]: {
    notificationType: "FYI",
  },
  [PipelineEventType.ConstitutionSessionResolved]: {
    notificationType: "FYI",
  },
};
