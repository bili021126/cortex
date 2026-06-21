import { SkillRegistry } from "@cortex/skill-kit";
import type { ExternalSearcher } from "@cortex/skill-kit";
import type { IMemoryStore, IPipelineObserver } from "@cortex/shared";
import type { MetaAgent } from "../core/meta-agent.js";
export declare function initSkillSystem(observer: IPipelineObserver, memory: IMemoryStore | undefined, metaAgent: MetaAgent, projectRoot: string, externalSearch?: ExternalSearcher): Promise<SkillRegistry>;
//# sourceMappingURL=init-skills.d.ts.map