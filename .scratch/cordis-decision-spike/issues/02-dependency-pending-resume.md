# 02 — 验证 dependency pending/resume

**What to build:** 当 Plugin 依赖尚未提供时，composition 进入可诊断的 pending 状态；依赖出现后恢复激活；永久缺失依赖稳定失败且不留下部分激活结果。

**Blocked by:** 01 — 建立 Composition decision spike 边界与可观测测试夹具

**Status:** completed

- [x] 未满足依赖不会被错误地视为已激活
- [x] 依赖补齐后 pending composition 可以恢复并完成激活
- [x] 永久缺失依赖产生稳定、可诊断的失败结果
- [x] pending、resume 和 failure 都有自动化成功/失败路径测试
- [x] 失败路径不会留下部分注册效果或错误的 current composition
