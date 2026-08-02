/**
 * 宵宫飞书抓取——ReAct 自主闭环
 *
 * 架构：宵宫（DeepSeek 推理）→ Playwright（执行）→ 页面文本（感知）→ 宵宫（下一轮决策）
 * 零 tool_calls 依赖，零图片，纯文本 ReAct 循环。
 *
 * 用法: node --import tsx packages/engine/tests/manual/scripts/yoimiya-feishu.ts
 * 前提: .env 已配置 DEEPSEEK_API_KEY
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
// ── 路径解析 ──
const __filename = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = path.dirname(__filename);
const ENGINE_DIR = path.resolve(SCRIPTS_DIR, "..", "..", "..");
const ROOT = path.resolve(ENGINE_DIR, "..", "..");

// ═══════════════════════════════════════════════
// 0. DeepSeek API 原生调用（零第三方依赖）
// ═══════════════════════════════════════════════

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function deepseekChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`},
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.0,
      max_tokens: 32768})});

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek API ${res.status}: ${errText}`);
  }

  const json = (await res.json()) as {
    choices: Array<{ message: { content: string | null } }>;
  };

  return json.choices[0]?.message?.content ?? "";
}

// ═══════════════════════════════════════════════
// 0. 加载 .env
// ═══════════════════════════════════════════════

function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

// ═══════════════════════════════════════════════
// 1. 宵宫 System Prompt（ReAct 动作协议）
// ═══════════════════════════════════════════════

function buildSystemPrompt(targetUrl: string): string {
  const persona = fs.readFileSync(
    path.join(ROOT, "prompts", "yoimiya", "system.md"),
    "utf-8",
  );

  const reactProtocol = `

──── 浏览器自主操作协议（ReAct 闭环）────

你是宵宫，正在用 Playwright 浏览器执行任务。每轮你会收到：
1. 当前页面 URL
2. 页面文本内容（前 8000 字）
3. 本轮之前的所有操作记录

你需要输出下一轮动作，严格遵循以下格式：

🎯 意图：<你想做什么，一句话>
🔧 动作：<动作类型>|<参数>

动作类型：
· navigate|<完整URL>           —— 跳转到新页面
· click|<CSS选择器>             —— 点击元素（如 button.submit, a[href], div.tab）
· type|<CSS选择器>|<文本>       —— 在输入框键入内容
· scroll|<down|up>              —— 滚屏查看更多内容
· wait|<毫秒>                   —— 等待页面加载
· extract|<你要提取什么>         —— 从当前页面提取指定内容后继续
· done|<任务完成的总结>          —— 任务结束，返回结果

规则：
· 每轮只输出一个 🔧 动作，不要一次输出多个
· 如果页面是飞书登录页，用 done 汇报"需要登录飞书，请手动操作"
· 如果页面加载失败或超时，用 done 汇报具体错误
· 先观察页面内容，再决定下一步——不要盲目操作
· 表格类页面先 scroll 浏览全貌，再 extract 提取数据
· 最多 15 轮操作，超时自动收工
· 飞书 Wiki 的表格数据通常不在 <table> 标签里，而是在自定义的 div 结构中—仔细看页面文本判断

你的目标页面: ${targetUrl}`;

  return persona + "\n" + reactProtocol;
}

// ═══════════════════════════════════════════════
// 2. 动作解析
// ═══════════════════════════════════════════════

type Action =
  | { type: "navigate"; url: string }
  | { type: "click"; selector: string }
  | { type: "type"; selector: string; text: string }
  | { type: "scroll"; direction: "up" | "down" }
  | { type: "wait"; ms: number }
  | { type: "extract"; what: string }
  | { type: "done"; summary: string };

function parseAction(output: string): Action | null {
  // 匹配 "🔧 动作：" 后面的内容
  const actionMatch = output.match(/🔧\s*动作[：:]\s*(.+)/);
  if (!actionMatch) return null;

  const raw = actionMatch[1].trim();
  const parts = raw.split("|");
  const type = parts[0]?.trim().toLowerCase();

  switch (type) {
    case "navigate":
      if (parts[1]) return { type: "navigate", url: parts[1].trim() };
      break;
    case "click":
      if (parts[1]) return { type: "click", selector: parts[1].trim() };
      break;
    case "type":
      if (parts[1] && parts[2]) return { type: "type", selector: parts[1].trim(), text: parts.slice(2).join("|").trim() };
      break;
    case "scroll":
      if (parts[1] === "up" || parts[1] === "down") return { type: "scroll", direction: parts[1] };
      break;
    case "wait":
      if (parts[1]) { const ms = parseInt(parts[1], 10); if (!isNaN(ms)) return { type: "wait", ms }; }
      break;
    case "extract":
      if (parts[1]) return { type: "extract", what: parts.slice(1).join("|").trim() };
      break;
    case "done":
      return { type: "done", summary: parts.slice(1).join("|").trim() || output };
    default:
      return null;
  }
  return null;
}

// ═══════════════════════════════════════════════
// 3. 动作执行器
// ═══════════════════════════════════════════════

async function executeAction(page: Page, action: Action): Promise<string> {
  switch (action.type) {
    case "navigate": {
      console.log(`  🌐 navigate → ${action.url}`);
      try {
        await page.goto(action.url, { timeout: 30_000, waitUntil: "domcontentloaded" });
        await page.waitForTimeout(2000);
        return `✅ 已导航到 ${page.url()}，标题: ${await page.title()}`;
      } catch (e) {
        return `❌ 导航失败: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    case "click": {
      console.log(`  🖱️ click → ${action.selector}`);
      try {
        await page.waitForSelector(action.selector, { timeout: 5000 });
        await page.click(action.selector);
        await page.waitForTimeout(1500);
        return `✅ 已点击 ${action.selector}`;
      } catch (e) {
        return `❌ 点击失败 (${action.selector}): ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    case "type": {
      console.log(`  ⌨️ type → ${action.selector}: "${action.text.slice(0, 50)}..."`);
      try {
        await page.waitForSelector(action.selector, { timeout: 5000 });
        await page.fill(action.selector, action.text);
        await page.waitForTimeout(500);
        return `✅ 已在 ${action.selector} 中输入文本`;
      } catch (e) {
        return `❌ 输入失败 (${action.selector}): ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    case "scroll": {
      console.log(`  📜 scroll → ${action.direction}`);
      const delta = action.direction === "down" ? 800 : -800;
      await page.evaluate(`scrollBy(0, ${delta})`);
      await page.waitForTimeout(800);
      return `✅ 已向${action.direction === "down" ? "下" : "上"}滚屏`;
    }

    case "wait": {
      console.log(`  ⏳ wait → ${action.ms}ms`);
      await page.waitForTimeout(action.ms);
      return `✅ 已等待 ${action.ms}ms`;
    }

    case "extract": {
      console.log(`  📖 extract → "${action.what}"`);
      // 提取全页文本
      const text = (await page.textContent("body")) ?? "";
      return `📄 页面文本:\n${text.slice(0, 6000)}`;
    }

    case "done":
      return `🏁 任务完成: ${action.summary}`;
  }
}

// ═══════════════════════════════════════════════
// 4. 页面感知（提取文本，零截图）
// ═══════════════════════════════════════════════

async function sensePage(page: Page): Promise<{ url: string; title: string; text: string }> {
  let url = "";
  let title = "";
  let text = "";

  try {
    url = page.url();
    title = await page.title();
    // 优先提取可见文本——去掉 script/style 等不可见元素
    // 用字符串 evaluate 避免 DOM 类型在 Node 环境下报 lint 错误
    text = (await page.evaluate(`
      (function() {
        var body = document.body;
        if (!body) return '';
        var clone = body.cloneNode(true);
        var hidden = clone.querySelectorAll('script, style, noscript, [aria-hidden="true"]');
        for (var i = 0; i < hidden.length; i++) hidden[i].remove();
        return clone.textContent || '';
      })()
    `)) ?? "";

    // 压缩空白
    text = text.replace(/\n{3}/g, "\n\n").replace(/[ \t]{3}/g, "  ").trim();
  } catch {
    text = "(无法读取页面内容)";
  }

  return { url, title, text: text.slice(0, 8000) };
}

// ═══════════════════════════════════════════════
// 5. 主流程
// ═══════════════════════════════════════════════

async function main() {
  loadEnv();

  const API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!API_KEY) {
    console.error("❌ DEEPSEEK_API_KEY 未设置");
    process.exit(1);
  }

  const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1";
  const CHAT_MODEL = "deepseek-v4-flash";

  const TARGET_URL =
    "https://rcnwa456pqsg.feishu.cn/wiki/ZDOvwxeqpi7xjZkyxJLcGoocn8d?sheet=6KGlri";

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  🎆 宵宫 ReAct 闭环 —— 飞书 Wiki 抓取       ║");
  console.log("╚══════════════════════════════════════════════╝\n");
  console.log(`  模型: ${CHAT_MODEL}`);
  console.log(`  目标: ${TARGET_URL}\n`);

  const systemPrompt = buildSystemPrompt(TARGET_URL);

  // ── 启动浏览器 ──
  console.log("🎆 引燃！启动 Chromium...\n");
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });

  const conversation: Array<{ role: "user" | "assistant"; content: string }> = [];
  const MAX_ROUNDS = 15;

  try {
    // ── 第一轮：导航到目标页面 ──
    console.log("── 第 1 轮：导航 ──");
    const navResult = await executeAction(page, { type: "navigate", url: TARGET_URL });
    console.log(`  ${navResult}\n`);

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      // 感知页面
      const { url, title, text } = await sensePage(page);
      const pageInfo = `\n[页面 URL] ${url}\n[页面标题] ${title}\n[页面文本]\n${text}`;

      // 构造用户消息
      const userMsg =
        round === 1
          ? `开始执行任务。\n${pageInfo}`
          : `上一轮结果: ${conversation[conversation.length - 1]?.content ?? ""}\n\n${pageInfo}\n\n请输出下一轮动作。`;

      console.log(`── 第 ${round} 轮：感知 → 决策 ──`);
      console.log(`  URL: ${url}`);
      console.log(`  标题: ${title}`);
      console.log(`  文本长度: ${text.length} 字`);

      // 调用 LLM（原生 fetch，零第三方依赖）
      console.log(`  🤖 调用 DeepSeek...`);
      const startTime = Date.now();
      const output = await deepseekChat(
        BASE_URL, API_KEY, CHAT_MODEL,
        [
          { role: "system", content: systemPrompt },
          ...conversation.slice(-6), // 只保留最近 3 轮对话
          { role: "user", content: userMsg },
        ],
      );
      const elapsed = Date.now() - startTime;

      console.log(`  ✅ LLM 响应 ${elapsed}ms，${output.length} 字`);

      // 析出意图行
      const intentMatch = output.match(/🎯\s*意图[：:]\s*(.+)/);
      if (intentMatch) console.log(`  🎯 ${intentMatch[1].trim()}`);

      // 解析动作
      const action = parseAction(output);
      if (!action) {
        console.log(`  ⚠️ 未能解析动作，原始输出:\n${output.slice(0, 300)}\n`);
        conversation.push({ role: "assistant", content: output });
        continue;
      }

      // 记录对话
      conversation.push({ role: "assistant", content: output });

      // 执行动作
      const execResult = await executeAction(page, action);
      console.log(`  📋 结果: ${execResult.slice(0, 200)}\n`);
      conversation.push({ role: "user", content: execResult });

      // 检查是否完成
      if (action.type === "done") {
        console.log("\n════════════════════════════════════════");
        console.log("  🎆 宵宫回报：");
        console.log(`  ${action.summary}`);
        console.log("════════════════════════════════════════\n");
        break;
      }

      if (round === MAX_ROUNDS) {
        console.log("\n⚠️ 达到最大轮数，强制收工");
        // 最后尝试提取
        const { text: finalText } = await sensePage(page);
        console.log("\n── 最终页面文本 ──");
        console.log(finalText.slice(0, 5000));
        console.log("──────────────────\n");
      }
    }
  } catch (e) {
    console.error("❌ 运行异常:", e instanceof Error ? e.message : String(e));
  } finally {
    await browser.close();
    console.log("\n🎆 烟花收工！✨");
  }
}

main().catch((e) => {
  console.error("脚本异常:", e);
  process.exit(1);
});
