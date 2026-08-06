/**
 * IPC 处理器注册
 *
 * 将 CortexBridge 的方法暴露为 Electron IPC handler。
 * 渲染进程通过 preload 暴露的 API 调用这些 handler。
 */
import type { IpcMain } from "electron";
import { app, BrowserWindow } from "electron";
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
  SCREENSHOT: "desktop:screenshot",
} as const;

export function registerIpcHandlers(ipcMain: IpcMain, cortex: CortexBridge): void {
  // cortex:init — 连接 daemon
  ipcMain.handle(IPC_CHANNELS.CORTEX_INIT, async (_event, daemonPort?: number) => {
    await cortex.init(daemonPort);
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

  // desktop:screenshot — 窗口级截图导出（harness 视觉闭环：capturePage 捕获窗口自身渲染——遮挡免疫）
  ipcMain.handle(IPC_CHANNELS.SCREENSHOT, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { ok: false, error: "窗口不可用" };
    try {
      const image = await win.capturePage();
      const outPath = path.join(app.getPath("userData"), "desktop-shot.png");
      fs.writeFileSync(outPath, image.toPNG());
      return { ok: true, data: outPath };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
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
      let data: Record<string, unknown>;
      try {
        const raw = fs.readFileSync(settingsPath, "utf-8");
        const parsed: unknown = JSON.parse(raw);
        // R12-A3：合法 JSON 但非纯对象（数组/字符串/null）——视为损坏走备份路径（此前 data[key]=value 静默无效仍返回 ok:true）
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error(`settings.json 非对象: ${typeof parsed}`);
        }
        data = parsed as Record<string, unknown>;
      } catch {
        // R11-20：解析失败——备份原始文件后从空对象合并，绝不覆盖可读文件（此前 catch 分支
        // 写 { [key]: value } 丢弃所有其他设置；单次损坏导致下次写入全量静默丢失）
        try {
          fs.copyFileSync(settingsPath, `${settingsPath}.corrupt-${Date.now()}.bak`);
        } catch { /* 文件不存在则无需备份 */ }
        data = {};
      }
      data[key] = value;
      fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), "utf-8");
      return { ok: true };
    },
  );
}

function getSettingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}
