import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FIXED_TASKS } from './corpus.js'
import { runComparison, runLangGraphComparison, runMinimalBaseline } from './runner.js'

const composition = { id: 'evaluation-agent', version: '1.0.0', plugins: [] as const }

describe('fixed Agent Loop comparison', () => {
  const directories: string[] = []

  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('keeps a fixed corpus of 50 tasks and records baseline manifests', async () => {
    expect(FIXED_TASKS).toHaveLength(50)
    expect(new Set(FIXED_TASKS.map((task) => task.id)).size).toBe(50)
    const directory = mkdtempSync(join(tmpdir(), 'ev-agent-evaluation-'))
    directories.push(directory)
    const manifests = await runMinimalBaseline({ databasePath: join(directory, 'baseline.sqlite'), composition })

    expect(manifests).toHaveLength(50)
    expect(manifests.every((manifest) => manifest.status === 'completed' || manifest.status === 'failed')).toBe(true)
    const expectedApprovalTasks = FIXED_TASKS.filter((task) => task.mode === 'approval' || task.mode === 'recovery').length
    expect(manifests.filter((manifest) => manifest.approvalCount > 0)).toHaveLength(expectedApprovalTasks)
    expect(manifests.filter((manifest) => manifest.status === 'failed')).toHaveLength(1)
    expect(manifests.every((manifest) => manifest.rawEvents.length > 0 && manifest.budget.maxModelTurns === 4)).toBe(true)

    const langGraph = await runLangGraphComparison({ composition })
    expect(langGraph).toHaveLength(50)
    expect(langGraph.filter((manifest) => manifest.approvalCount > 0)).toHaveLength(expectedApprovalTasks)
    expect(langGraph.every((manifest) => (manifest.status === 'completed' || manifest.status === 'failed') && manifest.rawEvents.length > 0)).toBe(true)
  })

  it('runs the LangGraph comparison only after producing equivalent fixed-task evidence', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ev-agent-comparison-'))
    directories.push(directory)
    const report = await runComparison({ databasePath: join(directory, 'comparison.sqlite'), composition }, FIXED_TASKS.slice(0, 2))

    expect(report.taskCount).toBe(2)
    expect(report.baseline.map((manifest) => manifest.taskId)).toEqual(report.langGraph.map((manifest) => manifest.taskId))
    expect(report.baseline.map((manifest) => manifest.response)).toEqual(report.langGraph.map((manifest) => manifest.response))
    expect(report.baseline.every((manifest) => manifest.rawEvents.length > 0)).toBe(true)
  })
})
