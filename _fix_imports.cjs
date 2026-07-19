const fs = require('fs');
const base = 'packages/memory/src/cyrene';

// memory-audit.ts
let c1 = fs.readFileSync(base+'/memory-audit.ts','utf8');
c1 = c1.replace(/".\/memory-types"/g, '"./memory-types.js"');
c1 = c1.replace('new Map(evidence.map((item) => [item.id, item]))', 'new Map<string, MemoryEvidence>(evidence.map((item: MemoryEvidence) => [item.id, item]))');
fs.writeFileSync(base+'/memory-audit.ts', c1);
console.log('audit done');

// memory-compressor.ts
let c2 = fs.readFileSync(base+'/memory-compressor.ts','utf8');
c2 = c2.replace(/".\/memory-store"/g, '"./memory-store.js"');
c2 = c2.replace(/".\/memory-types"/g, '"./memory-types.js"');
c2 = c2.replace(/".\/llm-adapter"/g, '"./llm-adapter.js"');
fs.writeFileSync(base+'/memory-compressor.ts', c2);
console.log('compressor done');

// memory-judge.ts  
let c3 = fs.readFileSync(base+'/memory-judge.ts','utf8');
c3 = c3.replace(/".\/llm-adapter"/g, '"./llm-adapter.js"');
c3 = c3.replace(/".\/memory-types"/g, '"./memory-types.js"');
c3 = c3.replace('const path = modelSettingsPath', 'const settingsPath = modelSettingsPath');
c3 = c3.replace('path.join(process.cwd(), "data", "model-settings.json")', 'settingsPath || require("path").join(process.cwd(), "data", "model-settings.json")');
fs.writeFileSync(base+'/memory-judge.ts', c3);
console.log('judge done');

// llm-adapter.ts
let c4 = fs.readFileSync(base+'/llm-adapter.ts','utf8');
c4 = c4.replace('{ input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0 }', '{ input: (data.usage as { prompt_tokens?: number; completion_tokens?: number }).prompt_tokens ?? 0, output: (data.usage as { prompt_tokens?: number; completion_tokens?: number }).completion_tokens ?? 0 }');
fs.writeFileSync(base+'/llm-adapter.ts', c4);
console.log('llm done');

// retriever.ts - add MemoryEntry import
let c5 = fs.readFileSync(base+'/rag/retriever.ts','utf8');
c5 = c5.replace('import { JsonVectorStore, SearchResult, cosineSimilarity } from "./vectorstore.js"', 'import { JsonVectorStore, SearchResult, cosineSimilarity, type MemoryEntry } from "./vectorstore.js"');
fs.writeFileSync(base+'/rag/retriever.ts', c5);
console.log('retriever done');

// memory-resolver.ts - fix fs overload issue
let c6 = fs.readFileSync(base+'/memory-resolver.ts','utf8');
c6 = c6.replace('loadModelSettingsFromFile(fpath, fs, DEFAULT_MODEL_SETTINGS)', 'loadModelSettingsFromFile(fpath, { existsSync: (p: string) => fs.existsSync(p), readFileSync: (p: string, enc: string) => fs.readFileSync(p, enc as any) as string }, DEFAULT_MODEL_SETTINGS)');
fs.writeFileSync(base+'/memory-resolver.ts', c6);
console.log('resolver done');
