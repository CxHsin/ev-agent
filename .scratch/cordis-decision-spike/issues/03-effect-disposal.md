# 03 — 验证完整 effect disposal

**What to build:** 正常卸载、替换和激活失败后，Plugin 注册的效果都被清理；重复 load/unload 测试最终保持零残留效果。

**Blocked by:** 01 — 建立 Composition decision spike 边界与可观测测试夹具

**Status:** ready-for-agent

- [ ] 正常卸载会清理所有可观测效果
- [ ] composition 替换会清理被替换 composition 的效果
- [ ] 激活失败会清理候选 composition 已创建的部分效果
- [ ] 重复 load/unload 周期后注册效果数量为零
- [ ] 成功和失败路径都通过自动化测试验证
