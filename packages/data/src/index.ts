/**
 * index.ts — @cortex/data 公开 API
 *
 * 数据处理层：任务实体、存储、格式化、配置
 */

// 核心模型
export { Task, ValidationError } from './core/models/task.js';
export type { TaskConstructorData, TaskUpdateData, TaskJSON } from './core/models/task.js';
export { TaskStatus, isValidStatus, VALID_STATUSES } from './core/models/status.js';
export { Priority, isValidPriority, VALID_PRIORITIES, priorityLabel } from './core/models/priority.js';

// 服务
export { TaskService } from './core/services/task.service.js';
export type { TaskStats } from './core/services/task.service.js';

// 存储
export { TaskRepository } from './storage/interfaces/task.repository.js';
export type { TaskFilter } from './storage/interfaces/task.repository.js';
export { JsonFileAdapter } from './storage/adapters/json-file.adapter.js';
export { TaskNotFoundError, TaskDeletedError, StorageIOError } from './storage/errors.js';

// 格式化
export { JsonFormatter } from './formatters/json.formatter.js';
export { PlainFormatter } from './formatters/plain.formatter.js';
export { TableFormatter } from './formatters/table.formatter.js';

// 工具
export { generateId } from './utils/id.js';
export { nowISO, formatDate, nowMs } from './utils/date.js';

// 配置
export { config, loadConfig } from './config/index.js';
export type { AppConfig } from './config/index.js';
