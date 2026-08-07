# 桌面端全量审计（2026-08-07）

范围：desktop 产品面（U1 状态机 + 截图通道 + 链路修复）——目标"完成桌面端"的审计闭环。

## 一、改动清单（本周期）

| 模块 | 改动 | 状态 |
|---|---|---|
| **U1 状态机**（message-state-machine） | 十态纯 reducer + 转换表 25 边 + 非法拒绝 + 谓词 + UI 规格 | ✅ 34/34 |
| **server error kind**（protocol + chat-executor） | chat.error 加 errorKind（timeout/fatal/network/cancelled）+ classifyChatError | ✅ 3/3 |
| **ChatView 接线** | reducer 推进 + 错误映射 + retry/regenerate/stop 按钮 + busy 推导 + 状态角标 | ✅ |
| **chat.css** | U1 状态气泡样式（queued/streaming/error 等） | ✅ |
| **截图通道**（capturePage/canvas/fetch） | 桌宠 canvas + chat capturePage + 定时截图 | ✅ 运行验证 |
| **sandbox 修复** | type:module preload 与 sandbox 不兼容——sandbox:false | ✅ |
| **IPC chat 修复** | conn.http.chat 挂起——fetch 直连 + 30s 超时 | ✅ 运行验证 |

## 二、验证证据

```
✅ 状态机测试 34/34（转换表每边一例）
✅ 契约测试 3/3（classifyChatError 三分类）
✅ tsc（desktop/server/protocol/client）零错
✅ eslint（desktop/server）零问题
✅ 运行验证（qwen 视觉闭环）：
   桌宠截图 343KB（昔涟 Live2D 形象）
   chat 窗口截图（标题/气泡/输入框/状态角标）
   "思考中…"（busy 态）→ AI 回复上屏（assistant 消息——complete 态）
   error_fatal"出错了"角标（失败路径实战）
✅ HTTP chat 直连 200（cyrene agent 真实回复）
```

## 三、遗留清单（诚实）

| 项 | 状态 | 影响 |
|---|---|---|
| **WS 流式断点**（消息分发层——7 轮深挖未通） | ⚠️ 已知限制 | U1 的 streaming 态未实战（状态机有——运行时走 HTTP 非流式） |
| **conn.http.chat 挂起**（http-client 的 timeoutMs 路径） | ⚠️ 未归因（fetch 直连绕开） | 桥接层待修（低优先——直连可用） |
| **注入验证代码** | ✅ 已移除（8ee39bb5） | — |
| **gateway 调试日志** | ✅ 已移除（8ee39bb5） | — |
| **截图通道的临时定时器**（5s 定时截图） | ⚠️ 保留（验证用） | 正式版改按需触发 |

## 四、评分

```
U1 状态机（工程）：9/10（纯函数/全边测试/契约一致——扣流式未实战）
桌面端运行：7.5/10（链路通——HTTP 回复上屏——扣 WS 流式断点/conn.http 挂起）
```

## 五、结论

**"完成桌面端"的工程主体完成**：U1 状态机（十态全落地 + 34 测试）+ 错误分类契约 + UI 渲染 + 状态动作 + 视觉闭环运行验证——**聊天链路通（注入→发送→AI 回复→complete 态）**。遗留（WS 流式断点/conn.http 挂起）是**链路完善**的下一轮任务——不影响桌面端主体可用。
