/**
 * Calculator — 字符串表达式计算器
 * 支持 +-* /、括号、优先级。除以零返回 NaN，非法字符抛 Error。
 */
export class Calculator {
  /**
   * 计算字符串表达式
   * @param expr 数学表达式，如 "2+3*4", "(1+2)*3"
   * @returns 计算结果
   * @throws Error 当表达式包含非法字符时
   */
  calculate(expr: string): number {
    if (typeof expr !== "string" || expr.trim() === "") {
      throw new Error("表达式不能为空");
    }

    // 检查非法字符（只允许 0-9, +, -, *, /, ., 空格, (, )）
    const validChars = /^[0-9+\-*/.()\s]+$/;
    if (!validChars.test(expr)) {
      throw new Error(`非法字符: "${expr}"`);
    }

    // 使用 Function 构造器实现安全的表达式求值
    // 注意：这里只允许数字和运算符，通过上面的校验已经过滤了非法字符
    try {
      const result = new Function(`"use strict"; return (${expr})`)();
      
      if (typeof result !== "number" || !isFinite(result)) {
        // 除以零 → NaN
        if (typeof result === "number" && !isFinite(result)) {
          return NaN;
        }
        return NaN;
      }
      
      return result;
    } catch {
      // 如果表达式有语法错误（如除以零在 JS 中返回 Infinity 而非报错）
      // 但其他解析错误会抛出异常
      return NaN;
    }
  }
}
