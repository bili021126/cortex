# manual/ — 手动 E2E 测试脚本

> 这些脚本需要真实 LLM API Key（`.env` 中的 `DEEPSEEK_API_KEY`）。
> 运行前确认 `DEEPSEEK_CHAT_MODEL` 和 `DEEPSEEK_REASONER_MODEL` 已配置。

## 快速验证

| 脚本 | 用途 | 耗时 |
|------|------|------|
| `manual-e2e-verify.ts` | 最简意图全管线打通 | ~30s |
| `e2e-real-llm.ts` | Core-1 v2.0 真实 LLM 全管线 E2E | ~2min |

## 按场景

| 脚本 | 场景 | Agent 参与 |
|------|------|-----------|
| `calculator-e2e.ts` | 计算器系统·专家协作闭环 | Code + Review + Analysis + Inspector + Loop + Ops |
| `webui-calculator-e2e.ts` | WebUI 计算器·MetaAgent 自规划 + 宵宫验证 | Meta + Code + Review + Inspector + Browser + Loop + Ops |
| `webui-calculator-verify.ts` | WebUI 计算器·生成产物验证 | Inspector |
| `browser-e2e.ts` | BrowserAgent 独立验证 | Browser |
| `mini-react-test.ts` | 超级复杂场景·6Agent 全链路压力测试 | Code + Review + Analysis + Inspector + Loop + Ops |

## 审视与会议

| 脚本 | 用途 |
|------|------|
| `conversation-10.ts` | 圆桌对话·原神角色议会·多制度版本 |
| `conversation-11.ts` | 圆桌对话·自审视共识会议·强约束版本 |
| `cortex-self-examination.ts` | Cortex 自审视实验 |

## 运行方式

```bash
# 单脚本
npx tsx packages/engine/tests/manual/<脚本名>.ts

# 例：快速验证
npx tsx packages/engine/tests/manual/manual-e2e-verify.ts
```
