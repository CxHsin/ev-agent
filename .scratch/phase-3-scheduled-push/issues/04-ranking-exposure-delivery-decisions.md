# 04 — Exposure、candidate ranking 与 Delivery Decision

**What to build:** 一个被 schedule occurrence 调用的 ranking/delivery decision seam，使用 active subscription scope、normalized Source Items、user/Agent evidence、exposure history 和有限 Interaction Signal 对候选排序，并为每个 considered candidate 创建 delivered 或 suppressed 的 Delivery Decision。

**Blocked by:** 01 — Push Subscription Candidate 与显式确认; 02 — 持久 Schedule 与 occurrence 恢复; 03 — RSS/GitHub Source Connector 与 Source Item versioning

**Status:** ready-for-agent

- [ ] ranking 只读取 active subscription 授权范围内的 source item，并返回 score components、evidence references 和 explanation
- [ ] exposure 按 subscription/source item/version/occurrence durable 去重，重复曝光会影响 novelty 或 suppression
- [ ] 每个 considered candidate 都有 Delivery Decision、reason 和 evidence，包含 delivery、duplicate、out-of-scope、stale、budget、fetch-incomplete 等 outcome
- [ ] ranking 和 Interaction Signal 不能修改 subscription scope、timing、channel、item budget、validity 或 status
- [ ] occurrence runner 在 fake clock/SQLite restart 下产生确定性排序和决策结果
