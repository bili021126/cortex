import * as readline from "node:readline";
import type { PlatformBridge, ConfirmationRequest, ConfirmationResponse, PlatformContext } from "@cortex/shared";
import { PlatformKind } from "@cortex/shared";

/**
 * CLIAdapter —— PlatformBridge 的 CLI 实现。
 *
 * - confirm() 通过 stdin 阻塞等待用户输入 y/n。
 * - notify() 写入 stdout。
 * - getPlatformContext() 固定返回 CLI 上下文。
 */
export class CLIAdapter implements PlatformBridge {
  private rl: readline.Interface | null = null;

  /** 获取或创建 readline 接口（惰性初始化，避免重复监听 stdin） */
  private _ensureRl(): readline.Interface {
    if (!this.rl) {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
    }
    return this.rl;
  }

  async confirm(request: ConfirmationRequest): Promise<ConfirmationResponse> {
    const rl = this._ensureRl();

    // 构造提示信息
    const header = `\n[ConfirmGate] ${request.level} — ${request.toolName}`;
    const body = `  ${request.summary}`;
    const detail = request.detail ? `\n  Detail: ${request.detail}` : "";
    const prompt = `${header}\n${body}${detail}\n  Approve? [y/N]: `;

    const answer = await new Promise<string>((resolve) => {
      rl.question(prompt, resolve);
    });

    const approved = answer.trim().toLowerCase() === "y";
    return { requestId: request.id, approved };
  }

  notify(message: string): void {
    process.stdout.write(`[Cortex] ${message}\n`);
  }

  getPlatformContext(): PlatformContext {
    return { kind: PlatformKind.CLI, foreground: true, idle: false };
  }

  /** 关闭 readline 接口，释放 stdin */
  close(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}
