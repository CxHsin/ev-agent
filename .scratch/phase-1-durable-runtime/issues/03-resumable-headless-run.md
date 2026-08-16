# 03 — 完成可恢复的 deterministic headless Run

**What to build:** 一个端到端 headless Run，通过 versioned Composition、Durability、persistent job 和 deterministic fake model 完成一次可解释执行；在 checkpoint 后模拟进程终止，新的 runtime 可以从同一 SQLite database 恢复，生成最终结果而不重复已经提交的外部 effect。

**Blocked by:** 01 — 建立 production workspace、Plugin SDK 与 Composition 边界; 02 — 建立 SQLite Durability、Agent Event 存储与 replay

Status: completed

- [x] deterministic fake model 能脚本化成功结果、可控模型失败和指定 checkpoint 的 interruption
- [x] Run 创建前验证 composition/configuration；失败时不会改变 last working composition 或写入错误的可执行状态
- [x] Run 对每个有意义的 model/action checkpoint 写入有序 Agent Events，并能得到 completed、resumable 或 terminal failure 状态
- [x] Run 的 persistent job 在进程终止后由新 runtime 重新发现并 resume，而不是被遗留的 running 状态永久卡住
- [x] 在外部 effect 已提交但进程随后终止的故障窗口中，resume 使用 stable idempotency key，最终只产生一次 effect
- [x] 恢复后的 Run 生成与未中断执行相同的最终结果和 state summary
- [x] replay Run event history 生成与 live Run 相同的 state summary，且 history 能解释恢复过程
- [x] Run 持久化 serializable model/config/budget，重启后可以发现 recoverable Run；composition identity 变化会被拒绝
- [x] ExecutionBudget 对 steps/effects 施加有限约束，并将 `budget_exhausted` 作为可恢复 checkpoint 记录
- [x] 端到端测试无网络、无凭据、无非确定性等待，并在完整测试套件中稳定通过
- [x] Phase 1 roadmap exit criteria 全部有自动化证据：配置 rollback、restart/resume no duplicate effects、Plugin effect cleanup、event replay
