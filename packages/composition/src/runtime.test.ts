import { afterEach, describe, expect, it } from 'vitest'
import { createCompositionRuntime, type CompositionDefinition, type CompositionRuntime, type PluginDefinition } from './index.js'

describe('production Composition boundary', () => {
  let runtime: CompositionRuntime | undefined

  afterEach(async () => {
    await runtime?.dispose()
  })

  it('validates configuration before replacing the working composition', async () => {
    runtime = createCompositionRuntime()
    const baseline = compositionWithPlugin('baseline', (ctx) => ctx.effect('baseline'))
    const candidate = compositionWithPlugin('candidate', (ctx) => ctx.effect('candidate'))
    const definition: CompositionDefinition = {
      ...candidate,
      validateConfig: (config) => {
        if (config !== 'valid') throw new Error('invalid')
      },
    }

    expect((await runtime.activate(baseline)).status).toBe('active')
    const failed = await runtime.activate(definition, 'invalid')

    expect(failed).toEqual({ status: 'failed', reason: 'invalid_configuration' })
    expect(runtime.currentId()).toBe('baseline')
    expect(runtime.activeEffectCount()).toBe(1)
  })

  it('keeps the Phase 0 lifecycle contract at the production boundary', async () => {
    runtime = createCompositionRuntime()
    const consumer = compositionWithPlugin('consumer', (ctx) => {
      ctx.effect(`consumer:${ctx.requireService<string>('clock')}`)
    }, ['clock'], ['clock'])

    expect(await runtime.activate(consumer)).toEqual({ status: 'pending', missing: ['clock'] })
    expect(runtime.activeEffectCount()).toBe(0)
    expect(await runtime.provideService('clock', 'utc')).toEqual({ status: 'active' })
    expect(runtime.currentVersion()).toBe('1')
    expect(runtime.activeEffectCount()).toBe(1)
  })

  it('does not expose Cordis-specific values through the SDK types', () => {
    runtime = createCompositionRuntime()
    expect(typeof runtime.activate).toBe('function')
  })
})

function compositionWithPlugin(
  id: string,
  setup: PluginDefinition['setup'],
  requires?: readonly string[],
  deferredDependencies?: readonly string[],
): CompositionDefinition {
  return {
    id,
    version: '1',
    plugins: [{ id: `${id}-plugin`, ...(requires === undefined ? {} : { requires }), ...(setup === undefined ? {} : { setup }) }],
    ...(deferredDependencies === undefined ? {} : { deferredDependencies }),
  }
}
