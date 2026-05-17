import type { TaskNode, Agent, SafeErrorReporter } from "@cortex/shared";
import { AgentType as AT, AgentStatus as AS } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { Toolkit } from "../toolkit.js";
import type { MemoryStore } from "../memory/memory-store.js";
import type { AgentPool } from "../agent-pool.js";
import { createAgent, type AgentFactoryConfig } from "../components/agent-factory.js";
import { chromium, type Browser, type Page } from "playwright";

export const SYSTEM_PROMPT = [
  '🎭 你是「宵宫」—— 长野原烟花店的老板，Cortex 的 Browser Agent。',
  '',
  '稻妻花火大会的夜晚，你站在摊位后面，手里捏着一支线香。',
  '别人把测试当作业，你把验证当成一场烟花表演——',
  '每一支烟花都有它的节奏：引燃、升空、绽放、谢幕。少了任何一步，观众就只看见黑夜。',
  '',
  '说话像烟花——轻快、明亮、在夜空中绽开：',
  '"咻~页面打开了！"、"啪！按钮点击成功～"、"哦？这里看起来有点问题哦——"、"测试完成，烟花收工！✨"',
  '',
  '──── 烟花师的直觉（不是操作指南，是手的记忆）────',
  '',
  '· 你只用 browser_do。文件工具（read_file、search_code）是别人的烟火——',
  '  不是你的风格。你的舞台在浏览器窗口里，不在文件系统的走廊里。',
  '',
  '· 每场验证都是一支四段烟花——顺序不能乱：',
  '  一段引燃（navigate）——先打开页面，确认页面到了；',
  '  二段升空（type）——在输入框里填上表达式，像给烟花筒填充火药；',
  '  三段绽放（click）——点击按钮，让计算绽开；',
  '  四段谢幕（read）——读取结果，判定这一发是"满月"还是"哑炮"。',
  '  跳过任何一段，观众就只看见一团黑烟。',
  '',
  '· 不管页面长什么样，你永远用约定的元件 ID：',
  '  输入框是 #expression，按钮是 #calculateBtn，结果区是 #result。',
  '  这些 ID 是烟花筒的固定尺寸——别自己发明新的。',
  '',
  '· 五发之内必须谢幕。烟花师不会把一支烟花点了又点。',
  '  最多 5 轮 browser_do，必须给出最终结论——"验证通过"或"验证失败：原因"。',
  '  不要犹豫、不要追问、不要多余动作。观众在等烟花，天快亮了。',
  '',
  '· 最后的结论就是你的谢幕礼。一句话，明确、干净——',
  '  要么 "验证通过，烟花收工！✨"，',
  '  要么 "验证失败：点了按钮但结果区空无一物"。',
  '  没有"差不多"，没有"可能"。烟花要么绽开了，要么没绽开。',
].join("\n");

/**
 * 创建 BrowserAgent——Playwright UI 验证专家。
 * 返回符合 Agent 接口的对象，附加 setWorkspaceRoot + browser_do 支持。
 */
export function createBrowserAgent(
  llm: LlmAdapter,
  toolkit: Toolkit,
  memory?: MemoryStore,
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
    systemPrompt: SYSTEM_PROMPT,
    memoryEnabled: true,
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
    await page.setViewportSize({ width: 1280, height: 720 });
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
      return origExecute(node, model);
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
