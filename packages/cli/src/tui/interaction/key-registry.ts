/**
 * tui/interaction/key-registry.ts — 快捷键注册表
 *
 * 支持序列键（如 'g then i'）、上下文感知、优先级冲突解决。
 *
 * @module tui/interaction/key-registry
 * @since v6
 */

import type { KeyBinding, KeyContext } from "./types.js";

/**
 * 快捷键注册表
 */
export class KeyRegistry {
  private bindings = new Map<string, KeyBinding>();
  private sequenceBuffer: string[] = [];
  private sequenceTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly SEQUENCE_TIMEOUT = 1000; // 1秒内完成序列

  /**
   * 注册快捷键
   * @returns 取消注册函数
   */
  register(binding: KeyBinding): () => void {
    this.bindings.set(binding.id, binding);
    return () => this.unregister(binding.id);
  }

  /**
   * 注销快捷键
   */
  unregister(id: string): void {
    this.bindings.delete(id);
  }

  /**
   * 处理按键事件
   * @returns 是否被消费
   */
  handleKeyPress(key: string, context: KeyContext = "global"): boolean {
    // 清理序列超时
    if (this.sequenceTimeout) {
      clearTimeout(this.sequenceTimeout);
      this.sequenceTimeout = null;
    }

    // 添加当前按键到序列缓冲
    this.sequenceBuffer.push(key);
    const sequence = this.sequenceBuffer.join(" then ");

    // 查找匹配的绑定
    const candidates = this.findCandidates(sequence, context);

    if (candidates.length === 0) {
      // 没有匹配，检查是否有以当前序列为前缀的绑定
      const hasPrefix = this.hasPrefixMatches(sequence, context);
      if (hasPrefix) {
        // 等待更多按键
        this.sequenceTimeout = setTimeout(() => {
          this.sequenceBuffer = [];
        }, this.SEQUENCE_TIMEOUT);
        return false;
      }
      // 完全不匹配，重置
      this.sequenceBuffer = [];
      return false;
    }

    // 找到精确匹配
    const exact = candidates.filter((b) => b.key === sequence);
    if (exact.length > 0) {
      // 按优先级排序，取最高
      exact.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
      const winner = exact[0];
      this.sequenceBuffer = [];
      if (winner) void winner.handler();
      return true;
    }

    // 只有前缀匹配，等待更多按键
    this.sequenceTimeout = setTimeout(() => {
      this.sequenceBuffer = [];
    }, this.SEQUENCE_TIMEOUT);
    return false;
  }

  /**
   * 查找匹配当前序列的绑定
   */
  private findCandidates(sequence: string, context: KeyContext): KeyBinding[] {
    return [...this.bindings.values()].filter((b) => {
      // 上下文检查
      if (b.context && b.context !== "global" && b.context !== context) {
        return false;
      }
      // 条件检查
      if (b.when && !b.when()) {
        return false;
      }
      return b.key === sequence;
    });
  }

  /**
   * 检查是否有以当前序列为前缀的绑定
   */
  private hasPrefixMatches(sequence: string, context: KeyContext): boolean {
    return [...this.bindings.values()].some((b) => {
      if (b.context && b.context !== "global" && b.context !== context) {
        return false;
      }
      if (b.when && !b.when()) {
        return false;
      }
      return b.key.startsWith(sequence + " then ");
    });
  }

  /**
   * 获取指定上下文的所有绑定
   */
  getBindingsForContext(context: KeyContext): KeyBinding[] {
    return [...this.bindings.values()].filter(
      (b) => !b.context || b.context === "global" || b.context === context,
    );
  }

  /**
   * 获取所有绑定
   */
  getAllBindings(): KeyBinding[] {
    return [...this.bindings.values()];
  }

  /**
   * 导出绑定（用于用户自定义键位）
   */
  exportBindings(): Array<{ id: string; key: string; label: string; category: string }> {
    return [...this.bindings.values()].map((b) => ({
      id: b.id,
      key: b.key,
      label: b.label,
      category: b.category,
    }));
  }

  /**
   * 清理
   */
  destroy(): void {
    if (this.sequenceTimeout) {
      clearTimeout(this.sequenceTimeout);
    }
    this.bindings.clear();
    this.sequenceBuffer = [];
  }
}
