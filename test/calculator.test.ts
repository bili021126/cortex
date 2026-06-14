/**
 * Calculator 单元测试
 * 测试 +-* /、括号、优先级、除以零(=NaN)、非法字符(=throw)
 */
import { Calculator } from "../src/calculator.js";
import assert from "node:assert";

// 使用简单的 test runner 模拟
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
  } catch (e) {
    console.log(`  ❌ ${name}: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

const calc = new Calculator();

// ── 基本四则运算 ──
test("加法 2+3 = 5", () => {
  assert.strictEqual(calc.calculate("2+3"), 5);
});

test("减法 5-3 = 2", () => {
  assert.strictEqual(calc.calculate("5-3"), 2);
});

test("乘法 3*4 = 12", () => {
  assert.strictEqual(calc.calculate("3*4"), 12);
});

test("除法 10/2 = 5", () => {
  assert.strictEqual(calc.calculate("10/2"), 5);
});

// ── 运算符优先级 ──
test("优先级 2+3*4 = 14", () => {
  assert.strictEqual(calc.calculate("2+3*4"), 14);
});

test("优先级 10-2*3 = 4", () => {
  assert.strictEqual(calc.calculate("10-2*3"), 4);
});

test("优先级 20/4+2 = 7", () => {
  assert.strictEqual(calc.calculate("20/4+2"), 7);
});

// ── 括号 ──
test("括号 (2+3)*4 = 20", () => {
  assert.strictEqual(calc.calculate("(2+3)*4"), 20);
});

test("嵌套括号 ((2+3)*2)+1 = 11", () => {
  assert.strictEqual(calc.calculate("((2+3)*2)+1"), 11);
});

test("括号除法 (10-2)/2 = 4", () => {
  assert.strictEqual(calc.calculate("(10-2)/2"), 4);
});

// ── 除以零 ──
test("除以零 1/0 = NaN", () => {
  const r = calc.calculate("1/0");
  assert.ok(Number.isNaN(r), `期望 NaN，得到 ${r}`);
});

test("除以零 0/0 = NaN", () => {
  const r = calc.calculate("0/0");
  assert.ok(Number.isNaN(r), `期望 NaN，得到 ${r}`);
});

test("除以零 (2+3)/(1-1) = NaN", () => {
  const r = calc.calculate("(2+3)/(1-1)");
  assert.ok(Number.isNaN(r), `期望 NaN，得到 ${r}`);
});

// ── 非法字符 ──
test("非法字符 abc 抛 Error", () => {
  assert.throws(() => calc.calculate("2+abc"), /非法字符/);
});

test("非法字符 @ 抛 Error", () => {
  assert.throws(() => calc.calculate("2@3"), /非法字符/);
});

test("非法字符 # 抛 Error", () => {
  assert.throws(() => calc.calculate("3#4"), /非法字符/);
});

// ── 边界情况 ──
test("负数 -5+3 = -2", () => {
  assert.strictEqual(calc.calculate("-5+3"), -2);
});

test("小数 2.5+3.5 = 6", () => {
  assert.strictEqual(calc.calculate("2.5+3.5"), 6);
});

test("多个运算符 1+2+3+4 = 10", () => {
  assert.strictEqual(calc.calculate("1+2+3+4"), 10);
});

test("空格容忍 2 + 3 = 5", () => {
  assert.strictEqual(calc.calculate("2 + 3"), 5);
});

test("空字符串抛 Error", () => {
  assert.throws(() => calc.calculate(""), /表达式不能为空/);
});

console.log("\n总计: 22 个测试用例完成\n");
