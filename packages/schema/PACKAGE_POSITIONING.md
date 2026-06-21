## 定位 —— 在 Cortex monorepo 中的角色

`@cortex/schema` 是 Cortex 的**类型安全运行时验证**基础包。提供声明式 Schema 定义语言 + 运行时数据验证能力，验证结果统一返回 `@cortex/result` 的 `Result<T, SchemaError>` 类型。将 TypeScript 编译期类型安全扩展到运行时边界——API 请求、文件读取、用户输入、跨进程通信等"类型信任断裂"的时刻。

## 职责边界 —— 做什么、不做什么

### 做什么

- **定义 Schema 类型系统**：提供 `s.string()`、`s.number()`、`s.boolean()`、`s.object()`、`s.array()`、`s.union()`、`s.optional()`、`s.nullable()` 等基础 Schema 构造器
- **编译期类型推断**：从 Schema 定义中自动推导出 TypeScript 类型（`s.string()` → `string`、`s.object({ name: s.string() })` → `{ name: string }`）
- **运行时验证**：`parse(schema, data)` → `Result<T, SchemaError>` 安全验证入口
- **安全降级**：`parseOr(schema, data, fallback)` → `T`，验证失败时返回默认值
- **Schema 组合**：通过 `and()` / `or()` / `pipe()` 组合已有 Schema，构建复杂验证规则
- **验证后变换**：`transform(schema, fn)` 在验证通过后对值进行类型转换（如字符串→Date）
- **错误收集**：`parseAll(schema, data)` → `Result<T, SchemaError[]>` 收集所有字段的验证错误而非短路返回
- **Schema 元信息**：支持 `describe()`、标签（tag）等元信息，供文档生成和调试用
- **Schema 反射**：提供 `infer()` 运行时检查 Schema 形状，支持自描述和序列化

### 不做什么

- **不替代 TypeScript 类型系统**：编译期类型检查仍是主力防线。Schema 只在运行时边界（IO 入口、外部数据反序列化）使用，不用于业务逻辑内部的类型守卫替代品
- **不做序列化/反序列化**：不涉及 JSON、BSON、MessagePack 等格式的编解码。schema 只做"数据是否符合结构"的判定，不做"数据是什么格式"的转换
- **不包含 HTTP/API 框架集成**：不提供 Express 中间件、Fastify 插件、tRPC 适配器等。留给上层框架或应用层自行封装
- **不提供异步验证器**：所有验证器为纯同步函数。异步边界（I/O 读取、网络请求）由调用方在 parse 之前完成
- **不定义 SchemaError 以外的错误类型体系**：错误类型统一为 `SchemaError`（路径 + 消息 + 码），不引入多级错误层级
- **不定义规则链式 API（类似 zod 的 `.min().max().email()`）**：基础类型只做类型检查，精细化约束（长度范围、正则、枚举值）通过 `pipe()` + 自定义验证器组合实现

## 解决的问题 —— 为什么需要这个包

### 1. 运行时边界的类型安全缺口

TypeScript 的静态类型系统在编译期提供强大的安全保障，但一旦数据跨越运行时边界——HTTP 请求体、文件读取内容、数据库查询结果、环境变量、用户输入——类型信息消失，数据退化为 `unknown`。当前 monorepo 中各处通过散落的 `if/else` 类型守卫、`JSON.parse` 后手动字段检查、第三方库混用来填补这个缺口，缺乏统一方案。`@cortex/schema` 填补了这一层：`parse(schema, data)` 在一个调用中完成验证 + 类型窄化。

```typescript
// 当前做法（散落的手动验证）：
function parseConfig(raw: unknown): Config {
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== "string") throw new Error("name must be string");
  if (typeof obj.port !== "number") throw new Error("port must be number");
  return { name: obj.name, port: obj.port };
}

// 使用 @cortex/schema：
const ConfigSchema = s.object({
  name: s.string(),
  port: s.number(),
});
// ConfigSchema 自动推导出类型：{ name: string; port: number }

const result = parse(ConfigSchema, raw);
// result 的类型：Result<{ name: string; port: number }, SchemaError>
```

### 2. 统一验证模式，消除散落的 if/else 类型守卫

当前 monorepo 中各包处理外部数据的方式不统一：
- `@cortex/config` 从 JSON 文件加载配置时手动检查字段
- `@cortex/engine` 从 `cortex-agents.json` 解析 Agent 定义时使用多处类型断言
- `@cortex/shared` 中多处 `if (typeof x !== "object")` 散落各处

`@cortex/schema` 提供一个声明式的标准模式，所有包通过同一机制完成运行时验证，消除重复的类型守卫样板代码。

### 3. 与 `@cortex/result` 深度集成，消除隐式异常路径

与 zod（抛 `ZodError`）和 yup（抛 `ValidationError`）不同，`@cortex/schema` 的验证结果统一返回 `@cortex/result` 的 `Result<T, SchemaError>` 类型。这带来了三个关键好处：

- **异常路径编码到类型中**：调用方从签名上就知道验证可能失败，编译器强制处理
- **链式组合**：验证结果可以直接 `andThen` 接入后续的业务逻辑管线，无需 try/catch 包围
- **错误类型统一**：所有验证错误为 `SchemaError` 类型，与 monorepo 的错误处理体系无缝衔接

```typescript
// 链式验证 + 处理
const result = parse(UserSchema, raw)
  .andThen(user => validatePermissions(user))
  .map(user => createSession(user));

match(result, {
  ok: session => respondWith(session),
  err: error => respondWithError(error),
});
```

### 4. 声明式 Schema 优于命令式验证

手写类型守卫是命令式的——每次验证都是一个新的 `if/else` 序列。Schema 是声明式的——描述"数据应该是什么样子"，运行时如何检查是包的责任。声明式的好处：

- **可组合**：小 Schema 通过 `and` / `or` / `pipe` 组合成大 Schema
- **可测试**：Schema 定义可独立测试，不需要 mock 数据来源
- **可自省**：Schema 元信息支持运行时反射，可用于文档生成、API 可视化
- **类型推导**：从 Schema 定义自动推导 TypeScript 类型，消除手工维护类型定义与运行时期望之间的漂移

### 5. 零外部运行时依赖

不引入 zod（~40KB minified）、yup（~30KB）、io-ts（需要 fp-ts 作为对等依赖）等第三方验证库。纯 TypeScript 实现，类型推断友好，体积可控。作为 monorepo 基础设施层的基础包，保持零外部运行时依赖是核心约束——每个 monorepo 包的消费者都应该能信任它的依赖图是可控的。

### 6. Schema 反射与自描述

`@cortex/schema` 的 Schema 对象在运行时保留形状信息（`infer()` 方法），支持：

- **Schema 序列化**：将 Schema 定义序列化为 JSON 可描述的结构，支持跨进程/跨语言共享验证规则
- **文档生成**：从 Schema 定义自动生成数据结构的 API 文档
- **动态验证**：根据运行时获得的 Schema 定义动态构造验证器（适用于插件系统、动态配置等场景）

这比 zod 的 `._def` 内部属性更规范——`infer()` 是公开 API，不依赖内部实现细节。
