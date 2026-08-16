export type Cleanup = () => void | Promise<void>

export interface PluginContext {
  readonly compositionId: string
  readonly config: unknown
  effect(label: string): void
  getService<T>(name: string): T | undefined
  requireService<T>(name: string): T
}

export interface AgentScope {
  readonly id: string
  set<T>(key: string, value: T): void
  get<T>(key: string): T | undefined
  effect(label: string): void
  effectCount(): number
  dispose(): Promise<void>
}

export interface PluginDefinition {
  readonly id: string
  readonly requires?: readonly string[]
  readonly setup?: (context: PluginContext) => void | Cleanup
}

export interface CompositionDefinition {
  readonly id: string
  readonly version: string
  readonly plugins: readonly PluginDefinition[]
  /** Dependencies that are expected to be supplied after initial activation. */
  readonly deferredDependencies?: readonly string[]
  /** Throws when the candidate configuration cannot be activated. */
  readonly validateConfig?: (config: unknown) => void
}

export type ActivationResult =
  | { readonly status: 'active' }
  | { readonly status: 'pending'; readonly missing: readonly string[] }
  | {
      readonly status: 'failed'
      readonly reason: 'invalid_configuration' | 'missing_dependency' | 'activation_failed'
      readonly missing?: readonly string[]
    }

export interface CompositionRuntime {
  activate(definition: CompositionDefinition, config?: unknown): Promise<ActivationResult>
  provideService(name: string, value: unknown): Promise<ActivationResult>
  deactivate(): Promise<void>
  dispose(): Promise<void>
  currentId(): string | undefined
  currentVersion(): string | undefined
  activeEffectCount(): number
  openAgentScope(id: string): Promise<AgentScope>
}
