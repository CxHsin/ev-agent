# 01 — 建立 production workspace、Plugin SDK 与 Composition 边界

**What to build:** 一个可运行的 production-shaped runtime workspace，能够通过 Cordis 隔离的 Composition 边界加载、替换和卸载 versioned Plugin composition，并对外提供不包含 Cordis 类型的 Plugin SDK。失败配置和失败激活不会替换最后一个 working composition，也不会留下效果或污染 Agent scope。

**Blocked by:** None — can start immediately

Status: completed

- [x] pnpm workspace 提供明确的 Plugin SDK、Composition 和 runtime package 边界，Phase 0 disposable spike 不成为业务代码的直接依赖
- [x] Plugin SDK 暴露 domain-level identity、依赖、setup 和 cleanup/effect contract，不暴露 Cordis `Context`、`Fiber` 或 `FiberState`
- [x] Composition 能加载带显式 version 的 working composition，并返回可诊断的 active、pending 和 failed lifecycle result
- [x] 未满足依赖的 candidate 不会启动独立 Plugin effect；依赖提供后可以恢复激活，永久缺失依赖稳定失败
- [x] 正常卸载、成功替换、失败激活和重复 load/unload 后都没有残留可观测效果
- [x] 两个 Agent scope 的状态和效果互相隔离；替换 Composition 不擦除 Agent state，销毁一个 scope 不影响另一个
- [x] 无效配置或激活失败的 candidate 不会替换 last working composition，candidate 的状态和 effect 会被清理
- [x] Phase 0 lifecycle acceptance suite 在新 Composition 边界上继续通过
