import type { ModelTool } from '@ev-agent/model'

export type ToolEffectClass = 'read' | 'external' | 'destructive'

export interface ToolValidationFailure {
  readonly valid: false
  readonly error: string
}

export interface ToolValidationSuccess {
  readonly valid: true
}

export type ToolValidationResult = ToolValidationFailure | ToolValidationSuccess

export interface ToolExecutionContext {
  readonly runId: string
  readonly toolCallId: string
  readonly idempotencyKey: string
}

export type ToolRecoveryResult<Output = unknown> =
  | { readonly status: 'completed'; readonly output: Output }
  | { readonly status: 'not_started' }
  | { readonly status: 'unknown' }

export interface ToolDefinition<Input = unknown, Output = unknown> {
  readonly name: string
  readonly description: string
  readonly inputSchema: unknown
  readonly effectClass: ToolEffectClass
  readonly requiredPermission?: string
  readonly idempotencyKey?: (input: unknown, context: ToolExecutionContext) => string
  readonly validateInput: (input: unknown) => ToolValidationResult
  readonly validateOutput: (output: unknown) => ToolValidationResult
  readonly execute: (input: Input, context: ToolExecutionContext) => Output | Promise<Output>
  readonly recoverEffect?: (context: ToolExecutionContext) => ToolRecoveryResult<Output> | Promise<ToolRecoveryResult<Output>>
}

export interface ToolExecutionResult {
  readonly name: string
  readonly output: unknown
}

export interface PermissionRequest {
  readonly runId: string
  readonly toolCallId: string
  readonly toolName: string
  readonly effectClass: ToolEffectClass
  readonly requiredPermission: string | undefined
  readonly input: unknown
}

export type PermissionDecision =
  | { readonly status: 'allow' }
  | { readonly status: 'deny'; readonly reason: string }
  | { readonly status: 'requires_approval'; readonly reason: string }

export interface PermissionGrant {
  readonly toolName: string
  readonly permission?: string
  readonly matchesInput: (input: unknown) => boolean
}

export interface PermissionPolicyOptions {
  readonly grants?: readonly PermissionGrant[]
  readonly deniedTools?: readonly string[]
}

export class PermissionPolicy {
  private readonly grants: PermissionGrant[]
  private readonly deniedTools: ReadonlySet<string>

  constructor(options: PermissionPolicyOptions = {}) {
    this.grants = [...(options.grants ?? [])]
    this.deniedTools = new Set(options.deniedTools ?? [])
  }

  decide(request: PermissionRequest): PermissionDecision {
    if (this.deniedTools.has(request.toolName)) return { status: 'deny', reason: 'tool_denied_by_policy' }
    if (request.effectClass === 'read') return { status: 'allow' }
    const granted = this.grants.some((grant) => grant.toolName === request.toolName
      && (grant.permission === undefined || grant.permission === request.requiredPermission)
      && grant.matchesInput(request.input))
    if (granted) return { status: 'allow' }
    return { status: 'requires_approval', reason: 'external_effect_requires_approval' }
  }
}

export class ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition>()

  register<Input, Output>(definition: ToolDefinition<Input, Output>): void {
    if (this.definitions.has(definition.name)) throw new Error(`tool "${definition.name}" is already registered`)
    if (definition.name.length === 0) throw new Error('tool name is required')
    this.definitions.set(definition.name, definition as ToolDefinition)
  }

  get(name: string): ToolDefinition | undefined {
    return this.definitions.get(name)
  }

  list(): readonly ToolDefinition[] {
    return [...this.definitions.values()]
  }

  modelTools(): readonly ModelTool[] {
    return this.list().map((definition) => ({
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema,
    }))
  }

  async execute(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const definition = this.definitions.get(name)
    if (!definition) throw new Error(`unknown tool "${name}"`)
    const validation = definition.validateInput(input)
    if (!validation.valid) throw new Error(`invalid input for tool "${name}": ${validation.error}`)
    const output = await definition.execute(input, context)
    const outputValidation = definition.validateOutput(output)
    if (!outputValidation.valid) throw new Error(`invalid output for tool "${name}": ${outputValidation.error}`)
    return { name, output }
  }

  idempotencyKey(name: string, input: unknown, context: Omit<ToolExecutionContext, 'idempotencyKey'>): string {
    const definition = this.definitions.get(name)
    if (!definition) throw new Error(`unknown tool "${name}"`)
    const fullContext: ToolExecutionContext = {
      ...context,
      idempotencyKey: `${context.runId}:${name}:${context.toolCallId}`,
    }
    return definition.idempotencyKey?.(input, fullContext) ?? fullContext.idempotencyKey
  }
}

export function validToolInput(): ToolValidationSuccess {
  return { valid: true }
}

export function invalidToolInput(error: string): ToolValidationFailure {
  return { valid: false, error }
}

export function validToolOutput(): ToolValidationSuccess {
  return { valid: true }
}

export function invalidToolOutput(error: string): ToolValidationFailure {
  return { valid: false, error }
}
