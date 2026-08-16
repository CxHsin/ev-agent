# 05 — 验证失败配置的事务性 rollback

**What to build:** 已运行的 composition 在无效配置或激活失败的候选替换后保持不变；候选产生的效果全部清理。

**Blocked by:** 01 — 建立 Composition decision spike 边界与可观测测试夹具

**Status:** completed

- [x] 无效配置在候选 composition 成为 current 之前被拒绝
- [x] 激活失败的候选不会替换最后一个 working composition
- [x] 候选创建的状态和效果不会污染 working composition
- [x] 重复失败替换具有确定性结果
- [x] 成功替换和两类失败替换都有自动化测试
