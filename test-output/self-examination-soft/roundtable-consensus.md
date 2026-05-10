# 审视共识修复清单

> 产出方式：6 位 Agent 圆桌会议（审视共识会议 · 强约束版本）
> 生成日期：2026-05-10
> 收束者：凝光（第 3 轮第 7 次发言 · 1888 字）
> 参会 Agent：⚡刻晴、🌿纳西妲、⚗️阿贝多、⚓北斗、🐰安柏、💎凝光、🔮莫娜、🎆宵宫、☁️甘雨、🍵托马
> 此文件由 runMeeting 自动生成，每次会议完成后覆写。旧版自动追加至「历史版本」区。

---
凝光审视完毕。簇E模式债务的根因已经清晰：`Agent` 构造同构模式在6个文件中重复，`getMemoryQuery()` 在4处重复——这是可提取的工厂模式，不阻断运行但持续增加维护成本。簇F的治理合规偏差中，`.env` 双文件值冲突（`DEEPSEEK_CHAT_MODEL` 不一致）已在第二轮标记为待定，CI缺失仍悬而未决。DeepSeek 4.1多模态预留暂不构成修复项，仅作为架构方向记录。

现根据所有轮次共识，输出**完整更新版修复优先级清单**。以下项目均已与第零轮地面真相交叉核对，严格遵守排除规则。

---

## 审视共识修复清单（最终版）

### P0 立即修复（阻断级——不修则下阶段无法推进）
- [ ] **MemoryStore.write() 缺少 `_lifecycle` 守卫**（刻晴、托马复现证据）—— `close` 后写入数据静默丢失，无异常、无持久化
- [ ] **CI 缺失**（北斗、刻晴）—— 无自动化验证，`build`、`test`、`lint` 均不可靠，P1-2 未修复
- [ ] **observer.emit 安全回退未覆盖所有核心 catch 分支**（莫娜、纳西妲）—— `_sqlRead` 与 `_deserializeRow` 已覆盖，但 `write` 路径仍可能绕过 observer

### P1 高优先（Core-2 启动前必须完成）
- [ ] **`.env` 双文件 `DEEPSEEK_CHAT_MODEL` 值冲突**（root: flash vs engine: reasoner）—— 命名统一但值不匹配，去重声明不实，风险高
- [ ] **write-through 缺少事务包裹**（阿贝多）—— write 成功但 flush 前崩溃导致内存/持久层不一致
- [ ] **Agent 构造同构模式 6 次重复**（莫娜·簇E）—— 提取 `SimpleAgent` 工厂函数，减少重复代码债
- [ ] **`getMemoryQuery()` 4 次重复结构**（莫娜·簇E）—— 与工厂提取一同重构
- [ ] **`SafeErrorReporter` 静默空转**（莫娜·模式D）—— `_safeReporter` 为 null 时吞掉错误，需改为 observer/console 双通道

### P2 重要（Core-2 期间修复）
- [ ] **测试覆盖不足**（安柏）—— `synthetic.test.ts` 缺少 `close` 后 `write` 异常场景测试
- [ ] **`read/delete` 在 `close` 后缺少接口契约**（纳西妲·簇A扩展）—— 返回明确错误而非静默失败
- [ ] **`agent.ts` 作为 import 热力中心（18/22 文件）**（纳西妲·架构债务）—— 引入接口抽象层减少直接依赖

### P3 改善（可延后但不应遗忘）
- [ ] **DeepSeek 4.1 多模态预留**（前瞻）—— 记录架构对齐点，无需立即修改
- [ ] **MemoryStore 三重防护（observer+console）文档化**（凝光）—— 写入治理手册
- [ ] **browser-e2e 引用路径更新**（安柏怀疑已滞后）—— 核实后对齐

### ✅ 已闭合（从清单移除）
- ✅ scheduler node.failed 去重 + node.complete 守卫
- ✅ MemoryStore _saveDb try-catch + observer.emit('memory.persist_failed')
- ✅ MemoryStore _deserializeRow JSON.parse try-catch 防护
- ✅ MemoryStore _sqlRead observer 迁移
- ✅ scheduler claimedBy invariant observer 化
- ✅ Agent 层继承已闭合
- ✅ eslint/tsconfig 已就位
- ✅ shared 编译通过
- ✅ shared 四域拆分
- ✅ test.html 已迁 webui/
- ✅ tmp/ 已进 gitignore
- （第零轮各 Agent 确认的其他已闭合项）

---
此清单即天权的最终签署。如有异议，请在下一次核对中提出；否则依此执行。