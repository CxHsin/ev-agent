# 05 — 增加 Memory Candidate path 与 Evidence Bundle

**What to build:** 一个可持久化 Memory Candidate、执行 provenance/scope/conflict/duplicate/sensitivity 校验、明确接受或拒绝，并为 conversational response 生成带来源和适用范围的 Evidence Bundle。

**Blocked by:** 04 — 建立 version-bound Session

**Status:** completed

- [x] Memory Candidate 与 accepted Claim 在 domain model 和 durable records 中分离
- [x] candidate validation 能接受有效 candidate，拒绝 schema、provenance、scope、duplicate 和 conflict 问题
- [x] rejected candidate 保留可解释 reason，不会改变 accepted state
- [x] Evidence Bundle 包含 source、applicability、confidence 和关联 event/claim identity
- [x] conversational Run 能附加 Evidence Bundle，且 replay 后结构一致
