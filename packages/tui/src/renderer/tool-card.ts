/**
 * tui/renderer/tool-card.ts — Tool 调用卡片
 *
 * 管理工具调用的状态与展示，支持展开查看输出详情。
 * 参考 Pi TUI 的 ToolCard 实现。
 *
 * @module tui/renderer/tool-card
 * @since v3 — P1 Tool卡片可展开
 */

import type { TuiComponent } from "./diff-renderer.js";

type ToolStatus = "pending" | "success" | "error";

interface ToolCall {
  id: string;
  tool: string;
  status: ToolStatus;
  output: string;
  expanded: boolean;
  durationMs: number;
}

const STATUS_ICONS: Record<ToolStatus, string> = {
  pending: "⏳", success: "✅", error: "❌",
};

export class ToolCard implements TuiComponent {
  private cards: ToolCall[] = [];
  private maxCards = 20;

  render(width: number): string[] {
    const rows: string[] = [];
    for (const card of this.cards.slice(-this.maxCards)) {
      const icon = STATUS_ICONS[card.status];
      rows.push(`${icon} ${card.tool} · ${card.durationMs}ms`);
      if (card.expanded && card.output) {
        const preview = card.output.slice(0, width * 3).split("\n").map(l => `   │ ${l}`).slice(0, 12);
        rows.push(...preview);
        if (card.output.length > width * 3) rows.push(`   └─ ${card.output.length} chars total`);
      }
    }
    return rows;
  }

  invalidate(): void {}

  add(id: string, tool: string): void {
    this.cards.push({ id, tool, status: "pending", output: "", expanded: false, durationMs: 0 });
  }

  complete(id: string, output: string, durationMs: number, success: boolean): void {
    const card = this.cards.find(c => c.id === id);
    if (card) {
      card.status = success ? "success" : "error";
      card.output = output;
      card.durationMs = durationMs;
    }
  }

  toggle(id: string): void {
    const card = this.cards.find(c => c.id === id);
    if (card) card.expanded = !card.expanded;
  }
}

export const toolCard = new ToolCard();
