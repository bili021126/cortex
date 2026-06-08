import { AgentType as AT, AgentStatus as AS, type TaskNode, type Agent, type SafeErrorReporter, type MemoryEntry, type ReadMode } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { Toolkit } from "../platform/toolkit.js";
import type { MemoryStore } from "../memory/memory-store.js";
import type { AgentPool } from "../core/agent-pool.js";
import { createAgent, type AgentFactoryConfig } from "../components/agent-factory.js";
import { BROWSER_DEFAULT_VIEWPORT } from "@cortex/config";
import { chromium, type Browser, type Page } from "playwright";

/**
 * 创建 BrowserAgent——Playwright UI 验证专家。
 * 返回符合 Agent 接口的对象，附加 setWorkspaceRoot + browser_do 支持。
 */
export function createBrowserAgent(
  llm: LlmAdapter,
  toolkit: Toolkit,
  memory?: MemoryStore,
  systemPrompt?: string,
  filterRead?: (entries: MemoryEntry[], mode: ReadMode) => MemoryEntry[],
): Agent & {
  setPool(pool: AgentPool, instanceId: string): void;
  setSafeReporter(reporter: SafeErrorReporter): void;
  setWorkspaceRoot(root: string): void;
  wakeup(): Promise<void>;
  shutdown(): Promise<void>;
} {
  let browser: Browser | null = null;
  let page: Page | null = null;
  let workspaceRoot: string | null = null;
  let safeReporterRef: SafeErrorReporter | null = null;

  // 注册 browser_do 工具
  toolkit.register("browser_do", async (params) => {
    const action = params.action as string;
    const timeout = (params.timeout as number) ?? 10_000;

    if (!page) {
      return { success: false, error: "浏览器未初始化" };
    }

    try {
      switch (action) {
        case "navigate": {
          const url = params.url as string;
          if (!url) return { success: false, error: "navigate 缺少 url 参数" };
          await page.goto(url, { timeout, waitUntil: "domcontentloaded" });
          const title = await page.title();
          return { success: true, output: `已打开页面: ${title} (${url})` };
        }
        case "type": {
          const selector = params.selector as string;
          const text = params.text as string;
          if (!selector) return { success: false, error: "type 缺少 selector 参数" };
          if (text === undefined) return { success: false, error: "type 缺少 text 参数" };
          await page.waitForSelector(selector, { timeout });
          await page.fill(selector, text);
          return { success: true, output: `已在 "${selector}" 中输入: "${text}"` };
        }
        case "click": {
          const selector = params.selector as string;
          if (!selector) return { success: false, error: "click 缺少 selector 参数" };
          await page.waitForSelector(selector, { timeout });
          await page.click(selector);
          return { success: true, output: `已点击 "${selector}"` };
        }
        case "read": {
          const selector = params.selector as string;
          if (!selector) return { success: false, error: "read 缺少 selector 参数" };
          await page.waitForSelector(selector, { timeout, state: "visible" });
          const text = await page.textContent(selector);
          return { success: true, output: text ?? "(元素存在但无文本内容)" };
        }
        case "screenshot": {
          const buf = await page.screenshot({ type: "png", fullPage: false });
          const b64 = buf.toString("base64");
          return { success: true, output: `[截图已生成，${buf.length} bytes，base64 前 200 字符] ${b64.slice(0, 200)}...` };
        }
        default:
          return { success: false, error: `未知 browser_do 操作: "${action}"` };
      }
    } catch (e) {
      return { success: false, error: `browser_do.${action} 失败: ${e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300)}` };
    }
  });

  const config: AgentFactoryConfig = {
    type: AT.Browser,
    systemPrompt: systemPrompt ?? '',
    memoryEnabled: true,
    filterRead,
    preExecuteHook: (node: TaskNode): TaskNode => {
      if (!workspaceRoot) return node;
      return {
        ...node,
        payload: `${node.payload}\n\n[工作区路径] ${workspaceRoot}\n（本地 HTML 文件可使用 file:/// 协议打开，例如 file:///${workspaceRoot.replace(/\\/g, "/")}/index.html）`,
      };
    },
  };

  const agent = createAgent(config, llm, toolkit, memory);

  async function initBrowser(): Promise<void> {
    if (browser?.isConnected()) return;
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.setViewportSize(BROWSER_DEFAULT_VIEWPORT);
  }

  const origWakeup = agent.wakeup;
  const origExecute = agent.execute;
  const origShutdown = agent.shutdown;

  return {
    ...agent,

    setWorkspaceRoot(root: string) {
      workspaceRoot = root;
    },

    setSafeReporter(reporter: SafeErrorReporter) {
      safeReporterRef = reporter;
      agent.setSafeReporter(reporter);
    },

    async wakeup(): Promise<void> {
      if (agent.status !== AS.Created) return;
      await initBrowser();
      await origWakeup();
    },

    async execute(node: TaskNode, model: string) {
      if (!page) await initBrowser();
      return await origExecute(node, model);
    },

    async shutdown(): Promise<void> {
      await origShutdown();
      if (browser) {
        try { await browser.close(); } catch (e) {
          if (safeReporterRef) {
            safeReporterRef({ source: "BrowserAgent.shutdown", error: e, severity: "degraded", hint: "browser.close() failed" });
          } else {
            console.warn(`[BrowserAgent] browser.close() 失败: ${String(e)}`);
          }
        }
      }
      browser = null;
      page = null;
    },
  };
}
