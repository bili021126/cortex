// alert-engine.ts — 简单规则告警引擎
// 基于 TelemetryController 数据，按预置规则触发告警

import { TelemetryController, TelemetryLevel, type TelemetryPoint } from "./telemetry-controller.js";

interface AlertRule {
  metric: string;
  condition: (points: TelemetryPoint[]) => boolean;
  level: TelemetryLevel;
  message: string;
}

class AlertEngine {
  private rules: AlertRule[] = [];

  constructor(initialRules?: AlertRule[]) {
    if (initialRules) {
      this.rules.push(...initialRules);
    }
  }

  addRule(rule: AlertRule): void {
    this.rules.push(rule);
  }

  check(controller: TelemetryController): TelemetryPoint[] {
    const triggered: TelemetryPoint[] = [];
    const windowMs = 5 * 60 * 1000; // 最近 5 分钟

    for (const rule of this.rules) {
      const points = controller.query(rule.metric, windowMs);
      if (points.length > 0 && rule.condition(points)) {
        triggered.push({
          metric: rule.metric,
          value: points.length,
          level: rule.level,
          tags: { message: rule.message, triggeredCount: points.length },
          timestamp: Date.now(),
        });
      }
    }
    return triggered;
  }
}

// ── 预置规则（已迁至 @cortex/config PRESET_ALERT_RULES，由 bootstrap 注入）──

export const alertEngine = new AlertEngine();

export type { AlertRule };
export { AlertEngine };
