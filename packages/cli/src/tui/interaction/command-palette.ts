/**
 * tui/interaction/command-palette.ts — 命令面板控制器
 *
 * Ctrl+K 触发的命令面板，支持模糊搜索、自动注册。
 *
 * @module tui/interaction/command-palette
 * @since v6
 */

import type { CommandPaletteItem } from "./types.js";
import type { KeyRegistry } from "./key-registry.js";
import type { CharacterTheme } from "../theme/character-theme.js";

/**
 * 命令面板控制器
 */
export class CommandPaletteController {
  private items: CommandPaletteItem[] = [];
  private filteredItems: CommandPaletteItem[] = [];
  private _query = "";
  private _selectedIndex = 0;
  private _isOpen = false;
  private changeListeners: Array<() => void> = [];

  /**
   * 订阅状态变化（React UI 用于触发重渲染）
   */
  onChange(listener: () => void): () => void {
    this.changeListeners.push(listener);
    return () => {
      this.changeListeners = this.changeListeners.filter((l) => l !== listener);
    };
  }

  private notifyChange(): void {
    for (const listener of this.changeListeners) {
      try { listener(); } catch { /* ignore */ }
    }
  }

  /**
   * 从快捷键注册表自动注册命令
   */
  registerFromKeyRegistry(registry: KeyRegistry): void {
    const bindings = registry.getAllBindings();
    for (const binding of bindings) {
      this.addItem({
        id: `key-${binding.id}`,
        label: binding.label,
        description: binding.description,
        shortcut: binding.key,
        category: binding.category,
        keywords: [binding.label, binding.category, binding.id],
        action: binding.handler,
      });
    }
  }

  /**
   * 从角色主题注册 Agent 切换命令
   * @param onSwitch 实际切换 Agent 的回调
   */
  registerAgentCommands(themes: CharacterTheme[], onSwitch: (agentType: string) => void): void {
    for (const theme of themes) {
      this.addItem({
        id: `agent-${theme.agentType}`,
        label: `切换到 ${theme.name}`,
        description: `${theme.emoji} ${theme.role}`,
        icon: theme.emoji,
        category: "agent",
        keywords: [theme.name, theme.nameEn, theme.role, theme.agentType],
        action: () => onSwitch(theme.agentType),
      });
    }
  }

  /**
   * 添加命令项
   */
  addItem(item: CommandPaletteItem): void {
    // 避免重复
    const existing = this.items.findIndex((i) => i.id === item.id);
    if (existing >= 0) {
      this.items[existing] = item;
    } else {
      this.items.push(item);
    }
    this.applyFilter();
  }

  /**
   * 移除命令项
   */
  removeItem(id: string): void {
    this.items = this.items.filter((i) => i.id !== id);
    this.applyFilter();
  }

  /**
   * 打开面板
   */
  open(): void {
    this._isOpen = true;
    this._query = "";
    this._selectedIndex = 0;
    this.applyFilter();
    this.notifyChange();
  }

  /**
   * 关闭面板
   */
  close(): void {
    this._isOpen = false;
    this._query = "";
    this._selectedIndex = 0;
    this.notifyChange();
  }

  /**
   * 设置搜索查询
   */
  setQuery(q: string): void {
    this._query = q;
    this._selectedIndex = 0;
    this.applyFilter();
    this.notifyChange();
  }

  /**
   * 选择下一项
   */
  selectNext(): void {
    if (this.filteredItems.length === 0) return;
    this._selectedIndex = (this._selectedIndex + 1) % this.filteredItems.length;
    this.notifyChange();
  }

  /**
   * 选择上一项
   */
  selectPrev(): void {
    if (this.filteredItems.length === 0) return;
    this._selectedIndex = (this._selectedIndex - 1 + this.filteredItems.length) % this.filteredItems.length;
    this.notifyChange();
  }

  /**
   * 执行当前选中项
   */
  async execute(): Promise<void> {
    const item = this.filteredItems[this._selectedIndex];
    if (!item) return;
    await item.action();
    this.close();
  }

  /**
   * 获取过滤后的项目列表
   */
  getFilteredItems(): CommandPaletteItem[] {
    return this.filteredItems;
  }

  /**
   * 获取当前查询
   */
  get query(): string {
    return this._query;
  }

  /**
   * 获取选中索引
   */
  get selectedIndex(): number {
    return this._selectedIndex;
  }

  /**
   * 是否打开
   */
  get isOpen(): boolean {
    return this._isOpen;
  }

  /**
   * 应用模糊搜索过滤
   */
  private applyFilter(): void {
    if (!this._query) {
      this.filteredItems = [...this.items];
      return;
    }

    const query = this._query.toLowerCase();
    const scored = this.items
      .map((item) => ({
        item,
        score: this.fuzzyScore(item, query),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    this.filteredItems = scored.map(({ item }) => item);
  }

  /**
   * 模糊搜索评分
   */
  private fuzzyScore(item: CommandPaletteItem, query: string): number {
    let score = 0;

    // 完全匹配 label
    if (item.label.toLowerCase().includes(query)) {
      score += 10;
      // 开头匹配加分
      if (item.label.toLowerCase().startsWith(query)) {
        score += 5;
      }
    }

    // 匹配关键词
    for (const keyword of item.keywords) {
      if (keyword.toLowerCase().includes(query)) {
        score += 3;
      }
    }

    // 匹配描述
    if (item.description?.toLowerCase().includes(query)) {
      score += 1;
    }

    // 匹配分类
    if (item.category.toLowerCase().includes(query)) {
      score += 2;
    }

    return score;
  }
}
