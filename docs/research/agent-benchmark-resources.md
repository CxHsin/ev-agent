# Agent Benchmark Resources

> Checked 2026-08-16 against official repositories, dataset cards, and papers. This note selects resources for a durable personal Agent Harness; it is not a general leaderboard survey.

## Recommended Core

### tau3-bench for conversational tool use

The current `sierra-research/tau2-bench` repository has evolved into tau3-bench. It evaluates policy-following conversational agents that interact with users and tools across airline, retail, telecom, banking knowledge, and optional voice domains. The repository is MIT licensed and provides task definitions, simulators, trajectories, evaluation code, and a leaderboard.

Use the text-mode base split through an external Python benchmark adapter. Pin release `v1.0.1` or newer explicitly: the maintainers state that July 2026 banking task fixes make older results non-comparable for that domain. Start with a small, stratified retail and telecom subset before paying for full repeated trials.

Sources: [official repository](https://github.com/sierra-research/tau2-bench) · [official evaluation documentation](https://github.com/sierra-research/tau2-bench/blob/main/docs/evaluation.md) · [MIT license](https://github.com/sierra-research/tau2-bench/blob/main/LICENSE)

### LongMemEval-V2 for durable Agent memory

LongMemEval-V2 evaluates whether a memory system extracts reusable experience from long multimodal web-agent trajectories. Its 451 manually curated questions cover static state recall, dynamic state tracking, workflow knowledge, environment gotchas, and premise awareness across web and enterprise domains. The largest haystacks reach 500 trajectories and 115 million tokens; public small and medium tiers report both answer accuracy and query latency.

This is a better primary fit than LongMemEval v1 because the project needs Agent experience and workflow memory, not only recall from chat history. Implement the project's memory capability as a benchmark backend, begin with the small tier, and keep the benchmark's reader model fixed when comparing memory plugins. Code and dataset declare Apache-2.0.

Sources: [official repository](https://github.com/xiaowu0162/LongMemEval-V2) · [official dataset](https://huggingface.co/datasets/xiaowu0162/longmemeval-v2) · [paper](https://arxiv.org/abs/2605.12493) · [Apache-2.0 license](https://github.com/xiaowu0162/LongMemEval-V2/blob/main/LICENSE)

### Project-owned Harness Resilience suite

No reviewed public Agent benchmark measures Cordis-style dependency activation, reversible plugin effects, failed-composition rollback, durable-job recovery, or duplicate side effects after injected crashes. These must remain project-owned deterministic tests with fault injection and mock providers. They should not be mixed into a model-quality score.

### Project-owned ProactiveEval

The reviewed public resources do not test the complete decision "is this new item worth interrupting this particular user now?" A project-owned dataset must combine user state, source items, prior exposure, timing, daily interruption budget, and labels for must-send, optional, and should-not-send. Public recommendation data can inform ranking methods, but cannot replace this product-specific evaluation.

## Useful Secondary Resources

| Resource | Useful coverage | Decision |
| --- | --- | --- |
| [MemoryAgentBench](https://github.com/HUST-AI-HYZ/MemoryAgentBench) | Incremental multi-turn retrieval, test-time learning, long-range understanding, conflict resolution, and recommendation Recall@5 | Add after LongMemEval-V2 if these failure modes are not already covered; code and dataset declare MIT. |
| [ToolSandbox](https://github.com/apple/ToolSandbox) | Stateful personal-device tools, insufficient-information tasks, tool dependencies, and user simulation | Reuse selected scenario ideas or add an adapter later; it uses Apple's permissive custom software license rather than a standard SPDX license. |
| [AgentBench FC](https://github.com/THUDM/AgentBench) | OS, database, knowledge graph, WebShop, ALFWorld, and function-calling environments | Do not include in the first evaluation wave: setup is broad and resource-heavy, and much of it does not test the personal-Harness thesis. Repository license is Apache-2.0. |
| [LongMemEval v1](https://github.com/xiaowu0162/LongMemEval) | 500 questions over long timestamped chat histories, including updates, temporal reasoning, and abstention | Keep as an optional chat-memory regression; prefer V2 for the primary claim. Repository and cleaned dataset declare MIT. |
| [LaMP](https://github.com/LaMP-Benchmark/LaMP) | Personalized generation from user histories | Methodology reference only until redistribution terms are clarified; the official repository does not currently expose a license through its root or GitHub metadata. |
| [LoCoMo](https://github.com/snap-research/locomo) | Long-conversation memory and question answering | Methodology reference only until licensing and overlap with LongMemEval-V2 justify integration. |

## Integration Rules

1. Keep original benchmark data and evaluators outside the TypeScript runtime. Invoke each official Python environment through a versioned benchmark adapter rather than translating its scoring logic.
2. Pin the benchmark release or commit, dataset revision, environment lockfile, model identifier, model parameters, judge configuration, and trial count in every run manifest.
3. Store raw trajectories and evaluator outputs as immutable artifacts; import only normalized metrics into the Harness event log.
4. Use the same model and budget for system ablations. Public benchmark scores cannot by themselves establish that the Harness is better, because benchmark data may be present in model training and black-box models may change.
5. Keep a private final holdout for project-specific evaluations and run it only for release candidates.

## First Evaluation Wave

The smallest defensible first wave is:

1. Harness Resilience suite with deterministic providers.
2. LongMemEval-V2 small tier for memory-provider comparison.
3. A stratified tau3-bench text subset for conversational tools and policy compliance.
4. ProactiveEval development and private test splits.
5. Thirty days of longitudinal personal-use metrics.

MemoryAgentBench, ToolSandbox, and broader AgentBench environments are expansion candidates, not prerequisites for the first public release.
