# Cortex 包依赖拓扑

Cortex 采用 29 包分层架构（L0–L4），依赖为严格单向 DAG。

**架构真相源（漂移时以此为准）：**
- [`PACKAGE_POSITIONING.md`](../PACKAGE_POSITIONING.md) — 人类可读的包定位与分层说明
- [`packages/tools/src/layer-contract.ts`](tools/src/layer-contract.ts) — 机器可读分层契约（CI 门禁用）

上述两处为单一真相源，本文件不再维护包拓扑清单。
