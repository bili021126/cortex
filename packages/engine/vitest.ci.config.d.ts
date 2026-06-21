/**
 * CI 快速单元测试——排除需要全引擎启动（ONNX + SQLite + bootstrap）的集成测试。
 * 慢速测试由 vitest.ci-slow.config.ts 单独跑。
 *
 * ⚠️ vitest 2.1.9 的 exclude（config 字段和 CLI --exclude）均不可靠，
 * 故改用 include 的 picomatch ! 否定 glob 来排除。
 */
declare const _default: import("vite").UserConfig;
export default _default;
//# sourceMappingURL=vitest.ci.config.d.ts.map