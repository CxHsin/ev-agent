# 06 — 形成 Cordis adoption decision ADR

**What to build:** 汇总四个行为的成功路径、失败模式、重复性和限制，明确选择 adopt、adopt-with-constraints 或 reject，并记录后续 Phase 1 必须遵守的边界。

**Blocked by:** 02 — 验证 dependency pending/resume; 03 — 验证完整 effect disposal; 04 — 验证 Agent-scope isolation; 05 — 验证失败配置的事务性 rollback

**Status:** ready-for-agent

- [ ] ADR 包含四个行为的自动化结果和失败模式
- [ ] ADR 记录重复运行的测量结果和残留效果指标
- [ ] ADR 明确 adopt、adopt-with-constraints 或 reject 之一
- [ ] 任何约束都明确落在 Composition 边界或生命周期规则上
- [ ] ADR 保留后续 Phase 1 的可执行 exit criteria
