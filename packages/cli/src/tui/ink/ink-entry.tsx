/**
 * tui/ink/ink-entry.tsx — Ink TUI 入口（v6 整合版）
 *
 * 使用 Ink.render() 接管终端渲染。
 * 创建交互系统实例（KeyRegistry + FocusManager + CommandPalette），
 * 由 App 组件负责注册绑定和命令。
 *
 * @module tui/ink/ink-entry
 * @since v5 — Ink 重构 Phase 1 → v6 交互系统整合
 */

import { render } from "ink";
import { AgentType } from "@cortex/shared";
import type { ITuiEngineBridge, ICommandDispatcher, ICommandContext } from "@cortex/shared";
import { App } from "./app.js";

// ─── 交互系统 ──────────────────────────────────
import { KeyRegistry } from "../interaction/key-registry.js";
import { FocusManager } from "../interaction/focus-manager.js";
import { CommandPaletteController } from "../interaction/command-palette.js";

export interface InkTuiOptions {
  registry: ICommandDispatcher;
  bridge: ITuiEngineBridge;
  context?: ICommandContext;
  /** main.ts 在 bootstrap 前替换了 stdout，Ink 渲染前需要恢复 */
  origStdout?: typeof process.stdout.write;
}

/**
 * 启动 Ink TUI。
 *
 * Ink.render() 会接管终端（alt screen + raw mode），
 * 返回的 instance 提供 waitUntilExit() 用于阻塞直到用户退出。
 */
export async function startInkTui(options: InkTuiOptions): Promise<number> {
  const projectRoot = (options.context?.projectRoot as string) ?? process.cwd();

  // ── 恢复 stdout（Ink 渲染依赖 process.stdout.write）──
  if (options.origStdout) {
    process.stdout.write = options.origStdout;
  }

  // ── 创建交互系统实例（绑定注册由 App 组件完成）──
  const keyRegistry = new KeyRegistry();
  const focusManager = new FocusManager();
  const commandPalette = new CommandPaletteController();

  const instance = render(
    <App
      initialAgent={AgentType.Butler}
      bridge={options.bridge}
      registry={options.registry}
      registryCtx={options.context}
      projectRoot={projectRoot}
      keyRegistry={keyRegistry}
      focusManager={focusManager}
      commandPalette={commandPalette}
    />,
    {
      // Ctrl+C 交由 App 内 SigintHandler 两连退出处理，禁用 Ink 默认单击退出
      exitOnCtrlC: false,
    },
  );

  await instance.waitUntilExit();
  instance.unmount();
  return 0;
}
