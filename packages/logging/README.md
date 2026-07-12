# @cortex/logging — Transport / Formatter 使用指南

## 概述

`@cortex/logging` 提供统一的日志基础设施，支持可插拔的 Transport（输出目标）
和 Formatter（格式化策略）。

## 核心概念

```
Logger (应用层)
  ├── Transport (输出目的地)
  │     ├── ConsoleTransport  → stdout/stderr
  │     ├── FileTransport     → 文件追加写入
  │     └── PipelineBridge    → PipelineObserver 事件桥接
  └── Formatter (格式化策略)
        ├── DefaultFormatter  → "[LEVEL] logger: message {meta}"
        └── JsonFormatter     → {"ts":..., "level":..., "msg":...}
```

## Transport

### ConsoleTransport

输出到终端 stdout/stderr，按日志级别分流：
- Debug / Info → `console.log`
- Warn → `console.warn`
- Error / Fatal → `console.error`

```typescript
import { ConsoleTransport } from "@cortex/logging";

const transport = new ConsoleTransport({ color: true, showTimestamp: true });
```

### FileTransport

异步追加写入文件，按行分隔。

```typescript
import { FileTransport } from "@cortex/logging";

const transport = new FileTransport({ path: "/var/log/cortex.log" });
```

**注意**: FileTransport 延迟打开文件描述符（首个 write 时触发），
避免未使用时占用 FD。

### LoggingPipelineBridge

将日志事件桥接到 PipelineObserver，实现日志 → 遥测事件映射。

```typescript
import { LoggingPipelineBridge, addTransport } from "@cortex/logging";

const bridge = new LoggingPipelineBridge({
  emit: (event) => observer.emit({ type: "log", payload: { message: event } }),
  minLevel: LogLevel.Warn,
  source: "engine",
});
addTransport(bridge.createTransport());
```

## Formatter

### DefaultFormatter

人类可读格式：`2026-07-13T12:00:00.000Z [INFO] my-logger: message {"meta":"value"}`

```typescript
import { DefaultFormatter } from "@cortex/logging";

const formatter = new DefaultFormatter({ color: true, showTimestamp: true });
```

### JsonFormatter

结构化 JSON 格式，适合日志收集系统。

```typescript
import { JsonFormatter } from "@cortex/logging";

const formatter = new JsonFormatter({ pretty: true });
```

输出示例：
```json
{
  "ts": 1770000000000,
  "level": "INFO",
  "logger": "my-logger",
  "msg": "message",
  "meta": { "key": "value" }
}
```

## Logger 使用

```typescript
import { createLogger, configureRootLogger, addTransport, shutdownLoggers } from "@cortex/logging";
import { FileTransport, ConsoleTransport } from "@cortex/logging";

// 配置根 Logger
configureRootLogger({ minLevel: LogLevel.Debug });
addTransport(new FileTransport({ path: "./app.log" }));

// 创建具名 Logger
const log = createLogger("my-component");
log.info("启动完成", { component: "my-component", durationMs: 100 });
log.warn("配置缺失", { key: "timeout" });
log.error("连接失败", { retries: 3 }, new Error("ECONNREFUSED"));

// 优雅关闭
await shutdownLoggers();
```

## PipelineBridge 日志级别映射

| Logging 级别 | 桥接事件级别 | PipelineObserver |
|-------------|------------|-----------------|
| Debug/Info  | `silent`   | 不发射           |
| Warn/Error  | `degraded` | 降级事件         |
| Fatal       | `fatal`    | 致命事件         |
