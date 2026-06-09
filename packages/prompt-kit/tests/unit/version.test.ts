// @ci: unit
/**
 * @cortex/prompt-kit — PromptVersion 单元测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PromptVersion } from "../../src/version/prompt-version.js";
import { PromptBlockType } from "../../src/types.js";
import type { PromptTemplate, VersionRecord } from "../../src/types.js";

function makeTemplate(id: string, version: string, blocks: Array<{ id: string; content: string }>): PromptTemplate {
  return {
    id,
    name: id,
    version,
    blocks: blocks.map((b) => ({
      id: b.id,
      type: PromptBlockType.Instruction,
      content: b.content,
      priority: 10,
    })),
    tags: [],
    source: "test",
  };
}

describe("PromptVersion", () => {
  let versionManager: PromptVersion;

  beforeEach(() => {
    versionManager = new PromptVersion();
  });

  describe("getHistory", () => {
    it("无历史时应返回空数组", () => {
      const history = versionManager.getHistory("nonexistent");
      expect(history).toEqual([]);
    });

    it("记录变更后应能查询历史", () => {
      const record: VersionRecord = {
        templateId: "test-template",
        version: "1.0.0",
        changeDescription: "初始版本",
        changedBy: "analysis",
        timestamp: Date.now(),
        blocksChanged: ["block1"],
      };
      versionManager.recordChange(record);

      const history = versionManager.getHistory("test-template");
      expect(history).toHaveLength(1);
      expect(history[0].version).toBe("1.0.0");
    });

    it("最新记录应在最前", () => {
      versionManager.recordChange({
        templateId: "t", version: "1.0.0", changeDescription: "v1",
        changedBy: "test", timestamp: 100, blocksChanged: [],
      });
      versionManager.recordChange({
        templateId: "t", version: "2.0.0", changeDescription: "v2",
        changedBy: "test", timestamp: 200, blocksChanged: [],
      });

      const history = versionManager.getHistory("t");
      expect(history[0].version).toBe("2.0.0");
      expect(history[1].version).toBe("1.0.0");
    });
  });

  describe("recordChange with snapshots", () => {
    it("应保存模板快照", async () => {
      const template = makeTemplate("my-template", "1.0.0", [
        { id: "b1", content: "你是AI助手" },
      ]);

      versionManager.recordChange({
        templateId: "my-template",
        version: "1.0.0",
        changeDescription: "初始版本",
        changedBy: "analysis",
        timestamp: Date.now(),
        blocksChanged: ["b1"],
      }, template);

      const loaded = await versionManager.getVersion("my-template", "1.0.0");
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe("my-template");
      expect(loaded!.blocks).toHaveLength(1);
    });

    it("不存在的版本应返回 null", async () => {
      const result = await versionManager.getVersion("no-template", "1.0.0");
      expect(result).toBeNull();
    });
  });

  describe("diff", () => {
    it("应正确计算版本差异", () => {
      const v1 = makeTemplate("t", "1.0.0", [
        { id: "identity", content: "你是AI助手" },
        { id: "instructions", content: "请帮助用户" },
      ]);
      const v2 = makeTemplate("t", "2.0.0", [
        { id: "identity", content: "你是高级AI助手" },
        { id: "instructions", content: "请帮助用户" },
        { id: "output", content: "输出JSON格式" },
      ]);

      versionManager.recordChange(
        { templateId: "t", version: "1.0.0", changeDescription: "v1", changedBy: "test", timestamp: 1, blocksChanged: [] },
        v1,
      );
      versionManager.recordChange(
        { templateId: "t", version: "2.0.0", changeDescription: "v2", changedBy: "test", timestamp: 2, blocksChanged: [] },
        v2,
      );

      const diff = versionManager.diff("t", "1.0.0", "2.0.0");
      expect(diff.templateId).toBe("t");
      expect(diff.additions).toContain("output");
      expect(diff.modifications[0].blockId).toBe("identity");
      expect(diff.modifications[0].before).toContain("AI助手");
      expect(diff.modifications[0].after).toContain("高级AI助手");
    });

    it("缺少快照时应返回空 diff", () => {
      const diff = versionManager.diff("no-template", "1.0.0", "2.0.0");
      expect(diff.additions).toHaveLength(0);
      expect(diff.removals).toHaveLength(0);
      expect(diff.modifications).toHaveLength(0);
    });
  });
});
