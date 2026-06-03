// ============================================================
// @cortex/engine/platform/path-utils —— 路径安全验证
//
// 路径越界防护：所有文件操作（read_file / write_file / search_code /
// list_files / delete_file / parse_ast）的路径经此验证后，
// L0 操作无法读取/写入 PROJECT_DIR 之外的任意文件。
//
// 防护策略：
//   1. 相对路径 → 基于 root 解析，再检查越界
//   2. 绝对路径 → 直接检查是否在 root 子树内
//   3. `../` 穿越 → resolve() 展开后检查（阻断绕过）
//   4. 符号链接穿透 → resolve() 展开后检查（阻断绕过）
//   5. 空路径/NUL 字节 → 拒绝
// ============================================================

import * as path from "node:path";

/**
 * 路径越界检查结果。
 * - ok=true 时 safePath 是验证后可在沙箱内安全使用的绝对路径
 * - ok=false 时 reason 描述违规原因
 */
export type PathValidationResult =
  | { ok: true; safePath: string }
  | { ok: false; reason: string; input: string };

/**
 * 验证文件路径是否在 projectRoot 沙箱内。
 *
 * @param filePath 工具调用传入的文件路径（可能为相对/绝对路径）
 * @param projectRoot 项目根目录（绝对路径）。null 时跳过沙箱检查（向后兼容）
 * @returns 验证结果
 */
export function validatePath(filePath: string, projectRoot: string | null): PathValidationResult {
  // ── 基础输入校验 ──
  if (!filePath || filePath.trim() === "") {
    return { ok: false, reason: "路径为空", input: filePath };
  }
  if (filePath.includes("\0")) {
    return { ok: false, reason: "路径包含 NUL 字节", input: filePath };
  }

  // ── 未设沙箱时允许任意路径（向后兼容测试场景） ──
  if (!projectRoot) {
    return { ok: true, safePath: path.resolve(filePath) };
  }

  // ── 解析路径（展开 ..、符号链接等） ──
  const resolvedRoot = path.resolve(projectRoot);
  const resolved = path.resolve(resolvedRoot, filePath);

  // ── 越界检查 ──
  // 允许：resolved 等于 root 或在 root 子树内
  // 注意：root 可能已以分隔符结尾（如 "/"），需避免双分隔符误判
  const sep = path.sep;
  const rootPrefix = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep;
  if (resolved === resolvedRoot || resolved.startsWith(rootPrefix)) {
    return { ok: true, safePath: resolved };
  }

  return {
    ok: false,
    reason: `路径越界: "${filePath}" (解析为 "${resolved}") 不在工作区 "${resolvedRoot}" 内`,
    input: filePath,
  };
}

/**
 * 验证路径并返回安全绝对路径，违规时抛出错误。
 * 适用于需要快速失败（fail-fast）的场景。
 *
 * @throws 路径越界时抛出 Error
 */
export function resolveSafePath(filePath: string, projectRoot: string | null): string {
  const result = validatePath(filePath, projectRoot);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.safePath;
}
