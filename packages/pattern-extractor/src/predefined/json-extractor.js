// ============================================================
// @cortex/pattern-extractor — JsonPatternExtractor 实现
// ============================================================
//
// @file-overview
// JsonPatternExtractor 是 PatternExtractor 接口的一个具体实现，
// 专门用于从 JSON 内容中提取结构模式和命名约定模式。
//
// 适用场景：
// - 分析 API 响应的 JSON Schema 结构模式
// - 提取配置文件中的键命名约定
// - 识别数据对象的结构复杂度模式
// - 检测数组元素的同质性模式
//
// 提取策略：
// 1. 解析 JSON → 递归遍历所有节点
// 2. 统计键命名风格分布（camelCase / snake_case / PascalCase / kebab-case）
// 3. 统计对象嵌套深度分布
// 4. 统计属性值类型分布（string / number / boolean / null / object / array）
// 5. 统计数组元素类型同质性
// 6. 基于统计显著性提取模式，计算置信度
//
// @layer 实现层（Implementation Layer）
// @implements PatternExtractor<string, JsonExtractorOptions>
//
// @coding-standards
// - 零 any 类型 —— 所有 JSON 值通过 JsonValue 联合类型描述
// - 零非空断言 —— 所有可选字段通过空值检查守卫
// - 所有公开 API 均附带完整 JSDoc
// - 所有错误通过 ExtractionResult.error 返回，不抛出运行时异常
// ============================================================
import { PatternKind, } from "../extractor.js";
/**
 * 创建初始化统计对象。
 *
 * 所有计数器归零，键列表为空。
 *
 * @returns 初始化后的 JsonAnalysisStats
 */
function createEmptyStats() {
    return {
        namingCounts: {
            camelCase: 0,
            snake_case: 0,
            PascalCase: 0,
            "kebab-case": 0,
            other: 0,
        },
        allKeys: [],
        maxDepth: 0,
        totalDepthSum: 0,
        visitedNodes: 0,
        typeCounts: {
            string: 0,
            number: 0,
            boolean: 0,
            null: 0,
            object: 0,
            array: 0,
        },
        arraysAnalyzed: 0,
        homogeneousArrays: 0,
        propertyCountsPerObject: [],
        totalStringLength: 0,
        stringValueCount: 0,
    };
}
// ============================================================
// §4 命名风格检测工具
// ============================================================
/**
 * 检测键名的命名风格。
 *
 * 匹配规则（按优先级）：
 * 1. 全小写 + 连字符分隔 → kebab-case（如 "user-name"）
 * 2. 全小写 + 下划线分隔 → snake_case（如 "user_name"）
 * 3. 首字母大写 + 无分隔符 → PascalCase（如 "UserName"）
 * 4. 首字母小写 + 无分隔符 → camelCase（如 "userName"）
 * 5. 以上均不匹配 → other
 *
 * @param key - JSON 对象键名
 * @returns 检测到的命名风格
 *
 * @example
 * ```typescript
 * detectNamingStyle("userName");   // → "camelCase"
 * detectNamingStyle("user_name");  // → "snake_case"
 * detectNamingStyle("UserName");   // → "PascalCase"
 * detectNamingStyle("user-name");  // → "kebab-case"
 * detectNamingStyle("123key");     // → "other"
 * ```
 */
function detectNamingStyle(key) {
    // 空键或非字母开头
    if (key.length === 0) {
        return "other";
    }
    // kebab-case: 仅含小写字母、数字和连字符，且含连字符
    if (/^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)*$/.test(key)) {
        return "kebab-case";
    }
    // snake_case: 仅含小写字母、数字和下划线，且含下划线
    if (/^[a-z][a-z0-9]*(_[a-z][a-z0-9]*)*$/.test(key)) {
        return "snake_case";
    }
    // PascalCase: 首字母大写，无分隔符
    if (/^[A-Z][a-zA-Z0-9]*$/.test(key)) {
        return "PascalCase";
    }
    // camelCase: 首字母小写，无分隔符
    if (/^[a-z][a-zA-Z0-9]*$/.test(key)) {
        return "camelCase";
    }
    return "other";
}
/**
 * 检测 JSON 值的类型。
 *
 * 使用 Object.prototype.toString 进行类型检测，
 * 区分 object（普通对象）和 array（数组）。
 *
 * @param value - JSON 值
 * @returns 属性类型枚举值
 */
function detectPropertyType(value) {
    if (value === null) {
        return "null";
    }
    if (Array.isArray(value)) {
        return "array";
    }
    if (typeof value === "object") {
        return "object";
    }
    // typeof 返回 "string" | "number" | "boolean"
    // 但 TypeScript 收窄后 value 为 string | number | boolean
    if (typeof value === "string") {
        return "string";
    }
    if (typeof value === "number") {
        return "number";
    }
    // boolean
    return "boolean";
}
// ============================================================
// §5 JSON 递归分析器
// ============================================================
/**
 * 递归分析 JSON 值，填充统计信息。
 *
 * 遍历策略：
 * - 对象：遍历所有键，累计命名风格计数和类型计数
 * - 数组：检查元素类型同质性，递归分析对象/数组成员
 * - 基本类型：仅累计类型计数
 *
 * 深度跟踪：每进入一层嵌套 depth + 1，当前节点的 depth
 * 为进入时的深度值。
 *
 * @param value  - 当前遍历的 JSON 值
 * @param stats  - 统计累积器（就地修改）
 * @param depth  - 当前嵌套深度（根节点为 0）
 * @param seen   - 对象引用 Set，用于检测循环引用
 * @returns void（stats 就地修改）
 */
function analyzeJsonValue(value, stats, depth, seen) {
    stats.visitedNodes++;
    stats.totalDepthSum += depth;
    if (depth > stats.maxDepth) {
        stats.maxDepth = depth;
    }
    if (value === null) {
        stats.typeCounts.null++;
        return;
    }
    if (typeof value === "string") {
        stats.typeCounts.string++;
        stats.totalStringLength += value.length;
        stats.stringValueCount++;
        return;
    }
    if (typeof value === "number") {
        stats.typeCounts.number++;
        return;
    }
    if (typeof value === "boolean") {
        stats.typeCounts.boolean++;
        return;
    }
    if (Array.isArray(value)) {
        stats.typeCounts.array++;
        stats.arraysAnalyzed++;
        // 检查数组元素类型同质性
        if (value.length > 0) {
            const firstType = value.length > 0 ? detectPropertyType(value[0]) : null;
            let isHomogeneous = true;
            if (firstType !== null) {
                for (let i = 1; i < value.length; i++) {
                    const elementType = detectPropertyType(value[i]);
                    if (elementType !== firstType) {
                        isHomogeneous = false;
                        break;
                    }
                }
            }
            if (isHomogeneous) {
                stats.homogeneousArrays++;
            }
        }
        // 递归分析数组元素
        for (const element of value) {
            analyzeJsonValue(element, stats, depth + 1, seen);
        }
        return;
    }
    // 普通对象
    if (typeof value === "object" && value !== null) {
        stats.typeCounts.object++;
        // 循环引用检测
        if (seen.has(value)) {
            return;
        }
        seen.add(value);
        const keys = Object.keys(value);
        stats.propertyCountsPerObject.push(keys.length);
        for (const key of keys) {
            stats.allKeys.push(key);
            // 统计命名风格
            const style = detectNamingStyle(key);
            stats.namingCounts[style]++;
            // 递归分析属性值
            const propValue = value[key];
            analyzeJsonValue(propValue, stats, depth + 1, seen);
        }
        seen.delete(value);
    }
}
// ============================================================
// §6 模式构建器
// ============================================================
/**
 * 生成模式的唯一标识。
 *
 * 格式：`json-extractor-{name-slug}`，
 * 其中 name-slug 为模式名称的 kebab-case 缩写。
 *
 * @param nameSlug - 模式名称的简短标识
 * @returns 唯一 ID 字符串
 */
function buildPatternId(nameSlug) {
    return `json-extractor-${nameSlug}`;
}
/**
 * 构建命名约定模式。
 *
 * 从统计结果中找出占比最高的命名风格。
 * 仅当该风格的键数量 ≥ 总键数的 60% 且 ≥ minSampleSize 时产出模式。
 *
 * @param stats - 分析统计结果
 * @param source - 输入来源标识
 * @param minSampleSize - 最小样本数
 * @returns PatternDefinition 或 undefined（不满足条件时）
 */
function buildNamingPattern(stats, source, minSampleSize) {
    const totalKeys = stats.allKeys.length;
    if (totalKeys < minSampleSize) {
        return undefined;
    }
    // 找占比最高的命名风格
    let dominantStyle = "other";
    let dominantCount = 0;
    const styleEntries = Object.entries(stats.namingCounts);
    for (const [style, count] of styleEntries) {
        if (count > dominantCount) {
            dominantCount = count;
            dominantStyle = style;
        }
    }
    const ratio = dominantCount / totalKeys;
    // 要求占比 ≥ 60% 才有意义
    if (ratio < 0.6) {
        return undefined;
    }
    // 找到正反例
    const positiveExample = stats.allKeys.find((k) => detectNamingStyle(k) === dominantStyle) ?? stats.allKeys[0];
    const negativeExample = stats.allKeys.find((k) => detectNamingStyle(k) !== dominantStyle);
    const styleDescriptionMap = {
        camelCase: "小驼峰命名（camelCase），首字母小写，单词间无分隔符",
        snake_case: "下划线命名（snake_case），全小写，单词间以下划线分隔",
        PascalCase: "大驼峰命名（PascalCase），首字母大写，单词间无分隔符",
        "kebab-case": "连字符命名（kebab-case），全小写，单词间以连字符分隔",
        other: "其他命名风格",
    };
    const styleNameMap = {
        camelCase: "camelCase",
        snake_case: "snake_case",
        PascalCase: "PascalCase",
        "kebab-case": "kebab-case",
        other: "other",
    };
    const confidence = Math.min(0.3 + ratio * 0.6, 0.95);
    // 构建要素
    const elements = [
        {
            name: styleNameMap[dominantStyle],
            type: "naming-convention",
            signature: `${styleNameMap[dominantStyle]} (${Math.round(ratio * 100)}%)`,
            isPrimary: true,
        },
        {
            name: "total-keys",
            type: "metric",
            signature: `${totalKeys} keys analyzed`,
            isPrimary: false,
        },
    ];
    // 构建规则
    const rules = [
        `JSON 对象键应使用 ${styleDescriptionMap[dominantStyle]}`,
        `当前 ${Math.round(ratio * 100)}% 的键（${dominantCount}/${totalKeys}）遵循此风格`,
    ];
    if (dominantStyle !== "other" && ratio >= 0.9) {
        rules.push("一致性极高，建议作为项目 JSON 键命名规范强制执行");
    }
    else if (dominantStyle !== "other" && ratio >= 0.75) {
        rules.push("一致性良好，建议在代码审查中保持此风格");
    }
    else {
        rules.push("一致性一般，建议统一命名风格以提高可读性");
    }
    // 构建示例
    const examples = [
        {
            code: JSON.stringify({ [positiveExample]: "..." }, null, 2),
            isPositive: true,
            description: `符合 ${styleNameMap[dominantStyle]} 风格的命名示例`,
        },
    ];
    if (negativeExample !== undefined) {
        const negativeStyle = detectNamingStyle(negativeExample);
        examples.push({
            code: JSON.stringify({ [negativeExample]: "..." }, null, 2),
            isPositive: false,
            description: `不符合主流风格（${styleNameMap[negativeStyle]}）的反例`,
        });
    }
    const now = Date.now();
    return {
        id: buildPatternId("naming-convention"),
        kind: PatternKind.Naming,
        name: `JSON 键命名约定：${styleNameMap[dominantStyle]}`,
        description: [
            `从 JSON 结构中检测到主导命名风格为 **${styleNameMap[dominantStyle]}**。`,
            "",
            `**统计概览**：`,
            `- 总键数：${totalKeys}`,
            `- ${styleNameMap[dominantStyle]}：${dominantCount} 个（${Math.round(ratio * 100)}%）`,
            ...Object.entries(stats.namingCounts)
                .filter(([, count]) => count > 0)
                .map(([style, count]) => `- ${style}：${count} 个（${Math.round((count / totalKeys) * 100)}%）`),
            "",
            "**建议**：",
            dominantStyle !== "other" && ratio >= 0.75
                ? "命名风格一致性好，建议保持当前规范。"
                : "命名风格存在混杂，建议统一为一种风格以提高可读性。",
        ]
            .filter(Boolean)
            .join("\n"),
        tags: ["json", "naming-convention", styleNameMap[dominantStyle]],
        language: "json",
        confidence,
        source,
        body: {
            rules,
            examples: examples.length > 0 ? examples : undefined,
        },
        elements,
        extractor: "json-extractor",
        extractedAt: now,
        usageCount: 0,
        weight: Math.round(confidence * 10),
    };
}
/**
 * 构建结构深度模式。
 *
 * 从统计结果中提取嵌套深度分布特征。
 * 仅当 visitedNodes ≥ minSampleSize 时产出模式。
 *
 * @param stats - 分析统计结果
 * @param source - 输入来源标识
 * @param minSampleSize - 最小样本数
 * @returns PatternDefinition 或 undefined
 */
function buildStructurePattern(stats, source, minSampleSize) {
    if (stats.visitedNodes < minSampleSize) {
        return undefined;
    }
    const avgDepth = stats.totalDepthSum / stats.visitedNodes;
    const avgPropsPerObject = stats.propertyCountsPerObject.length > 0
        ? stats.propertyCountsPerObject.reduce((a, b) => a + b, 0) /
            stats.propertyCountsPerObject.length
        : 0;
    const confidence = Math.min(0.3 + (stats.visitedNodes / (stats.visitedNodes + 10)) * 0.5, 0.9);
    const elements = [
        {
            name: "max-depth",
            type: "metric",
            signature: `${stats.maxDepth}`,
            isPrimary: true,
        },
        {
            name: "avg-depth",
            type: "metric",
            signature: `${avgDepth.toFixed(2)}`,
            isPrimary: false,
        },
        {
            name: "total-nodes",
            type: "metric",
            signature: `${stats.visitedNodes}`,
            isPrimary: false,
        },
    ];
    if (stats.propertyCountsPerObject.length > 0) {
        elements.push({
            name: "avg-props-per-object",
            type: "metric",
            signature: `${avgPropsPerObject.toFixed(1)}`,
            isPrimary: false,
        });
    }
    const rules = [
        `JSON 对象最大嵌套深度为 ${stats.maxDepth} 层`,
        `平均嵌套深度为 ${avgDepth.toFixed(2)} 层`,
    ];
    if (stats.maxDepth <= 2) {
        rules.push("结构扁平，易于遍历和序列化");
    }
    else if (stats.maxDepth <= 4) {
        rules.push("结构适中，建议关注深层路径的可读性");
    }
    else {
        rules.push("结构较深，建议考虑扁平化重构以提升可维护性");
    }
    if (avgPropsPerObject > 0) {
        rules.push(`平均每对象含 ${avgPropsPerObject.toFixed(1)} 个属性` +
            (avgPropsPerObject > 10
                ? "，属性较多，建议考虑拆分"
                : avgPropsPerObject > 5
                    ? "，属性数量适中"
                    : "，结构简洁"));
    }
    const now = Date.now();
    return {
        id: buildPatternId("structure-depth"),
        kind: PatternKind.Structural,
        name: `JSON 结构深度模式（最大深度 ${stats.maxDepth}）`,
        description: [
            "从 JSON 结构中检测到嵌套深度分布特征。",
            "",
            "**统计概览**：",
            `- 总节点数：${stats.visitedNodes}`,
            `- 最大嵌套深度：${stats.maxDepth}`,
            `- 平均嵌套深度：${avgDepth.toFixed(2)}`,
            ...(stats.propertyCountsPerObject.length > 0
                ? [
                    `- 对象数量：${stats.propertyCountsPerObject.length}`,
                    `- 平均每对象属性数：${avgPropsPerObject.toFixed(1)}`,
                ]
                : []),
            "",
            "**结构评价**：",
            stats.maxDepth <= 2
                ? "✅ 结构扁平，易于理解和处理。"
                : stats.maxDepth <= 4
                    ? "⚠️ 结构适中，深层路径可能影响可读性。"
                    : "🔴 结构较深，建议评估扁平化重构的必要性。",
        ].join("\n"),
        tags: ["json", "structure", "depth"],
        language: "json",
        confidence,
        source,
        body: {
            rules,
        },
        elements,
        extractor: "json-extractor",
        extractedAt: now,
        usageCount: 0,
        weight: Math.round(confidence * 10),
    };
}
/**
 * 构建属性类型分布模式。
 *
 * 从统计结果中提取属性值类型的分布特征。
 * 仅当 visitedNodes ≥ minSampleSize 时产出模式。
 *
 * @param stats - 分析统计结果
 * @param source - 输入来源标识
 * @param minSampleSize - 最小样本数
 * @returns PatternDefinition 或 undefined
 */
function buildTypeDistributionPattern(stats, source, minSampleSize) {
    if (stats.visitedNodes < minSampleSize) {
        return undefined;
    }
    const totalValues = stats.typeCounts.string +
        stats.typeCounts.number +
        stats.typeCounts.boolean +
        stats.typeCounts.null +
        stats.typeCounts.object +
        stats.typeCounts.array;
    if (totalValues === 0) {
        return undefined;
    }
    // 按类型占比排序
    const typeDistribution = Object.entries(stats.typeCounts).sort((a, b) => b[1] - a[1]);
    const dominantType = typeDistribution[0];
    // 计算占比
    const dominantRatio = dominantType[1] / totalValues;
    const confidence = Math.min(0.3 + (totalValues / (totalValues + 20)) * 0.5, 0.85);
    const typeNameMap = {
        string: "字符串（string）",
        number: "数字（number）",
        boolean: "布尔值（boolean）",
        null: "空值（null）",
        object: "对象（object）",
        array: "数组（array）",
    };
    const elements = [
        {
            name: `dominant-type-${dominantType[0]}`,
            type: "type-distribution",
            signature: `${typeNameMap[dominantType[0]]} (${Math.round(dominantRatio * 100)}%)`,
            isPrimary: true,
        },
        {
            name: "total-values",
            type: "metric",
            signature: `${totalValues} values`,
            isPrimary: false,
        },
    ];
    const rules = [
        `JSON 值类型以 ${typeNameMap[dominantType[0]]} 为主（${Math.round(dominantRatio * 100)}%）`,
        `共涉及 ${typeDistribution.filter(([, c]) => c > 0).length} 种值类型`,
    ];
    if (dominantRatio >= 0.8) {
        rules.push("类型高度集中，数据结构较为单一");
    }
    else if (dominantRatio >= 0.5) {
        rules.push("类型分布存在主导类型，同时具有多样性");
    }
    else {
        rules.push("类型分布均衡，数据结构多样性高");
    }
    const typeSummary = typeDistribution
        .filter(([, count]) => count > 0)
        .map(([type, count]) => `  - ${typeNameMap[type]}：${count} 个`)
        .join("\n");
    const now = Date.now();
    return {
        id: buildPatternId("type-distribution"),
        kind: PatternKind.Structural,
        name: `JSON 属性类型分布（${typeNameMap[dominantType[0]]} 主导）`,
        description: [
            "从 JSON 结构中检测到属性值类型的分布特征。",
            "",
            "**类型分布概览**：",
            typeSummary,
            "",
            `**主导类型**：${typeNameMap[dominantType[0]]}（${Math.round(dominantRatio * 100)}%）`,
            "",
            dominantRatio >= 0.8
                ? "数据以单一类型为主，可能为同构数据集。"
                : dominantRatio >= 0.5
                    ? "数据结构有主导类型，同时包含其他类型的属性。"
                    : "数据类型分布均衡，异构性强。",
        ].join("\n"),
        tags: ["json", "type-distribution", dominantType[0]],
        language: "json",
        confidence,
        source,
        body: {
            rules,
        },
        elements,
        extractor: "json-extractor",
        extractedAt: now,
        usageCount: 0,
        weight: Math.round(confidence * 10),
    };
}
/**
 * 构建数组同质性模式。
 *
 * 从统计结果中提取数组元素类型的一致性特征。
 * 仅当 arraysAnalyzed ≥ minSampleSize 时产出模式。
 *
 * @param stats - 分析统计结果
 * @param source - 输入来源标识
 * @param minSampleSize - 最小样本数
 * @returns PatternDefinition 或 undefined
 */
function buildArrayHomogeneityPattern(stats, source, minSampleSize) {
    if (stats.arraysAnalyzed < minSampleSize) {
        return undefined;
    }
    const homogeneityRatio = stats.arraysAnalyzed > 0
        ? stats.homogeneousArrays / stats.arraysAnalyzed
        : 0;
    const confidence = Math.min(0.3 +
        (stats.arraysAnalyzed / (stats.arraysAnalyzed + 5)) * 0.3 +
        homogeneityRatio * 0.3, 0.9);
    const elements = [
        {
            name: "homogeneity-ratio",
            type: "metric",
            signature: `${Math.round(homogeneityRatio * 100)}%`,
            isPrimary: true,
        },
        {
            name: "arrays-analyzed",
            type: "metric",
            signature: `${stats.arraysAnalyzed}`,
            isPrimary: false,
        },
    ];
    const rules = [
        `JSON 数组中 ${homogeneityRatio >= 0.8
            ? "绝大多数"
            : homogeneityRatio >= 0.5
                ? "多数"
                : "少数"}数组元素类型一致`,
        `同质数组占比 ${Math.round(homogeneityRatio * 100)}%（${stats.homogeneousArrays}/${stats.arraysAnalyzed}）`,
    ];
    if (homogeneityRatio >= 0.9) {
        rules.push("数组高度同质，建议使用类型化数组或泛型约束");
    }
    else if (homogeneityRatio >= 0.7) {
        rules.push("数组同质性良好，多数数组元素类型一致");
    }
    else if (homogeneityRatio >= 0.4) {
        rules.push("数组同质性一般，部分数组包含混合类型元素");
    }
    else {
        rules.push("数组异质性高，注意处理混合类型数组的边界情况");
    }
    const now = Date.now();
    return {
        id: buildPatternId("array-homogeneity"),
        kind: PatternKind.Structural,
        name: `JSON 数组元素同质性模式（${Math.round(homogeneityRatio * 100)}% 同质）`,
        description: [
            "从 JSON 结构中检测到数组元素类型的一致性特征。",
            "",
            "**统计概览**：",
            `- 分析的数组总数：${stats.arraysAnalyzed}`,
            `- 同质数组（元素类型一致）：${stats.homogeneousArrays}`,
            `- 异质数组（混合类型）：${stats.arraysAnalyzed - stats.homogeneousArrays}`,
            `- 同质率：${Math.round(homogeneityRatio * 100)}%`,
            "",
            homogeneityRatio >= 0.9
                ? "✅ 数组高度同质，数据结构设计良好。"
                : homogeneityRatio >= 0.7
                    ? "⚠️ 数组同质性良好，建议检查异质数组是否合理。"
                    : "🔴 数组存在较多混合类型元素，建议审查数据结构设计。",
        ].join("\n"),
        tags: ["json", "array", "homogeneity"],
        language: "json",
        confidence,
        source,
        body: {
            rules,
        },
        elements,
        extractor: "json-extractor",
        extractedAt: now,
        usageCount: 0,
        weight: Math.round(confidence * 10),
    };
}
// ============================================================
// §7 JsonPatternExtractor — 主实现类
// ============================================================
/**
 * JsonPatternExtractor —— 基于 JSON 结构分析的模式提取器。
 *
 * 专门用于从 JSON 内容中提取结构模式和命名约定模式。
 * 通过递归遍历 JSON 树，统计键命名风格、嵌套深度、属性类型分布
 * 和数组元素同质性等特征，产出标准化的 PatternDefinition。
 *
 * **支持的提取维度**（可通过 {@link JsonExtractorOptions} 控制）：
 * - 命名约定模式（Naming）：检测 camelCase / snake_case / PascalCase / kebab-case 分布
 * - 结构深度模式（Structural）：分析嵌套深度和对象属性分布
 * - 类型分布模式（Structural）：分析属性值类型的分布特征
 * - 数组同质性模式（Structural）：分析数组元素类型的一致性
 *
 * **置信度计算**：
 * - 基础置信度 0.3，根据样本量和统计显著性递增
 * - 最大置信度 0.95（命名模式）/ 0.9（其他模式）
 * - 样本量不足时返回 undefined（不产出该模式）
 *
 * @implements PatternExtractor<string, JsonExtractorOptions>
 *
 * @example
 * ```typescript
 * const extractor = new JsonPatternExtractor();
 *
 * const result = extractor.extract(`{
 *   "userName": "alice",
 *   "emailAddress": "alice@example.com",
 *   "isActive": true,
 *   "profileData": {
 *     "firstName": "Alice",
 *     "lastName": "Smith",
 *     "age": 30
 *   }
 * }`);
 *
 * if (result.success) {
 *   for (const pattern of result.patterns) {
 *     console.log(`[${pattern.kind}] ${pattern.name}`);
 *     // → [naming] JSON 键命名约定：camelCase
 *     // → [structural] JSON 结构深度模式（最大深度 2）
 *     // → [structural] JSON 属性类型分布（string 主导）
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // 按需关闭某些分析维度以提升性能
 * const extractor = new JsonPatternExtractor({
 *   extractArrayPatterns: false,
 *   extractTypePatterns: false,
 * });
 * ```
 */
export class JsonPatternExtractor {
    /** @inheritdoc */
    name = "json-extractor";
    /** @inheritdoc */
    supportedLanguages = ["json"];
    /** @inheritdoc */
    supportedKinds = [
        PatternKind.Structural,
        PatternKind.Naming,
    ];
    /** @inheritdoc */
    description = "基于 JSON 结构分析的模式提取器，从 JSON 内容中提取键命名约定、对象结构深度、属性类型分布和数组元素同质性等模式";
    /** 合并后的选项（含默认值），使用 InternalOptions 独立类型避免泛型约束问题 */
    _options;
    /**
     * 创建 JsonPatternExtractor 实例。
     *
     * @param options - 提取器专有选项（可选，使用缺省默认值）
     *
     * @example
     * ```typescript
     * // 使用默认选项
     * const extractor = new JsonPatternExtractor();
     *
     * // 自定义选项
     * const extractor = new JsonPatternExtractor({
     *   extractNamingPatterns: true,
     *   extractStructurePatterns: true,
     *   extractTypePatterns: false,
     *   extractArrayPatterns: false,
     *   minSampleSize: 5,
     *   enableDiagnostics: true,
     * });
     * ```
     */
    constructor(options) {
        this._options = {
            extractNamingPatterns: options?.extractNamingPatterns ?? true,
            extractStructurePatterns: options?.extractStructurePatterns ?? true,
            extractTypePatterns: options?.extractTypePatterns ?? true,
            extractArrayPatterns: options?.extractArrayPatterns ?? true,
            minSampleSize: options?.minSampleSize ?? 3,
            logLevel: options?.logLevel ?? "info",
            enableDiagnostics: options?.enableDiagnostics ?? false,
        };
    }
    /**
     * 从 JSON 字符串中提取模式。
     *
     * 执行流程：
     * 1. **输入校验**：检查输入是否为非空字符串
     * 2. **JSON 解析**：调用 JSON.parse 解析输入
     * 3. **结构分析**：递归遍历 JSON 树，收集统计信息
     * 4. **模式构建**：基于统计信息，按配置维度构建 PatternDefinition
     * 5. **结果组装**：返回 ExtractionResult（判别联合）
     *
     * **错误处理**：
     * - JSON 解析失败 → success: false，error 包含解析错误详情
     * - 输入为空或非 JSON → success: false，error 包含校验信息
     * - 空对象或空数组 → success: true，patterns: []（无模式可提取）
     * - 循环引用 → 自动检测并跳过，不导致 Stack Overflow
     *
     * @param input   - JSON 字符串（必须是合法的 JSON）
     * @param options - 提取器专有选项（可选，覆盖构造函数中传入的默认选项）
     * @returns ExtractionResult — 判别联合，TypeScript 自动收窄
     *
     * @example
     * ```typescript
     * const result = extractor.extract('{"name": "test", "value": 42}');
     *
     * if (result.success) {
     *   console.log(`发现 ${result.patterns.length} 个模式`);
     * } else {
     *   console.error(`提取失败: ${result.error}`);
     * }
     * ```
     */
    extract(input, options) {
        const startTime = Date.now();
        const diagnostics = [];
        // ── 步骤 1：输入校验 ──
        if (typeof input !== "string") {
            return {
                success: false,
                patterns: [],
                diagnostics: [
                    ...diagnostics,
                    `[json-extractor] 输入类型错误: 期望 string，收到 ${typeof input}`,
                ],
                durationMs: Date.now() - startTime,
                error: `输入类型错误：期望 string，收到 ${typeof input}`,
            };
        }
        const trimmedInput = input.trim();
        if (trimmedInput.length === 0) {
            return {
                success: false,
                patterns: [],
                diagnostics: [
                    ...diagnostics,
                    "[json-extractor] 输入为空字符串",
                ],
                durationMs: Date.now() - startTime,
                error: "输入为空字符串，无法提取模式",
            };
        }
        // ── 步骤 2：JSON 解析 ──
        let parsedValue;
        try {
            parsedValue = JSON.parse(trimmedInput);
        }
        catch (parseError) {
            const errorMessage = parseError instanceof Error
                ? parseError.message
                : "未知解析错误";
            return {
                success: false,
                patterns: [],
                diagnostics: [
                    ...diagnostics,
                    `[json-extractor] JSON 解析失败: ${errorMessage}`,
                ],
                durationMs: Date.now() - startTime,
                error: `JSON 解析失败: ${errorMessage}`,
            };
        }
        // ── 步骤 3：结构分析 ──
        const stats = createEmptyStats();
        const seen = new Set();
        try {
            analyzeJsonValue(parsedValue, stats, 0, seen);
        }
        catch (analyzeError) {
            const errorMessage = analyzeError instanceof Error
                ? analyzeError.message
                : "未知分析错误";
            diagnostics.push(`[json-extractor] 结构分析异常: ${errorMessage}`);
            if (this._options.enableDiagnostics) {
                diagnostics.push(`[json-extractor] 已访问节点数: ${stats.visitedNodes}`);
            }
        }
        // 合并运行时选项与构造选项
        const mergedOptions = {
            extractNamingPatterns: options?.extractNamingPatterns ?? this._options.extractNamingPatterns,
            extractStructurePatterns: options?.extractStructurePatterns ??
                this._options.extractStructurePatterns,
            extractTypePatterns: options?.extractTypePatterns ?? this._options.extractTypePatterns,
            extractArrayPatterns: options?.extractArrayPatterns ?? this._options.extractArrayPatterns,
            minSampleSize: options?.minSampleSize ?? this._options.minSampleSize,
            logLevel: this._options.logLevel,
            enableDiagnostics: this._options.enableDiagnostics,
        };
        diagnostics.push(`[json-extractor] 分析完成: ${stats.visitedNodes} 节点, ${stats.allKeys.length} 键, ${stats.arraysAnalyzed} 数组`);
        // ── 步骤 4：模式构建 ──
        const source = "json-input";
        const patterns = [];
        if (mergedOptions.extractNamingPatterns) {
            const namingPattern = buildNamingPattern(stats, source, mergedOptions.minSampleSize);
            if (namingPattern !== undefined) {
                patterns.push(namingPattern);
                diagnostics.push(`[json-extractor] 命名模式: "${namingPattern.name}" (置信度: ${namingPattern.confidence})`);
            }
            else {
                diagnostics.push("[json-extractor] 命名模式: 样本不足或分布无主导风格，跳过");
            }
        }
        if (mergedOptions.extractStructurePatterns) {
            const structurePattern = buildStructurePattern(stats, source, mergedOptions.minSampleSize);
            if (structurePattern !== undefined) {
                patterns.push(structurePattern);
                diagnostics.push(`[json-extractor] 结构模式: "${structurePattern.name}" (置信度: ${structurePattern.confidence})`);
            }
            else {
                diagnostics.push("[json-extractor] 结构模式: 样本不足，跳过");
            }
        }
        if (mergedOptions.extractTypePatterns) {
            const typePattern = buildTypeDistributionPattern(stats, source, mergedOptions.minSampleSize);
            if (typePattern !== undefined) {
                patterns.push(typePattern);
                diagnostics.push(`[json-extractor] 类型模式: "${typePattern.name}" (置信度: ${typePattern.confidence})`);
            }
            else {
                diagnostics.push("[json-extractor] 类型模式: 样本不足，跳过");
            }
        }
        if (mergedOptions.extractArrayPatterns) {
            const arrayPattern = buildArrayHomogeneityPattern(stats, source, mergedOptions.minSampleSize);
            if (arrayPattern !== undefined) {
                patterns.push(arrayPattern);
                diagnostics.push(`[json-extractor] 数组模式: "${arrayPattern.name}" (置信度: ${arrayPattern.confidence})`);
            }
            else {
                diagnostics.push("[json-extractor] 数组模式: 样本不足，跳过");
            }
        }
        const durationMs = Date.now() - startTime;
        diagnostics.push(`[json-extractor] 提取完成: ${patterns.length} 个模式, 耗时 ${durationMs}ms`);
        // ── 步骤 5：返回结果 ──
        return {
            success: true,
            patterns,
            diagnostics,
            durationMs,
        };
    }
    /**
     * 判断该提取器能否处理指定语言和模式种类。
     *
     * JsonPatternExtractor 的处理能力：
     * - 语言：仅支持 "json"（严格匹配，不接受 "*" 通配）
     * - 种类：Structural（结构模式）和 Naming（命名模式）
     *
     * @param language - 目标编程语言
     * @param kind     - 目标模式种类
     * @returns true 当 language === "json" 且 kind 在 supportedKinds 中
     *
     * @example
     * ```typescript
     * extractor.canHandle("json", PatternKind.Structural);
     * // → true
     *
     * extractor.canHandle("typescript", PatternKind.Structural);
     * // → false（仅支持 json）
     * ```
     */
    canHandle(language, kind) {
        return (this.supportedLanguages.includes(language) &&
            this.supportedKinds.includes(kind));
    }
}
// ============================================================
// §8 包锚点
// ============================================================
/**
 * JSON_EXTRACTOR_ANCHOR —— JsonPatternExtractor 包身份锚点。
 *
 * 用于运行时自检和版本标识。
 * 消费方可通过检查此常量确认 JsonPatternExtractor 已正确加载。
 */
export const JSON_EXTRACTOR_ANCHOR = "[@cortex/pattern-extractor] JsonPatternExtractor v0.1.0 — JSON 结构模式提取器";
//# sourceMappingURL=json-extractor.js.map