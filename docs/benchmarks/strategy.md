# Benchmark Strategy

The project combines reproducible industry benchmarks with project-specific evaluations and 30-day personal-use evidence. Framework reliability and Agent usefulness are reported separately.

## Evidence Layers

1. Contract tests verify capability and plugin conformance.
2. Runtime resilience tests verify lifecycle cleanup, rollback, restart recovery, idempotency, and replay.
3. Offline Agent evaluations compare quality, latency, cost, and human correction on fixed tasks.
4. Longitudinal metrics measure whether the conversational and proactive assemblies remain useful during real personal use.

## Initial Runtime Targets

| Measure | Target |
| --- | ---: |
| Invalid configurations rejected before activation | 100% |
| Failed activation preserves the last working assembly | 100% |
| Registered effects remaining after 1,000 load/unload cycles | 0 |
| State-summary agreement after deterministic replay | 100% |
| Duplicate external side effects across 100 injected failures | 0 |
| Durable-task recovery after restart | 100% |

Startup time, idle memory, and dispatch overhead are recorded as baselines before targets are set.

## Assembly Evaluations

The conversational assembly uses at least 50 real tasks and reports task success, tool-call success, long-term-memory factual accuracy, human correction time, end-to-end latency, and cost.

The proactive assembly uses at least 200 source items labeled as must-send, optional, or should-not-send. It reports precision within the daily interruption budget, must-send recall, duplicate or already-known rate, personalization-reason accuracy, and 30-day keep, open, action, and negative-feedback rates.

## Comparisons

Controlled comparisons hold the model, tools, inputs, and budget constant while comparing a deterministic script, a minimal ReAct loop, a LangGraph.js provider, and this project's composition. End-to-end product comparisons use the same task intent and information sources where product interfaces permit it, and report limitations rather than implying perfect experimental control.

DeepSeek Harness is an architectural reference, not a direct quality baseline for proactive personalization.

## Acceptance Evidence

The first public claim of a durable personal Agent Harness requires two independent product assemblies, two interchangeable model or Agent-loop providers, restart and plugin-replacement continuity, replayable evaluations, 30 days of personal use, published failures, and at least one independently packaged non-core plugin.

## First Evaluation Wave

1. Run the project-owned Harness Resilience suite with deterministic providers.
2. Run LongMemEval-V2 small tier through its official Python environment. Hold the reader model fixed and compare no memory, vector RAG, the official AgentRunbook baseline, and the project's memory provider.
3. Run a pinned tau3-bench text subset through its official Python environment. Hold model, tools, inputs, and budget fixed while comparing a deterministic workflow, minimal ReAct loop, LangGraph.js provider, and the default Agent Definition.
4. Run project-owned ProactiveEval development and frozen private-test splits.
5. Report 30 days of longitudinal personal-use metrics.

MemoryAgentBench, ToolSandbox, and AgentBench FC are second-wave candidates. Public benchmark selection evidence and licensing notes live in `docs/research/agent-benchmark-resources.md`.

## External Benchmark Adapters

Official benchmark environments and scorers remain in Python. Versioned adapters start them, collect immutable raw artifacts, and import normalized metrics into the Harness. An adapter must pin the benchmark release or commit, dataset revision, dependency environment, model settings, judge settings, trial count, and budget.

## ProactiveEval Labels

Source items are labeled before Agent predictions are revealed. Each label records `must-send`, `optional`, or `should-not-send`, plus the expected reason, latest useful time, whether the user already knew it, and an available action. Prompt and ranking changes may use the development split; the frozen test split is reserved for release candidates.

## Cadence

- Every change runs API-free contract and resilience tests.
- Weekly paid smoke runs use fixed benchmark samples and hard budget limits.
- Milestones run complete public small tiers.
- Release candidates run frozen tests with repeated stochastic trials.
