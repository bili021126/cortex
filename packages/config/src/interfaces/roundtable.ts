/**
 * @cortex/config — 圆桌会议模板接口
 *
 * @module interfaces/roundtable
 * @layer root — 零依赖，纯类型层
 */

/** 圆桌会议模板 */
export interface RoundtableTemplate {
  /** 模板名称（用于 `cortex roundtable start <name>`） */
  name: string;
  /** 人类可读描述 */
  description: string;
  /** 参与 Persona 数 */
  personas: number;
  /** 轮次数 */
  rounds: number;
  /** 参与的 Agent Persona 名列表 */
  agents: string[];
  /** 自定义规则（追加在通用规则之后） */
  rules?: string[];
}
