# 07 — 实现 React Chat Surface

**What to build:** 一个可用的 React Chat Surface，能展示 Session 消息、streaming response、tool activity、pending approval、Evidence Bundle、reconnect 和 terminal error，并通过 API 完成用户交互。

**Blocked by:** 06 — 暴露 Fastify/SSE conversational API

**Status:** completed

- [x] 用户可以创建/选择 Session 并提交消息
- [x] streamed text、tool activity、approval request、evidence 和 completed response 有清晰状态
- [x] approve/deny 控件只提交 domain decision，不在浏览器执行 effect
- [x] SSE 断线后按 cursor reconnect，不重复展示已确认事件
- [x] loading、empty、pending、error 和 completed 状态在 desktop/mobile viewport 可用
- [x] 浏览器级测试覆盖主要用户流程
