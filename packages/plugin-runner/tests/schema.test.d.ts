/**
 * @cortex/plugin-runner — schema.ts 单元测试
 *
 * 覆盖范围（完整行覆盖）：
 *
 * 第一层：类型校验原语（s 命名空间）
 *   - s.string()         StringValidator (min, max, pattern, email, url, uuid, nonEmpty)
 *   - s.number()         NumberValidator (min, max, integer, positive)
 *   - s.boolean()        BooleanValidator
 *   - s.object()         ObjectValidator (strict, passthrough, extend, pick, omit)
 *   - s.array()          ArrayValidator (min, max)
 *   - s.literal()        strict literal matching
 *   - s.union()          union (match at least one)
 *   - s.enum()           enum values list
 *   - s.any()            always pass
 *   - s.record()         dictionary value validation
 *
 * 第二层：PluginSchema 定义助手
 *   - definePluginSchema()
 *   - defineConfigSchema()
 *   - createMinimalSchema()
 *   - baseConfigSchema / strictConfigSchema / defaultPluginSchema
 *
 * 工具函数
 *   - composeSchemas()
 *   - validation.isValid / assert / formatErrors
 */
export {};
//# sourceMappingURL=schema.test.d.ts.map