export interface FakeModelStep {
  readonly text: string
  readonly failure?: string
  readonly effect?: {
    readonly idempotencyKey: string
    readonly type: string
    readonly result: unknown
  }
}

export class ScriptedFakeModel {
  private readonly steps: readonly FakeModelStep[]

  constructor(steps: readonly FakeModelStep[]) {
    this.steps = steps
  }

  step(index: number): FakeModelStep | undefined {
    return this.steps[index]
  }
}
