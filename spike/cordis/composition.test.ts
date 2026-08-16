import { afterEach, describe, expect, it } from 'vitest'
import {
  createCompositionRuntime,
  type CompositionDefinition,
  type CompositionRuntime,
  type PluginDefinition,
} from './composition.js'

describe('Cordis Composition decision spike', () => {
  let runtime: CompositionRuntime | undefined

  afterEach(async () => {
    await runtime?.dispose()
  })

  it('loads and unloads a composition through a Cordis-independent boundary', async () => {
    runtime = createCompositionRuntime()
    const composition = compositionWithPlugin('baseline', (ctx) => {
      ctx.effect('baseline-effect')
    })

    const result = await runtime.activate(composition)

    expect(result.status).toBe('active')
    expect(runtime.currentId()).toBe('baseline')
    expect(runtime.activeEffectCount()).toBe(1)

    await runtime.deactivate()

    expect(runtime.currentId()).toBeUndefined()
    expect(runtime.activeEffectCount()).toBe(0)
  })

  it('keeps a plugin pending and resumes it when a dependency appears', async () => {
    runtime = createCompositionRuntime()
    const consumer = compositionWithPlugin('consumer', (ctx) => {
      ctx.effect(`consumer:${ctx.requireService<string>('clock')}`)
    }, ['clock'], ['clock'])

    const pending = await runtime.activate(consumer)

    expect(pending.status).toBe('pending')
    expect(runtime.currentId()).toBeUndefined()
    expect(runtime.activeEffectCount()).toBe(0)

    const resumed = await runtime.provideService('clock', 'utc')

    expect(resumed.status).toBe('active')
    expect(runtime.currentId()).toBe('consumer')
    expect(runtime.activeEffectCount()).toBe(1)
  })

  it('reports an unresolved dependency without partially activating the composition', async () => {
    runtime = createCompositionRuntime()
    const consumer = compositionWithPlugin('unresolved', (ctx) => {
      ctx.effect('should-not-run')
    }, ['never'])

    const result = await runtime.activate(consumer)

    expect(result).toMatchObject({ status: 'failed', reason: 'missing_dependency' })
    expect(runtime.currentId()).toBeUndefined()
    expect(runtime.activeEffectCount()).toBe(0)
  })

  it('disposes effects on replacement, failed activation, and repeated unload cycles', async () => {
    runtime = createCompositionRuntime()
    const baseline = compositionWithPlugin('baseline', (ctx) => {
      ctx.effect('baseline-effect')
    })
    const candidate = compositionWithPlugin('candidate', (ctx) => {
      ctx.effect('candidate-effect')
      throw new Error('candidate setup failed')
    })

    await runtime.activate(baseline)
    expect(runtime.activeEffectCount()).toBe(1)

    const failed = await runtime.activate(candidate)

    expect(failed.status).toBe('failed')
    expect(runtime.currentId()).toBe('baseline')
    expect(runtime.activeEffectCount()).toBe(1)

    for (let index = 0; index < 1000; index += 1) {
      await runtime.deactivate()
      await runtime.activate(baseline)
    }
    await runtime.deactivate()

    expect(runtime.activeEffectCount()).toBe(0)
  })

  it('isolates Agent scope state and effects', async () => {
    runtime = createCompositionRuntime()
    await runtime.activate(compositionWithPlugin('scoped'))

    const first = runtime.openAgentScope('first')
    const second = runtime.openAgentScope('second')
    first.set('focus', 'one')
    second.set('focus', 'two')
    first.effect('first-effect')
    second.effect('second-effect')

    expect(first.get('focus')).toBe('one')
    expect(second.get('focus')).toBe('two')
    expect(first.effectCount()).toBe(1)
    expect(second.effectCount()).toBe(1)

    await first.dispose()

    expect(first.effectCount()).toBe(0)
    expect(second.get('focus')).toBe('two')
    expect(second.effectCount()).toBe(1)
    expect(() => first.set('focus', 'after-dispose')).toThrow(/disposed/)
    expect(() => first.effect('after-dispose')).toThrow(/disposed/)
  })

  it('rolls back invalid configuration while preserving the working composition', async () => {
    runtime = createCompositionRuntime()
    const baseline = compositionWithPlugin('baseline', (ctx) => {
      ctx.effect('baseline-effect')
    })
    const invalid = compositionWithPlugin('invalid', (ctx) => {
      ctx.effect('invalid-effect')
    })

    await runtime.activate(baseline)
    const result = await runtime.activate(invalid, { valid: false })

    expect(result).toMatchObject({ status: 'failed', reason: 'invalid_configuration' })
    expect(runtime.currentId()).toBe('baseline')
    expect(runtime.activeEffectCount()).toBe(1)
  })
})

function compositionWithPlugin(
  id: string,
  setup?: PluginDefinition['setup'],
  requires?: readonly string[],
  deferredDependencies?: readonly string[],
): CompositionDefinition {
  return {
    id,
    ...(deferredDependencies === undefined ? {} : { deferredDependencies }),
    plugins: [{
        id: `${id}-plugin`,
        ...(requires === undefined ? {} : { requires }),
        ...(setup === undefined ? {} : { setup }),
      }],
  }
}
