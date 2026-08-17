# 04 — 建立 version-bound Session

**What to build:** 一个创建并恢复 Session 的 domain service，把 Session 固定绑定到 Agent Definition 的 identity、version 和 fingerprint；Session message 会进入 conversational Run，定义变化时恢复明确失败而不是静默迁移。

**Blocked by:** 02 — 完成最小 ReAct Agent Loop 与 Tool Registry

**Status:** completed

- [x] Session 创建持久化 Agent Definition identity、version 和 fingerprint
- [x] 一个 Session 能创建 message Run 并恢复消息与 Run 状态
- [x] changed Agent Definition version 或 fingerprint 被拒绝并保留原 Session
- [x] Session、Run 和 Agent Event 的关联可 replay 和解释
- [x] process restart 后 Session 与未完成 Run 可继续使用
