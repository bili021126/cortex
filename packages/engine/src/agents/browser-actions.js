// ============================================================
// @cortex/engine/agents/browser-actions —— BrowserAgent 工具行为注册表
//
// 将 browser_do 的 navigate/type/click/read/screenshot/evaluate/measure/wait/scroll
// 从 browser-agent.ts 的硬编码 switch-case 提取为声明式 action 定义。
// 每个 action 声明 name + required params + handler。
//
// createBrowserAgent 接受可选的 actions 参数，默认使用 BUILTIN_BROWSER_ACTIONS。
//
// @since v3.x — Agent 配置化
// @since Core-2 — 宵宫视觉设计工具链配齐（evaluate/measure/wait/scroll）
// ============================================================
// ─── 内置操作定义 ────────────────────────────────────
export const BUILTIN_BROWSER_ACTIONS = [
    {
        name: "navigate",
        requiredParams: ["url"],
        handler: async (page, params, timeout) => {
            const url = params.url;
            await page.goto(url, { timeout, waitUntil: "domcontentloaded" });
            const title = await page.title();
            return { success: true, output: `已打开页面: ${title} (${url})` };
        },
    },
    {
        name: "type",
        requiredParams: ["selector", "text"],
        handler: async (page, params, timeout) => {
            const selector = params.selector;
            const text = params.text;
            await page.waitForSelector(selector, { timeout });
            await page.fill(selector, text);
            return { success: true, output: `已在 "${selector}" 中输入: "${text}"` };
        },
    },
    {
        name: "click",
        requiredParams: ["selector"],
        handler: async (page, params, timeout) => {
            const selector = params.selector;
            await page.waitForSelector(selector, { timeout });
            await page.click(selector);
            return { success: true, output: `已点击 "${selector}"` };
        },
    },
    {
        name: "read",
        requiredParams: ["selector"],
        handler: async (page, params, timeout) => {
            const selector = params.selector;
            await page.waitForSelector(selector, { timeout, state: "visible" });
            const text = await page.textContent(selector);
            return { success: true, output: text ?? "(元素存在但无文本内容)" };
        },
    },
    {
        name: "screenshot",
        requiredParams: [],
        handler: async (page, params, _timeout) => {
            const fullPage = params.fullPage === true;
            const selector = params.selector;
            let buf;
            if (selector) {
                const el = await page.$(selector);
                if (!el)
                    return { success: false, error: `元素不存在: "${selector}"` };
                buf = await el.screenshot({ type: "png" });
            }
            else {
                buf = await page.screenshot({ type: "png", fullPage });
            }
            const b64 = buf.toString("base64");
            const scope = selector ? `元素 "${selector}"` : (fullPage ? "全页面" : "视口");
            return {
                success: true,
                output: `[截图已生成: ${scope}, ${(buf.length / 1024).toFixed(1)}KB, base64 前 200 字符] ${b64.slice(0, 200)}...`,
            };
        },
    },
    // ══════════════════════════════════════════════
    // Core-2: 宵宫视觉设计工具链
    // ══════════════════════════════════════════════
    // evaluate —— 在页面上下文执行 JS 表达式，返回结果。
    // 支持 $selector 快捷语法：$selector → computed styles + rect + HTML
    {
        name: "evaluate",
        requiredParams: ["expression"],
        handler: async (page, params, _timeout) => {
            const expression = params.expression.trim();
            const textOnly = params.textOnly === true;
            try {
                let js;
                if (expression.startsWith("$")) {
                    // DOM 元素检查：$selector → computed styles + rect + html
                    const sel = JSON.stringify(expression.slice(1).trim());
                    js = `(function(){var s=${sel};var es=document.querySelectorAll(s);if(es.length===0)return"(未找到匹配元素)";var r=[];var m=Math.min(es.length,20);for(var i=0;i<m;i++){var e=es[i];var st=window.getComputedStyle(e);var rc=e.getBoundingClientRect();r.push({index:i,tag:e.tagName.toLowerCase(),id:e.id||undefined,class:e.className||undefined,text:${textOnly}?(e.innerText||"").slice(0,200):undefined,html:${!textOnly}?(e.outerHTML||"").slice(0,500):undefined,rect:{x:Math.round(rc.x),y:Math.round(rc.y),w:Math.round(rc.width),h:Math.round(rc.height)},computed:{display:st.display,position:st.position,color:st.color,backgroundColor:st.backgroundColor,fontSize:st.fontSize,fontWeight:st.fontWeight,margin:st.margin,padding:st.padding,border:st.border,width:st.width,height:st.height,gap:st.gap,flexDirection:st.flexDirection,alignItems:st.alignItems,justifyContent:st.justifyContent,overflow:st.overflow,opacity:st.opacity,zIndex:st.zIndex,borderRadius:st.borderRadius,boxShadow:st.boxShadow}})}return JSON.stringify(r,null,2)})()`;
                }
                else {
                    // 任意 JS 表达式
                    js = `(function(){try{var v=eval(${JSON.stringify(expression)});if(v===undefined)return"undefined";if(typeof v==="string")return v;return JSON.stringify(v,null,2)}catch(e){return"Error: "+e.message}})()`;
                }
                const result = await page.evaluate(js);
                return { success: true, output: String(result) };
            }
            catch (e) {
                return { success: false, error: `evaluate 失败: ${e instanceof Error ? e.message : String(e)}` };
            }
        },
    },
    // measure —— 测量元素的布局属性（位置、尺寸、CSS 盒模型）
    {
        name: "measure",
        requiredParams: ["selector"],
        handler: async (page, params, _timeout) => {
            try {
                const js = `(function(){var s=${JSON.stringify(params.selector)};var e=document.querySelector(s);if(!e)return"(未找到元素: "+s+")";var st=window.getComputedStyle(e);var rc=e.getBoundingClientRect();var vw=window.innerWidth;var vh=window.innerHeight;return JSON.stringify({selector:s,tag:e.tagName.toLowerCase(),rect:{x:Math.round(rc.x),y:Math.round(rc.y),w:Math.round(rc.width),h:Math.round(rc.height)},viewport:{w:vw,h:vh},visible:rc.width>0&&rc.height>0&&rc.bottom>0&&rc.right>0&&rc.top<vh&&rc.left<vw,layout:{display:st.display,position:st.position,boxSizing:st.boxSizing,width:st.width,height:st.height,margin:st.margin,padding:st.padding,border:st.border,gap:st.gap,flexDirection:st.flexDirection,flexWrap:st.flexWrap,gridTemplateColumns:st.gridTemplateColumns}},null,2)})()`;
                const result = await page.evaluate(js);
                return { success: true, output: String(result) };
            }
            catch (e) {
                return { success: false, error: `measure 失败: ${e instanceof Error ? e.message : String(e)}` };
            }
        },
    },
    // wait —— 等待条件满足（选择器出现 / 固定毫秒 / 网络空闲）
    {
        name: "wait",
        requiredParams: ["waitFor"],
        handler: async (page, params, timeout) => {
            const waitFor = params.waitFor;
            const selector = params.selector;
            const ms = params.ms ?? 1000;
            if (waitFor === "selector" && selector) {
                await page.waitForSelector(selector, { timeout });
                return { success: true, output: `等待到选择器 "${selector}" 出现` };
            }
            if (waitFor === "ms") {
                await page.waitForTimeout(ms);
                return { success: true, output: `等待了 ${ms}ms` };
            }
            if (waitFor === "network") {
                await page.waitForLoadState("networkidle", { timeout });
                return { success: true, output: "网络空闲" };
            }
            return { success: false, error: `未知 waitFor 值: "${waitFor}"，支持 selector/ms/network` };
        },
    },
    // scroll —— 页面滚动（顶部/底部/指定元素）
    {
        name: "scroll",
        requiredParams: ["to"],
        handler: async (page, params, _timeout) => {
            const to = params.to;
            const selector = params.scrollToSelector;
            if (to === "top") {
                await page.evaluate("window.scrollTo(0,0)");
                return { success: true, output: "已滚动到页面顶部" };
            }
            if (to === "bottom") {
                await page.evaluate("window.scrollTo(0,document.body.scrollHeight)");
                return { success: true, output: "已滚动到页面底部" };
            }
            if (to === "selector" && selector) {
                await page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({behavior:"instant",block:"center"})`);
                return { success: true, output: `已滚动到元素 "${selector}"` };
            }
            return { success: false, error: `未知 scroll to 值: "${to}"，支持 top/bottom/selector` };
        },
    },
];
/**
 * 从 action 注册表构建 browser_do 工具处理器。
 * 返回一个可直接注册到 Toolkit 的 handler 函数。
 */
export function buildBrowserDoHandler(actions, pageRef) {
    const actionMap = new Map();
    for (const a of actions)
        actionMap.set(a.name, a);
    return async (params) => {
        const page = pageRef.current;
        if (!page) {
            return { success: false, error: "浏览器未初始化" };
        }
        const actionName = params.action;
        const def = actionMap.get(actionName);
        if (!def) {
            return { success: false, error: `未知 browser_do 操作: "${actionName}"` };
        }
        // 参数校验
        for (const key of def.requiredParams) {
            if (params[key] === undefined) {
                return { success: false, error: `${actionName} 缺少 ${key} 参数` };
            }
        }
        const timeout = params.timeout ?? 10_000;
        try {
            return await def.handler(page, params, timeout);
        }
        catch (e) {
            return {
                success: false,
                error: `browser_do.${actionName} 失败: ${e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300)}`,
            };
        }
    };
}
//# sourceMappingURL=browser-actions.js.map