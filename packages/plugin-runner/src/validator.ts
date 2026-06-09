/**
 * @cortex/plugin-runner — Schema 校验模块
 *
 * 管理校验 schema，在插件 init/execute 前后执行校验。
 * 校验器与 registry 分离——同一 schema 可被多个插件复用。
 * 无外部校验库依赖（纯函数式校验）。
 */

import type { PluginSchema, ValidationResult } from "./types.js";

/**
 * PluginValidator —— 插件校验器。
 *
 * 管理 schema 注册、配置校验、输入/输出校验。
 */
export class PluginValidator {
  /** schema 缓存映射（schema name → PluginSchema） */
  private _schemas: Map<string, PluginSchema> = new Map();

  /**
   * 注册一个校验 schema。
   * @throws 重复注册同名 schema 时抛 Error
   */
  registerSchema(schema: PluginSchema): void {
    if (this._schemas.has(schema.name)) {
      throw new Error(
        `[PluginValidator] schema 重复注册: "${schema.name}" 已存在`,
      );
    }
    this._schemas.set(schema.name, schema);
  }

  /**
   * 注销指定名称的 schema。
   * @returns 是否成功注销
   */
  unregisterSchema(name: string): boolean {
    return this._schemas.delete(name);
  }

  /**
   * 获取指定名称的 schema。
   */
  getSchema(name: string): PluginSchema | undefined {
    return this._schemas.get(name);
  }

  /**
   * 检查指定名称的 schema 是否已注册。
   */
  hasSchema(name: string): boolean {
    return this._schemas.has(name);
  }

  /**
   * 校验指定 schema 下的配置。
   * @returns 校验结果
   */
  validateConfig(name: string, config: unknown): ValidationResult {
    const schema = this._schemas.get(name);
    if (!schema) {
      return { valid: true, errors: [] };
    }

    const errors = schema.validateConfig(config);
    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 校验指定 schema 下的输入参数。
   * @returns 校验结果（无 schema 或未定义 validateInput 时视为通过）
   */
  validateInput(name: string, input: unknown): ValidationResult {
    const schema = this._schemas.get(name);
    if (!schema?.validateInput) {
      return { valid: true, errors: [] };
    }

    const errors = schema.validateInput(input);
    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 校验指定 schema 下的输出结果。
   * @returns 校验结果（无 schema 或未定义 validateOutput 时视为通过）
   */
  validateOutput(name: string, output: unknown): ValidationResult {
    const schema = this._schemas.get(name);
    if (!schema?.validateOutput) {
      return { valid: true, errors: [] };
    }

    const errors = schema.validateOutput(output);
    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
