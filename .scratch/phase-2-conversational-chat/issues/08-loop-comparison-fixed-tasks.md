# 08 — 建立 Agent Loop baseline、LangGraph 对比与固定任务证据

**What to build:** 在最小 ReAct Loop 已可测量后，建立至少 50 个固定 real-task 场景的可重复执行清单，并在等价 Model、Tool、ExecutionBudget 和数据记录规则下比较最小 Loop 与 LangGraph.js；保存每次 Run manifest、结果和事件轨迹。

**Blocked by:** 02 — 完成最小 ReAct Agent Loop 与 Tool Registry

**Status:** completed

- [x] 固定任务集至少包含 50 个有明确 expected outcome 的 conversational/tool scenarios
- [x] baseline runner 为每个任务记录 Agent Loop、model、budget、tool/approval decisions、result 和 raw event trace
- [x] LangGraph.js 只在 baseline 已有结果后接入，且使用相同输入与等价 budgets
- [x] 比较报告区分 success、approval、failure、recovery、latency/cost metadata，不混淆 provider mismatch
- [x] 运行不依赖真实网络或凭据，且可重跑得到确定性结果
