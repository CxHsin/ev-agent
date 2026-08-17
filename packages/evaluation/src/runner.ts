import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCompositionRuntime, type CompositionDefinition } from '@ev-agent/composition'
import type { AgentEvent } from '@ev-agent/durability'
import { DurabilityStore } from '@ev-agent/durability'
import { ConversationalRunService, PermissionPolicy, ToolRegistry, invalidToolInput, validToolInput, validToolOutput } from '@ev-agent/execution'
import { DeterministicFakeModel, type FakeModelStep, type ModelMessage, type ModelResponseItem } from '@ev-agent/model'
import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { FIXED_TASKS, taskMessage, type FixedTaskScenario } from './corpus.js'

export type ComparisonLoop = 'minimal-react' | 'langgraph'

export interface TaskRunManifest {
  readonly taskId: string
  readonly loop: ComparisonLoop
  readonly model: string
  readonly budget: { readonly maxModelTurns: number; readonly maxToolCalls: number }
  readonly status: 'completed' | 'failed' | 'resumable'
  readonly response: string
  readonly error: string | undefined
  readonly approvalCount: number
  readonly toolCallCount: number
  readonly eventTypes: readonly string[]
  readonly rawEvents: readonly AgentEvent[]
  readonly latencyMs: number
  readonly providerMismatch: boolean
}

export interface FixedTaskRunnerOptions {
  readonly databasePath?: string
  readonly composition: CompositionDefinition
  readonly modelName?: string
  readonly budget?: { readonly maxModelTurns: number; readonly maxToolCalls: number }
}

export interface ComparisonReport {
  readonly generatedAt: number
  readonly taskCount: number
  readonly baseline: readonly TaskRunManifest[]
  readonly langGraph: readonly TaskRunManifest[]
}

const DEFAULT_BUDGET = { maxModelTurns: 4, maxToolCalls: 4 }

export async function runMinimalBaseline(
  options: FixedTaskRunnerOptions,
  tasks: readonly FixedTaskScenario[] = FIXED_TASKS,
): Promise<readonly TaskRunManifest[]> {
  const databasePath = options.databasePath ?? join(mkdtempSync(join(tmpdir(), 'ev-agent-eval-')), 'runtime.sqlite')
  let runtime = new ConversationalRunService({ databasePath })
  const manifests: TaskRunManifest[] = []
  try {
    for (const task of tasks) {
      const restart = task.mode === 'recovery'
        ? async (): Promise<ConversationalRunService> => {
          await runtime.close()
          runtime = new ConversationalRunService({ databasePath })
          return runtime
        }
        : undefined
      manifests.push(await runMinimalTask(runtime, options, task, restart))
    }
    return manifests
  } finally {
    await runtime.close()
  }
}

export async function runLangGraphComparison(
  options: FixedTaskRunnerOptions,
  tasks: readonly FixedTaskScenario[] = FIXED_TASKS,
): Promise<readonly TaskRunManifest[]> {
  const databasePath = options.databasePath ?? join(mkdtempSync(join(tmpdir(), 'ev-agent-langgraph-')), 'runtime.sqlite')
  const store = new DurabilityStore(databasePath)
  const composition = createCompositionRuntime()
  const manifests: TaskRunManifest[] = []
  try {
    const activation = await composition.activate(options.composition)
    if (activation.status !== 'active') throw new Error(`LangGraph evaluation composition is not active: ${activation.status}`)
    for (const task of tasks) manifests.push(await runLangGraphTask(options, task, store))
    return manifests
  } finally {
    await composition.dispose()
    store.close()
  }
}

export async function runComparison(
  options: FixedTaskRunnerOptions,
  tasks: readonly FixedTaskScenario[] = FIXED_TASKS,
): Promise<ComparisonReport> {
  const baseline = await runMinimalBaseline(options, tasks)
  const langGraph = await runLangGraphComparison(options, tasks)
  return { generatedAt: Date.now(), taskCount: tasks.length, baseline, langGraph }
}

async function runMinimalTask(
  runtime: ConversationalRunService,
  options: FixedTaskRunnerOptions,
  task: FixedTaskScenario,
  restart?: () => Promise<ConversationalRunService>,
): Promise<TaskRunManifest> {
  const startedAt = Date.now()
  const runId = `minimal:${task.id}`
  const tools = createTools(task)
  const model = new DeterministicFakeModel(initialScript(task))
  const first = await runtime.start({
    runId,
    composition: options.composition,
    model,
    modelName: options.modelName ?? 'fake-model',
    messages: [taskMessage(task)],
    tools,
    budget: options.budget ?? DEFAULT_BUDGET,
  })
  const activeRuntime = first.summary.pendingApproval === undefined || restart === undefined ? runtime : await restart()
  const result = first.summary.pendingApproval === undefined
    ? first
    : await activeRuntime.decide({
      runId,
      approvalId: first.summary.pendingApproval.approvalId,
      decision: 'approved',
      composition: options.composition,
      model,
      modelName: options.modelName ?? 'fake-model',
      messages: [taskMessage(task)],
      tools,
      budget: options.budget ?? DEFAULT_BUDGET,
    })
  return manifest(activeRuntime, runId, 'minimal-react', task, result, options, Date.now() - startedAt)
}

async function runLangGraphTask(options: FixedTaskRunnerOptions, task: FixedTaskScenario, store: DurabilityStore): Promise<TaskRunManifest> {
  const startedAt = Date.now()
  const runId = `langgraph:${task.id}`
  const outcome = await invokeLangGraph(options, task, store)
  const rawEvents = store.listEvents(runId)
  return {
    taskId: task.id,
    loop: 'langgraph',
    model: options.modelName ?? 'fake-model',
    budget: options.budget ?? DEFAULT_BUDGET,
    status: outcome.status,
    response: outcome.response,
    error: outcome.error,
    approvalCount: outcome.approvalCount,
    toolCallCount: outcome.toolCallCount,
    eventTypes: rawEvents.map((event) => event.type),
    rawEvents,
    latencyMs: Date.now() - startedAt,
    providerMismatch: false,
  }
}

function createTools(task: FixedTaskScenario): ToolRegistry {
  const tools = new ToolRegistry()
  if (task.mode === 'read') {
    tools.register({
      name: 'read_fixture', description: 'Read a fixed evaluation fixture', inputSchema: { type: 'object' }, effectClass: 'read',
      validateInput: (input) => input !== null && typeof input === 'object' ? validToolInput() : invalidToolInput('object required'),
      validateOutput: () => validToolOutput(),
      execute: () => ({ taskId: task.id, value: 'fixture-ready' }),
    })
  }
  if (task.mode === 'approval') {
    tools.register({
      name: 'external_fixture', description: 'Perform a fixed external evaluation effect', inputSchema: { type: 'object' }, effectClass: 'external', requiredPermission: 'evaluation.effect',
      validateInput: (input) => input !== null && typeof input === 'object' ? validToolInput() : invalidToolInput('object required'),
      validateOutput: () => validToolOutput(),
      execute: () => ({ taskId: task.id, applied: true }),
    })
  }
  if (task.mode === 'recovery') {
    tools.register({
      name: 'external_fixture', description: 'Resume a fixed external evaluation effect', inputSchema: { type: 'object' }, effectClass: 'external', requiredPermission: 'evaluation.effect',
      validateInput: (input) => input !== null && typeof input === 'object' ? validToolInput() : invalidToolInput('object required'),
      validateOutput: () => validToolOutput(),
      execute: () => ({ taskId: task.id, applied: true }),
    })
  }
  return tools
}

function initialScript(task: FixedTaskScenario): readonly FakeModelStep[] {
  if (task.mode === 'text') return [{ items: [{ type: 'text', text: task.expected }] }]
  if (task.mode === 'read') return [
    { items: [{ type: 'tool_call', id: `${task.id}:read`, name: 'read_fixture', arguments: {} }] },
    { items: [{ type: 'text', text: task.expected }] },
  ]
  if (task.mode === 'failure') return [{ error: 'fixed_provider_failure' }]
  return [
    { items: [{ type: 'tool_call', id: `${task.id}:external`, name: 'external_fixture', arguments: {} }] },
    { items: [{ type: 'text', text: task.expected }] },
  ]
}

function manifest(
  runtime: ConversationalRunService,
  runId: string,
  loop: ComparisonLoop,
  task: FixedTaskScenario,
  result: Awaited<ReturnType<ConversationalRunService['start']>>,
  options: FixedTaskRunnerOptions,
  latencyMs: number,
): TaskRunManifest {
  const events = runtime.listEvents(runId)
  return {
    taskId: task.id,
    loop,
    model: options.modelName ?? (loop === 'langgraph' ? 'langgraph-scripted-model' : 'fake-model'),
    budget: options.budget ?? DEFAULT_BUDGET,
    status: result.status,
    response: result.summary.response,
    error: result.summary.error,
    approvalCount: events.filter((event) => event.type === 'conversation.approval.requested').length,
    toolCallCount: result.summary.toolCalls.length,
    eventTypes: events.map((event) => event.type),
    rawEvents: events,
    latencyMs,
    providerMismatch: false,
  }
}

interface LangGraphOutcome {
  readonly status: TaskRunManifest['status']
  readonly response: string
  readonly toolCallCount: number
  readonly approvalCount: number
  readonly error: string | undefined
  readonly trace: readonly { readonly type: string; readonly payload: unknown }[]
}

async function invokeLangGraph(options: FixedTaskRunnerOptions, task: FixedTaskScenario, store: DurabilityStore): Promise<LangGraphOutcome> {
  const model = new DeterministicFakeModel(initialScript(task))
  const tools = createTools(task)
  const permissionPolicy = new PermissionPolicy()
  const budget = options.budget ?? DEFAULT_BUDGET
  type ToolCall = Extract<ModelResponseItem, { type: 'tool_call' }>
  type TraceEvent = { readonly type: string; readonly payload: unknown }
  let eventSequence = 0
  const checkpoint = (events: readonly TraceEvent[]): readonly TraceEvent[] => {
    for (const event of events) {
      eventSequence += 1
      store.appendEvent({
        eventId: `langgraph:${task.id}:event:${eventSequence}`,
        runId: `langgraph:${task.id}`,
        type: event.type,
        occurredAt: Date.now(),
        payload: event.payload,
      })
    }
    return events
  }
  const GraphState = Annotation.Root({
    phase: Annotation<string>({ reducer: (_, next) => next, default: () => 'model' }),
    response: Annotation<string>({ reducer: (_, next) => next, default: () => '' }),
    toolCallCount: Annotation<number>({ reducer: (_, next) => next, default: () => 0 }),
    approvalCount: Annotation<number>({ reducer: (_, next) => next, default: () => 0 }),
    modelTurns: Annotation<number>({ reducer: (_, next) => next, default: () => 0 }),
    messages: Annotation<ModelMessage[]>({ reducer: (_, next) => next, default: () => [taskMessage(task)] }),
    toolCall: Annotation<ToolCall | undefined>({ reducer: (_, next) => next, default: () => undefined }),
    status: Annotation<TaskRunManifest['status']>({ reducer: (_, next) => next, default: () => 'resumable' }),
    error: Annotation<string | undefined>({ reducer: (_, next) => next, default: () => undefined }),
    trace: Annotation<TraceEvent[]>({ reducer: (current, next) => [...current, ...next], default: () => [] }),
  })
  const graph = new StateGraph(GraphState)
    .addNode('model', async (state) => {
      if (state.modelTurns >= budget.maxModelTurns) {
        return { phase: 'done', status: 'resumable', error: 'budget_exhausted:maxModelTurns', trace: checkpoint([{ type: 'conversation.budget_exhausted', payload: { reason: 'maxModelTurns' } }]) }
      }
      try {
        const response = await model.complete({
          model: options.modelName ?? 'fake-model',
          messages: state.messages,
          tools: tools.modelTools(),
          capabilities: ['text', 'tool_calls'],
        })
        const toolCalls = response.items.filter((item): item is ToolCall => item.type === 'tool_call')
        const text = response.items.filter((item): item is Extract<ModelResponseItem, { type: 'text' }> => item.type === 'text').map((item) => item.text).join('')
        const assistant: ModelMessage = {
          role: 'assistant',
          content: text,
          ...(toolCalls.length === 0 ? {} : { toolCalls: toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })) }),
        }
        const trace: TraceEvent[] = [{ type: 'conversation.model.completed', payload: { response } }]
        if (response.finishReason === 'error') {
          trace.push({ type: 'conversation.failed', payload: { error: 'model_finished_with_error' } })
          return { phase: 'done', status: 'failed', error: 'model_finished_with_error', modelTurns: state.modelTurns + 1, messages: [...state.messages, assistant], trace: checkpoint(trace) }
        }
        if (response.finishReason === 'length') {
          trace.push({ type: 'conversation.budget_exhausted', payload: { reason: 'model_length' } })
          return { phase: 'done', status: 'resumable', error: 'budget_exhausted:model_length', modelTurns: state.modelTurns + 1, messages: [...state.messages, assistant], trace: checkpoint(trace) }
        }
        if (response.finishReason === 'tool_call' && toolCalls.length === 0) {
          trace.push({ type: 'conversation.failed', payload: { error: 'model_finished_without_tool_call' } })
          return { phase: 'done', status: 'failed', error: 'model_finished_without_tool_call', modelTurns: state.modelTurns + 1, messages: [...state.messages, assistant], trace: checkpoint(trace) }
        }
        if (toolCalls.length === 0) {
          trace.push({ type: 'conversation.completed', payload: { response: text } })
          return { phase: 'done', status: 'completed', response: text, modelTurns: state.modelTurns + 1, messages: [...state.messages, assistant], trace: checkpoint(trace) }
        }
        return { phase: 'tool', modelTurns: state.modelTurns + 1, messages: [...state.messages, assistant], toolCall: toolCalls[0], trace: checkpoint(trace) }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'model_failed'
        return { phase: 'done', status: 'failed', error: message, trace: checkpoint([{ type: 'conversation.failed', payload: { error: message } }]) }
      }
    })
    .addNode('tool', async (state) => {
      const call = state.toolCall
      if (call === undefined) return { phase: 'done', status: 'failed', error: 'tool_call_missing', trace: checkpoint([{ type: 'conversation.failed', payload: { error: 'tool_call_missing' } }]) }
      if (state.toolCallCount >= budget.maxToolCalls) {
        return { phase: 'done', status: 'resumable', error: 'budget_exhausted:maxToolCalls', trace: checkpoint([{ type: 'conversation.budget_exhausted', payload: { reason: 'maxToolCalls' } }]) }
      }
      const definition = tools.get(call.name)
      if (definition === undefined) return { phase: 'done', status: 'failed', error: `unknown tool "${call.name}"`, trace: checkpoint([{ type: 'conversation.failed', payload: { error: `unknown tool "${call.name}"` } }]) }
      const idempotencyKey = tools.idempotencyKey(call.name, call.arguments, { runId: `langgraph:${task.id}`, toolCallId: call.id })
      const trace: TraceEvent[] = [{ type: 'conversation.tool.called', payload: { callId: call.id, name: call.name, arguments: call.arguments, idempotencyKey } }]
      const decision = permissionPolicy.decide({
        runId: `langgraph:${task.id}`,
        toolCallId: call.id,
        toolName: definition.name,
        effectClass: definition.effectClass,
        requiredPermission: definition.requiredPermission,
        input: call.arguments,
      })
      if (decision.status === 'deny') {
        trace.push({ type: 'conversation.tool.denied', payload: { callId: call.id, name: call.name, reason: decision.reason } })
        return { phase: 'model', toolCallCount: state.toolCallCount + 1, messages: [...state.messages, { role: 'tool', toolCallId: call.id, toolName: call.name, content: JSON.stringify({ denied: true, reason: decision.reason }) }], trace: checkpoint(trace) }
      }
      let approvalGranted = false
      if (decision.status === 'requires_approval') {
        approvalGranted = true
        const approvalId = `langgraph:${task.id}:approval:${call.id}`
        store.createApprovalWithEvent({
          approvalId,
          runId: `langgraph:${task.id}`,
          toolCallId: call.id,
          toolName: call.name,
          effectClass: definition.effectClass === 'destructive' ? 'destructive' : 'external',
          idempotencyKey,
          input: call.arguments,
          ...(definition.requiredPermission === undefined ? {} : { requiredPermission: definition.requiredPermission }),
          createdAt: Date.now(),
        }, {
          eventId: `${approvalId}:requested`,
          runId: `langgraph:${task.id}`,
          type: 'conversation.approval.requested',
          occurredAt: Date.now(),
          payload: { approvalId, callId: call.id, name: call.name, reason: decision.reason },
        })
        store.decideApprovalWithEvent(approvalId, 'approved', 'evaluation approval', Date.now(), {
          eventId: `${approvalId}:decided`,
          runId: `langgraph:${task.id}`,
          type: 'conversation.approval.decided',
          occurredAt: Date.now(),
          payload: { approvalId, callId: call.id, decision: 'approved' },
        })
      }
      try {
        const executionContext = { runId: `langgraph:${task.id}`, toolCallId: call.id, idempotencyKey }
        const claim = definition.effectClass === 'read' ? undefined : store.claimEffect({ idempotencyKey, runId: executionContext.runId, effectType: definition.effectClass })
        const output = claim?.status === 'completed'
          ? claim.result
          : (await tools.execute(call.name, call.arguments, executionContext)).output
        const completedEvent = {
          eventId: `${executionContext.runId}:tool:${call.id}:completed`,
          runId: executionContext.runId,
          type: 'conversation.tool.completed',
          occurredAt: Date.now(),
          payload: { callId: call.id, name: call.name, output, idempotencyKey, effectReplayed: claim?.status === 'completed' },
        }
        if (definition.effectClass === 'read') store.appendEvent(completedEvent)
        else store.recordEffectWithEvent({ idempotencyKey, runId: executionContext.runId, effectType: definition.effectClass, result: output, event: completedEvent })
        return { phase: 'model', toolCallCount: state.toolCallCount + 1, approvalCount: state.approvalCount + (approvalGranted ? 1 : 0), messages: [...state.messages, { role: 'tool', toolCallId: call.id, toolName: call.name, content: JSON.stringify(output) }], trace: checkpoint(trace) }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'tool_failed'
        store.appendEvent({ eventId: `langgraph:${task.id}:tool:${call.id}:failed`, runId: `langgraph:${task.id}`, type: 'conversation.tool.failed', occurredAt: Date.now(), payload: { callId: call.id, name: call.name, error: message } })
        return { phase: 'done', status: 'failed', error: message, trace: checkpoint(trace) }
      }
    })
    .addEdge(START, 'model')
    .addConditionalEdges('model', (state) => state.phase, { tool: 'tool', done: END })
    .addConditionalEdges('tool', (state) => state.phase, { model: 'model', done: END })
    .compile()
  const result = await graph.invoke({})
  return {
    status: result.status,
    response: result.response,
    toolCallCount: result.toolCallCount,
    approvalCount: result.approvalCount,
    error: result.error,
    trace: result.trace,
  }
}
