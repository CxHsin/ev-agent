# 03 — 增加 Tool permission、approval 与恢复

**What to build:** 一个把 read tool 自动放行、把 external effect 转为 durable approval request 的权限路径；用户可以 approve 或 deny，Run 可在重启后恢复，已提交 effect 使用 stable idempotency key 且最多执行一次。

**Blocked by:** 02 — 完成最小 ReAct Agent Loop 与 Tool Registry

**Status:** completed

- [x] Permission policy 返回 allow、deny 或 requires approval，并按 tool 与资源范围匹配 grant
- [x] 未批准 external effect 不会调用 capability implementation
- [x] approval request、approve、deny、execution receipt 和理由均为 durable Agent Events
- [x] approval pending 状态能被新 runtime 发现并恢复
- [x] crash window 重试不会重复已提交 external effect
- [x] denied effect 的原因可被后续 Agent response 解释
