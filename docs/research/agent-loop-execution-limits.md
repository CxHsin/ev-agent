# Agent Loop Execution Limits

> Checked 2026-08-16 against current official documentation. The question is whether Codex, Claude Code, and OpenCode expose maximum Agent-loop steps or equivalent budgets.

## Findings

| Harness | Public control | Default behavior |
| --- | --- | --- |
| OpenCode | Agent option `steps`; legacy `maxSteps` is deprecated | No step limit. It iterates until the model stops or the user interrupts. At the limit it is forced to return a text summary. |
| Claude Code CLI | `--max-turns` in print mode | No turn limit by default. Reaching it exits with an error. |
| Claude Agent SDK | `maxTurns` for the main run and Agent definitions | Optional; unset by default. A turn is an API/tool-use round trip. |
| OpenAI Codex CLI / SDK | No public maximum-turn or maximum-step option found in the current official CLI, SDK, or configuration references | The public SDK shows `thread.run(...)` without a turn-bound option. |
| OpenAI Codex experimental configuration | `features.rollout_budget.limit_tokens` when rollout-budget tracking is enabled | The feature is documented as under development and off by default; it is a token budget rather than a step count. |

Sources: [OpenCode Agent max steps](https://opencode.ai/docs/agents/#max-steps) · [Claude Code CLI flags](https://code.claude.com/docs/en/cli-reference#cli-flags) · [Claude Agent SDK TypeScript reference](https://platform.claude.com/docs/en/agent-sdk/typescript) · [OpenAI Codex SDK](https://developers.openai.com/codex/sdk/) · [OpenAI Codex configuration reference](https://developers.openai.com/codex/config-file/config-reference/)

## Interpretation

A missing default step cap does not mean an execution has no boundaries. Interactive coding harnesses rely on model termination, user interruption, context management, per-tool timeouts, permissions, and provider limits. OpenCode and Claude expose optional turn limits for cost control, automation, or SDK callers, while leaving interactive use unbounded by default.

A raw step count is also a weak universal budget: one step may be a cheap read or an expensive model/tool round trip, and long legitimate tasks may need many steps. Token, cost, wall-clock, side-effect, and cancellation limits express the actual risks more directly.

## Recommendation for This Project

Use a composable `ExecutionBudget`, not a mandatory global `maxSteps`:

- Interactive Chat runs may leave `maxModelTurns` unset, while always supporting user cancellation, tool timeouts, cost visibility, and external-side-effect approvals.
- Unattended Push, scheduled, and Evaluation runs must have finite wall-clock, token/cost, retry, and side-effect budgets. `maxModelTurns` is an optional final fuse and may be mandatory for a particular Product Assembly.
- Benchmarks pin the same turn and cost budgets across compared Agent Loops.
- Budget exhaustion checkpoints the Run and returns a resumable `budget_exhausted` outcome with completed work and remaining work; it is not silently treated as success or destructive failure.
