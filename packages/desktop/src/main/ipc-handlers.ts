/**
 * IPC 处理器注册
 *
 * 将 CortexBridge 的方法暴露为 Electron IPC handler。
 * 渲染进程通过 preload 暴露的 API 调用这些 handler。
 */
import type { IpcMain } from "electron";
import { app } from "electron";
import type { CortexBridge } from "./cortex-bridge.js";
import * as path from "path";
import * as fs from "fs";

// ── IPC 通道名 ────────────────────────────────────────
export const IPC_CHANNELS = {
  CORTEX_INIT: "cortex:init",
  CORTEX_CHAT: "cortex:chat",
  CORTEX_STREAM_CHAT: "cortex:stream-chat",
  CORTEX_GET_AGENTS: "cortex:get-agents",
  LIVE2D_SPEAK: "live2d:speak",
  LIVE2D_EXPRESSION: "live2d:expression",
  SETTINGS_GET: "settings:get",
  SETTINGS_SET: "settings:set",
} as const;

export function registerIpcHandlers(ipcMain: IpcMain, cortex: CortexBridge): void {
  // cortex:init — 初始化引擎
  ipcMain.handle(IPC_CHANNELS.CORTEX_INIT, async (_event, projectRoot: string) => {
    await cortex.init(projectRoot);
    return { ok: true };
  });

  // cortex:chat — 发送对话
  ipcMain.handle(
    IPC_CHANNELS.CORTEX_CHAT,
    async (_event, input: string, agent?: string) => {
      const result = await cortex.chat(input, agent);
      return { ok: true, data: result };
    },
  );

  // cortex:stream-chat — 流式对话
  ipcMain.handle(
    IPC_CHANNELS.CORTEX_STREAM_CHAT,
    async (event, input: string, agent?: string) => {
      const result = await cortex.streamChat(input, agent, (chunk) => {
        event.sender.send(IPC_CHANNELS.CORTEX_STREAM_CHAT, { chunk, done: false });
      });
      event.sender.send(IPC_CHANNELS.CORTEX_STREAM_CHAT, { chunk: "", done: true, full: result });
      return { ok: true };
    },
  );

  // cortex:get-agents — 获取 Agent 列表
  ipcMain.handle(IPC_CHANNELS.CORTEX_GET_AGENTS, async () => {
    const agents = await cortex.getAgents();
    return { ok: true, data: agents };
  });

  // live2d:speak — TTS 语音（Cortex 尚无 TTS 管道，返回空音频）
  ipcMain.handle(IPC_CHANNELS.LIVE2D_SPEAK, async (_event, _text: string) => {
    // TTS 管道未就绪，返回空音频避免阻塞渲染进程
    return { ok: true, data: null };
  });

  // live2d:expression — 表情切换
  ipcMain.handle(IPC_CHANNELS.LIVE2D_EXPRESSION, async (_event, expression: string) => {
    // 透传给渲染进程的 Live2D 控制器
    return { ok: true, expression };
  });

  // settings:get — 读取设置
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async (_event, key: string) => {
    const settingsPath = getSettingsPath();
    try {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      const data = JSON.parse(raw);
      return { ok: true, data: key ? data[key] : data };
    } catch {
      return { ok: true, data: key ? undefined : {} };
    }
  });

  // settings:set — 写入设置
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_SET,
    async (_event, key: string, value: unknown) => {
      const settingsPath = getSettingsPath();
      try {
        const raw = fs.readFileSync(settingsPath, "utf-8");
        const data = JSON.parse(raw);
        data[key] = value;
        fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), "utf-8");
      } catch {
        fs.writeFileSync(
          settingsPath,
          JSON.stringify({ [key]: value }, null, 2),
          "utf-8",
        );
      }
      return { ok: true };
    },
  );
}

function getSettingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}
