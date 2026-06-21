// ============================================================
// @cortex/factory — 文档配置加载器
//
// 从 @cortex/config 包加载 docs.json。
// ============================================================
import * as fs from "node:fs";
import { resolveConfigDataDir, loadConfigDomain } from "@cortex/config";
const readFileNode = (fp) => fs.readFileSync(fp, "utf-8");
/**
 * 加载文档配置。
 * 该文件为可选——不存在时返回空默认配置。
 */
export function loadDocsConfig(_projectRoot, dataDirOverride) {
    const dataDir = dataDirOverride ?? resolveConfigDataDir();
    let config;
    try {
        config = loadConfigDomain("docs", readFileNode, dataDir);
    }
    catch {
        return {
            constitutionPath: "docs/Cortex 概念顶层设计 v2.5.md",
            docRegistry: [],
        };
    }
    // 可选文件不存在时 loadConfigDomain 返回 undefined
    if (!config) {
        return {
            constitutionPath: "docs/Cortex 概念顶层设计 v2.5.md",
            docRegistry: [],
        };
    }
    return _validateStructure(config);
}
function _validateStructure(config) {
    if (!config || typeof config !== "object") {
        throw new Error("docs.json: 顶层必须为对象");
    }
    if (!config.constitutionPath) {
        config.constitutionPath = "docs/Cortex 概念顶层设计 v2.5.md";
    }
    if (!Array.isArray(config.docRegistry)) {
        config.docRegistry = [];
    }
    // 校验每项文档注册
    for (const entry of config.docRegistry) {
        const e = entry;
        if (!e.path) {
            throw new Error("docs.json: docRegistry 项缺少 path");
        }
    }
    return config;
}
//# sourceMappingURL=docs.loader.js.map