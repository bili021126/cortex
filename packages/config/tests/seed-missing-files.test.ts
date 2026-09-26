// @ci: unit
// ============================================================
// @cortex/config —— seedMissingFiles add-only 语义测试
//
// 回归背景：旧实现为 `if (fs.existsSync(userDataDir)) return`，只在首次创建目录时播种，
// 导致上游新增/修改的配置永远到不了已安装的用户数据目录。实测 ~/.cortex/config 缺
// architecture-flows.json（新配置域在运行时静默读不到），event-routing.json 缺 mergeRules
// （NotificationPipe 归并静默失效）。
//
// 本测试钉死两条：① 缺什么补什么；② 已存在的一律不动（用户编辑不可丢）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { seedMissingFiles } from "../src/index.js";

let pkgDir: string;
let userDir: string;

function makePkgDir(files: Record<string, string>): void {
  mkdirSync(pkgDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(pkgDir, name), content);
  }
}

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), `cortex-seed-${randomUUID()}-`));
  pkgDir = join(base, "dist-data");
  userDir = join(base, "user-config");
});

afterEach(() => {
  rmSync(pkgDir, { recursive: true, force: true });
  rmSync(userDir, { recursive: true, force: true });
});

describe("seedMissingFiles（add-only 补种）", () => {
  it("用户目录不存在时创建并复制全部 json", () => {
    makePkgDir({ "a.json": '{"x":1}', "b.json": '{"y":2}' });

    seedMissingFiles(userDir, pkgDir);

    expect(readdirSync(userDir).sort()).toEqual(["a.json", "b.json"]);
    expect(readFileSync(join(userDir, "a.json"), "utf-8")).toBe('{"x":1}');
  });

  it("已存在的文件不被覆盖——用户编辑必须保留", () => {
    makePkgDir({ "a.json": '{"from":"package"}', "new.json": '{"from":"package"}' });
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, "a.json"), '{"from":"user-edited"}');

    seedMissingFiles(userDir, pkgDir);

    // 已存在的保持用户版本
    expect(readFileSync(join(userDir, "a.json"), "utf-8")).toBe('{"from":"user-edited"}');
    // 缺的那个补上
    expect(readFileSync(join(userDir, "new.json"), "utf-8")).toBe('{"from":"package"}');
  });

  it("回归：目录已存在时仍补种新增文件（旧实现在此直接 return）", () => {
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, "old.json"), "{}");
    // 上游后来新增了 architecture-flows.json 这类新域文件
    makePkgDir({ "old.json": '{"package":"v2"}', "architecture-flows.json": '{"flows":[]}' });

    seedMissingFiles(userDir, pkgDir);

    expect(readFileSync(join(userDir, "architecture-flows.json"), "utf-8")).toBe('{"flows":[]}');
    expect(readFileSync(join(userDir, "old.json"), "utf-8")).toBe("{}");
  });

  it("只处理 .json——dist/data 里编译出的 .js/.d.ts/.map 不种进用户目录", () => {
    makePkgDir({ "a.json": "{}" });
    writeFileSync(join(pkgDir, "context-policies.js"), "export {};");
    writeFileSync(join(pkgDir, "context-policies.d.ts"), "export {};");
    writeFileSync(join(pkgDir, "context-policies.js.map"), "{}");

    seedMissingFiles(userDir, pkgDir);

    expect(readdirSync(userDir)).toEqual(["a.json"]);
  });

  it("包数据目录不存在时不抛错（读取侧仍有兜底）", () => {
    expect(() => seedMissingFiles(userDir, join(pkgDir, "nope"))).not.toThrow();
  });

  it("幂等——重复调用结果一致，且不产生多余文件", () => {
    makePkgDir({ "a.json": '{"x":1}' });

    seedMissingFiles(userDir, pkgDir);
    seedMissingFiles(userDir, pkgDir);

    expect(readdirSync(userDir)).toEqual(["a.json"]);
  });
});
