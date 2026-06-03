// ============================================================
// 🌿 Cortex 技能注册表 — 依赖图（DAG）
// 设计：纳西妲 | 实现：阿贝多
//
// 使用邻接表 + 三色标记法检测循环依赖
// 白色: 未访问 | 灰色: 正在访问 | 黑色: 已处理
//
// @moved-from projects/solo-flight/src/registry/dependency-graph.ts
// ============================================================

import type { SkillId } from './types.js';
import type { IDependencyGraph } from './interfaces.js';

type Color = 'white' | 'gray' | 'black';

export class DependencyGraph implements IDependencyGraph {
  /** 邻接表: 技能 ID → 它所依赖的技能 ID 列表 */
  private readonly graph = new Map<SkillId, SkillId[]>();

  /** 反向邻接表: 技能 ID → 依赖于它的技能 ID 列表 */
  private readonly reverseGraph = new Map<SkillId, SkillId[]>();

  addNode(skillId: SkillId, dependencies: SkillId[]): void {
    this.graph.set(skillId, [...dependencies]);

    // 更新反向图
    for (const depId of dependencies) {
      if (!this.reverseGraph.has(depId)) {
        this.reverseGraph.set(depId, []);
      }
      const dependents = this.reverseGraph.get(depId)!;
      if (!dependents.includes(skillId)) {
        dependents.push(skillId);
      }
    }

    // 确保节点在反向图中也有记录（即使没有依赖它的技能）
    if (!this.reverseGraph.has(skillId)) {
      this.reverseGraph.set(skillId, []);
    }
  }

  removeNode(skillId: SkillId): void {
    this.graph.delete(skillId);
    this.reverseGraph.delete(skillId);

    // 从其他节点的依赖列表中移除
    for (const [, deps] of this.graph) {
      const idx = deps.indexOf(skillId);
      if (idx !== -1) deps.splice(idx, 1);
    }
    for (const [, dependents] of this.reverseGraph) {
      const idx = dependents.indexOf(skillId);
      if (idx !== -1) dependents.splice(idx, 1);
    }
  }

  /**
   * 使用三色标记法检测循环依赖
   * @returns 如果存在循环，返回循环路径；否则返回 null
   */
  detectCycle(): SkillId[] | null {
    const color = new Map<SkillId, Color>();
    const parent = new Map<SkillId, SkillId | null>();

    for (const nodeId of this.graph.keys()) {
      color.set(nodeId, 'white');
      parent.set(nodeId, null);
    }

    for (const nodeId of this.graph.keys()) {
      if (color.get(nodeId) === 'white') {
        const cycle = this.dfsVisit(nodeId, color, parent);
        if (cycle) return cycle;
      }
    }

    return null;
  }

  private dfsVisit(
    nodeId: SkillId,
    color: Map<SkillId, Color>,
    parent: Map<SkillId, SkillId | null>
  ): SkillId[] | null {
    color.set(nodeId, 'gray');

    const deps = this.graph.get(nodeId) ?? [];
    for (const depId of deps) {
      if (!this.graph.has(depId)) continue; // 外部依赖，跳过检测

      const depColor = color.get(depId);
      if (depColor === 'gray') {
        // 发现回边 → 构建循环路径
        const cycle: SkillId[] = [depId, nodeId];
        let p = nodeId;
        while (p !== depId && parent.get(p) !== null) {
          p = parent.get(p)!;
          cycle.push(p);
        }
        return cycle.reverse();
      }

      if (depColor === 'white') {
        parent.set(depId, nodeId);
        const cycle = this.dfsVisit(depId, color, parent);
        if (cycle) return cycle;
      }
    }

    color.set(nodeId, 'black');
    return null;
  }

  /**
   * 拓扑排序（Kahn 算法）
   * @returns 拓扑排序后的技能 ID 列表
   */
  topologicalSort(): SkillId[] {
    const inDegree = new Map<SkillId, number>();
    const queue: SkillId[] = [];

    // 初始化入度
    for (const [nodeId, deps] of this.graph) {
      if (!inDegree.has(nodeId)) inDegree.set(nodeId, 0);
      for (const depId of deps) {
        if (this.graph.has(depId)) {
          inDegree.set(depId, (inDegree.get(depId) ?? 0) + 1);
        }
      }
    }

    // 入度为 0 的节点入队
    for (const [nodeId] of this.graph) {
      if ((inDegree.get(nodeId) ?? 0) === 0) {
        queue.push(nodeId);
      }
    }

    const sorted: SkillId[] = [];
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      sorted.push(nodeId);

      const deps = this.graph.get(nodeId) ?? [];
      for (const depId of deps) {
        if (this.graph.has(depId)) {
          const deg = (inDegree.get(depId) ?? 1) - 1;
          inDegree.set(depId, deg);
          if (deg === 0) {
            queue.push(depId);
          }
        }
      }
    }

    return sorted;
  }

  /** 递归获取某个技能的所有依赖 */
  getDependencies(skillId: SkillId): SkillId[] {
    const visited = new Set<SkillId>();
    const result: SkillId[] = [];

    const dfs = (id: SkillId) => {
      if (visited.has(id)) return;
      visited.add(id);
      const deps = this.graph.get(id) ?? [];
      for (const depId of deps) {
        dfs(depId);
        if (!result.includes(depId)) result.push(depId);
      }
    };

    dfs(skillId);
    return result;
  }

  clear(): void {
    this.graph.clear();
    this.reverseGraph.clear();
  }

  /** 获取所有节点 */
  getNodes(): SkillId[] {
    return Array.from(this.graph.keys());
  }

  /** 获取某个技能的依赖（直接依赖） */
  getDirectDependencies(skillId: SkillId): SkillId[] {
    return this.graph.get(skillId) ?? [];
  }

  /** 获取依赖于某个技能的所有技能 */
  getDependents(skillId: SkillId): SkillId[] {
    return this.reverseGraph.get(skillId) ?? [];
  }
}
