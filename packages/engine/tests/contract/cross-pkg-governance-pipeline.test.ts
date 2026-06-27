// @ci: contract
/**
 * Cross-package governance pipeline —— governance→notification→telemetry→PipelineObserver
 *
 * 跨越 4 个包的治理管线集成测试：
 *   - @cortex/engine       — GovernanceEventEmitter（治理事件发射器）
 *   - @cortex/governance    — runPipeline / registerStage 修宪管线编排
 *   - @cortex/notification  — NotificationPipe 通知管线
 *   - @cortex/telemetry     — HealthCollector 降级健康聚合
 *   - @cortex/scheduler     — PipelineObserver 事件总线（事件源）
 *
 * 使用 mock 替代真实 LLM / DB / 文件系统。
 * 不调用真实的文件 I/O 修宪写入。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { PipelineEventType, PipelinePriority, type IPipelineObserver, type ObservableEvent } from "@cortex/shared";
import { GovernanceEventEmitter } from "@cortex/engine";
import { NotificationPipe, NotificationChannel, type RouteTableMap } from "@cortex/notification";
import { HealthCollector } from "@cortex/telemetry";
import { runPipeline } from "@cortex/governance";

// ── Mock Helpers ──────────────────────────────────────────

/** Mock PipelineObserver——拦截 emit，记录事件 */
function mockObserver(): IPipelineObserver & { emitted: ObservableEvent[] } {
  const emitted: ObservableEvent[] = [];
  return {
    emitted,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn((event: ObservableEvent) => { emitted.push(event); }),
  } as IPipelineObserver & { emitted: ObservableEvent[] };
}

// ── Mock Constitution Temp Dir ─────────────────────────────

/** 为 runPipeline 创建临时宪法目录（runPipeline 末尾调用 summarizeGovernance 需要） */
function setupMockConstitutionDir(rootDir: string): void {
  const dir = path.resolve(rootDir, "docs", "constitution");
  fs.mkdirSync(dir, { recursive: true });
  // 创建一个最小宪法文件
  const constitutionPath = path.join(dir, "Cortex 概念顶层设计 v1.0.0.md");
  if (!fs.existsSync(constitutionPath)) {
    fs.writeFileSync(constitutionPath, "# Cortex Constitution\n\nTest content for mock governance pipeline.", "utf-8");
  }
}

/** 清理 runPipeline 创建的临时目录 */
function cleanupMockDir(rootDir: string): void {
  if (fs.existsSync(rootDir)) {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

// ── Tests ─────────────────────────────────────────────────

describe("Cross-package governance pipeline", () => {
  let observer: ReturnType<typeof mockObserver>;
  let emitter: GovernanceEventEmitter;
  let notificationPipe: NotificationPipe;
  let healthCollector: HealthCollector;

  beforeEach(() => {
    observer = mockObserver();
    emitter = new GovernanceEventEmitter(observer);
    notificationPipe = new NotificationPipe();
    healthCollector = new HealthCollector();

    // 配置通知路由
    const routes: RouteTableMap = {
      [PipelineEventType.GovernanceAmendmentProposed]: {
        channel: NotificationChannel.Important,
        ackRequired: false,
      },
      [PipelineEventType.GovernanceComplianceViolation]: {
        channel: NotificationChannel.Urgent,
        ackRequired: true,
      },
      [PipelineEventType.GovernanceAuditReport]: {
        channel: NotificationChannel.Routine,
        ackRequired: false,
      },
      [PipelineEventType.GovernanceRoundtableConsensus]: {
        channel: NotificationChannel.Info,
        ackRequired: false,
      },
    };
    notificationPipe.loadRoutes(routes);
  });

  // ═══════════════════════════════════════════════════════
  // governance 事件 → 通知
  // ═══════════════════════════════════════════════════════

  it("should route governance event through PipelineObserver→NotificationPipe", () => {
    // GovernanceEventEmitter → PipelineObserver → NotificationPipe
    // 验证治理事件正确从 engine 层路由到 notification 层

    const receivedEvents: Array<{ type: string; channel: string }> = [];
    notificationPipe.onAll((evt) => {
      receivedEvents.push({ type: evt.type, channel: evt.channel });
    });

    // GovernanceEventEmitter 发射修宪提案事件
    emitter.emitAmendmentProposed({
      type: PipelineEventType.GovernanceAmendmentProposed,
      id: "AM-001",
      severity: "WARNING",
      source: "doc-govern",
      summary: "修改宪法 §3 —— 增加模块化铁律",
      detail: "提案详情...",
      suggestedAction: "fix",
    } as any);

    // PipelineObserver 收到事件
    expect(observer.emitted).toHaveLength(1);
    expect(observer.emitted[0]?.type).toBe(PipelineEventType.GovernanceAmendmentProposed);

    // NotificationPipe 通过 onAll 收到事件（模拟桥接：NotificationRuntime）
    // 注：NotificationRuntime 负责从 PipelineObserver → NotificationPipe 桥接
    // 此处手动桥接验证数据流正确性
    const pipelineEvent = observer.emitted[0]!;
    notificationPipe.push({
      type: pipelineEvent.type as string,
      summary: (pipelineEvent.payload as any)?.summary ?? "",
      sourceAgent: "doc-govern",
    });

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]?.type).toBe(PipelineEventType.GovernanceAmendmentProposed);
    // Important 通道（来自路由配置）
    expect(receivedEvents[0]?.channel).toBe(NotificationChannel.Important);
  });

  // ═══════════════════════════════════════════════════════
  // 通知 → telemetry 聚合
  // ═══════════════════════════════════════════════════════

  it("should aggregate governance notifications in HealthCollector", () => {
    // governance 事件 → notification → HealthCollector 聚合
    // 验证 telemetry 层正确收集治理降级事件

    // 模拟多次治理降级事件
    healthCollector.record("governance-loop", "degraded");
    healthCollector.record("governance-loop", "degraded");
    healthCollector.record("governance-pipeline", "silent");

    const snapshot = healthCollector.snapshot();

    expect(snapshot.totalDegradations).toBe(3);
    expect(snapshot.bySource["governance-loop"]).toBe(2);
    expect(snapshot.bySource["governance-pipeline"]).toBe(1);
    expect(snapshot.byLevel["degraded"]).toBe(2);
    expect(snapshot.byLevel["silent"]).toBe(1);
    expect(snapshot.recentSources).toContain("governance-loop");
    expect(snapshot.recentSources).toContain("governance-pipeline");
    expect(snapshot.degradedSince).not.toBeNull();
  });

  // ═══════════════════════════════════════════════════════
  // 降级 → 治理反馈
  // ═══════════════════════════════════════════════════════

  it("should detect degradation and trigger governance review", () => {
    // 降级事件 → HealthCollector 检测到阈值超标
    // → GovernanceEventEmitter 发射治理合规违规事件

    // 1. 模拟大量降级
    for (let i = 0; i < 10; i++) {
      healthCollector.record("memory-pipeline", "degraded");
    }

    const snapshot = healthCollector.snapshot();

    // 降级总数正确
    expect(snapshot.totalDegradations).toBe(10);
    expect(snapshot.bySource["memory-pipeline"]).toBe(10);

    // 2. 模拟发射合规违规事件（治理反馈）
    emitter.emitComplianceViolation({
      type: PipelineEventType.GovernanceComplianceViolation,
      id: "CV-001",
      severity: "WARNING",
      source: "doc-govern",
      summary: `记忆管线降级 10 次，需审查`,
      detail: `模块: memory-pipeline, 降级次数: 10`,
      suggestedAction: "escalate",
    } as any);

    // 3. PipelineObserver 收到合规违规事件
    expect(observer.emitted).toHaveLength(1);
    expect(observer.emitted[0]?.type).toBe(PipelineEventType.GovernanceComplianceViolation);
    const payload = observer.emitted[0]?.payload as any;
    expect(payload.summary).toContain("降级");
    expect(payload.suggestedAction).toBe("escalate");
  });

  // ═══════════════════════════════════════════════════════
  // 修宪管线
  // ═══════════════════════════════════════════════════════

  it("should execute amendment pipeline stages in governance→notification order", async () => {
    // 治理管线（governance-pipeline）各阶段按序执行
    // 结果通知到 notification 层

    const notifications: string[] = [];
    notificationPipe.onAll((evt) => {
      notifications.push(evt.type);
    });

    // 注册 mock 阶段——不操作真实文件系统
    const order: string[] = [];

    // 创建临时宪法目录（runPipeline 末尾的 summarizeGovernance 需要）
    const mockRootDir = path.resolve(process.cwd(), "..", "temp-mock-governance-test");
    setupMockConstitutionDir(mockRootDir);

    try {
      // 使用 stageOverrides 覆写阶段实现，避免 runPipeline 调用真实 judgeProposals
      const result = await runPipeline({
        rootDir: mockRootDir,
        stages: ["judgment", "ruler_decision", "archive"],
        onRulerDecision: async (judgments: any) => judgments,
        stageOverrides: {
          judgment: async (_ctx: any) => {
            order.push("judgment");
            return { stage: "judgment" as const, success: true, message: "评判通过", blocking: false };
          },
          ruler_decision: async (_ctx: any) => {
            order.push("ruler_decision");
            return { stage: "ruler_decision" as const, success: true, message: "裁决通过", blocking: false };
          },
          archive: async (_ctx: any) => {
            order.push("archive");
            return { stage: "archive" as const, success: true, message: "归档完成", blocking: false };
          },
        },
      });

      // 验证阶段按序执行
      expect(order).toEqual(["judgment", "ruler_decision", "archive"]);
      expect(result.success).toBe(true);
      expect(result.stageResults).toHaveLength(3);

      // 验证通知层收到正确事件
      // GovernanceEventEmitter 发射阶段结果
      emitter.emitAuditReport({
        type: PipelineEventType.GovernanceAuditReport,
        id: "AR-001",
        severity: "FYI",
        source: "governance-loop",
        summary: "修宪管线执行完成",
        detail: `阶段: ${result.stageResults.map((r: any) => r.stage).join(" → ")}`,
      } as any);

      // 模拟桥接到 notification
      if (observer.emitted.length > 0) {
        const evt = observer.emitted[0]!;
        notificationPipe.push({
          type: evt.type as string,
          summary: (evt.payload as any)?.summary ?? "",
        });
      }

      expect(notifications).toHaveLength(1);
    } finally {
      cleanupMockDir(mockRootDir);
    }
  });

  // ═══════════════════════════════════════════════════════
  // 事件类型完整性
  // ═══════════════════════════════════════════════════════

  it("should use correct PipelineEventType for governance events", () => {
    // 验证每种 governance 事件使用正确的 PipelineEventType 枚举值

    // 修宪提案
    emitter.emitAmendmentProposed({
      type: PipelineEventType.GovernanceAmendmentProposed,
      id: "AM-002",
      severity: "FYI",
      source: "doc-govern",
      summary: "测试提案",
    } as any);
    expect(observer.emitted[0]?.type).toBe(PipelineEventType.GovernanceAmendmentProposed);

    // 审计报告
    emitter.emitAuditReport({
      type: PipelineEventType.GovernanceAuditReport,
      id: "AR-002",
      severity: "FYI",
      source: "doc-govern",
      summary: "测试审计",
    } as any);
    expect(observer.emitted[1]?.type).toBe(PipelineEventType.GovernanceAuditReport);

    // 合规违规
    emitter.emitComplianceViolation({
      type: PipelineEventType.GovernanceComplianceViolation,
      id: "CV-002",
      severity: "WARNING",
      source: "sentinel",
      summary: "测试合规违规",
    } as any);
    expect(observer.emitted[2]?.type).toBe(PipelineEventType.GovernanceComplianceViolation);

    // 圆桌共识
    emitter.emitRoundtableConsensus({
      type: PipelineEventType.GovernanceRoundtableConsensus,
      id: "RT-001",
      severity: "FYI",
      source: "committee",
      summary: "测试圆桌共识",
    } as any);
    expect(observer.emitted[3]?.type).toBe(PipelineEventType.GovernanceRoundtableConsensus);

    // 验证发射了 4 个不同的事件
    expect(observer.emitted).toHaveLength(4);

    // 每种事件类型各不相同
    const types = observer.emitted.map((e: ObservableEvent) => e.type);
    expect(new Set(types).size).toBe(4);
  });
});
