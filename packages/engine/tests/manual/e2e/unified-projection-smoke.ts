/**
 * 统一记忆投影架构 - 冒烟测试（修复后重写版）
 *
 * 用法: npx tsx packages/engine/tests/manual/e2e/unified-projection-smoke.ts
 *
 * 覆盖:
 *   Fix 1: 纯内存模式访问统计写回 Map 原件
 *   Fix 2: FTS5 通道关键词匹配率评分
 *   Fix 3: 探索窗口内手动调权 → 回滚时合并增量
 *   Fix 4: 探索契约退火（间隔倍增）
 *   Fix 5: 向量通道使用真实余弦相似度
 *   Fix 6: _fusionScore 分离于 weight，阶段 5 统一应用
 */
import { AgentType, MemoryType } from "@cortex/shared";
import { MemoryStore } from "../../../src/memory/memory-store.js";

// 384 维假 embedding（模拟 all-MiniLM-L6-v2）
function makeFakeEmbed(seed: number): number[] {
  const arr = new Array<number>(384);
  for (let i = 0; i < 384; i++) {
    // 确定性伪随机，seed 决定主频
    arr[i] = Math.sin(seed * 0.1 + i * 0.01) * 0.5 + Math.cos(i * 0.03) * 0.3;
  }
  // L2 归一化
  const norm = Math.sqrt(arr.reduce((s, v) => s + v * v, 0));
  for (let i = 0; i < 384; i++) arr[i] /= norm;
  return arr;
}

async function main() {
  let passed = 0, total = 0;

  function assert(cond: boolean, msg: string) {
    total++;
    if (!cond) {
      console.log(`   ❌ FAIL [${total}]: ${msg}`);
      // 不立即退出，收集所有失败信息
    } else {
      passed++;
      console.log(`   ✅ PASS [${total}]: ${msg}`);
    }
  }

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   统一记忆投影架构 - 冒烟测试（修复后重写版）             ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  // ── 准备数据 ──────────────────────────────────
  const memory = new MemoryStore();

  // 三组记忆：不同关键词命中率
  const idA = memory.write({
    memoryType: MemoryType.Episodic,
    content: { action: "重构记忆检索模块" },
    summary: "刻晴：重构记忆检索模块的 FTS5 索引，提升关键词匹配精度",
    agentType: AgentType.Code,
    creatorId: "刻晴",
    weight: 5,
  });
  const idB = memory.write({
    memoryType: MemoryType.Conceptual,
    content: { design: "记忆投影架构" },
    summary: "纳西妲：设计了统一记忆投影与动态自迭代检索架构",
    agentType: AgentType.Analysis,
    creatorId: "纳西妲",
    weight: 8,
  });
  const idC = memory.write({
    memoryType: MemoryType.Knowledge,
    content: { doc: "宪法 §7.1" },
    summary: "凝光：记忆检索必须遵循宪法 §7.1 动态投影规则",
    agentType: AgentType.DocGovern,
    creatorId: "凝光",
    weight: 10,
  });
  // 带 embedding 的记忆（用于向量通道测试）
  const emb1 = makeFakeEmbed(42);
  const emb2 = makeFakeEmbed(43); // 与 42 相近
  const emb3 = makeFakeEmbed(999); // 与 42 远离
  const idV1 = memory.write({
    memoryType: MemoryType.Episodic,
    content: { task: "向量嵌入测试 A" },
    summary: "向量 A：与查询高度相关的记忆",
    agentType: AgentType.Code,
    creatorId: "测试",
    weight: 3,
    embedding: emb1,
  });
  const idV2 = memory.write({
    memoryType: MemoryType.Episodic,
    content: { task: "向量嵌入测试 B" },
    summary: "向量 B：与查询中度相关的记忆",
    agentType: AgentType.Code,
    creatorId: "测试",
    weight: 3,
    embedding: emb2,
  });
  const idV3 = memory.write({
    memoryType: MemoryType.Episodic,
    content: { task: "向量嵌入测试 C" },
    summary: "向量 C：无 embedding 的冷启动记忆",
    agentType: AgentType.Code,
    creatorId: "测试",
    weight: 3,
    // 故意不传 embedding——冷启动场景
  });

  // 建立关联
  memory.link(idA, idB, "DERIVED_FROM" as any, "刻晴");
  memory.link(idB, idC, "CITED_IN_COMMITTEE" as any, "纳西妲");

  console.log(`   写入 ${memory.size} 条记忆 + 2 条关联\n`);

  // ════════════════════════════════════════════════
  //  测试 1: forAgent() 动态投影
  // ════════════════════════════════════════════════
  console.log("── 1. forAgent() 动态投影 ──");

  const codeQuery = memory.forAgent({
    agentType: AgentType.Code,
    taskPhase: "execution",
    context: "重构记忆检索 FTS5 索引",
  });
  assert(codeQuery.queryMode === 'csa', "CodeAgent execution → csa 模式");
  assert(codeQuery.bfsDepth === 2, "execution 阶段 → bfsDepth=2");
  assert(codeQuery.limit === 3, "csa 模式 → limit=3");
  assert(codeQuery.trackAccess === true, "csa 模式 → trackAccess=true");
  assert(codeQuery.keywords!.length > 0, "context 提取出关键词");

  const metaQuery = memory.forAgent({
    agentType: AgentType.Meta,
    taskPhase: "planning",
    context: "规划下一阶段开发",
  });
  assert(metaQuery.queryMode === 'hca', "MetaAgent planning → hca 模式");
  assert(metaQuery.bfsDepth === 1, "planning 阶段 → bfsDepth=1");
  assert(metaQuery.limit === 10, "hca 模式 → limit=10");
  assert(metaQuery.trackAccess === false, "hca 模式 → trackAccess=false");

  const reviewQuery = memory.forAgent({
    agentType: AgentType.Review,
    taskPhase: "review",
  });
  assert(reviewQuery.bfsDepth === 3, "review 阶段 → bfsDepth=3");
  assert(reviewQuery.funnelOrder!.join(",") === "fts5,vector,bfs", "默认漏斗顺序 fts5,vector,bfs");
  console.log("");

  // ════════════════════════════════════════════════
  //  测试 2 (Fix 2): FTS5 通道关键词匹配率评分
  // ════════════════════════════════════════════════
  console.log("── 2. FTS5 关键词匹配率评分 (Fix 2) ──");

  // 关键词 ["重构", "记忆"]：
  //   idA "重构记忆检索模块的..." → 2/2 = 1.0
  //   idB "记忆投影与动态..." → 1/2 = 0.5
  //   idC "记忆检索必须遵循..." → 1/2 = 0.5（但可能被其他过滤排除）
  const kwResults = memory.read({
    keywords: ["重构", "记忆"],
    memoryTypes: [MemoryType.Episodic, MemoryType.Conceptual, MemoryType.Knowledge],
    limit: 10,
  });

  // 验证 idA 排在前面（匹配率最高）
  const idAIdx = kwResults.findIndex((m) => m.id === idA);
  const idBIdx = kwResults.findIndex((m) => m.id === idB);
  assert(idAIdx >= 0, "idA（全匹配）被 FTS5 检索到");
  assert(idBIdx >= 0, "idB（半匹配）被 FTS5 检索到");
  assert(idAIdx < idBIdx, "idA（全匹配 2/2）排在 idB（半匹配 1/2）前面");

  // 无关键词查询：默认 0.5 分
  const noKwResults = memory.read({ limit: 10 });
  const allHaveFusionScore = noKwResults.every((m) =>
    (m.metadata as any)?._fusionScore !== undefined
  );
  assert(allHaveFusionScore, "所有结果都有 _fusionScore");
  console.log("");

  // ════════════════════════════════════════════════
  //  测试 3 (Fix 5): 向量通道真实余弦相似度
  // ════════════════════════════════════════════════
  console.log("── 3. 向量通道真实余弦相似度 (Fix 5) ──");

  const queryEmb = makeFakeEmbed(42); // 与 emb1(42) 完全相同，与 emb2(43) 相近
  const vecResults = memory.read({
    queryEmbedding: queryEmb,
    limit: 10,
  });

  const v1 = vecResults.find((m) => m.id === idV1);
  const v2 = vecResults.find((m) => m.id === idV2);
  const v3 = vecResults.find((m) => m.id === idV3);
  assert(v1 !== undefined, "embedding=42 的记忆被向量通道召回");
  assert(v2 !== undefined, "embedding=43 的记忆被向量通道召回");
  assert(v3 !== undefined, "无 embedding 的记忆以冷启动降级保留");
  // idV1 (seed=42) 与 query (seed=42) 完全相同 → cos≈1.0；idV2 (seed=43) → cos < 1.0
  const v1Idx = vecResults.findIndex((m) => m.id === idV1);
  const v2Idx = vecResults.findIndex((m) => m.id === idV2);
  assert(v1Idx < v2Idx, "完全匹配 (cos≈1.0) 排在相近匹配 (cos<1.0) 前面（真实得分排序）");
  // 验证冷启动标记
  const v3FusionScore = (v3!.metadata as any)?._fusionScore as number;
  const v1FusionScore = (v1!.metadata as any)?._fusionScore as number;
  assert(v3FusionScore < v1FusionScore, "冷启动记忆 (score=0) 融合得分低于有 embedding 的记忆");
  console.log("");

  // ════════════════════════════════════════════════
  //  测试 4 (Fix 6): _fusionScore 分离 + 阶段 5 统一应用
  // ════════════════════════════════════════════════
  console.log("── 4. _fusionScore 分离与阶段 5 统一 (Fix 6) ──");

  const allResults = memory.read({ limit: 10 });
  for (const m of allResults) {
    const meta = m.metadata as any;
    assert(meta._fusionScore !== undefined,
      `记忆 ${m.summary.slice(0, 20)} 有 _fusionScore=${meta._fusionScore?.toFixed?.(3) ?? meta._fusionScore}`);
    assert(meta._fusionChannel !== undefined,
      `记忆 ${m.summary.slice(0, 20)} 有 _fusionChannel=${meta._fusionChannel}`);
    assert(meta._fusionHitCount !== undefined,
      `记忆 ${m.summary.slice(0, 20)} 有 _fusionHitCount=${meta._fusionHitCount}`);
    // weight 验证：必为时间衰减 × (0.5 + fusionScore) 的结果
    // 新写入的记忆 ageDays≈0, decayFactor≈1
    assert(m.weight > 0, `weight=${m.weight} > 0`);
  }

  // 手动构造已知期望值验证公式
  // 对 idA：单独查询，验证 weight = originalWeight * decay * (0.5 + _fusionScore)
  const soloResult = memory.read({
    keywords: ["FTS5"],
    memoryTypes: [MemoryType.Episodic],
    limit: 1,
  })[0];
  if (soloResult) {
    const soloMeta = soloResult.metadata as any;
    const fusionScore = soloMeta._fusionScore as number;
    const decayFactor = Math.max(0.1, 1 - (Date.now() - soloResult.createdAt) / (1000 * 60 * 60 * 24) / 30);
    const expectedWeight = +(5.0 * decayFactor * (0.5 + fusionScore)).toFixed(4);
    assert(Math.abs(soloResult.weight - expectedWeight) < 0.001,
      `weight=${soloResult.weight} ≈ expected=${expectedWeight} (decay=${decayFactor.toFixed(3)}, fusion=${fusionScore.toFixed(3)})`);
  }
  console.log("");

  // ════════════════════════════════════════════════
  //  测试 5 (Fix 1): 纯内存模式访问统计写回 Map
  // ════════════════════════════════════════════════
  console.log("── 5. 访问统计写回 Map 原件 (Fix 1) ──");

  // 第一次读：accessCount 应为 1
  const firstRead = memory.read({
    memoryTypes: [MemoryType.Knowledge],
    limit: 5,
  });
  const knowledgeEntry = firstRead.find((m) => m.id === idC);
  assert(knowledgeEntry !== undefined, "idC（Knowledge）被检索到");
  assert(knowledgeEntry!.accessCount >= 1, `第一次读取 accessCount=${knowledgeEntry!.accessCount} >= 1`);

  // 第二次读：accessCount 应递增（证明写回了 Map）
  const secondRead = memory.read({
    memoryTypes: [MemoryType.Knowledge],
    limit: 5,
  });
  const knowledgeEntry2 = secondRead.find((m) => m.id === idC);
  assert(knowledgeEntry2 !== undefined, "idC 再次被检索到");
  assert(knowledgeEntry2!.accessCount >= knowledgeEntry!.accessCount + 1,
    `第二次 accessCount=${knowledgeEntry2!.accessCount} >= 第一次+1 (${knowledgeEntry!.accessCount + 1})`);
  console.log("");

  // ════════════════════════════════════════════════
  //  测试 6: NEVER_RETRIEVED 标记
  // ════════════════════════════════════════════════
  console.log("── 6. FSA 因果归因 NEVER_RETRIEVED ──");

  const neverResults = memory.read({ limit: 10 });
  const retrieved = neverResults.filter((m) => (m.metadata as any)?._retrievedAt);
  assert(retrieved.length === neverResults.length, "所有返回结果都标记了 _retrievedAt");

  const withChannel = neverResults.filter((m) => (m.metadata as any)?._retrievalChannel);
  assert(withChannel.length === neverResults.length, "所有返回结果都标记了 _retrievalChannel");
  console.log("");

  // ════════════════════════════════════════════════
  //  测试 7: 通道权重调整 + 归一化
  // ════════════════════════════════════════════════
  console.log("── 7. 通道权重调整 + 归一化 ──");

  const w0 = memory.channelWeights;
  const sum0 = +(w0.fts5 + w0.vector + w0.bfs).toFixed(4);
  assert(Math.abs(sum0 - 1) < 0.001, `初始权重和=${sum0} ≈ 1`);

  memory.adjustChannelWeight('vector', 0.1);
  const w1 = memory.channelWeights;
  const sum1 = +(w1.fts5 + w1.vector + w1.bfs).toFixed(4);
  assert(Math.abs(sum1 - 1) < 0.001, `调整后权重和=${sum1} ≈ 1`);
  assert(w1.vector > w0.vector, "向量通道权重增加");

  // 边界：不能低于 0.05
  memory.adjustChannelWeight('bfs', -0.9);
  const w2 = memory.channelWeights;
  assert(w2.bfs >= 0.045, `bfs 权重=${w2.bfs.toFixed(3)} ≥ 0.05（下限保护）`);

  // 不能高于 0.9
  memory.adjustChannelWeight('fts5', 2.0);
  const w3 = memory.channelWeights;
  assert(w3.fts5 <= 0.91, `fts5 权重=${w3.fts5.toFixed(3)} ≤ 0.9（上限保护）`);
  console.log("");

  // ════════════════════════════════════════════════
  //  测试 8 (Fix 4): 探索契约退火
  // ════════════════════════════════════════════════
  console.log("── 8. 探索契约退火 (Fix 4) ──");

  // 创建一个全新 MemoryStore 避免前面的 read 计数干扰
  const memory2 = new MemoryStore();
  for (let i = 0; i < 5; i++) {
    memory2.write({
      memoryType: MemoryType.Episodic,
      content: { idx: i },
      summary: `测试记忆 ${i}`,
      agentType: AgentType.Code,
      creatorId: "test",
      weight: 1,
    });
  }

  // 第一次探索：50 轮触发
  for (let i = 0; i < 49; i++) memory2.read({ limit: 1 });
  const wPreExp1 = memory2.channelWeights;
  memory2.read({ limit: 1 }); // 第 50 次触发
  const wPostExp1 = memory2.channelWeights;
  const changed1 = wPreExp1.fts5 !== wPostExp1.fts5
    || wPreExp1.vector !== wPostExp1.vector
    || wPreExp1.bfs !== wPostExp1.bfs;
  assert(changed1, "第 50 轮触发探索契约");

  // 完成 10 轮观察 → 回滚
  for (let i = 0; i < 10; i++) memory2.read({ limit: 1 });
  const wAfterRollback = memory2.channelWeights;
  const rolledBack = Math.abs(wAfterRollback.fts5 - wPreExp1.fts5) < 0.001
    && Math.abs(wAfterRollback.vector - wPreExp1.vector) < 0.001
    && Math.abs(wAfterRollback.bfs - wPreExp1.bfs) < 0.001;
  assert(rolledBack, "10 轮观察后回滚到快照");

  // 第二次探索应在 100 轮触发（退火后间隔=100）
  // 目前已读 50+10=60 次，还需要 40 次
  for (let i = 0; i < 39; i++) memory2.read({ limit: 1 });
  // 第 100 次 read
  const wPreExp2 = memory2.channelWeights;
  memory2.read({ limit: 1 });
  const wPostExp2 = memory2.channelWeights;
  const changed2 = wPreExp2.fts5 !== wPostExp2.fts5
    || wPreExp2.vector !== wPostExp2.vector
    || wPreExp2.bfs !== wPostExp2.bfs;
  assert(changed2, "第 100 轮（退火后间隔=100）触发第二次探索");
  console.log("");

  // ════════════════════════════════════════════════
  //  测试 9 (Fix 3): 探索窗口内手动调权 → 回滚合并增量
  // ════════════════════════════════════════════════
  console.log("── 9. 探索窗口内手动调权合并 (Fix 3) ──");

  const memory3 = new MemoryStore();
  for (let i = 0; i < 5; i++) {
    memory3.write({
      memoryType: MemoryType.Episodic,
      content: { idx: i },
      summary: `合并测试记忆 ${i}`,
      agentType: AgentType.Code,
      creatorId: "test",
      weight: 1,
    });
  }

  // 触发探索
  for (let i = 0; i < 50; i++) memory3.read({ limit: 1 });
  const wSnap = memory3.channelWeights; // 探索后的权重
  assert(wSnap.fts5 !== 1/3 || wSnap.vector !== 1/3 || wSnap.bfs !== 1/3,
    "探索契约改变了权重");

  // 在观察窗口内手动调权
  memory3.adjustChannelWeight('bfs', 0.15);

  // 完成 10 轮观察 → 回滚合并
  for (let i = 0; i < 10; i++) memory3.read({ limit: 1 });
  const wAfterMerge = memory3.channelWeights;

  // 合并后权重应介于快照和快照+手动调整之间（取均值）
  // 不是完全回滚到探索前，也不是完全保留手动调整
  const wPreExplore = { fts5: 1/3, vector: 1/3, bfs: 1/3 };
  const fullyRolledBack = Math.abs(wAfterMerge.fts5 - wPreExplore.fts5) < 0.001
    && Math.abs(wAfterMerge.vector - wPreExplore.vector) < 0.001
    && Math.abs(wAfterMerge.bfs - wPreExplore.bfs) < 0.001;
  assert(!fullyRolledBack, "手动调权后未完全回滚到探索前（合并生效）");

  // 权重和仍为 1
  const sumMerge = +(wAfterMerge.fts5 + wAfterMerge.vector + wAfterMerge.bfs).toFixed(4);
  assert(Math.abs(sumMerge - 1) < 0.001, `合并后权重和=${sumMerge} ≈ 1`);
  console.log("");

  // ════════════════════════════════════════════════
  //  测试 10: 旧 MemoryQuery 路径兼容
  // ════════════════════════════════════════════════
  console.log("── 10. 旧 MemoryQuery 路径兼容 ──");
  const oldResults = memory.read({
    keywords: ["重构"],
    memoryTypes: [MemoryType.Episodic],
    limit: 5,
  });
  assert(oldResults.length >= 1, "关键词'重构'命中 ≥1 条");
  const oldResults2 = memory.read({
    states: ["ACTIVE" as any],
    limit: 3,
  });
  assert(oldResults2.length >= 3, "states 过滤有效");
  console.log("");

  // ── 收尾 ──
  console.log("╔══════════════════════════════════════════════════════════╗");
  if (passed === total) {
    console.log(`║   ✅ 全部 ${passed}/${total} 项测试通过                              ║`);
  } else {
    console.log(`║   ⚠️  ${passed}/${total} 通过, ${total - passed} 失败                              ║`);
  }
  console.log("╚══════════════════════════════════════════════════════════╝");

  if (passed !== total) process.exit(1);
}

main().catch((e) => {
  console.error("💥 冒烟测试崩溃:", e);
  process.exit(1);
});
