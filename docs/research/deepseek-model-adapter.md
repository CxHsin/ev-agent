# DeepSeek Model Adapter

> Checked 2026-08-16 against the official DeepSeek API documentation.

## Decision Evidence

DeepSeek documents its API as compatible with both OpenAI and Anthropic formats. The current quick start exposes OpenAI-format `https://api.deepseek.com` and Anthropic-format `https://api.deepseek.com/anthropic`, and currently lists the rolling model aliases `deepseek-v4-flash` and `deepseek-v4-pro`.

DeepSeek also implements an OpenAI Responses-compatible endpoint with streaming, function tools, server-side web search, reasoning output, usage accounting, and structured text formats. Compatibility is partial rather than semantic equivalence:

- the API is stateless: `previous_response_id`, `conversation`, and `store` are unsupported;
- `background`, `metadata`, prompt references, and server-side context management are unsupported;
- `max_tool_calls` is ignored and parallel tool calling is always enabled;
- function and web-search tools are supported, but most OpenAI built-in tool types are ignored;
- image and file input items are not supported;
- unsupported request fields may be silently ignored rather than rejected.

Sources: [DeepSeek API quick start](https://api-docs.deepseek.com/) · [Tool Calls](https://api-docs.deepseek.com/guides/tool_calls) · [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode) · [Responses API compatibility](https://api-docs.deepseek.com/guides/responses_api) · [Chat Completions reference](https://api-docs.deepseek.com/api/create-chat-completion/)

## Adapter Shape

The first production model plugin should be named and tested as a `DeepSeekModelAdapter`, not advertised as a complete generic OpenAI adapter. It may use the OpenAI SDK as transport, but it must:

1. validate requested capabilities locally and reject unsupported combinations instead of relying on silent server behavior;
2. normalize streaming text, reasoning, tool calls, finish states, errors, and token usage into the project's Model interface;
3. keep conversation state, compaction, tool-loop state, and retries inside Agent Execution rather than assuming provider-side state;
4. record the resolved model identifier and provider response metadata on every Run;
5. expose provider capabilities so Agent Definitions and benchmarks can detect unsupported features before execution.

The deterministic fake remains the test Adapter. A generic OpenAI-compatible production Adapter should only be extracted when a second compatible provider demonstrates genuinely shared behavior; until then it would be a hypothetical seam around DeepSeek-specific semantics.
