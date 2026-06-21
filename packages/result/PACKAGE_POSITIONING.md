## 定位 —— 在 Cortex monorepo 中的角色

`@cortex/result` 是 Cortex 的类型安全错误处理基础包。提供 Rust 风格 `Result<T, E>` 判别联合类型及其全套工具函数（map、andThen、match、tryCatch 等），使错误处理从运行时异常模式转向类型驱动模式。

## 职责边界 —— 做什么、不做什么

### 做什么

- 定义 `Result<T, E>` 类型（Ok / Err 判别联合）
- 提供构造函数：`ok()`, `err()`
- 提供类型守卫：`isOk()`, `isErr()`
- 提供解包函数：`unwrap()`, `unwrapOr()`, `unwrapOrElse()`, `expect()`
- 提供转换函数：`map()`, `mapErr()`
- 提供链式操作：`andThen()`, `orElse()`
- 提供模式匹配：`match()`
- 提供 try/catch 桥接：`tryCatch()`, `tryCatchAsync()`
- 提供集合操作：`fromNullable()`, `all()`
- 提供格式化辅助：`toString()`
- 提供 `PanicError` 错误类（用于 unwrap/expect 的异常抛出）

### 不做什么

- **不定义 Monad 实例**（不实现 Fantasy Land / Effect TS 的 Monad 接口）
- **不处理同步 I/O**（文件读写、网络请求等由消费者通过 `tryCatch` 自行包装）
- **不提供 Either 类型**（Result 专用于"成功/失败"语义，不适合表达"二选一"的非错误场景）
- **不提供异步 Result 构造**（`tryCatchAsync` 只是 Promise 的桥接，不是 AsyncResult 类型）
- **不包含运行时框架集成**（不提供 React Hooks、Express 中间件等）
- **不修改全局原型或 polyfill**

## 解决的问题 —— 为什么需要这个包

1. **消除隐式异常路径**：TypeScript 的 `throw` 不会出现在类型签名中，导致调用方不知道一个函数可能失败。`Result<T, E>` 将"可能失败"编码到返回类型中，编译器强制处理。

2. **统一错误处理模式**：在 monorepo 内的多个包中，错误处理方式（抛异常 vs 返回 null vs 返回错误码）各不相同。`Result<T, E>` 提供一个跨包统一的标准模式。

3. **链式错误传播**：通过 `andThen` / `map` 可以像 Rust 一样用 `?` 操作符的等价模式（函数式链式调用）组合可能失败的操作，避免嵌套 try/catch。

4. **零运行时依赖**：纯类型层实现，不引入 fp-ts / effect 等重型函数式库。适合作为 monorepo 基础设施层的基础类型。

5. **异步友好**：`tryCatchAsync` 为 async/await 提供统一的 Result 包装入口。
