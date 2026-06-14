// ============================================================
// @cortex/memory — 基本使用示例
//
// 展示 @cortex/memory 包的核心功能：
// 1. InMemoryMemoryStore 基本读写
// 2. FileBasedMemoryStore 持久化
// 3. MemoryStoreRegistry 注册表
// 4. 事务操作
// 5. 查询与过滤
//
// 运行: npx tsx examples/basic-usage.ts
// ============================================================

import {
  InMemoryMemoryStore,
  FileBasedMemoryStore,
  MemoryStoreRegistry,
} from "@cortex/memory";
import type {
  IMemoryStore,
  TransactionalMemoryStore,
  TransactionContext,
} from "@cortex/memory";
import { LinkType } from "@cortex/shared";
import type { MemoryWriteInput } from "@cortex/shared";
import * as path from "node:path";
import { promises as fs } from "node:fs";

// ─── 辅助函数 ──────────────────────────────────

function createSampleInput(overrides: Partial<MemoryWriteInput> = {}): MemoryWriteInput {
  return {
    source: { agentType: "Alhaitham", taskId: "example-task" },
    kind: "Insight",
    summary: "示例记忆",
    semantic_gist: "这是一个示例记忆条目",
    content_blob: { example: true, timestamp: Date.now() },
    ...overrides,
  };
}

function printSeparator(title: string): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

// ─── 示例 1: InMemoryMemoryStore ───────────────

async function exampleInMemoryStore(): Promise<void> {
  printSeparator("示例 1: InMemoryMemoryStore 基本操作");

  const store = new InMemoryMemoryStore();
  await store.init(":memory:");

  // 写入
  const id1 = await store.write(createSampleInput({ summary: "第一条记忆" }));
  const id2 = await store.write(createSampleInput({ summary: "第二条记忆" }));
  console.log(`写入 2 条记忆: ${id1}, ${id2}`);

  // 读取
  const entry = await store.get(id1);
  console.log(`读取记忆: ${entry?.summary}`);

  // 查询
  const results = await store.read({ kind: "Insight" });
  console.log(`查询到 ${results.length} 条 Insight 类型的记忆`);

  // 存在性检查
  console.log(`has(id1): ${store.has(id1)}`);
  console.log(`has(non-existent): ${store.has("non-existent")}`);

  // 删除
  await store.delete(id2);
  console.log(`删除后 size: ${store.size}`);

  await store.close();
}

// ─── 示例 2: FileBasedMemoryStore ──────────────

async function exampleFileBasedStore(): Promise<void> {
  printSeparator("示例 2: FileBasedMemoryStore 持久化");

  const testDir = path.join(process.cwd(), ".example-data");

  const store = new FileBasedMemoryStore({ autoFlush: true });
  await store.init(testDir);

  // 写入记忆（自动持久化）
  const id = await store.write(createSampleInput({
    summary: "持久化记忆",
    semantic_gist: "这条记忆会被写入磁盘文件",
  }));
  console.log(`写入持久化记忆: ${id}`);

  // 验证文件存在
  const entryPath = path.join(testDir, "entries", `${id}.json`);
  const exists = await fs.access(entryPath).then(() => true).catch(() => false);
  console.log(`文件已持久化: ${exists}`);

  // 关闭并重新打开
  await store.close();
  console.log("存储已关闭");

  const store2 = new FileBasedMemoryStore();
  await store2.init(testDir);
  console.log("存储已重新初始化");

  const loaded = await store2.get(id);
  console.log(`重新加载: ${loaded?.summary}`);

  await store2.close();

  // 清理
  await fs.rm(testDir, { recursive: true, force: true });
}

// ─── 示例 3: MemoryStoreRegistry ───────────────

async function exampleRegistry(): Promise<void> {
  printSeparator("示例 3: MemoryStoreRegistry 注册表");

  const registry = new MemoryStoreRegistry();

  // 注册内存存储
  const memStore = new InMemoryMemoryStore();
  await memStore.init(":memory:");
  registry.register("in-memory", memStore);
  console.log('已注册: "in-memory"');

  // 注册工厂（惰性初始化）
  registry.registerFactory("lazy", async () => {
    const store = new InMemoryMemoryStore();
    await store.init(":memory:");
    console.log('  → "lazy" 存储已惰性初始化');
    return store;
  });

  // 获取默认存储
  const defaultStore = await registry.getDefault();
  console.log(`默认存储名称: ${(defaultStore as any).constructor.name}`);

  // 获取工厂存储（触发惰性初始化）
  const lazyStore = await registry.get("lazy");
  console.log(`工厂存储已获取: ${lazyStore !== undefined}`);

  // 切换默认
  registry.switchDefault("lazy");
  const newDefault = await registry.getDefault();
  console.log(`切换后默认: ${(newDefault as any).constructor.name}`);

  // 列出所有名称
  console.log(`已注册名称: ${registry.getNames().join(", ")}`);

  await registry.shutdownAll();
}

// ─── 示例 4: 事务操作 ──────────────────────────

async function exampleTransaction(): Promise<void> {
  printSeparator("示例 4: 事务操作");

  const store = new InMemoryMemoryStore() as InMemoryMemoryStore & TransactionalMemoryStore;
  await store.init(":memory:");

  // 开启事务
  const txn: TransactionContext = await store.beginTransaction("Serializable");
  console.log(`事务已开启: ${txn.id} (隔离级别: ${txn.isolation})`);

  try {
    // 事务内写入
    const id1 = await store.writeWithin(txn, createSampleInput({ summary: "事务记忆1" }));
    const id2 = await store.writeWithin(txn, createSampleInput({ summary: "事务记忆2" }));
    console.log(`事务内写入 2 条记忆`);

    // 事务内建立关联
    await store.linkWithin(txn, id1, id2, LinkType.DerivedFrom);
    console.log(`事务内建立关联`);

    // 提交事务
    const result = await store.commit(txn);
    console.log(`事务提交成功: ${result.affectedCount} 个操作`);

    // 验证数据
    const entry = await store.get(id1);
    console.log(`提交后读取: ${entry?.summary}`);
  } catch (error) {
    console.error("事务失败，回滚中...");
    await store.rollback(txn);
    console.error("事务已回滚");
  }

  await store.close();
}

// ─── 示例 5: 查询与过滤 ────────────────────────

async function exampleQuery(): Promise<void> {
  printSeparator("示例 5: 查询与过滤");

  const store = new InMemoryMemoryStore();
  await store.init(":memory:");

  // 写入多种类型的记忆
  await store.write(createSampleInput({
    kind: "Insight",
    summary: "架构设计：采用微服务架构",
    weight: 3.0,
  }));
  await store.write(createSampleInput({
    kind: "TaskLog",
    summary: "任务执行：成功完成数据库迁移",
    weight: 1.0,
  }));
  await store.write(createSampleInput({
    kind: "Skill",
    summary: "技能学习：掌握 Rust 所有权机制",
    weight: 2.0,
  }));

  // 按类别过滤
  const insights = await store.read({ kind: "Insight" });
  console.log(`Insight 类型: ${insights.length} 条`);

  // 按关键词过滤
  const keywordResults = await store.read({ keywords: ["架构"] });
  console.log(`含"架构"关键词: ${keywordResults.length} 条`);

  // 按权重排序（read 默认按权重降序）
  const allSorted = await store.read({});
  console.log(`按权重排序: ${allSorted.map(e => `${e.summary} (${e.weight})`).join(", ")}`);

  // 限制结果
  const limited = await store.read({ limit: 2 });
  console.log(`限制 2 条: ${limited.length} 条`);

  // 按 metadata 过滤
  const metadataResults = await store.read({
    metadataFilter: { example: true },
  });
  console.log(`metadata 过滤: ${metadataResults.length} 条`);

  await store.close();
}

// ─── 主函数 ────────────────────────────────────

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║     @cortex/memory 基本使用示例                  ║");
  console.log("╚══════════════════════════════════════════════════╝");

  await exampleInMemoryStore();
  await exampleFileBasedStore();
  await exampleRegistry();
  await exampleTransaction();
  await exampleQuery();

  console.log("\n✅ 所有示例执行完毕");
}

main().catch(console.error);
