import type { TaskNode } from "@cortex/shared";
import { AgentType as AT, AgentStatus as AS } from "@cortex/shared";
import type { LlmAdapter } from "./llm-adapter.js";
import type { Toolkit } from "./toolkit.js";
import type { MemoryStore } from "./memory-store.js";
import { BaseAgent } from "./base-agent.js";
import { chromium, type Browser, type Page } from "playwright";

const SYSTEM_PROMPT = [
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
 * BrowserAgent（宵宫）—— 长野原烟花店的 UI 验证专家。
 *
 * 继承 BaseAgent，共享 ReAct 循环和生命周期管理。
 * 额外持有 Playwright 实例和 browser_do 工具处理器。
 *
 * 与 InspectorAgent 同属"确定性工具链"阵营：
 * - InspectorAgent: child_process → tsc/vitest → 编译/测试事实
 * - BrowserAgent:   Playwright → 真实浏览器 → UI 交互验证
 *
 * browser_do 工具处理器由本 Agent 在初始化时注册到 Toolkit 中，
 * 这样 Playwright 实例完全由 BrowserAgent 管控。
 */
export class BrowserAgent extends BaseAgent {
  readonly type = AT.Browser;
  readonly systemPrompt = SYSTEM_PROMPT;

  private browser: Browser | null = null;
  private page: Page | null = null;

  /** 工作区根目录 — 用于 file:// 协议加载本地 HTML */
  private workspaceRoot: string | null = null;

  constructor(
    llm: LlmAdapter,
    toolkit: Toolkit,
    memory?: MemoryStore,
  ) {
    super(llm, toolkit, memory);
    // 注入真实的 browser_do 处理器
    this._registerBrowserTool();
  }

  /** 设置工作区根目录 */
  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
  }

  async wakeup(): Promise<void> {
    if (this.status !== AS.Created) return;
    await this._initBrowser();
    await super.wakeup();
  }

  /** 前置钩子：注入工作区路径信息供 LLM 构造 file:// URL */
  protected preExecuteHook(node: TaskNode): TaskNode {
    if (!this.workspaceRoot) return node;
    return {
      ...node,
      payload: `${node.payload}\n\n[工作区路径] ${this.workspaceRoot}\n（本地 HTML 文件可使用 file:/// 协议打开，例如 file:///${this.workspaceRoot.replace(/\\/g, "/")}/index.html）`,
    };
  }

  async execute(node: TaskNode, model: string) {
    // 懒初始化：ensure browser 已就绪
    if (!this.page) await this._initBrowser();
    return super.execute(node, model);
  }

  async shutdown(): Promise<void> {
    await super.shutdown();
    if (this.browser) {
      try { await this.browser.close(); } catch (e) {
        if (this._safeReporter) {
          this._safeReporter({ source: "BrowserAgent.shutdown", error: e, severity: "degraded", hint: "browser.close() failed" });
        } else {
          console.warn(`[BrowserAgent] browser.close() 失败: ${String(e)}`);
        }
      }
    }
    this.browser = null;
    this.page = null;
  }

  // ── 浏览器生命周期 ──────────────────────────

  private async _initBrowser(): Promise<void> {
    if (this.browser?.isConnected()) return;
    this.browser = await chromium.launch({ headless: true });
    this.page = await this.browser.newPage();
    await this.page.setViewportSize({ width: 1280, height: 720 });
  }

  // ── browser_do 工具处理器 ────────────────────

  private _registerBrowserTool(): void {
    this.toolkit.register("browser_do", async (params) => {
      const action = params.action as string;
      const timeout = (params.timeout as number) ?? 10_000;

      if (!this.page) {
        return { success: false, error: "浏览器未初始化，请先调用 wakeup()" };
      }

      try {
        switch (action) {
          case "navigate": {
            const url = params.url as string;
            if (!url) return { success: false, error: "navigate 缺少 url 参数" };
            await this.page.goto(url, { timeout, waitUntil: "domcontentloaded" });
            const title = await this.page.title();
            return { success: true, output: `已打开页面: ${title} (${url})` };
          }

          case "type": {
            const selector = params.selector as string;
            const text = params.text as string;
            if (!selector) return { success: false, error: "type 缺少 selector 参数" };
            if (text === undefined) return { success: false, error: "type 缺少 text 参数" };
            await this.page.waitForSelector(selector, { timeout });
            await this.page.fill(selector, text);
            return { success: true, output: `已在 "${selector}" 中输入: "${text}"` };
          }

          case "click": {
            const selector = params.selector as string;
            if (!selector) return { success: false, error: "click 缺少 selector 参数" };
            await this.page.waitForSelector(selector, { timeout });
            await this.page.click(selector);
            return { success: true, output: `已点击 "${selector}"` };
          }

          case "read": {
            const selector = params.selector as string;
            if (!selector) return { success: false, error: "read 缺少 selector 参数" };
            await this.page.waitForSelector(selector, { timeout, state: "visible" });
            const text = await this.page.textContent(selector);
            return { success: true, output: text ?? "(元素存在但无文本内容)" };
          }

          case "screenshot": {
            const buf = await this.page.screenshot({ type: "png", fullPage: false });
            const b64 = buf.toString("base64");
            return { success: true, output: `[截图已生成，${buf.length} bytes，base64 前 200 字符] ${b64.slice(0, 200)}...` };
          }

          default:
            return { success: false, error: `未知 browser_do 操作: "${action}"。支持: navigate, type, click, read, screenshot` };
        }
      } catch (e) {
        return { success: false, error: `browser_do.${action} 失败: ${e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300)}` };
      }
    });
  }

}