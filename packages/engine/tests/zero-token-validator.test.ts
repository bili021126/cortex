// @ci: unit

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// 通过 validate 间接测试 _grepInterface 的命令注入防护
import { CrossPackageContractRule } from "../src/execution/zero-token-validator.js";

describe("CrossPackageContractRule — G-08 命令注入修复", () => {
  /**
   * 在临时目录下构造 mini package 结构，使 CrossPackageContractRule 能找到
   * src 目录中的 .ts 文件并验证接口/类型定义。
   */
  function withTempPkg(
    pkgName: string,
    files: Record<string, string>,
    fn: (pkgDir: string) => void,
  ) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-g08-"));
    const srcDir = path.join(tmpDir, "packages", pkgName, "src");
    fs.mkdirSync(srcDir, { recursive: true });

    for (const [fileName, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(srcDir, fileName), content, "utf-8");
    }

    const originalCwd = process.cwd;
    // mock process.cwd() to return tmpDir
    process.cwd = () => tmpDir;

    try {
      fn(srcDir);
    } finally {
      process.cwd = originalCwd;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  it("含特殊字符的 name 不会被执行（命令注入防护）", () => {
    // 即使 name 包含 shell 特殊字符，也应安全返回空结果
    withTempPkg("test-pkg", {
      "index.ts": "export const x = 1;",
    }, (_pkgDir) => {
      const rule = new CrossPackageContractRule();

      // 特殊字符 name：如果在 shell 中拼接，会执行 rm -rf /
      const result = rule.validate(
        {
          type: "governance_audit",
          priority: 0,
          timestamp: Date.now(),
          notificationType: "FYI",
          payload: {
            sourcePkg: "test-pkg",
            targetPkg: "test-pkg",
            interfaceName: "foo; rm -rf /",
          },
        },
        { workspaceRoot: process.cwd() },
      );

      // 应当安全返回，不抛异常，且 passed 应为 false（找不到接口定义）
      expect(result.passed).toBe(false);
      // 确保操作系统没有受到任何影响（验证不抛出 shell 相关的异常）
      expect(result.detail).toContain("中找到");
    });
  });

  it("正常接口名称能正确匹配", () => {
    withTempPkg("test-pkg", {
      "types.ts": "export interface MyInterface { key: string; }",
    }, (_pkgDir) => {
      const rule = new CrossPackageContractRule();

      const result = rule.validate(
        {
          type: "governance_audit",
          priority: 0,
          timestamp: Date.now(),
          notificationType: "FYI",
          payload: {
            sourcePkg: "test-pkg",
            targetPkg: "test-pkg",
            interfaceName: "MyInterface",
          },
        },
        { workspaceRoot: process.cwd() },
      );

      // 同一包内 source 和 target 都是 test-pkg，应能找到 MyInterface
      expect(result.passed).toBe(true);
    });
  });

  it("type 别名也能被正确匹配", () => {
    withTempPkg("test-pkg", {
      "types.ts": "export type MyType = string;",
    }, (_pkgDir) => {
      const rule = new CrossPackageContractRule();

      const result = rule.validate(
        {
          type: "governance_audit",
          priority: 0,
          timestamp: Date.now(),
          notificationType: "FYI",
          payload: {
            sourcePkg: "test-pkg",
            targetPkg: "test-pkg",
            interfaceName: "MyType",
          },
        },
        { workspaceRoot: process.cwd() },
      );

      expect(result.passed).toBe(true);
    });
  });
});
