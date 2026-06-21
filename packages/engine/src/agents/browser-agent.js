import { AgentType as AT, AgentStatus as AS, ToolCategory, ReversibilityLevel } from "@cortex/shared";
import { createAgent } from "../components/agent-factory.js";
import { BROWSER_DEFAULT_VIEWPORT } from "@cortex/config";
import { chromium } from "playwright";
import { BUILTIN_BROWSER_ACTIONS, buildBrowserDoHandler } from "./browser-actions.js";
import { LocalTool } from "@cortex/platform";
/**
 * 创建 BrowserAgent——Playwright UI 验证专家。
 * 返回符合 Agent 接口的对象，附加 setWorkspaceRoot + browser_do 支持。
 */
export function createBrowserAgent(llm, toolkit, memory, systemPrompt, filterRead, actions) {
    let browser = null;
    let page = null;
    let workspaceRoot = null;
    let safeReporterRef = null;
    const pageRef = { current: page };
    const actionDefs = actions ?? BUILTIN_BROWSER_ACTIONS;
    // 注册 browser_do 工具——由声明式 action 注册表驱动，含完整子操作描述
    toolkit.registerTool(new LocalTool("browser_do", ToolCategory.Search, `浏览器自动化操作。通过 action 参数指定子操作：
- navigate: 打开 URL（url）
- type: 在元素中输入文本（selector, text）
- click: 点击元素（selector）
- read: 读取元素文本内容（selector）
- screenshot: 截图——可选 fullPage（全页面）/ selector（指定元素）
- evaluate: 在页面执行 JS 并返回结果（expression）。$"selector" 可获取元素的 computed styles + rect
- measure: 测量元素布局属性——位置/尺寸/margin/padding/flex/grid（selector）
- wait: 等待条件——selector/ms/network（waitFor）
- scroll: 滚动页面——top/bottom/selector（to, scrollToSelector）
`, {
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
    }, ReversibilityLevel.L1, buildBrowserDoHandler(actionDefs, pageRef)));
    const config = {
        type: AT.Browser,
        systemPrompt: systemPrompt ?? '',
        memoryEnabled: true,
        filterRead,
        preExecuteHook: (node) => {
            if (!workspaceRoot)
                return node;
            return {
                ...node,
                payload: `${node.payload}\n\n[工作区路径] ${workspaceRoot}\n（本地 HTML 文件可使用 file:/// 协议打开，例如 file:///${workspaceRoot.replace(/\\/g, "/")}/index.html）`,
            };
        },
    };
    const agent = createAgent(config, llm, toolkit, memory);
    async function initBrowser() {
        if (browser?.isConnected())
            return;
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
        setWorkspaceRoot(root) {
            workspaceRoot = root;
        },
        setSafeReporter(reporter) {
            safeReporterRef = reporter;
            agent.setSafeReporter(reporter);
        },
        async wakeup() {
            if (agent.status !== AS.Created)
                return;
            await initBrowser();
            await origWakeup();
        },
        async execute(node, model) {
            if (!page)
                await initBrowser();
            return await origExecute(node, model);
        },
        async shutdown() {
            await origShutdown();
            if (browser) {
                try {
                    await browser.close();
                }
                catch (e) {
                    if (safeReporterRef) {
                        safeReporterRef({ source: "BrowserAgent.shutdown", error: e, severity: "degraded", hint: "browser.close() failed" });
                    }
                    else {
                        console.warn(`[BrowserAgent] browser.close() 失败: ${String(e)}`);
                    }
                }
            }
            browser = null;
            page = null;
        },
    };
}
//# sourceMappingURL=browser-agent.js.map