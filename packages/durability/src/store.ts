import { DatabaseSync } from 'node:sqlite'

export type PayloadStatus = 'present' | 'missing' | 'erased'

export interface AppendEventInput {
  readonly eventId: string
  readonly runId: string
  readonly type: string
  readonly occurredAt: number
  readonly payload?: unknown
}

export interface AgentEvent {
  readonly eventId: string
  readonly runId: string
  readonly sequence: number
  readonly type: string
  readonly occurredAt: number
  readonly payloadStatus: PayloadStatus
  readonly payload: unknown | undefined
}

export interface RecordEffectInput {
  readonly idempotencyKey: string
  readonly runId: string
  readonly effectType: string
  readonly result: unknown
}

export interface EffectReceipt {
  readonly idempotencyKey: string
  readonly runId: string
  readonly effectType: string
  readonly result: unknown
  readonly created: boolean
}

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface StoreJobInput {
  readonly jobId: string
  readonly runId: string
  readonly kind: string
  readonly idempotencyKey: string
  readonly input?: unknown
}

export interface PersistentJob {
  readonly jobId: string
  readonly runId: string
  readonly kind: string
  readonly idempotencyKey: string
  readonly status: JobStatus
  readonly attempts: number
  readonly leaseOwner: string | undefined
  readonly leaseUntil: number | undefined
  readonly input: unknown | undefined
  readonly result: unknown | undefined
  readonly error: string | undefined
}

interface EventRow {
  event_id: string
  run_id: string
  sequence: number
  event_type: string
  occurred_at: number
  payload_status: PayloadStatus
  payload_json: string | null
}

interface EffectRow {
  idempotency_key: string
  run_id: string
  effect_type: string
  result_json: string
}

interface JobRow {
  job_id: string
  run_id: string
  kind: string
  idempotency_key: string
  status: JobStatus
  attempts: number
  lease_owner: string | null
  lease_until: number | null
  input_json: string | null
  result_json: string | null
  error: string | null
}

export class DurabilityStore {
  private readonly db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path, { timeout: 5000 })
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_events (
        event_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        payload_status TEXT NOT NULL CHECK (payload_status IN ('present', 'missing', 'erased')),
        UNIQUE (run_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS agent_event_payloads (
        event_id TEXT PRIMARY KEY REFERENCES agent_events (event_id) ON DELETE CASCADE,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_events_run_sequence
        ON agent_events (run_id, sequence);

      CREATE TABLE IF NOT EXISTS effect_receipts (
        idempotency_key TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        effect_type TEXT NOT NULL,
        result_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS persistent_jobs (
        job_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        lease_owner TEXT,
        lease_until INTEGER,
        input_json TEXT,
        result_json TEXT,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS persistent_jobs_claimable
        ON persistent_jobs (status, lease_until, job_id);
    `)
  }

  appendEvent(input: AppendEventInput): AgentEvent {
    this.begin()
    try {
      this.insertEvent(input)
      const event = this.readEvent(input.eventId)
      if (!event) throw new Error(`event "${input.eventId}" was not stored`)
      this.commit()
      return event
    } catch (error) {
      this.rollback()
      throw error
    }
  }

  listEvents(runId: string): readonly AgentEvent[] {
    const rows = this.db.prepare(`
      SELECT e.event_id, e.run_id, e.sequence, e.event_type, e.occurred_at, e.payload_status,
        p.payload_json
      FROM agent_events e
      LEFT JOIN agent_event_payloads p ON p.event_id = e.event_id
      WHERE e.run_id = ?
      ORDER BY e.sequence ASC
    `).all(runId) as unknown as EventRow[]
    return rows.map(toEvent)
  }

  eraseEventPayload(eventId: string): void {
    this.begin()
    try {
      this.db.prepare('DELETE FROM agent_event_payloads WHERE event_id = ?').run(eventId)
      this.db.prepare(`
        UPDATE agent_events
        SET payload_status = 'erased'
        WHERE event_id = ?
      `).run(eventId)
      this.commit()
    } catch (error) {
      this.rollback()
      throw error
    }
  }

  replay<T>(runId: string, initial: T, reducer: (state: T, event: AgentEvent) => T): T {
    return this.listEvents(runId).reduce(reducer, initial)
  }

  recordEffect(input: RecordEffectInput): EffectReceipt {
    this.begin()
    try {
      const changes = this.db.prepare(`
        INSERT INTO effect_receipts (idempotency_key, run_id, effect_type, result_json)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (idempotency_key) DO NOTHING
      `).run(input.idempotencyKey, input.runId, input.effectType, stringify(input.result)).changes
      const row = this.db.prepare(`
        SELECT idempotency_key, run_id, effect_type, result_json
        FROM effect_receipts
        WHERE idempotency_key = ?
      `).get(input.idempotencyKey) as unknown as EffectRow | undefined
      if (!row) throw new Error(`effect "${input.idempotencyKey}" was not stored`)
      this.commit()
      return {
        ...toEffect(row),
        created: changes === 1,
      }
    } catch (error) {
      this.rollback()
      throw error
    }
  }

  getEffect(idempotencyKey: string): EffectReceipt | undefined {
    const row = this.db.prepare(`
      SELECT idempotency_key, run_id, effect_type, result_json
      FROM effect_receipts
      WHERE idempotency_key = ?
    `).get(idempotencyKey) as unknown as EffectRow | undefined
    return row ? { ...toEffect(row), created: false } : undefined
  }

  createJob(input: StoreJobInput): PersistentJob {
    this.db.prepare(`
      INSERT INTO persistent_jobs (job_id, run_id, kind, idempotency_key, status, input_json)
      VALUES (?, ?, ?, ?, 'pending', ?)
      ON CONFLICT (idempotency_key) DO NOTHING
    `).run(
      input.jobId,
      input.runId,
      input.kind,
      input.idempotencyKey,
      input.input === undefined ? null : stringify(input.input),
    )
    const job = this.getJobByIdempotencyKey(input.idempotencyKey)
    if (!job) throw new Error(`job "${input.idempotencyKey}" was not stored`)
    return job
  }

  claimJobForRun(runId: string, workerId: string, now: number, leaseMs: number): PersistentJob | undefined {
    this.begin()
    try {
      this.db.prepare(`
        UPDATE persistent_jobs
        SET status = 'pending', lease_owner = NULL, lease_until = NULL
        WHERE status = 'running' AND lease_until IS NOT NULL AND lease_until <= ?
      `).run(now)
      const row = this.db.prepare(`
        SELECT job_id
        FROM persistent_jobs
        WHERE status = 'pending' AND run_id = ?
        ORDER BY job_id ASC
        LIMIT 1
      `).get(runId) as { job_id: string } | undefined
      if (!row) {
        this.commit()
        return undefined
      }
      this.db.prepare(`
        UPDATE persistent_jobs
        SET status = 'running', attempts = attempts + 1, lease_owner = ?, lease_until = ?
        WHERE job_id = ? AND status = 'pending'
      `).run(workerId, now + leaseMs, row.job_id)
      const job = this.getJob(row.job_id)
      if (!job) throw new Error(`job "${row.job_id}" was not stored`)
      this.commit()
      return job
    } catch (error) {
      this.rollback()
      throw error
    }
  }

  renewJobLease(jobId: string, workerId: string, leaseUntil: number): PersistentJob {
    const changes = this.db.prepare(`
      UPDATE persistent_jobs
      SET lease_until = ?
      WHERE job_id = ? AND status = 'running' AND lease_owner = ?
    `).run(leaseUntil, jobId, workerId).changes
    if (changes !== 1) throw new Error(`job "${jobId}" is not owned by worker "${workerId}"`)
    const job = this.getJob(jobId)
    if (!job) throw new Error(`job "${jobId}" was not stored`)
    return job
  }

  updateJobInput(jobId: string, workerId: string, input: unknown): PersistentJob {
    const changes = this.db.prepare(`
      UPDATE persistent_jobs
      SET input_json = ?
      WHERE job_id = ? AND status = 'running' AND lease_owner = ?
    `).run(stringify(input), jobId, workerId).changes
    if (changes !== 1) throw new Error(`job "${jobId}" is not owned by worker "${workerId}"`)
    const job = this.getJob(jobId)
    if (!job) throw new Error(`job "${jobId}" was not stored`)
    return job
  }

  completeJob(jobId: string, workerId: string, result?: unknown): PersistentJob {
    const changes = this.db.prepare(`
      UPDATE persistent_jobs
      SET status = 'completed', lease_owner = NULL, lease_until = NULL, result_json = ?, error = NULL
      WHERE job_id = ? AND status = 'running' AND lease_owner = ?
    `).run(result === undefined ? null : stringify(result), jobId, workerId).changes
    if (changes !== 1) throw new Error(`job "${jobId}" is not owned by worker "${workerId}"`)
    const job = this.getJob(jobId)
    if (!job) throw new Error(`job "${jobId}" was not stored`)
    return job
  }

  completeJobWithEvent(
    jobId: string,
    workerId: string,
    event: AppendEventInput,
    result?: unknown,
  ): PersistentJob {
    return this.finishJobWithEvent(jobId, workerId, event, 'completed', result)
  }

  failJob(jobId: string, workerId: string, error: string): PersistentJob {
    const changes = this.db.prepare(`
      UPDATE persistent_jobs
      SET status = 'failed', lease_owner = NULL, lease_until = NULL, error = ?
      WHERE job_id = ? AND status = 'running' AND lease_owner = ?
    `).run(error, jobId, workerId).changes
    if (changes !== 1) throw new Error(`job "${jobId}" is not owned by worker "${workerId}"`)
    const job = this.getJob(jobId)
    if (!job) throw new Error(`job "${jobId}" was not stored`)
    return job
  }

  failJobWithEvent(jobId: string, workerId: string, event: AppendEventInput, error: string): PersistentJob {
    return this.finishJobWithEvent(jobId, workerId, event, 'failed', undefined, error)
  }

  getJob(jobId: string): PersistentJob | undefined {
    const row = this.db.prepare(`
      SELECT job_id, run_id, kind, idempotency_key, status, attempts, lease_owner, lease_until,
        input_json, result_json, error
      FROM persistent_jobs
      WHERE job_id = ?
    `).get(jobId) as unknown as JobRow | undefined
    return row ? toJob(row) : undefined
  }

  getJobForRun(runId: string): PersistentJob | undefined {
    const row = this.db.prepare(`
      SELECT job_id, run_id, kind, idempotency_key, status, attempts, lease_owner, lease_until,
        input_json, result_json, error
      FROM persistent_jobs
      WHERE run_id = ?
      ORDER BY job_id ASC
      LIMIT 1
    `).get(runId) as unknown as JobRow | undefined
    return row ? toJob(row) : undefined
  }

  listRecoverableJobs(now: number): readonly PersistentJob[] {
    const rows = this.db.prepare(`
      SELECT job_id, run_id, kind, idempotency_key, status, attempts, lease_owner, lease_until,
        input_json, result_json, error
      FROM persistent_jobs
      WHERE status = 'pending' OR (status = 'running' AND lease_until IS NOT NULL AND lease_until <= ?)
      ORDER BY job_id ASC
    `).all(now) as unknown as JobRow[]
    return rows.map(toJob)
  }

  close(): void {
    if (this.db.isOpen) this.db.close()
  }

  private getJobByIdempotencyKey(idempotencyKey: string): PersistentJob | undefined {
    const row = this.db.prepare(`
      SELECT job_id, run_id, kind, idempotency_key, status, attempts, lease_owner, lease_until,
        input_json, result_json, error
      FROM persistent_jobs
      WHERE idempotency_key = ?
    `).get(idempotencyKey) as unknown as JobRow | undefined
    return row ? toJob(row) : undefined
  }

  private readEvent(eventId: string): AgentEvent | undefined {
    const row = this.db.prepare(`
      SELECT e.event_id, e.run_id, e.sequence, e.event_type, e.occurred_at, e.payload_status,
        p.payload_json
      FROM agent_events
      e LEFT JOIN agent_event_payloads p ON p.event_id = e.event_id
      WHERE e.event_id = ?
    `).get(eventId) as unknown as EventRow | undefined
    return row ? toEvent(row) : undefined
  }

  private finishJobWithEvent(
    jobId: string,
    workerId: string,
    event: AppendEventInput,
    status: 'completed' | 'failed',
    result?: unknown,
    error?: string,
  ): PersistentJob {
    this.begin()
    try {
      this.insertEvent(event)
      const changes = this.db.prepare(`
        UPDATE persistent_jobs
        SET status = ?, lease_owner = NULL, lease_until = NULL, result_json = ?, error = ?
        WHERE job_id = ? AND status = 'running' AND lease_owner = ?
      `).run(
        status,
        result === undefined ? null : stringify(result),
        error ?? null,
        jobId,
        workerId,
      ).changes
      if (changes !== 1) throw new Error(`job "${jobId}" is not owned by worker "${workerId}"`)
      const job = this.getJob(jobId)
      if (!job) throw new Error(`job "${jobId}" was not stored`)
      this.commit()
      return job
    } catch (error) {
      this.rollback()
      throw error
    }
  }

  private insertEvent(input: AppendEventInput): void {
    const payloadStatus: PayloadStatus = input.payload === undefined ? 'missing' : 'present'
    const payloadJson = input.payload === undefined ? null : stringify(input.payload)
    const sequenceRow = this.db.prepare(
      'SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM agent_events WHERE run_id = ?',
    ).get(input.runId) as { next_sequence: number }
    const changes = this.db.prepare(`
      INSERT INTO agent_events (event_id, run_id, sequence, event_type, occurred_at, payload_status)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (event_id) DO NOTHING
    `).run(
      input.eventId,
      input.runId,
      sequenceRow.next_sequence,
      input.type,
      input.occurredAt,
      payloadStatus,
    ).changes
    if (changes === 1) {
      if (payloadJson !== null) {
        this.db.prepare(`
          INSERT INTO agent_event_payloads (event_id, payload_json)
          VALUES (?, ?)
        `).run(input.eventId, payloadJson)
      }
      return
    }

    const existing = this.readEvent(input.eventId)
    if (!existing || existing.runId !== input.runId || existing.type !== input.type) {
      throw new Error(`event "${input.eventId}" conflicts with an existing envelope`)
    }
    const existingPayloadJson = existing.payload === undefined ? null : stringify(existing.payload)
    if (existing.payloadStatus !== payloadStatus || existingPayloadJson !== payloadJson) {
      throw new Error(`event "${input.eventId}" conflicts with an existing payload`)
    }
  }

  private begin(): void {
    this.db.exec('BEGIN IMMEDIATE')
  }

  private commit(): void {
    this.db.exec('COMMIT')
  }

  private rollback(): void {
    if (this.db.isTransaction) this.db.exec('ROLLBACK')
  }
}

function stringify(value: unknown): string {
  const result = JSON.stringify(value)
  if (result === undefined) throw new TypeError('durable values must be JSON serializable')
  return result
}

function parseJson(value: string | null): unknown | undefined {
  return value === null ? undefined : JSON.parse(value) as unknown
}

function toEvent(row: EventRow): AgentEvent {
  return {
    eventId: row.event_id,
    runId: row.run_id,
    sequence: row.sequence,
    type: row.event_type,
    occurredAt: row.occurred_at,
    payloadStatus: row.payload_status,
    payload: parseJson(row.payload_json),
  }
}

function toEffect(row: EffectRow): Omit<EffectReceipt, 'created'> {
  return {
    idempotencyKey: row.idempotency_key,
    runId: row.run_id,
    effectType: row.effect_type,
    result: JSON.parse(row.result_json) as unknown,
  }
}

function toJob(row: JobRow): PersistentJob {
  return {
    jobId: row.job_id,
    runId: row.run_id,
    kind: row.kind,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    attempts: row.attempts,
    leaseOwner: row.lease_owner ?? undefined,
    leaseUntil: row.lease_until ?? undefined,
    input: parseJson(row.input_json),
    result: parseJson(row.result_json),
    error: row.error ?? undefined,
  }
}
