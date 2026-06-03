// ============================================================
// 🌿 Cortex 技能注册表 — 中间件类型与工具
// 设计：纳西妲 | 实现：阿贝多
//
// @moved-from projects/solo-flight/src/skill/middleware.ts
// ============================================================

import type {
  SkillMiddleware,
  MiddlewareContext,
  NextFunction,
  Logger,
} from './types.js';

/**
 * 组合中间件链（Koa-like 洋葱模型）
 * 按顺序组合多个中间件，返回一个根中间件
 */
export function compose(middlewares: SkillMiddleware[]): SkillMiddleware {
  return async (ctx: MiddlewareContext, next: NextFunction): Promise<void> => {
    let index = -1;

    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) {
        throw new Error('next() 被多次调用');
      }
      index = i;

      const middleware = middlewares[i];
      if (!middleware) {
        await next();
        return;
      }

      await middleware(ctx, () => dispatch(i + 1));
    };

    await dispatch(0);
  };
}

// ============ 内置中间件 ============

/** 日志中间件——记录技能执行开始和结束 */
export function createLoggingMiddleware(logger: Logger): SkillMiddleware {
  return async (ctx, next) => {
    const skillId = ctx.skill.meta.id;
    logger.info(`[${skillId}] 开始执行`);

    const start = Date.now();
    try {
      await next();
    } finally {
      const duration = Date.now() - start;
      logger.info(`[${skillId}] 执行完成, 耗时 ${duration}ms`);
    }
  };
}

/** 计时中间件——记录执行耗时到上下文 */
export const timingMiddleware: SkillMiddleware = async (ctx, next) => {
  const start = Date.now();
  try {
    await next();
  } finally {
    const duration = Date.now() - start;
    ctx['_duration'] = duration;
  }
};

/** 错误捕获中间件——捕获下游未处理的错误 */
export const errorCatchMiddleware: SkillMiddleware = async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    ctx.logger.error(
      `[${ctx.skill.meta.id}] 中间件链未捕获错误: ${err instanceof Error ? err.message : String(err)}`
    );
    throw err;
  }
};
