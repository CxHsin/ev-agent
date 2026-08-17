# 01 — 建立 Model capability contract 与 DeepSeek Adapter

**What to build:** 一个可由 Agent Loop 使用的 provider-neutral Model 能力契约，以及一个在请求前校验能力、在响应后归一化结果的 DeepSeek Model Adapter；同时保留 deterministic fake 作为同一契约的可控实现。

**Blocked by:** None — can start immediately

**Status:** completed

- [x] Model contract 表达 message、工具声明、文本/推理/工具调用输出、finish state、usage 和 provider metadata
- [x] deterministic fake 能脚本化 text、tool call、failure、streaming 和 interruption
- [x] DeepSeek Adapter 使用注入 transport，能够归一化成功、streaming、tool call、usage 和 provider error
- [x] 不支持的 capability 在发出 provider request 前返回可诊断的本地失败
- [x] API key、请求内容和敏感响应不会进入 durable event 或错误文本
- [x] Model contract tests 与 DeepSeek adapter tests 无网络、无凭据且通过 typecheck
