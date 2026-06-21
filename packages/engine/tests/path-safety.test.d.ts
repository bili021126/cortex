/**
 * @ci 路径越界防护单元测试
 *
 * 验证 validatePath / resolveSafePath 能阻断以下攻击向量：
 *   - ../ 向上穿越
 *   - 绝对路径绕过
 *   - NUL 字节注入
 *   - 空路径
 *   - 多级 ../ 穿越
 *
 * 正常路径通过验证，确保不会误杀合法操作。
 */
export {};
//# sourceMappingURL=path-safety.test.d.ts.map