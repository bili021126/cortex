/**
 * table.formatter.ts — 表格格式化器
 *
 * 使用 cli-table3 渲染表格输出
 *
 * 原位于 .cortex/archive/.../solo-flight/src/formatters/table.formatter.ts
 */

import Table from 'cli-table3';
import { Task } from '../core/models/task.js';
import { priorityLabel } from '../core/models/priority.js';
import { formatDate } from '../utils/date.js';

export class TableFormatter {
  formatList(tasks: Task[]): string {
    if (tasks.length === 0) {
      return '📭 暂无任务';
    }

    const table = new Table({
      head: ['ID', '标题', '状态', '优先级', '标签', '更新时间'],
      colWidths: [36, 30, 10, 10, 16, 16],
      style: { head: ['cyan'], border: ['grey'] },
    });

    for (const task of tasks) {
      table.push([
        task.id.slice(0, 8) + '...',
        task.title.length > 24 ? task.title.slice(0, 24) + '…' : task.title,
        task.statusLabel,
        priorityLabel(task.priority),
        task.tags.join(', ') || '-',
        formatDate(task.updatedAt),
      ]);
    }

    return table.toString();
  }

  formatDetail(task: Task): string {
    const lines: string[] = [];
    lines.push('━'.repeat(50));
    lines.push(`  📌 ${task.title}`);
    lines.push('━'.repeat(50));
    lines.push(`  ID         : ${task.id}`);
    lines.push(`  状态       : ${task.statusLabel}`);
    lines.push(`  优先级     : ${priorityLabel(task.priority)}`);
    lines.push(`  标签       : ${task.tags.join(', ') || '-'}`);
    lines.push(`  创建时间   : ${formatDate(task.createdAt)}`);
    lines.push(`  更新时间   : ${formatDate(task.updatedAt)}`);
    if (task.deletedAt) {
      lines.push(`  删除时间   : ${formatDate(task.deletedAt)}`);
    }
    if (task.description) {
      lines.push('━'.repeat(50));
      lines.push(`  描述:`);
      lines.push(`  ${task.description}`);
    }
    lines.push('━'.repeat(50));
    return lines.join('\n');
  }
}
