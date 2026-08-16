# 04 — 验证 Agent-scope isolation

**What to build:** 两个 Agent scope 可以并行运行，各自读写独立状态和效果；销毁一个 scope 不影响另一个 scope。

**Blocked by:** 01 — 建立 Composition decision spike 边界与可观测测试夹具

**Status:** completed

- [x] 两个 Agent scope 可以同时激活
- [x] 一个 scope 写入的状态不会被另一个 scope 读取或覆盖
- [x] 一个 scope 的效果不会出现在另一个 scope 的观察结果中
- [x] 销毁一个 scope 只清理该 scope 的状态和效果
- [x] 并行更新和销毁路径具有自动化测试
