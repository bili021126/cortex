/**
 * json.formatter.ts — JSON 格式化器
 *
 * 输出机器可读的 JSON 格式
 *
 * 原位于 .cortex/archive/.../solo-flight/src/formatters/json.formatter.ts
 */

import { Task } from '../core/models/task.js';

export class JsonFormatter {
  formatList(tasks: Task[]): string {
    return JSON.stringify(tasks.map(t => t.toJSON()), null, 2);
  }

  formatDetail(task: Task): string {
    return JSON.stringify(task.toJSON(), null, 2);
  }
}
