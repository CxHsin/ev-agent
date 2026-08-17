# 02 — 完成最小 ReAct Agent Loop 与 Tool Registry

**What to build:** 一个使用 Model contract 驱动的最小 ReAct conversational Run，能够在持久化 Run 中选择并执行一个经过注册和 schema 校验的 read tool，记录模型步骤与工具结果，并在下一轮模型输出后完成响应。

**Blocked by:** 01 — 建立 Model capability contract 与 DeepSeek Adapter

**Status:** completed

- [x] Tool Registry 暴露 stable identity、输入/输出校验、effect class 和执行 contract
- [x] ReAct Loop 能处理 text -> completed 与 tool call -> tool result -> final text 两条路径
- [x] 每个 model/tool checkpoint 都产生有序 Agent Events，并能通过 replay 得到相同 summary
- [x] malformed tool call、未知工具和模型失败产生可诊断 terminal failure
- [x] Run 使用现有 Composition/Durability/ExecutionBudget 边界，不创建第二套持久化运行时
- [x] deterministic end-to-end test 无网络、无凭据并稳定通过
