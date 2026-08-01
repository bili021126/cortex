// @layer 执行层
import { AgentType as AT, AgentStatus as AS, type TaskNode, type Agent, type SafeErrorReporter, type MemoryEntry, type ReadMode } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { Toolkit } from "@cortex/platform";
import type { MemoryStore } from "@cortex/memory-store";
import type { AgentPool } from "@cortex/scheduler";
import { createAgent, type AgentFactoryConfig } from "../execution/agent-factory.js";
import { BROWSER_DEFAULT_VIEWPORT, ToolCategory, ReversibilityLevel } from "@cortex/config";
import { chromium, type Browser, type Page } from "playwright";
import { BUILTIN_BROWSER_ACTIONS, buildBrowserDoHandler, type BrowserActionDef } from "./browser-actions.js";
import { LocalTool } from "@cortex/platform";

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
  actions?: BrowserActionDef[],
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

  const pageRef: { current: Page | null } = { current: page };
  const actionDefs = actions ?? BUILTIN_BROWSER_ACTIONS;

  // 注册 browser_do 工具——由声明式 action 注册表驱动，含完整子操作描述
  toolkit.registerTool(new LocalTool(
    "browser_do",
    ToolCategory.Search,
    `浏览器自动化操作。通过 action 参数指定子操作：
- navigate: 打开 URL（url）
- type: 在元素中输入文本（selector, text）
- click: 点击元素（selector）
- read: 读取元素文本内容（selector）
- screenshot: 截图——可选 fullPage（全页面）/ selector（指定元素）
- evaluate: 在页面执行 JS 并返回结果（expression）。$"selector" 可获取元素的 computed styles + rect
- measure: 测量元素布局属性——位置/尺寸/margin/padding/flex/grid（selector）
- wait: 等待条件——selector/ms/network（waitFor）
- scroll: 滚动页面——top/bottom/selector（to, scrollToSelector）
`,
    {
      action: { type: "string", description: "子操作名", enum: ["navigate", "type", "click", "read", "screenshot", "evaluate", "measure", "wait", "scroll"] },
      url: { type: "string", description: "目标 URL（navigate 时必需）" },
      selector: { type: "string", description: "CSS 选择器" },
      text: { type: "string", description: "输入文本（type 时必需）" },
      expression: { type: "string", description: "JS 表达式或 $selector（evaluate 时必需）" },
      textOnly: { type: "boolean", description: "evaluate 时仅返回文本（默认 false）" },
      fullPage: { type: "boolean", description: "screenshot 时截取全页面（默认 false）" },
      waitFor: { type: "string", description: "等待条件（wait 时必需）：selector/ms/network" },
      ms: { type: "number", description: "等待毫秒数（waitFor='ms' 时使用，默认 1000）" },
      to: { type: "string", description: "滚动目标（scroll 时必需）：top/bottom/selector" },
      scrollToSelector: { type: "string", description: "滚动目标选择器（to='selector' 时使用）" },
      timeout: { type: "number", description: "超时（ms），默认 10000" },
    },
    ReversibilityLevel.L1,
    buildBrowserDoHandler(actionDefs, pageRef),
  ));

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
    pageRef.current = page;
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
