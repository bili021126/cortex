/**
 * ReAct 循环规范测试 —— 修复 D2：react-helper.ts 已删除，仅保留 components/react-loop.ts
 *
 * 验证点：
 * 1. runReActLoop 从 components/react-loop.ts 导入
 * 2. ReActContext 接口可用
 * 3. react-helper.ts 已不存在
 * 4. index.ts 不再导出 runReActLoopLegacy
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("D2: react-helper 已删除，react-loop 为唯一版本", () => {
  it("react-helper.ts 源文件已删除", () => {
    const helperPath = path.resolve(__dirname, "../src/react-helper.ts");
    expect(fs.existsSync(helperPath)).toBe(false);
  });

  it("components/react-loop.ts 存在且包含 runReActLoop", async () => {
    const loopPath = path.resolve(__dirname, "../src/components/react-loop.ts");
    expect(fs.existsSync(loopPath)).toBe(true);

    const content = fs.readFileSync(loopPath, "utf-8");
    expect(content).toContain("export async function runReActLoop");
    expect(content).toContain("ReActContext");
  });

  it("index.ts 不导出 runReActLoopLegacy", () => {
    const indexPath = path.resolve(__dirname, "../src/index.ts");
    const content = fs.readFileSync(indexPath, "utf-8");
    expect(content).not.toContain("runReActLoopLegacy");
    expect(content).not.toContain("react-helper");
  });
});
