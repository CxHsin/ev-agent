# 01 — 建立 Composition decision spike 边界与可观测测试夹具

**What to build:** 一个可运行、可重复的最小 Composition 原型，以及用于观察生命周期、效果注册、Agent scope 和当前 composition 身份的测试夹具。Cordis 类型必须停留在 Composition 内部。

**Blocked by:** None — can start immediately

**Status:** completed

- [x] 原型可以加载和卸载最小 Plugin composition
- [x] 测试夹具可以观察激活状态、当前 composition 身份、注册效果数量和 scope-local 状态
- [x] Agent-domain 和 capability-facing 结果不暴露 Cordis 类型
- [x] 测试在无网络、无凭据环境中可重复运行
- [x] 原型保持可丢弃，不承诺生产 package 结构
