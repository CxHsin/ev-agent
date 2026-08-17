# 06 — Interaction Signal 与 ranking-only policy

**What to build:** 记录 open、click、dismiss、follow-up 等带来源 Interaction Signal，并将其作为 ranking evidence；任何 signal 都不能激活、扩大、加速、延长或续期 Push Subscription。

**Blocked by:** 04 — Exposure、candidate ranking 与 Delivery Decision; 05 — Inbox、Windows notification 与 linked Chat Session

**Status:** ready-for-agent

- [ ] Interaction Signal durable 保存 signal kind、source、timestamp、scope、item/decision reference 和 provenance
- [ ] ranking 可以读取 signal 并在 explanation 中显示影响，但 authority evaluator 完全忽略 signal 对 subscription mutation 的请求
- [ ] repeated positive/negative/neutral signals 按确定性规则影响排序或 suppression，且不越过 item budget
- [ ] API、inbox 和 linked Chat path 均只能 append signal，不能由 signal 改写 subscription
- [ ] tests 覆盖 signal replay、restart、ranking change 和 attempted authority escalation
