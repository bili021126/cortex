/**
 * tui/ink/command-palette-view.tsx — 命令面板浮层组件
 *
 * Ctrl+K 打开的模糊搜索命令面板。
 * 使用 useInput 手动处理输入（避免与 TextInput 冲突）。
 * 消费 Design Token，使用 FadeIn 动画。
 *
 * @module tui/ink/command-palette-view
 * @since v6
 */

import { Box, Text, useInput, type Key } from "ink";
import { useState, useEffect, useCallback } from "react";
import type { CommandPaletteController } from "../interaction/command-palette.js";
import { inkTheme } from "../theme/adapter-ink.js";
import { FadeIn } from "../animation/components/FadeIn.js";

export interface CommandPaletteViewProps {
  controller: CommandPaletteController;
  onClose: () => void;
}

export function CommandPaletteView({ controller, onClose }: CommandPaletteViewProps) {
  const [, forceUpdate] = useState(0);
  const t = inkTheme;

  // 订阅 controller 状态变化
  useEffect(() => {
    return controller.onChange(() => forceUpdate((n) => n + 1));
  }, [controller]);

  // 打开时清空查询
  useEffect(() => {
    controller.setQuery("");
  }, [controller]);

  const handleInput = useCallback(
    (input: string, key: Key) => {
      if (key.escape) {
        onClose();
        return;
      }
      if (key.return) {
        void controller.execute();
        return;
      }
      if (key.upArrow) {
        controller.selectPrev();
        return;
      }
      if (key.downArrow) {
        controller.selectNext();
        return;
      }
      if (key.backspace || key.delete) {
        const q = controller.query;
        controller.setQuery(q.slice(0, -1));
        return;
      }
      // 可打印字符 → 追加到查询
      if (input?.length === 1 && !key.ctrl && !key.meta) {
        controller.setQuery(controller.query + input);
      }
    },
    [controller, onClose],
  );

  useInput(handleInput);

  const items = controller.getFilteredItems();
  const selectedIdx = controller.selectedIndex;
  const maxVisible = 8;
  const visibleItems = items.slice(0, maxVisible);

  return (
    <FadeIn visible options={{ duration: "fast" }}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={t.primary.color}
        paddingX={1}
        paddingY={1}
        marginLeft={2}
        marginRight={2}
      >
        {/* 搜索框 */}
        <Box marginBottom={1}>
          <Text color={t.textMuted.color}>🔍 </Text>
          <Text color={t.textPrimary.color}>{controller.query || "搜索命令..."}</Text>
          <Text color={t.textMuted.color}>▌</Text>
        </Box>

        {/* 分隔线 */}
        <Box>
          <Text color={t.separator.color}>{"─".repeat(40)}</Text>
        </Box>

        {/* 命令列表 */}
        {visibleItems.length === 0 ? (
          <Box marginTop={1}>
            <Text color={t.textMuted.color}>无匹配命令</Text>
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            {visibleItems.map((item, idx) => {
              const isSelected = idx === selectedIdx;
              return (
                <Box key={item.id}>
                  <Text color={isSelected ? t.accent.color : t.textMuted.color}>
                    {isSelected ? "▸ " : "  "}
                  </Text>
                  {item.icon ? (
                    <Text color={isSelected ? t.accent.color : t.textSecondary.color}>
                      {item.icon}{" "}
                    </Text>
                  ) : null}
                  <Text
                    color={isSelected ? t.primary.color : t.textPrimary.color}
                    bold={isSelected}
                  >
                    {item.label}
                  </Text>
                  {item.shortcut ? (
                    <Text color={t.textMuted.color}> ({item.shortcut})</Text>
                  ) : null}
                  {item.description ? (
                    <Text color={t.textMuted.color}> — {item.description}</Text>
                  ) : null}
                </Box>
              );
            })}
          </Box>
        )}

        {/* 底部提示 */}
        <Box marginTop={1}>
          <Text color={t.textMuted.color}>
            ↑↓ 导航 · Enter 执行 · Esc 关闭
          </Text>
        </Box>
      </Box>
    </FadeIn>
  );
}
