// ============================================================
// 最小 Agent（学习用）—— 目标：让你亲眼看懂 "agent 到底怎么转"
// 它只做一件事：听懂你说的话 → 自己决定要不要按计算器 → 回答你
//
// 运行方式（在 D:\cortex 目录下）：
//   npx tsx --env-file=.env learn-agent/agent.ts "帮我算 3 + 4"
//
// 这个文件夹是"学习沙盒"，不 import 你项目的任何东西，删了毫无影响。
// ============================================================

// ── 1. 配置：从 .env 读取（不把密钥写死在代码里）──
const API_KEY = process.env.DEEPSEEK_API_KEY;
const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1";
const MODEL = process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-v4-flash";

// ── 2. 说明书（system prompt）：告诉 AI 它是谁、该干嘛 ──
const SYSTEM_PROMPT =
  "你是一个助手。如果用户让你算数，你必须调用 calculator 工具来计算，" +
  "不要自己心算。算完后，用中文把答案告诉用户。";

// ── 3. 工具（1/2）：给模型看的"说明书" —— 名字、用途、要什么参数 ──
const tools = [
  {
    type: "function",
    function: {
      name: "calculator",
      description: "计算两个数的加减乘除",
      parameters: {
        type: "object",
        properties: {
          a: { type: "number", description: "第一个数" },
          b: { type: "number", description: "第二个数" },
          op: { type: "string", enum: ["+", "-", "*", "/"], description: "运算符" },
        },
        required: ["a", "b", "op"],
      },
    },
  },
];

// ── 3. 工具（2/2）：真正干活的函数 —— 模型"举手"要调用时，由我们执行它 ──
function runCalculator(args: { a: number; b: number; op: string }): string {
  const { a, b, op } = args;
  const result =
    op === "+" ? a + b : op === "-" ? a - b : op === "*" ? a * b : a / b;
  return String(result);
}

// ── 4. 一次 LLM 调用：把整段对话发给模型，拿回它这一轮说的话 ──
async function askLLM(messages: any[]): Promise<any> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, messages, tools }),
  });
  const data: any = await res.json();
  return data.choices[0].message;
}

// ── 5. ★★★ 核心：那个"反复"的循环 ★★★ ──
async function main() {
  if (!API_KEY) {
    console.error("没读到 DEEPSEEK_API_KEY，请确认 .env 里有这一行");
    return;
  }

  const userInput = process.argv[2] ?? "帮我算 3 + 4";

  // 对话历史：先放"说明书"和"用户的话"
  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userInput },
  ];

  for (let round = 1; round <= 5; round++) {
    console.log(`\n─── 第 ${round} 圈循环 ───`);

    const msg = await askLLM(messages); // 问模型
    messages.push(msg); // 把模型这一轮的话记进历史

    // 情况 A：模型没有要用工具 → 它已经直接回答了 → 结束
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      console.log("🤖 最终回答：", msg.content);
      return;
    }

    // 情况 B：模型要调工具 → 我们真的执行 → 把结果塞回历史 → 回去再问
    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments);
      console.log(`🔧 模型申请调用：${call.function.name}(${JSON.stringify(args)})`);
      const result = runCalculator(args);
      console.log(`✅ 工具返回结果：${result}`);
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
    // ↑ 循环回到顶部：这次模型会看到工具结果，就能给出最终答案了
  }

  console.log("⚠️ 转满 5 圈还没结束，强制停止（这就是防止死循环）");
}

main();
