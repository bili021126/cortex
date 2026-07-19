/**
 * tui/ink/app.tsx — 根组件（v6 全系统整合）
 *
 * 布局：StatusBar(顶) → ChatView/GroupView(中) → InputBar(底)。
 * 整合 Design Token + 动画 + 交互系统 + 命令面板 + 焦点管理。
 *
 * @module tui/ink/app
 * @since v5 — Ink 重构 Phase 1 → v6 全系统整合
 */
import { Box, Text, useStdout, useApp, useInput } from "ink";
import { useReducer, useCallback, useState, useRef, useEffect, useMemo } from "react";
import type { AgentType } from "@cortex/shared";
import { AppContext } from "./app-context.js";
import { sessionReducer, initialSessionState } from "./session-reducer.js";
import { useEventBridge } from "./hooks/use-event-bridge.js";
import { StatusBar } from "./status-bar.js";
import { InputBar } from "./input-bar.js";
import { SplashScreen } from "./splash-screen.js";
import { ChatView } from "./chat-view.js";
import { PermissionPrompt } from "./permission-prompt.js";
import type { PermissionResult } from "./permission-prompt.js";
import { GroupView } from "./group-view.js";
import { CommandPaletteView } from "./command-palette-view.js";
import { groupChat } from "../group-chat.js";
import { commandMode } from "../modes/command-mode.js";
import { COMMAND_DEFS } from "../../commands/command-list.js";
import { loadInkSession, createAutoSaver } from "./session-persistence.js";
import { reversibilityLevel } from "../renderer/permission-dialog.js";
import { useInputHandler } from "./hooks/use-input-handler.js";
import type { TuiHooks } from "../types.js";
import type { ITuiEngineBridge, ICommandDispatcher, ICommandContext } from "@cortex/shared";

// ─── 交互系统 ──────────────────────────────────
import { KeyRegistry } from "../interaction/key-registry.js";
import { FocusManager } from "../interaction/focus-manager.js";
import { CommandPaletteController } from "../interaction/command-palette.js";
import { createDefaultBindings } from "../interaction/key-bindings.js";
import { useKeybinding } from "../interaction/hooks/use-keybinding.js";

// ─── 主题 ──────────────────────────────────────
import { inkTheme } from "../theme/adapter-ink.js";
import { defaultTokens } from "../theme/tokens.js";
import { CHARACTER_THEMES } from "../theme/character-theme.js";

// ─── 动画引擎 ──────────────────────────────────
import { animationEngine } from "../animation/engine.js";

// ─── Agent 排序列表（用于 Ctrl+] / Ctrl+[ 切换）──
const AGENT_ORDER = Object.keys(CHARACTER_THEMES);

export interface AppProps {
  initialAgent?: AgentType;
  bridge: ITuiEngineBridge;
  registry: ICommandDispatcher;
  registryCtx?: ICommandContext;
  projectRoot: string;
  /** 外部注入的交互系统实例（由 ink-entry 创建） */
  keyRegistry?: KeyRegistry;
  focusManager?: FocusManager;
  commandPalette?: CommandPaletteController;
}

export function App({
  initialAgent,
  bridge,
  registry,
  registryCtx,
  projectRoot,
  keyRegistry: externalKeyRegistry,
  focusManager: externalFocusManager,
  commandPalette: externalCommandPalette,
}: AppProps) {
  const { stdout } = useStdout();
  const { exit: exitApp } = useApp();
  const rows = stdout?.rows ?? 24;
  const columns = stdout?.columns ?? 80;
  const [showSplash, setShowSplash] = useState(true);
  const [exitRequested, setExitRequested] = useState(false);
  const t = inkTheme;
  const tokens = defaultTokens;

  // ── UI 状态 ──────────────────────────────────
  const [showSidebar, setShowSidebar] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  // ── 交互系统实例 ────────────────────────────
  const keyRegistry = useMemo(() => externalKeyRegistry ?? new KeyRegistry(), [externalKeyRegistry]);
  const focusManager = useMemo(() => externalFocusManager ?? new FocusManager(), [externalFocusManager]);
  const commandPalette = useMemo(() => externalCommandPalette ?? new CommandPaletteController(), [externalCommandPalette]);

  // ── 会话恢复 ──────────────────────────────
  const restored = useRef(false);
  const initialState = (() => {
    if (restored.current) return initialAgent
      ? { ...initialSessionState, agent: initialAgent }
      : initialSessionState;
    const saved = loadInkSession(projectRoot);
    if (saved) {
      restored.current = true;
      return {
        ...initialSessionState,
        agent: saved.agent,
        messages: saved.messages,
        sessionRestored: true,
      };
    }
    restored.current = true;
    return initialAgent
      ? { ...initialSessionState, agent: initialAgent }
      : initialSessionState;
  })();

  const [state, dispatch] = useReducer(sessionReducer, initialState);

  // ── 自动保存 ──────────────────────────────
  const stateRef = useRef(state);
  stateRef.current = state;
  const autoSaver = useRef(createAutoSaver(projectRoot, () => stateRef.current));

  useEffect(() => {
    autoSaver.current.touch();
  }, [state.messages.length, state.planState, state.planNodes.length, state.mode, state.agent]);

  useEffect(() => {
    return () => autoSaver.current.destroy();
  }, []);

  useEffect(() => {
    if (exitRequested) {
      autoSaver.current.flush();
      exitApp();
    }
  }, [exitRequested, exitApp]);

  // ── 事件桥接 ────────────────────────────────
  useEventBridge(dispatch);

  const requestExit = useCallback(() => setExitRequested(true), []);
  const handleSplashComplete = useCallback(() => setShowSplash(false), []);

  // ── 焦点管理：初始聚焦 input ────────────────
  useEffect(() => {
    focusManager.focus("input");
  }, [focusManager]);

  // ── 命令面板状态同步 ─────────────────────────
  useEffect(() => {
    return commandPalette.onChange(() => {
      setShowCommandPalette(commandPalette.isOpen);
      if (commandPalette.isOpen) {
        focusManager.pushOverlay("overlay");
      } else {
        focusManager.popOverlay();
      }
    });
  }, [commandPalette, focusManager]);

  // ── 快捷键绑定（真实 handler 注入） ────────────
  const callbacksRef = useRef({
    toggleCommandPalette: () => {},
    toggleSidebar: () => {},
    toggleHelp: () => {},
    focusInput: () => {},
    scrollUp: () => {},
    scrollDown: () => {},
    switchAgentNext: () => {},
    switchAgentPrev: () => {},
    togglePlanMode: () => {},
    panelNext: () => {},
    panelPrev: () => {},
  });

  // 每次渲染更新回调引用（通过 ref 保证 handler 始终最新）
  callbacksRef.current = {
    toggleCommandPalette: () => {
      if (commandPalette.isOpen) {
        commandPalette.close();
      } else {
        commandPalette.open();
      }
    },
    toggleSidebar: () => setShowSidebar((v) => !v),
    toggleHelp: () => {
      setShowHelp((v) => {
        if (!v) focusManager.pushOverlay("overlay");
        else focusManager.popOverlay();
        return !v;
      });
    },
    focusInput: () => {
      focusManager.focus("input");
      setShowHelp(false);
    },
    scrollUp: () => dispatch({ type: "SCROLL_UP" }),
    scrollDown: () => dispatch({ type: "SCROLL_DOWN" }),
    switchAgentNext: () => {
      if (AGENT_ORDER.length === 0) return;
      const idx = AGENT_ORDER.indexOf(stateRef.current.agent);
      const next = AGENT_ORDER[(idx + 1) % AGENT_ORDER.length];
      if (next) dispatch({ type: "SWITCH_AGENT", payload: next as AgentType });
    },
    switchAgentPrev: () => {
      if (AGENT_ORDER.length === 0) return;
      const idx = AGENT_ORDER.indexOf(stateRef.current.agent);
      const prev = AGENT_ORDER[(idx - 1 + AGENT_ORDER.length) % AGENT_ORDER.length];
      if (prev) dispatch({ type: "SWITCH_AGENT", payload: prev as AgentType });
    },
    togglePlanMode: () => {
      dispatch({
        type: "SET_MODE",
        payload: stateRef.current.mode === "plan" ? "chat" : "plan",
      });
    },
    panelNext: () => {
      const zones = focusManager.getZones();
      if (zones.length === 0) return;
      const idx = zones.indexOf(focusManager.getCurrent());
      const target = zones[(idx + 1) % zones.length];
      if (target) focusManager.focus(target);
    },
    panelPrev: () => {
      const zones = focusManager.getZones();
      if (zones.length === 0) return;
      const idx = zones.indexOf(focusManager.getCurrent());
      const target = zones[(idx - 1 + zones.length) % zones.length];
      if (target) focusManager.focus(target);
    },
  };

  // 注册带真实 handler 的快捷键绑定
  useEffect(() => {
    const bindings = createDefaultBindings({
      toggleCommandPalette: () => callbacksRef.current.toggleCommandPalette(),
      toggleSidebar: () => callbacksRef.current.toggleSidebar(),
      toggleHelp: () => callbacksRef.current.toggleHelp(),
      focusInput: () => callbacksRef.current.focusInput(),
      scrollUp: () => callbacksRef.current.scrollUp(),
      scrollDown: () => callbacksRef.current.scrollDown(),
      switchAgentNext: () => callbacksRef.current.switchAgentNext(),
      switchAgentPrev: () => callbacksRef.current.switchAgentPrev(),
      togglePlanMode: () => callbacksRef.current.togglePlanMode(),
      panelNext: () => callbacksRef.current.panelNext(),
      panelPrev: () => callbacksRef.current.panelPrev(),
    });

    const unregisters = bindings.map((b) => keyRegistry.register(b));
    return () => unregisters.forEach((u) => u());
  }, [keyRegistry]);

  // ── Agent 切换命令注入（dispatch 到真实切换） ────
  useEffect(() => {
    commandPalette.registerAgentCommands(
      Object.values(CHARACTER_THEMES),
      (agentType) => {
        dispatch({ type: "SWITCH_AGENT", payload: agentType as AgentType });
        commandPalette.close();
      },
    );
  }, [commandPalette]);

  // ── CLI 命令注入命令面板（Ctrl+K 发现入口，走 registry.dispatch）────
  useEffect(() => {
    for (const def of COMMAND_DEFS) {
      commandPalette.addItem({
        id: `cmd-${def.name}`,
        label: def.name,
        description: def.description,
        category: "command",
        keywords: [def.name, def.alias, def.description],
        action: async () => {
          const output = await commandMode(
            (args) => registry.dispatch(args, registryCtx),
            [def.name],
          );
          dispatch({ type: "ADD_MESSAGE", payload: { role: "system", content: output } });
          commandPalette.close();
        },
      });
    }
  }, [commandPalette, registry, registryCtx]);

  // ── 生命周期清理 ──────────────────────────────
  useEffect(() => {
    return () => {
      keyRegistry.destroy();
      animationEngine.destroy();
    };
  }, [keyRegistry]);

  // ── 权限确认机制 ────────────────────────────
  const permissionResolverRef = useRef<((result: PermissionResult) => void) | null>(null);
  const approveAllRef = useRef(false);

  /** 创建注入 chatMode/planMode 的 hooks（权限确认） */
  const createExternalHooks = useCallback((): Partial<TuiHooks> => {
    return {
      onPreToolUse: async (event) => {
        const level = reversibilityLevel(event.tool);
        if (level === 1) return "allow";
        if (approveAllRef.current) return "allow";
        return await new Promise<"allow" | "deny" | "skip">((resolve) => {
          dispatch({
            type: "PERMISSION_REQUIRED",
            payload: {
              tool: event.tool,
              input: event.input,
              level,
              agent: event.agent,
            },
          });
          permissionResolverRef.current = (result: PermissionResult) => {
            permissionResolverRef.current = null;
            if (result === "approve_all") approveAllRef.current = true;
            resolve(result === "approve_once" || result === "approve_all" ? "allow" : result);
          };
        });
      },
    };
  }, []);

  // ── 权限确认时焦点管理 ────────────────────────
  useEffect(() => {
    if (state.pendingPermission) {
      focusManager.pushOverlay("overlay");
    } else if (focusManager.getCurrent() === "overlay" && !showCommandPalette && !showHelp) {
      focusManager.popOverlay();
    }
  }, [state.pendingPermission, focusManager, showCommandPalette, showHelp]);

  // ── Escape 全局处理 ────────────────────────────
  useInput((_input, key) => {
    if (key.escape) {
      if (showHelp) {
        setShowHelp(false);
        focusManager.popOverlay();
        return;
      }
      if (showCommandPalette) {
        commandPalette.close();
        return;
      }
      // 默认：聚焦输入框
      focusManager.focus("input");
    }
  });

  // ── 输入处理（抽离至 useInputHandler，与 ansi dispatchInput 行为对称）──
  const handleInput = useInputHandler({
    stateRef,
    dispatch,
    projectRoot,
    requestExit,
    bridge,
    registry,
    registryCtx,
    createExternalHooks,
  });

  // ── 快捷键绑定桥接 ─────────────────────────────
  useKeybinding(keyRegistry, focusManager);

  // ─── 渲染 ──────────────────────────────────────
  if (showSplash) {
    return <SplashScreen onComplete={handleSplashComplete} />;
  }

  if (exitRequested) {
    return (
      <Box paddingX={tokens.spacing.xs}>
        <Text color={t.textMuted.color}>👋 再见～</Text>
      </Box>
    );
  }

  const planHint = state.planState === "reviewing" ? "说\"好的\"执行计划" : undefined;
  const currentFocus = focusManager.getCurrent();

  return (
    <AppContext.Provider value={{ dispatch, bridge, registry, registryCtx, projectRoot }}>
      <Box flexDirection="column" height={rows}>
        {/* 顶部状态栏 */}
        <StatusBar agent={state.agent} mode={state.mode} tokenUsage={state.tokenUsage} />

        {/* 主内容区 */}
        <Box flexDirection="row" flexGrow={1}>
          {/* 侧边栏（Lazygit 风格） */}
          {showSidebar && (
            <Box
              flexDirection="column"
              width={Math.min(28, Math.floor(columns * 0.25))}
              borderStyle="round"
              borderColor={currentFocus === "sidebar" ? tokens.color.border.focus : tokens.color.border.default}
              paddingX={1}
            >
              <Text color={t.primary.color} bold>🍀 昔涟</Text>
              <Text color={t.textMuted.color}>
                {tokens.typography.modeLabels[state.mode] ?? state.mode}
              </Text>
              <Box marginTop={1}>
                <Text color={t.separator.color}>{"─".repeat(20)}</Text>
              </Box>
              <Text color={t.textMuted.color} bold>快捷键</Text>
              <Text color={t.textSecondary.color}>Ctrl+K 命令面板</Text>
              <Text color={t.textSecondary.color}>Ctrl+B 侧边栏</Text>
              <Text color={t.textSecondary.color}>Ctrl+] 下一Agent</Text>
              <Text color={t.textSecondary.color}>Ctrl+[ 上一Agent</Text>
              <Text color={t.textSecondary.color}>Ctrl+P 规划模式</Text>
              <Text color={t.textSecondary.color}>Ctrl+U/D 翻页</Text>
              <Text color={t.textSecondary.color}>? 帮助</Text>
              <Text color={t.textSecondary.color}>i 聚焦输入</Text>
              <Text color={t.textSecondary.color}>Esc 返回</Text>
            </Box>
          )}

          {/* 主聊天区 */}
          <Box flexDirection="column" flexGrow={1} paddingTop={1}>
            <ChatView
              messages={state.messages}
              streamingContent={state.streamingContent}
              agent={state.agent}
              recentTools={state.recentTools}
              isProcessing={state.isProcessing}
              visibleOffset={state.visibleOffset}
              planNodes={state.planNodes}
              planState={state.planState}
            />
            <GroupView manager={groupChat} />
          </Box>
        </Box>

        {/* 浮层：命令面板 / 帮助 / 权限确认 / 输入栏 */}
        {showCommandPalette ? (
          <CommandPaletteView
            controller={commandPalette}
            onClose={() => commandPalette.close()}
          />
        ) : showHelp ? (
          <HelpOverlay />
        ) : state.pendingPermission ? (
          <PermissionPrompt
            request={state.pendingPermission}
            onResolve={(result) => {
              if (permissionResolverRef.current) {
                permissionResolverRef.current(result);
              }
            }}
          />
        ) : (
          <InputBar
            agent={state.agent}
            onSubmit={handleInput}
            disabled={state.isProcessing}
            hint={planHint}
            focused={currentFocus === "input"}
          />
        )}
      </Box>
    </AppContext.Provider>
  );
}

// ─── 帮助浮层 ────────────────────────────────────

function HelpOverlay() {
  const t = inkTheme;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={t.primary.color}
      paddingX={2}
      paddingY={1}
      marginLeft={2}
      marginRight={2}
    >
      <Text color={t.primary.color} bold>🍀 快捷键帮助</Text>
      <Box marginTop={1}>
        <Text color={t.separator.color}>{"─".repeat(40)}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text color={t.textSecondary.color}><Text color={t.accent.color} bold>Ctrl+K</Text>  命令面板 — 模糊搜索所有命令</Text>
        <Text color={t.textSecondary.color}><Text color={t.accent.color} bold>Ctrl+B</Text>  切换侧边栏</Text>
        <Text color={t.textSecondary.color}><Text color={t.accent.color} bold>Ctrl+]</Text>  下一个 Agent</Text>
        <Text color={t.textSecondary.color}><Text color={t.accent.color} bold>Ctrl+[</Text>  上一个 Agent</Text>
        <Text color={t.textSecondary.color}><Text color={t.accent.color} bold>Ctrl+P</Text>  切换规划模式</Text>
        <Text color={t.textSecondary.color}><Text color={t.accent.color} bold>Ctrl+U</Text>  向上翻页</Text>
        <Text color={t.textSecondary.color}><Text color={t.accent.color} bold>Ctrl+D</Text>  向下翻页</Text>
        <Text color={t.textSecondary.color}><Text color={t.accent.color} bold>i</Text>       聚焦输入框</Text>
        <Text color={t.textSecondary.color}><Text color={t.accent.color} bold>?</Text>       显示此帮助</Text>
        <Text color={t.textSecondary.color}><Text color={t.accent.color} bold>Esc</Text>     关闭浮层 / 返回输入</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={t.textMuted.color}>按 Esc 关闭</Text>
      </Box>
    </Box>
  );
}
