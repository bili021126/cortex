/**
 * plain.formatter.ts — 纯文本格式化器
 *
 * 简洁的文本输出
 *
 * 原位于 .cortex/archive/.../solo-flight/src/formatters/plain.formatter.ts
 */

import { Task } from '../core/models/task.js';
import { priorityLabel } from '../core/models/priority.js';
import { formatDate } from '../utils/date.js';

export class PlainFormatter {
  formatList(tasks: Task[]): string {
    if (tasks.length === 0) {
      return '暂无任务';
    }

    return tasks
      .map(t => {
        const tagStr = t.tags.length > 0 ? ` [${t.tags.join(', ')}]` : '';
        return `[${t.statusLabel}] ${t.title} (${priorityLabel(t.priority)})${tagStr} — ${formatDate(t.updatedAt)}`;
      })
      .join('\n');
  }

  formatDetail(task: Task): string {
    const lines: string[] = [];
    lines.push(`标题: ${task.title}`);
    lines.push(`ID: ${task.id}`);
    lines.push(`状态: ${task.statusLabel}`);
    lines.push(`优先级: ${priorityLabel(task.priority)}`);
    lines.push(`标签: ${task.tags.join(', ') || '-'}`);
    lines.push(`创建时间: ${formatDate(task.createdAt)}`);
    lines.push(`更新时间: ${formatDate(task.updatedAt)}`);
    if (task.description) {
      lines.push(`描述: ${task.description}`);
    }
    return lines.join('\n');
  }
}
