/**
 * tui/intent-router/classifiers/pattern.ts — L2 模式匹配分类器
 *
 * 增强版正则匹配，带权重评分。
 *
 * @module tui/intent-router/classifiers/pattern
 * @since v6
 */

import type { Classifier, ClassificationResult, IntentType, IntentResult, RouterContext } from "../types.js";

interface PatternRule {
  pattern: RegExp;
  type: IntentType;
  weight: number;
  reason: string;
  params?: Partial<IntentResult["params"]>;
}

/**
 * 模式匹配分类器
 * 使用带权重的正则规则集进行意图分类
 */
export class PatternClassifier implements Classifier {
  name = "pattern";

  private readonly rules: PatternRule[] = [
    // ── 任务类 ─────────────────────────
    {
      pattern: /^(帮我|请|给我|来一个|创建|生成|写[一个]?|做[一个]?|实现|开发|修复|修改|重构|优化|部署|运行|执行)/,
      type: "task",
      weight: 0.8,
      reason: "任务关键词前缀",
    },
    {
      pattern: /(写代码|写个|写一|实现|重构|修复bug|修bug|加个|加一个|删除|移除|创建|生成|部署|发布)/,
      type: "task",
      weight: 0.75,
      reason: "任务关键词",
    },
    {
      pattern: /(分析|调研|研究|查看|检查|扫描|测试|验证|评估)/,
      type: "task",
      weight: 0.6,
      reason: "分析/检查类任务",
    },

    // ── 命令类 ─────────────────────────
    {
      pattern: /^(ls|cd|cat|grep|find|git|npm|pnpm|yarn|node|python|docker|make|cargo|go |rustc|gcc)/,
      type: "command",
      weight: 0.85,
      reason: "Shell 命令",
    },
    {
      pattern: /^(打开|关闭|启动|停止|重启|安装|卸载|配置|设置)/,
      type: "command",
      weight: 0.6,
      reason: "中文操作动词",
    },

    // ── 确认类 ─────────────────────────
    {
      pattern: /^(好的|可以|确认|执行|同意|通过|yes|y|ok|sure|approve)$/i,
      type: "confirmation",
      weight: 0.85,
      reason: "确认/批准用语",
    },
    {
      pattern: /^(不行|不要|取消|拒绝|算了|no|n|deny|reject)$/i,
      type: "confirmation",
      weight: 0.7,
      reason: "拒绝/取消用语",
    },

    // ── 模式切换 ───────────────────────
    {
      pattern: /^(切换到|进入|使用)(规划|plan|任务|task)模式?/,
      type: "mode-switch",
      weight: 0.9,
      reason: "模式切换请求",
      params: { modeId: "plan" },
    },
    {
      pattern: /^(切换到|进入|使用)(聊天|chat|对话)模式?/,
      type: "mode-switch",
      weight: 0.9,
      reason: "模式切换请求",
      params: { modeId: "chat" },
    },

    // ── 聊天类 ─────────────────────────
    {
      pattern: /[?？]$/,
      type: "chat",
      weight: 0.7,
      reason: "以问号结尾",
    },
    {
      pattern: /^(什么是|怎么|如何|为什么|能不能|可以|请问|告诉我|解释|说明)/,
      type: "chat",
      weight: 0.75,
      reason: "问答类问题",
    },
    {
      pattern: /(你好|嗨|hi|hello|hey|早上好|下午好|晚上好)/i,
      type: "chat",
      weight: 0.9,
      reason: "问候语",
    },
    {
      pattern: /(谢谢|感谢|太好了|不错|厉害|棒|赞|666|nb)/,
      type: "chat",
      weight: 0.8,
      reason: "情感/反馈表达",
    },
  ];

  classify(input: string, _context: RouterContext): ClassificationResult {
    const trimmed = input.trim();

    // 短文本倾向聊天
    if (trimmed.length < 5) {
      return {
        type: "chat",
        confidence: 0.5,
        reason: "短文本默认聊天",
      };
    }

    // 遍历规则，取最高权重
    let bestResult: ClassificationResult = {
      type: "ambiguous",
      confidence: 0,
      reason: "无匹配规则",
    };

    for (const rule of this.rules) {
      if (rule.pattern.test(trimmed)) {
        if (rule.weight > bestResult.confidence) {
          bestResult = {
            type: rule.type,
            confidence: rule.weight,
            reason: rule.reason,
            params: rule.params,
          };
        }
      }
    }

    // 长文本倾向任务
    if (bestResult.confidence < 0.5 && trimmed.length > 40) {
      bestResult = {
        type: "task",
        confidence: 0.55,
        reason: "长文本倾向任务",
      };
    }

    return bestResult;
  }
}
