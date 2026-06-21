// @ci: unit
import { describe, it, expect } from "vitest";
import { BM25Index, tokenize, } from "@cortex/memory-store";
describe("tokenize", () => {
    it("切分中文文本为单字 token", () => {
        const tokens = tokenize("这段代码需要重构优化");
        expect(tokens).toContain("段");
        expect(tokens).toContain("代");
        expect(tokens).toContain("码");
        expect(tokens).toContain("重");
        expect(tokens).toContain("构");
        // 停用词应被过滤
        expect(tokens).not.toContain("的");
        expect(tokens).not.toContain("这");
    });
    it("切分英文保留完整单词", () => {
        const tokens = tokenize("Refactor the codebase");
        expect(tokens).toContain("refactor");
        expect(tokens).toContain("codebase");
        // 停用词
        expect(tokens).not.toContain("the");
    });
    it("空字符串返回空数组", () => {
        expect(tokenize("")).toEqual([]);
    });
});
describe("BM25Index", () => {
    it("添加文档后可搜索", () => {
        const index = new BM25Index();
        index.addDocument("doc1", {
            summary: "修复了登录模块的空指针异常",
            semantic_gist: "登录模块空指针异常修复",
            payload: "bug fix for NPE in login",
        });
        index.addDocument("doc2", {
            summary: "添加了用户资料页面",
            semantic_gist: "用户资料页面新增",
            payload: "add user profile page",
        });
        const results = index.search("登录 异常");
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].id).toBe("doc1");
        expect(results[0].score).toBeGreaterThan(0);
    });
    it("移除文档后不可搜索", () => {
        const index = new BM25Index();
        index.addDocument("doc1", {
            summary: "登录模块重构",
            semantic_gist: "登录模块",
            payload: "login",
        });
        // Verify document was added
        expect(index.docCount).toBe(1);
        expect(index.stats.docCount).toBe(1);
        index.removeDocument("doc1");
        // Verify document was removed
        expect(index.docCount).toBe(0);
        expect(index.stats.docCount).toBe(0);
    });
    it("多字段加权——summary 权重更高", () => {
        const index = new BM25Index({
            summary: 3,
            semantic_gist: 1,
        });
        // docA: 关键词在 summary
        index.addDocument("docA", {
            summary: "重构重构重构重构",
            semantic_gist: "无关内容",
            payload: "",
        });
        // docB: 关键词仅在 semantic_gist
        index.addDocument("docB", {
            summary: "无关内容无关内容",
            semantic_gist: "重构重构重构重构",
            payload: "",
        });
        const results = index.search("重构");
        expect(results.length).toBe(2);
        expect(results[0].id).toBe("docA"); // summary 权重更高
    });
    it("空查询返回空结果", () => {
        const index = new BM25Index();
        index.addDocument("d1", { summary: "测试" });
        expect(index.search("")).toEqual([]);
    });
    it("统计信息正确", () => {
        const index = new BM25Index();
        expect(index.stats.docCount).toBe(0);
        index.addDocument("a", { summary: "文档 A 内容" });
        index.addDocument("b", { summary: "文档 B 内容较多" });
        expect(index.stats.docCount).toBe(2);
        expect(index.stats.avgDocLength).toBeGreaterThan(0);
    });
});
//# sourceMappingURL=hybrid-retrieval.test.js.map