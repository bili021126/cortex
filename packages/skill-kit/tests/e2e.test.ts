/**
 * @cortex/skill-kit — 端到端（E2E）验证脚本
 *
 * ⚠️ 此测试已停用：核心逻辑已迁移至 @cortex/engine（TUI 深化 v2.6.4）
 *
 * 覆盖完整闭环：
 *   1. 注册 .ts 技能 → 动态加载 → 校验 → 缓存 → 执行 → 断言
 *   2. JSON 技能加载 → 适配 → 执行 → 断言
 *   3. 缓存命中/未命中 → 统计验证
 *   4. 异常路径（校验失败、技能未注册、输入校验失败）
 *   5. SkillFactory 一站式执行
 *
 * 运行方式：npx vitest run tests/e2e.test.ts
 *
 * @see docs/design.md §4 核心接口
 * @see docs/design.md §5 动态加载机制
 * @see docs/design.md §6 缓存策略
 * @see docs/design.md §7 执行管线
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type SkillDefinition,
  type SkillMeta,
  type SkillManifest,
  type SkillOutput,
  type ValidationResult,
  SkillCategory,
  SkillErrorCode,
} from "../dist/types.js";
import { DynamicImportLoader } from "../dist/loader.js";
import { SimpleSkillValidator } from "../dist/validator.js";
import { PipelineExecutor } from "../dist/executor.js";
import { DefaultSkillCache } from "../dist/cache.js";
import { SkillFactory } from "../dist/factory.js";

// ============================================================
// 辅助函数
// ============================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = join(__dirname, "..");
const TMP_DIR = join(PACKAGE_DIR, "tests", "skills", "tmp");

/** 确保临时目录存在 */
function ensureTmpDir(): void {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
  }
}

/** 创建临时 JSON 技能文件，返回文件路径 */
function createTempJsonSkill(
  overrides?: Partial<SkillManifest>,
): string {
  ensureTmpDir();
  const id = `e2e-json-${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const filePath = join(TMP_DIR, `${id}.json`);

  const manifest: SkillManifest = {
    id,
    agentType: "e2e-test",
    name: "E2E JSON 技能",
    version: "1.0.0",
    category: SkillCategory.TOOL,
    triggerTags: ["e2e", "json"],
    trigger: "E2E 测试触发",
    steps: [
      "解析输入参数",
      "执行 JSON 技能逻辑",
      "返回结果",
    ],
    expectedOutput: "E2E JSON 技能执行结果",
    discoveredBy: "阿贝多",
    createdAt: Date.now(),
    ...overrides,
  };

  writeFileSync(filePath, JSON.stringify(manifest, null, 2), "utf-8");
  return filePath;
}

/** 删除临时文件 */
function cleanupTempFile(filePath: string): void {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch {
    // 忽略清理错误
  }
}

// ── 内联 .ts 技能定义（用于 E2E 加载测试） ──────────────────

interface E2EInput {
  name: string;
  count?: number;
}

interface E2EOutput {
  greeting: string;
  count: number;
  timestamp: number;
}

/** 创建一个内联的 SkillDefinition（不经过文件系统，直接使用） */
function createE2ESkill(
  id: string,
  overrides?: Partial<SkillDefinition<E2EInput, E2EOutput>>,
): SkillDefinition<E2EInput, E2EOutput> {
  return {
    meta: {
      id,
      name: `E2E-${id}`,
      version: "2.0.0",
      description: "E2E 测试技能——验证完整执行管线",
      category: SkillCategory.DATA,
      triggerTags: ["e2e", "test"],
      trigger: "执行 E2E 测试时触发",
      steps: ["接收 name 和 count", "生成问候语", "记录时间戳"],
      expectedOutput: "{ greeting, count, timestamp }",
      author: "阿贝多",
      createdAt: Date.now(),
    },
    validateInput(input: unknown): input is E2EInput {
      return (
        typeof input === "object" &&
        input !== null &&
        "name" in input &&
        typeof (input as Record<string, unknown>).name === "string"
      );
    },
    async execute(ctx) {
      const { name, count = 1 } = ctx.input;
      return {
        success: true,
        data: {
          greeting: `你好，${name}！`,
          count,
          timestamp: Date.now(),
        },
      };
    },
    ...overrides,
  };
}

// ============================================================
// E2E 测试
// ============================================================

describe("E2E: 完整闭环 —— 加载 → 校验 → 缓存 → 执行", () => {
  let loader: DynamicImportLoader;
  let validator: SimpleSkillValidator;
  let cache: DefaultSkillCache;
  let executor: PipelineExecutor;

  beforeEach(() => {
    loader = new DynamicImportLoader({ baseDir: PACKAGE_DIR });
    validator = new SimpleSkillValidator({ strictVersion: true });
    cache = new DefaultSkillCache({ maxSize: 20, defaultTtlMs: 0 }); // TTL=0 永不过期
    executor = new PipelineExecutor({ defaultTimeout: 5_000 });
  });

  // ── 场景 1: 正常闭环（.ts 技能） ────────────────────────────

  it("场景 1: 加载 .ts 技能 → 校验 → 缓存 → 执行 → 断言", async () => {
    // 1. 注册技能路径
    loader.register("e2e-ts-skill", "./tests/skills/test-skill.ts");

    // 2. 加载
    const skill = await loader.load("e2e-ts-skill");
    expect(skill).toBeDefined();
    expect(skill.meta.id).toBe("test-skill");
    expect(typeof skill.execute).toBe("function");

    // 3. 校验
    const validationResult = validator.validate(skill);
    expect(validationResult.valid).toBe(true);
    expect(validationResult.errors).toHaveLength(0);

    // 4. 缓存
    cache.set("e2e-ts-skill", skill);
    expect(cache.has("e2e-ts-skill")).toBe(true);
    expect(cache.get("e2e-ts-skill")).toBe(skill);

    // 5. 执行
    const result = await executor.execute(skill, { name: "阿贝多", count: 3 });

    // 6. 断言
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        greeting: "你好，阿贝多！",
        count: 3,
      });
      expect(result.meta).toBeDefined();
      expect(result.meta!.duration).toBeGreaterThanOrEqual(0);
      expect(result.meta!.version).toBe("1.0.0");
      expect(result.meta!.timestamp).toBeGreaterThan(0);
    }
  });

  // ── 场景 2: 缓存命中 ────────────────────────────────────────

  it("场景 2: 第二次加载走缓存命中路径", async () => {
    const skill = createE2ESkill("e2e-cache-hit");

    // 直接放入缓存
    cache.set("e2e-cache-hit", skill);
    expect(cache.has("e2e-cache-hit")).toBe(true);

    // 命中
    const cached = cache.get("e2e-cache-hit");
    expect(cached).toBe(skill);

    // 再次命中
    const cachedAgain = cache.get("e2e-cache-hit");
    expect(cachedAgain).toBe(skill);

    // 验证缓存统计
    const stats = cache.stats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(0);
    expect(stats.hitRate).toBe(1);
  });

  // ── 场景 3: 缓存未命中 + 加载 → 缓存填充 ────────────────────

  it("场景 3: 缓存未命中 → 加载技能 → 写入缓存", async () => {
    const statsBefore = cache.stats();
    const initialMisses = statsBefore.misses;

    // 1. 缓存未命中
    const miss1 = cache.get("e2e-not-cached");
    expect(miss1).toBeUndefined();

    // 2. 手动加载并写入缓存（模拟 loader 行为）
    const skill = createE2ESkill("e2e-not-cached");
    cache.set("e2e-not-cached", skill);

    // 3. 第二次访问应命中
    const hit1 = cache.get("e2e-not-cached");
    expect(hit1).toBe(skill);

    // 4. 验证统计
    const stats = cache.stats();
    expect(stats.misses).toBe(initialMisses + 1);
    expect(stats.hits).toBeGreaterThanOrEqual(1);
  });

  // ── 场景 4: JSON 技能加载 → 适配 → 执行 ─────────────────────

  it("场景 4: JSON 技能完整闭环", async () => {
    // 1. 创建临时 JSON 技能
    const jsonPath = createTempJsonSkill();

    try {
      // 2. 加载 JSON 技能
      const skill = await loader.loadFromFile(jsonPath);
      expect(skill.meta.id).toBeDefined();
      expect(skill.meta.name).toBe("E2E JSON 技能");
      expect(skill.meta.version).toBe("1.0.0");

      // 3. 校验
      const vr = validator.validate(skill);
      expect(vr.valid).toBe(true);

      // 4. 放入缓存
      cache.set(skill.meta.id, skill);

      // 5. 执行
      const result = await executor.execute(skill, { someInput: "test" });
      expect(result.success).toBe(true);
      if (result.success) {
        // JSON 技能返回 { prompt } 格式
        expect(result.data).toHaveProperty("prompt");
        expect(result.data.prompt).toContain("E2E JSON 技能");
        expect(result.data.prompt).toContain("解析输入参数");
      }
    } finally {
      cleanupTempFile(jsonPath);
    }
  });

  // ── 场景 5: 异常路径 —— 校验失败 ────────────────────────────

  it("场景 5: 无效技能定义校验失败", () => {
    const badSkill = {
      meta: {
        id: "bad-skill",
        // 缺少 name
        version: "not-semver",
        // 缺少 description
        category: "INVALID_CATEGORY" as SkillCategory,
        triggerTags: "not-array" as unknown as string[],
        // 缺少 trigger
        steps: [],
        // 缺少 expectedOutput
      },
      // 缺少 execute
    } as unknown as SkillDefinition;

    const vr = validator.validate(badSkill);
    expect(vr.valid).toBe(false);
    expect(vr.errors.length).toBeGreaterThan(0);

    // 应包含多个具体错误
    const errorPaths = vr.errors.map((e) => e.path);
    expect(errorPaths).toContain("meta.name");
    expect(errorPaths).toContain("meta.description");
    expect(errorPaths).toContain("meta.trigger");
    expect(errorPaths).toContain("meta.steps");
    expect(errorPaths).toContain("meta.expectedOutput");
    expect(errorPaths).toContain("execute");
  });

  // ── 场景 6: 异常路径 —— 输入校验失败 ────────────────────────

  it("场景 6: validateInput 拒绝非法输入", async () => {
    const skill = createE2ESkill("e2e-input-validation");

    // 传入非法输入（缺少 name）
    const result = await executor.execute(skill, { count: 99 } as unknown as E2EInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(SkillErrorCode.VALIDATION_FAILED);
      expect(result.error.message).toContain("validateInput 返回 false");
    }
  });

  // ── 场景 7: 异常路径 —— 执行异常 ────────────────────────────

  it("场景 7: 执行抛出异常返回 EXECUTION_FAILED", async () => {
    const throwingSkill: SkillDefinition = {
      meta: {
        id: "e2e-throw",
        name: "会抛异常的技能",
        version: "1.0.0",
        description: "测试执行异常路径",
        category: SkillCategory.TOOL,
        triggerTags: ["e2e"],
        trigger: "执行异常测试",
        steps: ["抛出错误"],
        expectedOutput: "不会到达这里",
      },
      async execute() {
        throw new Error("E2E 模拟执行异常");
      },
    };

    const result = await executor.execute(throwingSkill, {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(SkillErrorCode.EXECUTION_FAILED);
      expect(result.error.message).toContain("E2E 模拟执行异常");
    }
  });

  // ── 场景 8: 主动失效缓存 ────────────────────────────────────

  it("场景 8: evict 主动失效缓存", () => {
    const skill = createE2ESkill("e2e-evict-me");

    cache.set("e2e-evict-me", skill);
    expect(cache.has("e2e-evict-me")).toBe(true);

    cache.evict("e2e-evict-me");
    expect(cache.has("e2e-evict-me")).toBe(false);
    expect(cache.get("e2e-evict-me")).toBeUndefined();
  });

  // ── 场景 9: 清空全部缓存 ────────────────────────────────────

  it("场景 9: clear 清空全部缓存", () => {
    cache.set("a", createE2ESkill("a"));
    cache.set("b", createE2ESkill("b"));
    cache.set("c", createE2ESkill("c"));

    const statsBefore = cache.stats();
    expect(statsBefore.size).toBe(3);

    cache.clear();

    const statsAfter = cache.stats();
    expect(statsAfter.size).toBe(0);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBeUndefined();
  });

  // ── 场景 10: LRU 淘汰 ───────────────────────────────────────

  it("场景 10: 超出 maxSize 触发 LRU 淘汰", () => {
    const lruCache = new DefaultSkillCache({ maxSize: 3, defaultTtlMs: 0 });

    lruCache.set("a", createE2ESkill("a"));
    lruCache.set("b", createE2ESkill("b"));
    lruCache.set("c", createE2ESkill("c"));

    // 访问 a，使其成为最近使用
    lruCache.get("a");

    // 插入 d，应淘汰最久未使用的 b
    lruCache.set("d", createE2ESkill("d"));

    expect(lruCache.get("a")).toBeDefined();  // 最近访问过，保留
    expect(lruCache.get("b")).toBeUndefined(); // 最久未使用，被淘汰
    expect(lruCache.get("c")).toBeDefined();  // 保留
    expect(lruCache.get("d")).toBeDefined();  // 新插入，保留
  });
});

// ============================================================
// E2E: SkillFactory 一站式流程
// ============================================================

describe("E2E: SkillFactory 一站式执行", () => {
  let factory: SkillFactory;
  let loader: DynamicImportLoader;
  let jsonFilePath: string;

  beforeEach(() => {
    loader = new DynamicImportLoader({ baseDir: PACKAGE_DIR });
    factory = new SkillFactory({
      loader,
      validator: new SimpleSkillValidator({ strictVersion: true }),
      executor: new PipelineExecutor({ defaultTimeout: 5_000 }),
      cache: new DefaultSkillCache({ maxSize: 20, defaultTtlMs: 0 }),
    });
  });

  afterEach(() => {
    if (jsonFilePath) {
      cleanupTempFile(jsonFilePath);
    }
  });

  it("加载并执行已注册的 .ts 技能", async () => {
    // 注册
    factory.register("e2e-ts-skill", "./tests/skills/test-skill.ts");

    // 执行（内部自动完成 load → validate → execute）
    const result = await factory.execute<E2EInput, E2EOutput>(
      "e2e-ts-skill",
      { name: "纳西妲", count: 5 },
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.greeting).toBe("你好，纳西妲！");
      expect(result.data.count).toBe(5);
      expect(result.meta).toBeDefined();
      expect(result.meta!.version).toBe("1.0.0");
      expect(result.meta!.duration).toBeGreaterThanOrEqual(0);
    }
  });

  it("第二次执行走缓存命中路径（factory.load）", async () => {
    factory.register("e2e-cached", "./tests/skills/test-skill.ts");

    // 第一次：缓存未命中 → 加载
    const skill1 = await factory.load("e2e-cached");
    expect(skill1).toBeDefined();

    // 第二次：缓存命中
    const skill2 = await factory.load("e2e-cached");
    expect(skill2).toBe(skill1); // 同一个引用

    // 缓存统计应显示命中
    const cacheStats = factory.getCache().stats();
    expect(cacheStats.hits).toBeGreaterThanOrEqual(1);
  });

  it("加载未注册的技能返回错误结果", async () => {
    const result = await factory.execute("nonexistent-skill", {});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("SKILL_NOT_FOUND");
      expect(result.error.message).toContain("nonexistent-skill");
    }
  });

  it("Factory.validate 检验未注册技能", async () => {
    const vr = await factory.validate("nonexistent");
    expect(vr.valid).toBe(false);
    expect(vr.errors[0].path).toBe("(root)");
    expect(vr.errors[0].message).toContain("nonexistent");
  });

  it("完整生命周期：register → load → validate → execute → cache → dispose", async () => {
    // 1. 注册
    factory.register("e2e-lifecycle", "./tests/skills/test-skill.ts");

    // 2. 加载（自动缓存）
    const loaded = await factory.load("e2e-lifecycle");
    expect(loaded).toBeDefined();

    // 3. 校验
    const vr = await factory.validate("e2e-lifecycle");
    expect(vr.valid).toBe(true);

    // 4. 执行
    const result = await factory.execute("e2e-lifecycle", { name: "生命周期测试" });
    expect(result.success).toBe(true);

    // 5. 缓存中有数据
    const cacheStats = factory.getCache().stats();
    expect(cacheStats.size).toBe(1);

    // 6. 释放
    await factory.dispose();
    const afterDispose = factory.getCache().stats();
    expect(afterDispose.size).toBe(0);
  });

  it("validate 检测技能定义不完整", async () => {
    // 注册一个不存在的文件路径
    factory.register("e2e-bad-path", "./tests/skills/____nonexistent____.ts");

    const vr = await factory.validate("e2e-bad-path");
    expect(vr.valid).toBe(false);
  });
});

// ============================================================
// E2E: 并发与边界
// ============================================================

describe("E2E: 边界与并发场景", () => {
  let executor: PipelineExecutor;

  beforeEach(() => {
    executor = new PipelineExecutor({ defaultTimeout: 10_000 });
  });

  it("执行耗时为零的技能", async () => {
    const instantSkill: SkillDefinition = {
      meta: {
        id: "e2e-instant",
        name: "即时技能",
        version: "1.0.0",
        description: "立即返回",
        category: SkillCategory.SYSTEM,
        triggerTags: ["e2e"],
        trigger: "即时触发",
        steps: ["立即返回"],
        expectedOutput: "ok",
      },
      async execute() {
        return { success: true, data: "instant" };
      },
    };

    const result = await executor.execute(instantSkill, {});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("instant");
      expect(result.meta!.duration).toBeGreaterThanOrEqual(0);
    }
  });

  it("技能执行包含 store 共享数据", async () => {
    const storeSkill: SkillDefinition = {
      meta: {
        id: "e2e-store",
        name: "存储技能",
        version: "1.0.0",
        description: "测试 store",
        category: SkillCategory.TOOL,
        triggerTags: ["e2e"],
        trigger: "store 测试",
        steps: ["写入 store"],
        expectedOutput: "store 操作结果",
      },
      async execute(ctx) {
        ctx.store.set("key1", "value1");
        ctx.store.set("key2", 42);
        return {
          success: true,
          data: {
            key1: ctx.store.get("key1"),
            key2: ctx.store.get("key2"),
            size: ctx.store.size,
          },
        };
      },
    };

    const result = await executor.execute(storeSkill, {});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        key1: "value1",
        key2: 42,
        size: 2,
      });
    }
  });

  it("技能执行生成 traceId", async () => {
    let capturedTraceId: string | undefined;

    const traceSkill: SkillDefinition = {
      meta: {
        id: "e2e-trace",
        name: "跟踪技能",
        version: "1.0.0",
        description: "测试 traceId",
        category: SkillCategory.TOOL,
        triggerTags: ["e2e"],
        trigger: "traceId 测试",
        steps: ["记录 traceId"],
        expectedOutput: "traceId",
      },
      async execute(ctx) {
        capturedTraceId = ctx.traceId;
        return { success: true, data: ctx.traceId };
      },
    };

    const result = await executor.execute(traceSkill, {}, { traceId: "e2e-custom-trace" });
    expect(result.success).toBe(true);
    expect(capturedTraceId).toBe("e2e-custom-trace");
  });

  it("空输入执行技能", async () => {
    const skill = createE2ESkill("e2e-empty-input");
    const result = await executor.execute(skill, { name: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.greeting).toBe("你好，！");
    }
  });

  it("onInit 钩子执行且仅执行一次", async () => {
    const initLog: number[] = [];

    const skill: SkillDefinition = {
      meta: {
        id: "e2e-init-once",
        name: "单次初始化技能",
        version: "1.0.0",
        description: "验证 onInit 仅首次执行",
        category: SkillCategory.SYSTEM,
        triggerTags: ["e2e"],
        trigger: "初始化测试",
        steps: ["执行 onInit"],
        expectedOutput: "初始化计数",
      },
      async onInit() {
        initLog.push(Date.now());
      },
      async execute() {
        return { success: true, data: { initCount: initLog.length } };
      },
    };

    const result1 = await executor.execute(skill, {});
    expect(result1.success).toBe(true);

    const result2 = await executor.execute(skill, {});
    expect(result2.success).toBe(true);

    expect(initLog.length).toBe(1); // 首次执行调用一次
  });
});
