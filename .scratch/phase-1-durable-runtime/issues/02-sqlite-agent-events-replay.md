# 02 — 建立 SQLite Durability、Agent Event 存储与 replay

**What to build:** 一个使用 SQLite WAL 的 Durability 模块，能够原子地写入有序 Agent Event envelope 和可分离 payload，并从持久化历史 replay 出与 live execution 一致的 Run state summary。模块同时提供可恢复 persistent job 的最小存储和 claim 语义，供下一个 headless Run slice 使用。

**Blocked by:** 01 — 建立 production workspace、Plugin SDK 与 Composition 边界

Status: completed

- [x] 使用真实临时 SQLite database 的测试能够创建、关闭并重新打开 Durability store
- [x] Agent Event envelope 包含稳定 event identity、Run identity、monotonic sequence、event type、occurrence information 和 payload 状态/引用
- [x] 一个事务可以写入 envelope 与 payload；按 Run 读取时顺序稳定且不会出现部分 event
- [x] payload 与 envelope 可独立读取，并能明确表达 payload 不存在或已被擦除的状态
- [x] 给定同一组有序 Agent Events，live execution reducer 和 replay reducer 产生相同的 state summary
- [x] 重复 idempotency key 不会创建第二个持久化副作用或第二个等价 job completion
- [x] persistent job 能被创建、claim、完成或失败，并在模拟进程终止后被新 Durability 实例发现为可恢复工作
- [x] Durability contract tests 不依赖网络、凭据、真实等待或执行顺序
