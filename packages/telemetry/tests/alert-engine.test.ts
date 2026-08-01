// @ci: unit
// ============================================================
// @cortex/telemetry —— AlertEngine 诚实数据源守护测试（spec S2-6）
//
// 守护：告警必须基于 telemetryController 的真实数据（controller.query），
// 无生产者/无数据时不得触发（context.inflate 等无 record 点的 metric 已移除）。
// 规则适配语义与 bootstrap setupAlertEngine（声明式 → 命令式）保持一致。
// ============================================================

import { describe, it, expect } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

import { AlertEngine, TelemetryController, TelemetryLevel, type TelemetryPoint } from "../src/index.js";

/** 与 @cortex/config PRESET_ALERT_RULES 同构的声明式规则（telemetry 不依赖 config） */
const PRESET_ALERT_RULES = [
  { metric: "llm.request_body_size", threshold: 200000, level: "notice", message: "LLM 请求体超 200K" },
  { metric: "agent_pool.idle_rate", threshold: 0, consecutive: 3, level: "alert", message: "Agent 池连续 3 轮空闲率为 0" },
] as const;

/** 声明式 → 命令式适配（与 bootstrap-engine.ts setupAlertEngine 同语义） */
function injectPresetRules(engine: AlertEngine): void {
  for (const rule of PRESET_ALERT_RULES) {
    engine.addRule({
      metric: rule.metric,
      level: rule.level === "alert" ? TelemetryLevel.ALERT : TelemetryLevel.NOTICE,
      message: rule.message,
      condition: (points) =>
        "consecutive" in rule
          ? points.length >= (rule.consecutive ?? 1)
          : points.some((p) => p.value > rule.threshold),
    });
  }
}

/** 每用例独立 controller（隔离落盘路径，不碰仓库内 .cortex/telemetry.json） */
function makeController(): TelemetryController {
  return new TelemetryController(join(tmpdir(), "cortex-alert-test", randomUUID(), "telemetry.json"));
}

function record(controller: TelemetryController, metric: string, value: number, level?: TelemetryLevel): void {
  controller.record({ metric, value, level, tags: {} });
}

describe("AlertEngine（spec S2-6 诚实收敛）", () => {
  it("空数据 → 零触发（不存在无真实生产者的恒触发规则）", () => {
    const engine = new AlertEngine();
    injectPresetRules(engine);

    const triggered = engine.check(makeController());

    expect(triggered).toHaveLength(0);
  });

  it("llm.request_body_size：有真实超阈值数据才触发 notice", () => {
    const engine = new AlertEngine();
    injectPresetRules(engine);
    const controller = makeController();

    // 未超阈值 → 不触发
    record(controller, "llm.request_body_size", 1024);
    expect(engine.check(controller)).toHaveLength(0);

    // 超阈值（>200000）→ 触发 notice
    record(controller, "llm.request_body_size", 250000);
    const triggered = engine.check(controller);
    expect(triggered).toHaveLength(1);
    const point = triggered[0] as TelemetryPoint;
    expect(point.metric).toBe("llm.request_body_size");
    expect(point.level).toBe(TelemetryLevel.NOTICE);
    expect(point.tags.message).toBe("LLM 请求体超 200K");
  });

  it("agent_pool.idle_rate：连续 ≥3 条空闲率为 0 才触发 alert", () => {
    const engine = new AlertEngine();
    injectPresetRules(engine);
    const controller = makeController();

    // 2 条 → 不触发（consecutive=3）
    record(controller, "agent_pool.idle_rate", 0, TelemetryLevel.TRACE);
    record(controller, "agent_pool.idle_rate", 0, TelemetryLevel.TRACE);
    expect(engine.check(controller)).toHaveLength(0);

    // 第 3 条 → 触发 alert
    record(controller, "agent_pool.idle_rate", 0, TelemetryLevel.TRACE);
    const triggered = engine.check(controller);
    expect(triggered).toHaveLength(1);
    expect(triggered[0]?.level).toBe(TelemetryLevel.ALERT);
    expect(triggered[0]?.tags.triggeredCount).toBe(3);
  });

  it("非规则 metric 数据不触发任何告警", () => {
    const engine = new AlertEngine();
    injectPresetRules(engine);
    const controller = makeController();

    record(controller, "some.unknown.metric", 999999);
    expect(engine.check(controller)).toHaveLength(0);
  });

  it("外部注入规则与预置规则互不干扰（addRule 累积语义）", () => {
    const engine = new AlertEngine();
    injectPresetRules(engine);
    const controller = makeController();

    record(controller, "llm.request_body_size", 250000);
    record(controller, "agent_pool.idle_rate", 0, TelemetryLevel.TRACE);
    record(controller, "agent_pool.idle_rate", 0, TelemetryLevel.TRACE);
    record(controller, "agent_pool.idle_rate", 0, TelemetryLevel.TRACE);

    const triggered = engine.check(controller);
    expect(triggered).toHaveLength(2);
    expect(new Set(triggered.map((p) => p.metric))).toEqual(
      new Set(["llm.request_body_size", "agent_pool.idle_rate"]),
    );
  });
});
