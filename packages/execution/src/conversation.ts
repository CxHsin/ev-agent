import {
  createCompositionRuntime,
  type CompositionDefinition,
  type CompositionRuntime,
} from '@ev-agent/composition'
import {
  DurabilityStore,
  type AgentEvent,
  type DurableApproval,
} from '@ev-agent/durability'
import {
  ModelError,
  type ModelAdapter,
  type ModelMessage,
  type ModelResponse,
  type ModelResponseItem,
} from '@ev-agent/model'
import type { EvidenceBundle } from '@ev-agent/personal-context'
import {
  PermissionPolicy,
  ToolRegistry,
  type PermissionDecision,
  type ToolDefinition,
} from './tools.js'

export interface ConversationalRunInput {
  readonly runId: string
  readonly sessionId?: string
  readonly composition: CompositionDefinition
  readonly model: ModelAdapter
  readonly modelName: string
  readonly messages: readonly ModelMessage[]
  readonly tools: ToolRegistry
  readonly permissionPolicy?: PermissionPolicy
  readonly evidenceBundle?: EvidenceBundle
  readonly budget?: ConversationalExecutionBudget
}

export interface ConversationalExecutionBudget {
  readonly maxModelTurns?: number
  readonly maxToolCalls?: number
}

export interface ConversationalApprovalInput extends ConversationalRunInput {
  readonly approvalId: string
  readonly decision: 'approved' | 'denied'
  readonly reason?: string
}

export type ConversationalRunStatus = 'completed' | 'failed' | 'resumable'

export interface ConversationToolRecord {
  readonly callId: string
  readonly name: string
  readonly output?: unknown
  readonly error?: string
}

export interface PendingApprovalSummary {
  readonly approvalId: string
  readonly callId: string
  readonly name: string
  readonly effectClass: 'external' | 'destructive'
  readonly idempotencyKey: string
  readonly arguments: unknown
  readonly reason: string
}

export interface ConversationStateSummary {
  readonly status: 'running' | 'completed' | 'failed'
  readonly response: string
  readonly modelTurns: number
  readonly toolCalls: readonly ConversationToolRecord[]
  readonly pendingApproval?: PendingApprovalSummary
  readonly evidenceBundle?: EvidenceBundle
  readonly error: string | undefined
}

export interface ConversationalRunResult {
  readonly runId: string
  readonly status: ConversationalRunStatus
  readonly summary: ConversationStateSummary
}

export interface ConversationalRunRuntimeOptions {
  readonly databasePath: string
  readonly now?: () => number
}

const DEFAULT_BUDGET: ConversationalExecutionBudget = {}

export class ConversationalRunService {
  private readonly store: DurabilityStore
  private readonly composition: CompositionRuntime
  private readonly now: () => number

  constructor(options: ConversationalRunRuntimeOptions) {
    this.store = new DurabilityStore(options.databasePath)
    this.composition = createCompositionRuntime()
    this.now = options.now ?? (() => Date.now())
  }

  async start(input: ConversationalRunInput): Promise<ConversationalRunResult> {
    const budget = this.safeBudget(input.budget)
    if (budget === undefined) return this.failed(input.runId, 'invalid_execution_budget')
    if (!validEvidenceBundle(input.evidenceBundle, input.runId)) return this.failed(input.runId, 'invalid_evidence_bundle')
    const activated = await this.activate(input)
    if (activated !== undefined) return activated

    const current = this.replay(input.runId)
    if (current.status === 'completed') return { runId: input.runId, status: 'completed', summary: current }
    if (current.status === 'failed') return { runId: input.runId, status: 'failed', summary: current }
    if (this.store.listEvents(input.runId).length === 0) {
      this.store.appendEvent({
        eventId: `${input.runId}:conversation.started`,
        runId: input.runId,
        type: 'conversation.started',
        occurredAt: this.now(),
        payload: {
          ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
        },
      })
    }

    const pending = this.store.listPendingApprovals(input.runId)[0]
    if (pending !== undefined) return this.pendingResult(input.runId)
    const messages = this.rebuildMessages(input.messages, input.runId)
    try {
      await this.recoverApprovedEffects(input, messages)
    } catch (error) {
      return this.failWithEvent(input.runId, error instanceof Error ? error.message : 'effect_recovery_failed')
    }
    return this.runLoop(input, this.rebuildMessages(input.messages, input.runId), budget)
  }

  async decide(input: ConversationalApprovalInput): Promise<ConversationalRunResult> {
    const budget = this.safeBudget(input.budget)
    if (budget === undefined) return this.failed(input.runId, 'invalid_execution_budget')
    if (!validEvidenceBundle(input.evidenceBundle, input.runId)) return this.failed(input.runId, 'invalid_evidence_bundle')
    const activated = await this.activate(input)
    if (activated !== undefined) return activated
    const existing = this.store.getApproval(input.approvalId)
    if (existing === undefined || existing.runId !== input.runId) return this.failed(input.runId, 'approval_not_found')

    const decisionEvent = {
      eventId: `${input.runId}:approval:${input.approvalId}:decided`,
      runId: input.runId,
      type: 'conversation.approval.decided',
      occurredAt: this.now(),
      payload: { approvalId: input.approvalId, decision: input.decision, reason: input.reason },
    }
    const durableDecision = this.store.decideApprovalWithEvent(
      input.approvalId,
      input.decision,
      input.reason,
      this.now(),
      decisionEvent,
    )

    const messages = this.rebuildMessages(input.messages, input.runId)
    try {
      if (durableDecision.approval.status === 'denied') {
        this.recordDeniedApproval(input.runId, durableDecision.approval)
      } else if (durableDecision.approval.status === 'approved') {
        await this.executeApprovedApproval(input, durableDecision.approval, messages)
      }
    } catch (error) {
      return this.failWithEvent(input.runId, error instanceof Error ? error.message : 'effect_recovery_failed')
    }
    return this.runLoop(input, this.rebuildMessages(input.messages, input.runId), budget)
  }

  listEvents(runId: string): readonly AgentEvent[] {
    return this.store.listEvents(runId)
  }

  listApprovals(runId: string): readonly DurableApproval[] {
    return this.store.listApprovals(runId)
  }

  getApproval(approvalId: string): DurableApproval | undefined {
    return this.store.getApproval(approvalId)
  }

  replay(runId: string): ConversationStateSummary {
    return this.store.replay(runId, emptySummary(), reduceConversationEvent)
  }

  async close(): Promise<void> {
    await this.composition.dispose()
    this.store.close()
  }

  private async activate(input: ConversationalRunInput): Promise<ConversationalRunResult | undefined> {
    const activation = await this.composition.activate(input.composition)
    if (activation.status === 'failed') return this.failed(input.runId, activation.reason)
    if (activation.status === 'pending') {
      return {
        runId: input.runId,
        status: 'resumable',
        summary: { ...this.replay(input.runId), error: `missing:${activation.missing.join(',')}` },
      }
    }
    return undefined
  }

  private async runLoop(
    input: ConversationalRunInput,
    messages: ModelMessage[],
    budget: ConversationalExecutionBudget,
  ): Promise<ConversationalRunResult> {
    const permissionPolicy = input.permissionPolicy ?? new PermissionPolicy()
    while (true) {
      const summary = this.replay(input.runId)
      if (summary.status === 'completed') return { runId: input.runId, status: 'completed', summary }
      if (summary.status === 'failed') return { runId: input.runId, status: 'failed', summary }
      if (summary.pendingApproval !== undefined) return this.pendingResult(input.runId)
      if (budget.maxModelTurns !== undefined && summary.modelTurns >= budget.maxModelTurns) return this.budgetExhausted(input.runId, 'maxModelTurns')

      let response: ModelResponse
      try {
        response = await this.completeModel(input, messages, summary.modelTurns)
      } catch (error) {
        if (error instanceof ModelError && error.code === 'interrupted') return this.interruptedWithEvent(input.runId, error.message)
        return this.failWithEvent(input.runId, error instanceof Error ? error.message : 'model_failed')
      }
      this.store.appendEvent({
        eventId: `${input.runId}:model:${summary.modelTurns}`,
        runId: input.runId,
        type: 'conversation.model.completed',
        occurredAt: this.now(),
        payload: { response },
      })

      const toolCalls = response.items.filter((item): item is Extract<ModelResponseItem, { type: 'tool_call' }> => item.type === 'tool_call')
      const text = response.items.filter((item): item is Extract<ModelResponseItem, { type: 'text' }> => item.type === 'text')
        .map((item) => item.text)
        .join('')
      if (response.finishReason === 'error') return this.failWithEvent(input.runId, 'model_finished_with_error')
      if (response.finishReason === 'length') return this.budgetExhausted(input.runId, 'model_length')
      if (response.finishReason === 'tool_call' && toolCalls.length === 0) return this.failWithEvent(input.runId, 'model_finished_without_tool_call')
      if (toolCalls.length === 0) {
        if (input.evidenceBundle !== undefined && !this.hasEvent(input.runId, `${input.runId}:conversation.evidence`)) {
          this.store.appendEvent({
            eventId: `${input.runId}:conversation.evidence`,
            runId: input.runId,
            type: 'conversation.evidence.attached',
            occurredAt: this.now(),
            payload: { bundle: input.evidenceBundle },
          })
        }
        this.store.appendEvent({
          eventId: `${input.runId}:conversation.completed`,
          runId: input.runId,
          type: 'conversation.completed',
          occurredAt: this.now(),
          payload: { response: text },
        })
        return { runId: input.runId, status: 'completed', summary: this.replay(input.runId) }
      }

      const assistantMessage: ModelMessage = {
        role: 'assistant',
        content: text,
        toolCalls: toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
      }
      messages.push(assistantMessage)
      for (const toolCall of toolCalls) {
        const current = this.replay(input.runId)
        if (budget.maxToolCalls !== undefined && current.toolCalls.length >= budget.maxToolCalls) {
          return this.budgetExhausted(input.runId, 'maxToolCalls')
        }
        const definition = input.tools.get(toolCall.name)
        if (definition === undefined) return this.failWithEvent(input.runId, `unknown tool "${toolCall.name}"`)
        const idempotencyKey = input.tools.idempotencyKey(toolCall.name, toolCall.arguments, {
          runId: input.runId,
          toolCallId: toolCall.id,
        })
        this.store.appendEvent({
          eventId: `${input.runId}:tool:${toolCall.id}:called`,
          runId: input.runId,
          type: 'conversation.tool.called',
          occurredAt: this.now(),
          payload: { callId: toolCall.id, name: toolCall.name, arguments: toolCall.arguments, effectClass: definition.effectClass, idempotencyKey },
        })
        const decision = permissionPolicy.decide({
          runId: input.runId,
          toolCallId: toolCall.id,
          toolName: definition.name,
          effectClass: definition.effectClass,
          requiredPermission: definition.requiredPermission,
          input: toolCall.arguments,
        })
        if (decision.status === 'deny') {
          this.recordDeniedTool(input.runId, toolCall.id, definition.name, decision.reason)
          messages.push(toolMessage(toolCall.id, definition.name, { denied: true, reason: decision.reason }))
          continue
        }
        if (decision.status === 'requires_approval') {
          this.requestApproval(input.runId, toolCall.id, definition, toolCall.arguments, idempotencyKey, decision)
          return this.pendingResult(input.runId)
        }
        try {
          await this.executeTool(input, definition, toolCall.id, toolCall.arguments, idempotencyKey, messages)
        } catch (error) {
          return this.failWithEvent(input.runId, error instanceof Error ? error.message : 'tool_failed')
        }
      }
    }
  }

  private async recoverApprovedEffects(input: ConversationalRunInput, messages: ModelMessage[]): Promise<void> {
    for (const approval of this.store.listApprovals(input.runId)) {
      if (approval.status === 'approved') await this.executeApprovedApproval(input, approval, messages)
      if (approval.status === 'denied') this.recordDeniedApproval(input.runId, approval)
    }
  }

  private async completeModel(input: ConversationalRunInput, messages: readonly ModelMessage[], turn: number): Promise<ModelResponse> {
    let completed: ModelResponse | undefined
    let deltaIndex = 0
    const request = {
      model: input.modelName,
      messages,
      tools: input.tools.modelTools(),
      capabilities: ['text', 'tool_calls', 'streaming'] as const,
      stream: true,
    }
    try {
      for await (const event of input.model.stream(request)) {
        if (event.type === 'text_delta' || event.type === 'reasoning_delta') {
          this.store.appendEvent({
            eventId: `${input.runId}:model:${turn}:delta:${deltaIndex++}`,
            runId: input.runId,
            type: event.type === 'text_delta' ? 'conversation.model.text.delta' : 'conversation.model.reasoning.delta',
            occurredAt: this.now(),
            payload: { text: event.text },
          })
        }
        if (event.type === 'failed') throw event.error
        if (event.type === 'completed') completed = event.response
      }
    } catch (error) {
      throw error instanceof Error ? error : new ModelError('model_stream_failed', 'provider_error')
    }
    if (completed === undefined) throw new ModelError('model stream ended without a completed response', 'invalid_response')
    return completed
  }

  private async executeApprovedApproval(input: ConversationalRunInput, approval: DurableApproval, messages: ModelMessage[]): Promise<void> {
    if (this.hasEvent(input.runId, `${input.runId}:tool:${approval.toolCallId}:completed`)) return
    const definition = input.tools.get(approval.toolName)
    if (definition === undefined) {
      this.recordDeniedTool(input.runId, approval.toolCallId, approval.toolName, 'tool_unavailable_after_approval')
      return
    }
    const expectedKey = input.tools.idempotencyKey(approval.toolName, approval.input, {
      runId: input.runId,
      toolCallId: approval.toolCallId,
    })
    if (definition.effectClass !== approval.effectClass
      || definition.requiredPermission !== approval.requiredPermission
      || expectedKey !== approval.idempotencyKey) {
      this.recordDeniedTool(input.runId, approval.toolCallId, approval.toolName, 'approved_tool_definition_changed')
      return
    }
    await this.executeTool(input, definition, approval.toolCallId, approval.input, approval.idempotencyKey, messages)
  }

  private async executeTool(
    input: ConversationalRunInput,
    definition: ToolDefinition,
    callId: string,
    argumentsValue: unknown,
    idempotencyKey: string,
    messages: ModelMessage[],
  ): Promise<void> {
    const claim = definition.effectClass === 'read'
      ? undefined
      : this.store.claimEffect({ idempotencyKey, runId: input.runId, effectType: definition.effectClass })
    let output: unknown
    let effectReplayed = claim?.status === 'completed'
    let recoveredOutput: unknown
    let hasRecoveredOutput = false
    if (claim !== undefined && claim.status === 'started' && !claim.created) {
      const recovery = definition.recoverEffect === undefined
        ? { status: 'unknown' as const }
        : await definition.recoverEffect({ runId: input.runId, toolCallId: callId, idempotencyKey })
      if (recovery.status === 'unknown') throw new ModelError('external effect could not be reconciled safely', 'provider_error')
      if (recovery.status === 'completed') {
        recoveredOutput = recovery.output
        hasRecoveredOutput = true
      }
    }
    try {
      if (claim?.status === 'completed') {
        output = claim.result
      } else if (hasRecoveredOutput) {
        output = recoveredOutput
      } else {
        output = (await input.tools.execute(definition.name, argumentsValue, { runId: input.runId, toolCallId: callId, idempotencyKey })).output
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'tool_failed'
      this.store.appendEvent({
        eventId: `${input.runId}:tool:${callId}:failed`,
        runId: input.runId,
        type: 'conversation.tool.failed',
        occurredAt: this.now(),
        payload: { callId, name: definition.name, error: message },
      })
      throw new ModelError(message, 'provider_error')
    }
    const completedEvent = {
      eventId: `${input.runId}:tool:${callId}:completed`,
      runId: input.runId,
      type: 'conversation.tool.completed',
      occurredAt: this.now(),
      payload: { callId, name: definition.name, output, effectReplayed, idempotencyKey },
    }
    let storedOutput = output
    if (definition.effectClass === 'read') {
      this.store.appendEvent({ ...completedEvent, payload: { ...completedEvent.payload, output } })
    } else {
      const receipt = this.store.recordEffectWithEvent({
        idempotencyKey,
        runId: input.runId,
        effectType: definition.effectClass,
        result: output,
        event: { ...completedEvent, payload: { ...completedEvent.payload, output } },
      })
      storedOutput = receipt.result
    }
    messages.push(toolMessage(callId, definition.name, storedOutput))
  }

  private requestApproval(
    runId: string,
    callId: string,
    definition: ToolDefinition,
    argumentsValue: unknown,
    idempotencyKey: string,
    decision: Extract<PermissionDecision, { status: 'requires_approval' }>,
  ): void {
    const approvalId = `${runId}:approval:${callId}`
    const approvalEvent = {
      eventId: `${runId}:approval:${approvalId}:requested`,
      runId,
      type: 'conversation.approval.requested',
      occurredAt: this.now(),
      payload: {
        approvalId,
        callId,
        name: definition.name,
        effectClass: definition.effectClass,
        idempotencyKey,
        arguments: argumentsValue,
        reason: decision.reason,
      },
    }
    this.store.createApprovalWithEvent({
      approvalId,
      runId,
      toolCallId: callId,
      toolName: definition.name,
      effectClass: definition.effectClass as 'external' | 'destructive',
      idempotencyKey,
      input: argumentsValue,
      ...(definition.requiredPermission === undefined ? {} : { requiredPermission: definition.requiredPermission }),
      createdAt: this.now(),
    }, approvalEvent)
  }

  private budgetExhausted(runId: string, reason: 'maxModelTurns' | 'maxToolCalls' | 'model_length'): ConversationalRunResult {
    const eventId = `${runId}:conversation.budget_exhausted:${reason}`
    if (!this.hasEvent(runId, eventId)) {
      this.store.appendEvent({
        eventId,
        runId,
        type: 'conversation.budget_exhausted',
        occurredAt: this.now(),
        payload: { reason },
      })
    }
    return { runId, status: 'resumable', summary: this.replay(runId) }
  }

  private interruptedWithEvent(runId: string, reason: string): ConversationalRunResult {
    const eventId = `${runId}:conversation.interrupted`
    if (!this.hasEvent(runId, eventId)) {
      this.store.appendEvent({
        eventId,
        runId,
        type: 'conversation.interrupted',
        occurredAt: this.now(),
        payload: { reason },
      })
    }
    return { runId, status: 'resumable', summary: this.replay(runId) }
  }

  private recordDeniedApproval(runId: string, approval: DurableApproval): void {
    this.recordDeniedTool(runId, approval.toolCallId, approval.toolName, approval.decisionReason ?? 'approval_denied')
  }

  private recordDeniedTool(runId: string, callId: string, name: string, reason: string): void {
    if (this.hasEvent(runId, `${runId}:tool:${callId}:denied`)) return
    this.store.appendEvent({
      eventId: `${runId}:tool:${callId}:denied`,
      runId,
      type: 'conversation.tool.denied',
      occurredAt: this.now(),
      payload: { callId, name, reason },
    })
  }

  private hasEvent(runId: string, eventId: string): boolean {
    return this.store.listEvents(runId).some((event) => event.eventId === eventId)
  }

  private pendingResult(runId: string): ConversationalRunResult {
    return { runId, status: 'resumable', summary: this.replay(runId) }
  }

  private failed(runId: string, reason: string): ConversationalRunResult {
    return { runId, status: 'failed', summary: { ...emptySummary(), status: 'failed', error: reason } }
  }

  private failWithEvent(runId: string, error: string): ConversationalRunResult {
    if (!this.hasEvent(runId, `${runId}:conversation.failed`)) {
      this.store.appendEvent({
        eventId: `${runId}:conversation.failed`,
        runId,
        type: 'conversation.failed',
        occurredAt: this.now(),
        payload: { error },
      })
    }
    return this.failed(runId, error)
  }

  private safeBudget(budget: ConversationalExecutionBudget | undefined): ConversationalExecutionBudget | undefined {
    const value = budget ?? DEFAULT_BUDGET
    if ((value.maxModelTurns !== undefined && (!Number.isSafeInteger(value.maxModelTurns) || value.maxModelTurns < 0))
      || (value.maxToolCalls !== undefined && (!Number.isSafeInteger(value.maxToolCalls) || value.maxToolCalls < 0))) return undefined
    return value
  }

  private rebuildMessages(initial: readonly ModelMessage[], runId: string): ModelMessage[] {
    const messages = [...initial]
    for (const event of this.store.listEvents(runId)) {
      if (event.payloadStatus !== 'present') continue
      const payload = event.payload as Record<string, unknown>
      if (event.type === 'conversation.model.completed') {
        const response = asModelResponse(payload.response)
        if (!response) continue
        const toolCalls = response.items.filter((item): item is Extract<ModelResponseItem, { type: 'tool_call' }> => item.type === 'tool_call')
        const text = response.items.filter((item): item is Extract<ModelResponseItem, { type: 'text' }> => item.type === 'text')
          .map((item) => item.text)
          .join('')
        messages.push({
          role: 'assistant',
          content: text,
          ...(toolCalls.length === 0 ? {} : { toolCalls: toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })) }),
        })
      }
      if (event.type === 'conversation.tool.completed' || event.type === 'conversation.tool.denied' || event.type === 'conversation.tool.failed') {
        const callId = typeof payload.callId === 'string' ? payload.callId : 'unknown'
        const name = typeof payload.name === 'string' ? payload.name : 'unknown'
        const content = event.type === 'conversation.tool.completed'
          ? payload.output
          : { error: typeof payload.error === 'string' ? payload.error : typeof payload.reason === 'string' ? payload.reason : 'tool_failed' }
        messages.push(toolMessage(callId, name, content))
      }
    }
    return messages
  }
}

function toolMessage(callId: string, name: string, output: unknown): ModelMessage {
  return {
    role: 'tool',
    toolCallId: callId,
    toolName: name,
    content: serializeToolOutput(output),
  }
}

function serializeToolOutput(output: unknown): string {
  try {
    return JSON.stringify(output)
  } catch {
    return '[unserializable tool output]'
  }
}

function validEvidenceBundle(bundle: EvidenceBundle | undefined, runId: string): boolean {
  return bundle === undefined || bundle.runId === runId
}

function emptySummary(): ConversationStateSummary {
  return { status: 'running', response: '', modelTurns: 0, toolCalls: [], error: undefined }
}

function reduceConversationEvent(summary: ConversationStateSummary, event: AgentEvent): ConversationStateSummary {
  if (event.payloadStatus !== 'present') return summary
  const payload = event.payload as Record<string, unknown>
  if (event.type === 'conversation.model.completed') return { ...summary, modelTurns: summary.modelTurns + 1, error: undefined }
  if (event.type === 'conversation.tool.completed') {
    const callId = typeof payload.callId === 'string' ? payload.callId : 'unknown'
    const name = typeof payload.name === 'string' ? payload.name : 'unknown'
    return {
      ...summary,
      toolCalls: [...summary.toolCalls, { callId, name, ...(payload.output === undefined ? {} : { output: payload.output }) }],
    }
  }
  if (event.type === 'conversation.tool.failed') {
    const callId = typeof payload.callId === 'string' ? payload.callId : 'unknown'
    const name = typeof payload.name === 'string' ? payload.name : 'unknown'
    return {
      ...summary,
      toolCalls: [...summary.toolCalls, { callId, name, error: typeof payload.error === 'string' ? payload.error : 'tool_failed' }],
    }
  }
  if (event.type === 'conversation.tool.denied') {
    const callId = typeof payload.callId === 'string' ? payload.callId : 'unknown'
    const name = typeof payload.name === 'string' ? payload.name : 'unknown'
    return {
      ...summary,
      toolCalls: [...summary.toolCalls, { callId, name, error: typeof payload.reason === 'string' ? payload.reason : 'approval_denied' }],
    }
  }
  if (event.type === 'conversation.approval.requested') {
    return {
      ...summary,
      pendingApproval: {
        approvalId: typeof payload.approvalId === 'string' ? payload.approvalId : 'unknown',
        callId: typeof payload.callId === 'string' ? payload.callId : 'unknown',
        name: typeof payload.name === 'string' ? payload.name : 'unknown',
        effectClass: payload.effectClass === 'destructive' ? 'destructive' : 'external',
        idempotencyKey: typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey : 'unknown',
        arguments: payload.arguments,
        reason: typeof payload.reason === 'string' ? payload.reason : 'approval_required',
      },
    }
  }
  if (event.type === 'conversation.evidence.attached') {
    return { ...summary, evidenceBundle: payload.bundle as EvidenceBundle }
  }
  if (event.type === 'conversation.approval.decided') return clearPendingApproval(summary)
  if (event.type === 'conversation.budget_exhausted') {
    return { ...summary, error: `budget_exhausted:${typeof payload.reason === 'string' ? payload.reason : 'unknown'}` }
  }
  if (event.type === 'conversation.interrupted') {
    return { ...summary, error: `interrupted:${typeof payload.reason === 'string' ? payload.reason : 'unknown'}` }
  }
  if (event.type === 'conversation.completed') {
    return clearPendingApproval({ ...summary, status: 'completed', response: typeof payload.response === 'string' ? payload.response : '' })
  }
  if (event.type === 'conversation.failed') {
    return clearPendingApproval({ ...summary, status: 'failed', error: typeof payload.error === 'string' ? payload.error : 'conversation_failed' })
  }
  return summary
}

function clearPendingApproval(summary: ConversationStateSummary): ConversationStateSummary {
  const { pendingApproval: _pendingApproval, ...withoutPending } = summary
  return withoutPending
}

function asModelResponse(value: unknown): ModelResponse | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const response = value as Partial<ModelResponse>
  if (typeof response.responseId !== 'string' || typeof response.provider !== 'string' || typeof response.model !== 'string' || !Array.isArray(response.items)) return undefined
  return response as ModelResponse
}
