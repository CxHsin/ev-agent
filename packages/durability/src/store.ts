import { DatabaseSync } from 'node:sqlite'
import type {
  DurableClaim,
  DurableEvidenceBundle,
  DurableEvidenceItem,
  DurableMemoryCandidate,
  MemoryCandidateStatus,
  StoreEvidenceBundleInput,
  StoreMemoryCandidateInput,
} from './memory.js'
import type {
  DurableSession,
  DurableSessionMessage,
  StoreSessionInput,
  StoreSessionMessageInput,
} from './session.js'

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

export type EffectClaimStatus = 'started' | 'completed'

export interface EffectClaim {
  readonly idempotencyKey: string
  readonly runId: string
  readonly effectType: string
  readonly status: EffectClaimStatus
  readonly result: unknown | undefined
  readonly created: boolean
}

export interface RecordEffectEventInput extends RecordEffectInput {
  readonly event: AppendEventInput
}

export type ApprovalStatus = 'pending' | 'approved' | 'denied'

export interface StoreApprovalInput {
  readonly approvalId: string
  readonly runId: string
  readonly toolCallId: string
  readonly toolName: string
  readonly effectClass: 'external' | 'destructive'
  readonly idempotencyKey: string
  readonly input: unknown
  readonly requiredPermission?: string
  readonly createdAt: number
}

export interface DurableApproval {
  readonly approvalId: string
  readonly runId: string
  readonly toolCallId: string
  readonly toolName: string
  readonly effectClass: 'external' | 'destructive'
  readonly idempotencyKey: string
  readonly input: unknown
  readonly requiredPermission: string | undefined
  readonly status: ApprovalStatus
  readonly decisionReason: string | undefined
  readonly createdAt: number
  readonly decidedAt: number | undefined
}

export interface ApprovalDecisionResult {
  readonly approval: DurableApproval
  readonly changed: boolean
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

interface EffectIntentRow {
  idempotency_key: string
  run_id: string
  effect_type: string
  status: EffectClaimStatus
  result_json: string | null
}

interface ApprovalRow {
  approval_id: string
  run_id: string
  tool_call_id: string
  tool_name: string
  effect_class: 'external' | 'destructive'
  idempotency_key: string
  input_json: string
  required_permission: string | null
  status: ApprovalStatus
  decision_reason: string | null
  created_at: number
  decided_at: number | null
}

interface MemoryCandidateRow {
  candidate_id: string
  agent_scope_id: string
  memory_kind: import('./memory.js').MemoryKind
  claim_key: string
  content: string
  source: string
  scope: string
  confidence: number
  sensitive: number
  status: MemoryCandidateStatus
  decision_reason: string | null
  created_at: number
  decided_at: number | null
}

interface ClaimRow {
  claim_id: string
  candidate_id: string
  agent_scope_id: string
  memory_kind: import('./memory.js').MemoryKind
  claim_key: string
  content: string
  source: string
  scope: string
  confidence: number
  sensitive: number
  accepted_at: number
}

interface EvidenceItemRow {
  item_id: string
  reference_type: 'claim' | 'event'
  reference_id: string
  source: string
  applicability: string
  confidence: number
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
      CREATE TABLE IF NOT EXISTS effect_intents (
        idempotency_key TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        effect_type TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('started', 'completed')),
        result_json TEXT
      );

      CREATE TABLE IF NOT EXISTS permission_approvals (
        approval_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        tool_call_id TEXT NOT NULL UNIQUE,
        tool_name TEXT NOT NULL,
        effect_class TEXT NOT NULL CHECK (effect_class IN ('external', 'destructive')),
        idempotency_key TEXT NOT NULL UNIQUE,
        input_json TEXT NOT NULL,
        required_permission TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')),
        decision_reason TEXT,
        created_at INTEGER NOT NULL,
        decided_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS permission_approvals_run_status
        ON permission_approvals (run_id, status, created_at);

      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        agent_definition_id TEXT NOT NULL,
        agent_definition_version TEXT NOT NULL,
        agent_definition_fingerprint TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_messages (
        message_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions (session_id) ON DELETE CASCADE,
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (session_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS session_messages_session_sequence
        ON session_messages (session_id, sequence);

      CREATE TABLE IF NOT EXISTS memory_candidates (
        candidate_id TEXT PRIMARY KEY,
        agent_scope_id TEXT NOT NULL,
        memory_kind TEXT NOT NULL CHECK (memory_kind IN ('episodic', 'semantic', 'procedural', 'working')),
        claim_key TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        scope TEXT NOT NULL,
        confidence REAL NOT NULL,
        sensitive INTEGER NOT NULL CHECK (sensitive IN (0, 1)),
        status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
        decision_reason TEXT,
        created_at INTEGER NOT NULL,
        decided_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS memory_candidates_scope_status
        ON memory_candidates (agent_scope_id, scope, status, claim_key);
      CREATE TABLE IF NOT EXISTS memory_claims (
        claim_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL UNIQUE REFERENCES memory_candidates (candidate_id) ON DELETE CASCADE,
        agent_scope_id TEXT NOT NULL,
        memory_kind TEXT NOT NULL,
        claim_key TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        scope TEXT NOT NULL,
        confidence REAL NOT NULL,
        sensitive INTEGER NOT NULL CHECK (sensitive IN (0, 1)),
        accepted_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evidence_bundles (
        bundle_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evidence_items (
        item_id TEXT PRIMARY KEY,
        bundle_id TEXT NOT NULL REFERENCES evidence_bundles (bundle_id) ON DELETE CASCADE,
        reference_type TEXT NOT NULL CHECK (reference_type IN ('claim', 'event')),
        reference_id TEXT NOT NULL,
        source TEXT NOT NULL,
        applicability TEXT NOT NULL,
        confidence REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS evidence_items_bundle
        ON evidence_items (bundle_id, item_id);

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

  getEvent(eventId: string): AgentEvent | undefined {
    const row = this.readEvent(eventId)
    return row
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

  eraseSessionMessage(messageId: string): void {
    this.begin()
    try {
      this.db.prepare(`UPDATE session_messages SET content = '[erased]' WHERE message_id = ?`).run(messageId)
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

  claimEffect(input: Omit<RecordEffectInput, 'result'>): EffectClaim {
    this.begin()
    try {
      const existingReceipt = this.db.prepare(`
        SELECT idempotency_key, run_id, effect_type, result_json
        FROM effect_receipts
        WHERE idempotency_key = ?
      `).get(input.idempotencyKey) as EffectRow | undefined
      if (existingReceipt) {
        this.commit()
        return {
          idempotencyKey: existingReceipt.idempotency_key,
          runId: existingReceipt.run_id,
          effectType: existingReceipt.effect_type,
          status: 'completed',
          result: JSON.parse(existingReceipt.result_json),
          created: false,
        }
      }
      const changes = this.db.prepare(`
        INSERT INTO effect_intents (idempotency_key, run_id, effect_type, status)
        VALUES (?, ?, ?, 'started')
        ON CONFLICT (idempotency_key) DO NOTHING
      `).run(input.idempotencyKey, input.runId, input.effectType).changes
      const row = this.db.prepare(`
        SELECT idempotency_key, run_id, effect_type, status, result_json
        FROM effect_intents
        WHERE idempotency_key = ?
      `).get(input.idempotencyKey) as EffectIntentRow | undefined
      if (!row) throw new Error(`effect intent "${input.idempotencyKey}" was not stored`)
      this.commit()
      return {
        idempotencyKey: row.idempotency_key,
        runId: row.run_id,
        effectType: row.effect_type,
        status: row.status,
        result: row.result_json === null ? undefined : JSON.parse(row.result_json),
        created: changes === 1,
      }
    } catch (error) {
      this.rollback()
      throw error
    }
  }

  recordEffectWithEvent(input: RecordEffectEventInput): EffectReceipt {
    this.begin()
    try {
      const receipt = this.recordEffectWithinTransaction(input)
      this.db.prepare(`
        UPDATE effect_intents
        SET status = 'completed', result_json = ?
        WHERE idempotency_key = ?
      `).run(stringify(receipt.result), input.idempotencyKey)
      this.insertEvent(input.event)
      this.commit()
      return receipt
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

  createApproval(input: StoreApprovalInput): DurableApproval {
    this.db.prepare(`
      INSERT INTO permission_approvals (
        approval_id, run_id, tool_call_id, tool_name, effect_class, idempotency_key,
        input_json, required_permission, status, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      ON CONFLICT (approval_id) DO NOTHING
    `).run(
      input.approvalId,
      input.runId,
      input.toolCallId,
      input.toolName,
      input.effectClass,
      input.idempotencyKey,
      stringify(input.input),
      input.requiredPermission ?? null,
      input.createdAt,
    )
    const approval = this.getApproval(input.approvalId)
    if (!approval) throw new Error(`approval "${input.approvalId}" was not stored`)
    if (approval.runId !== input.runId || approval.toolCallId !== input.toolCallId || approval.idempotencyKey !== input.idempotencyKey) {
      throw new Error(`approval "${input.approvalId}" conflicts with an existing request`)
    }
    return approval
  }

  createApprovalWithEvent(input: StoreApprovalInput, event: AppendEventInput): DurableApproval {
    this.begin()
    try {
      const approval = this.createApproval(input)
      this.insertEvent(event)
      this.commit()
      return approval
    } catch (error) {
      this.rollback()
      throw error
    }
  }

  getApproval(approvalId: string): DurableApproval | undefined {
    const row = this.db.prepare(`
      SELECT approval_id, run_id, tool_call_id, tool_name, effect_class, idempotency_key,
        input_json, required_permission, status, decision_reason, created_at, decided_at
      FROM permission_approvals
      WHERE approval_id = ?
    `).get(approvalId) as unknown as ApprovalRow | undefined
    return row ? toApproval(row) : undefined
  }

  listPendingApprovals(runId: string): readonly DurableApproval[] {
    return this.listApprovals(runId).filter((approval) => approval.status === 'pending')
  }

  createSession(input: StoreSessionInput): DurableSession {
    this.db.prepare(`
      INSERT INTO sessions (session_id, agent_definition_id, agent_definition_version, agent_definition_fingerprint, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (session_id) DO NOTHING
    `).run(
      input.sessionId,
      input.agentDefinitionId,
      input.agentDefinitionVersion,
      input.agentDefinitionFingerprint,
      input.createdAt,
    )
    const session = this.getSession(input.sessionId)
    if (!session) throw new Error(`session "${input.sessionId}" was not stored`)
    if (session.agentDefinitionId !== input.agentDefinitionId
      || session.agentDefinitionVersion !== input.agentDefinitionVersion
      || session.agentDefinitionFingerprint !== input.agentDefinitionFingerprint) {
      throw new Error(`session "${input.sessionId}" conflicts with an existing Agent Definition`)
    }
    return session
  }

  getSession(sessionId: string): DurableSession | undefined {
    const row = this.db.prepare(`
      SELECT session_id, agent_definition_id, agent_definition_version, agent_definition_fingerprint, created_at
      FROM sessions
      WHERE session_id = ?
    `).get(sessionId) as {
      session_id: string
      agent_definition_id: string
      agent_definition_version: string
      agent_definition_fingerprint: string
      created_at: number
    } | undefined
    return row === undefined ? undefined : {
      sessionId: row.session_id,
      agentDefinitionId: row.agent_definition_id,
      agentDefinitionVersion: row.agent_definition_version,
      agentDefinitionFingerprint: row.agent_definition_fingerprint,
      createdAt: row.created_at,
    }
  }

  getSessionForRun(runId: string): DurableSession | undefined {
    const row = this.db.prepare(`
      SELECT s.session_id, s.agent_definition_id, s.agent_definition_version,
        s.agent_definition_fingerprint, s.created_at
      FROM sessions s
      INNER JOIN session_messages m ON m.session_id = s.session_id
      WHERE m.run_id = ?
      ORDER BY m.sequence ASC
      LIMIT 1
    `).get(runId) as {
      session_id: string
      agent_definition_id: string
      agent_definition_version: string
      agent_definition_fingerprint: string
      created_at: number
    } | undefined
    return row === undefined ? undefined : {
      sessionId: row.session_id,
      agentDefinitionId: row.agent_definition_id,
      agentDefinitionVersion: row.agent_definition_version,
      agentDefinitionFingerprint: row.agent_definition_fingerprint,
      createdAt: row.created_at,
    }
  }

  appendSessionMessage(input: StoreSessionMessageInput): DurableSessionMessage {
    this.begin()
    try {
      const message = this.appendSessionMessageWithinTransaction(input)
      this.commit()
      return message
    } catch (error) {
      this.rollback()
      throw error
    }
  }

  appendSessionMessageForCompletedRun(input: StoreSessionMessageInput): DurableSessionMessage {
    this.begin()
    try {
      const terminal = this.db.prepare(`
        SELECT 1 FROM agent_events
        WHERE run_id = ? AND event_type = 'conversation.completed'
        LIMIT 1
      `).get(input.runId) as { 1: number } | undefined
      if (!terminal) throw new Error(`Run "${input.runId}" has not completed`)
      const message = this.appendSessionMessageWithinTransaction(input)
      this.commit()
      return message
    } catch (error) {
      this.rollback()
      throw error
    }
  }

  listSessionMessages(sessionId: string): readonly DurableSessionMessage[] {
    const rows = this.db.prepare(`
      SELECT message_id, session_id, run_id, sequence, role, content, created_at
      FROM session_messages
      WHERE session_id = ?
      ORDER BY sequence ASC
    `).all(sessionId) as unknown as Array<{
      message_id: string
      session_id: string
      run_id: string
      sequence: number
      role: import('./session.js').SessionMessageRole
      content: string
      created_at: number
    }>
    return rows.map(toSessionMessage)
  }

  private getSessionMessage(messageId: string): DurableSessionMessage | undefined {
    const row = this.db.prepare(`
      SELECT message_id, session_id, run_id, sequence, role, content, created_at
      FROM session_messages
      WHERE message_id = ?
    `).get(messageId) as unknown as {
      message_id: string
      session_id: string
      run_id: string
      sequence: number
      role: import('./session.js').SessionMessageRole
      content: string
      created_at: number
    } | undefined
    return row ? toSessionMessage(row) : undefined
  }

  private appendSessionMessageWithinTransaction(input: StoreSessionMessageInput): DurableSessionMessage {
    if (!this.getSession(input.sessionId)) throw new Error(`session "${input.sessionId}" was not stored`)
    const sequenceRow = this.db.prepare(
      'SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM session_messages WHERE session_id = ?',
    ).get(input.sessionId) as { next_sequence: number }
    this.db.prepare(`
      INSERT INTO session_messages (message_id, session_id, run_id, sequence, role, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (message_id) DO NOTHING
    `).run(input.messageId, input.sessionId, input.runId, sequenceRow.next_sequence, input.role, input.content, input.createdAt)
    const message = this.getSessionMessage(input.messageId)
    if (!message) throw new Error(`session message "${input.messageId}" was not stored`)
    if (message.sessionId !== input.sessionId || message.runId !== input.runId || message.role !== input.role || message.content !== input.content) {
      throw new Error(`session message "${input.messageId}" conflicts with an existing message`)
    }
    return message
  }

  private getClaimByCandidate(candidateId: string): DurableClaim | undefined {
    const row = this.db.prepare(`
      SELECT claim_id, candidate_id, agent_scope_id, memory_kind, claim_key, content, source,
        scope, confidence, sensitive, accepted_at
      FROM memory_claims
      WHERE candidate_id = ?
    `).get(candidateId) as unknown as ClaimRow | undefined
    return row ? toClaim(row) : undefined
  }

  createMemoryCandidate(input: StoreMemoryCandidateInput): DurableMemoryCandidate {
    if ((input.status as MemoryCandidateStatus | undefined) === 'accepted') throw new Error('Memory Candidate must be validated before acceptance')
    this.db.prepare(`
      INSERT INTO memory_candidates (
        candidate_id, agent_scope_id, memory_kind, claim_key, content, source, scope,
        confidence, sensitive, status, decision_reason, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (candidate_id) DO NOTHING
    `).run(
      input.candidateId,
      input.agentScopeId,
      input.kind,
      input.claimKey,
      input.content,
      input.source,
      input.scope,
      input.confidence,
      input.sensitive ? 1 : 0,
      input.status ?? 'pending',
      input.decisionReason ?? null,
      input.createdAt,
    )
    const candidate = this.getMemoryCandidate(input.candidateId)
    if (!candidate) throw new Error(`memory candidate "${input.candidateId}" was not stored`)
    return candidate
  }

  eraseMemoryCandidate(candidateId: string, erasedAt: number): void {
    this.begin()
    try {
      this.db.prepare('DELETE FROM memory_claims WHERE candidate_id = ?').run(candidateId)
      this.db.prepare(`
        UPDATE memory_candidates
        SET claim_key = '[erased]', content = '[erased]', source = '[erased]', scope = '[erased]',
          confidence = 0, sensitive = 0, status = 'rejected', decision_reason = 'data_erased', decided_at = ?
        WHERE candidate_id = ?
      `).run(erasedAt, candidateId)
      this.commit()
    } catch (error) {
      this.rollback()
      throw error
    }
  }

  getMemoryCandidate(candidateId: string): DurableMemoryCandidate | undefined {
    const row = this.db.prepare(`
      SELECT candidate_id, agent_scope_id, memory_kind, claim_key, content, source, scope,
        confidence, sensitive, status, decision_reason, created_at, decided_at
      FROM memory_candidates
      WHERE candidate_id = ?
    `).get(candidateId) as unknown as MemoryCandidateRow | undefined
    return row ? toMemoryCandidate(row) : undefined
  }

  listMemoryCandidates(agentScopeId: string): readonly DurableMemoryCandidate[] {
    const rows = this.db.prepare(`
      SELECT candidate_id, agent_scope_id, memory_kind, claim_key, content, source, scope,
        confidence, sensitive, status, decision_reason, created_at, decided_at
      FROM memory_candidates
      WHERE agent_scope_id = ?
      ORDER BY created_at ASC, candidate_id ASC
    `).all(agentScopeId) as unknown as MemoryCandidateRow[]
    return rows.map(toMemoryCandidate)
  }

  rejectMemoryCandidate(candidateId: string, reason: string, decidedAt: number): void {
    this.begin()
    try {
      const candidate = this.getMemoryCandidate(candidateId)
      if (!candidate) throw new Error(`memory candidate "${candidateId}" was not stored`)
      if (candidate.status !== 'pending') {
        this.commit()
        return
      }
      this.db.prepare(`
        UPDATE memory_candidates
        SET status = 'rejected', decision_reason = ?, decided_at = ?
        WHERE candidate_id = ? AND status = 'pending'
      `).run(reason, decidedAt, candidateId)
      this.commit()
    } catch (error) {
      this.rollback()
      throw error
    }
  }

  acceptValidatedMemoryCandidate(
    candidateId: string,
    proof: import('./memory.js').MemoryAcceptanceProof,
    reason: string,
    decidedAt: number,
    claimId?: string,
  ): DurableClaim | undefined {
    if (proof.validator !== 'personal-context') throw new Error('Memory Candidate acceptance requires the Personal Context validator')
    this.begin()
    try {
      const candidate = this.getMemoryCandidate(candidateId)
      if (!candidate) throw new Error(`memory candidate "${candidateId}" was not stored`)
      if (candidate.status !== 'pending') {
        const existing = this.getClaimByCandidate(candidateId)
        this.commit()
        return existing
      }
      this.db.prepare(`
        UPDATE memory_candidates
        SET status = 'accepted', decision_reason = ?, decided_at = ?
        WHERE candidate_id = ? AND status = 'pending'
      `).run(reason, decidedAt, candidateId)
      const claim: DurableClaim = {
        claimId: claimId ?? `${candidateId}:claim`,
        candidateId: candidate.candidateId,
        agentScopeId: candidate.agentScopeId,
        kind: candidate.kind,
        claimKey: candidate.claimKey,
        content: candidate.content,
        source: candidate.source,
        scope: candidate.scope,
        confidence: candidate.confidence,
        sensitive: candidate.sensitive,
        acceptedAt: decidedAt,
      }
      this.db.prepare(`
        INSERT INTO memory_claims (
          claim_id, candidate_id, agent_scope_id, memory_kind, claim_key, content, source,
          scope, confidence, sensitive, accepted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        claim.claimId,
        claim.candidateId,
        claim.agentScopeId,
        claim.kind,
        claim.claimKey,
        claim.content,
        claim.source,
        claim.scope,
        claim.confidence,
        claim.sensitive ? 1 : 0,
        claim.acceptedAt,
      )
      this.commit()
      return claim
    } catch (error) {
      this.rollback()
      throw error
    }
  }

  listClaims(agentScopeId: string): readonly DurableClaim[] {
    const rows = this.db.prepare(`
      SELECT claim_id, candidate_id, agent_scope_id, memory_kind, claim_key, content, source,
        scope, confidence, sensitive, accepted_at
      FROM memory_claims
      WHERE agent_scope_id = ?
      ORDER BY accepted_at ASC, claim_id ASC
    `).all(agentScopeId) as unknown as ClaimRow[]
    return rows.map(toClaim)
  }

  getClaim(claimId: string): DurableClaim | undefined {
    const row = this.db.prepare(`
      SELECT claim_id, candidate_id, agent_scope_id, memory_kind, claim_key, content, source,
        scope, confidence, sensitive, accepted_at
      FROM memory_claims
      WHERE claim_id = ?
    `).get(claimId) as unknown as ClaimRow | undefined
    return row ? toClaim(row) : undefined
  }

  createEvidenceBundle(input: StoreEvidenceBundleInput): DurableEvidenceBundle {
    this.begin()
    try {
      this.db.prepare(`
        INSERT INTO evidence_bundles (bundle_id, run_id, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT (bundle_id) DO NOTHING
      `).run(input.bundleId, input.runId, input.createdAt)
      for (const item of input.items) {
        this.db.prepare(`
          INSERT INTO evidence_items (item_id, bundle_id, reference_type, reference_id, source, applicability, confidence)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (item_id) DO NOTHING
        `).run(item.itemId, input.bundleId, item.referenceType, item.referenceId, item.source, item.applicability, item.confidence)
      }
      const bundle = this.getEvidenceBundle(input.bundleId)
      if (!bundle) throw new Error(`evidence bundle "${input.bundleId}" was not stored`)
      this.commit()
      return bundle
    } catch (error) {
      this.rollback()
      throw error
    }
  }

  getEvidenceBundle(bundleId: string): DurableEvidenceBundle | undefined {
    const bundle = this.db.prepare(`
      SELECT bundle_id, run_id, created_at
      FROM evidence_bundles
      WHERE bundle_id = ?
    `).get(bundleId) as { bundle_id: string; run_id: string; created_at: number } | undefined
    if (!bundle) return undefined
    const items = this.db.prepare(`
      SELECT item_id, reference_type, reference_id, source, applicability, confidence
      FROM evidence_items
      WHERE bundle_id = ?
      ORDER BY item_id ASC
    `).all(bundleId) as unknown as EvidenceItemRow[]
    return {
      bundleId: bundle.bundle_id,
      runId: bundle.run_id,
      createdAt: bundle.created_at,
      items: items.map(toEvidenceItem),
    }
  }

  listApprovals(runId: string): readonly DurableApproval[] {
    const rows = this.db.prepare(`
      SELECT approval_id, run_id, tool_call_id, tool_name, effect_class, idempotency_key,
        input_json, required_permission, status, decision_reason, created_at, decided_at
      FROM permission_approvals
      WHERE run_id = ?
      ORDER BY created_at ASC, approval_id ASC
    `).all(runId) as unknown as ApprovalRow[]
    return rows.map(toApproval)
  }

  decideApproval(approvalId: string, status: Exclude<ApprovalStatus, 'pending'>, reason: string | undefined, decidedAt: number): ApprovalDecisionResult {
    this.begin()
    try {
      const changes = this.db.prepare(`
        UPDATE permission_approvals
        SET status = ?, decision_reason = ?, decided_at = ?
        WHERE approval_id = ? AND status = 'pending'
      `).run(status, reason ?? null, decidedAt, approvalId).changes
      const approval = this.getApproval(approvalId)
      if (!approval) throw new Error(`approval "${approvalId}" was not stored`)
      this.commit()
      return { approval, changed: changes === 1 }
    } catch (error) {
      this.rollback()
      throw error
    }
  }

  decideApprovalWithEvent(
    approvalId: string,
    status: Exclude<ApprovalStatus, 'pending'>,
    reason: string | undefined,
    decidedAt: number,
    event: AppendEventInput,
  ): ApprovalDecisionResult {
    this.begin()
    try {
      const result = this.decideApprovalWithinTransaction(approvalId, status, reason, decidedAt)
      if (result.changed) this.insertEvent(event)
      this.commit()
      return result
    } catch (error) {
      this.rollback()
      throw error
    }
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

  private recordEffectWithinTransaction(input: RecordEffectInput): EffectReceipt {
    const changes = this.db.prepare(`
      INSERT INTO effect_receipts (idempotency_key, run_id, effect_type, result_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (idempotency_key) DO NOTHING
    `).run(input.idempotencyKey, input.runId, input.effectType, stringify(input.result)).changes
    const row = this.db.prepare(`
      SELECT idempotency_key, run_id, effect_type, result_json
      FROM effect_receipts
      WHERE idempotency_key = ?
    `).get(input.idempotencyKey) as EffectRow | undefined
    if (!row) throw new Error(`effect "${input.idempotencyKey}" was not stored`)
    return { ...toEffect(row), created: changes === 1 }
  }

  private decideApprovalWithinTransaction(
    approvalId: string,
    status: Exclude<ApprovalStatus, 'pending'>,
    reason: string | undefined,
    decidedAt: number,
  ): ApprovalDecisionResult {
    const changes = this.db.prepare(`
      UPDATE permission_approvals
      SET status = ?, decision_reason = ?, decided_at = ?
      WHERE approval_id = ? AND status = 'pending'
    `).run(status, reason ?? null, decidedAt, approvalId).changes
    const approval = this.getApproval(approvalId)
    if (!approval) throw new Error(`approval "${approvalId}" was not stored`)
    return { approval, changed: changes === 1 }
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

function toApproval(row: ApprovalRow): DurableApproval {
  return {
    approvalId: row.approval_id,
    runId: row.run_id,
    toolCallId: row.tool_call_id,
    toolName: row.tool_name,
    effectClass: row.effect_class,
    idempotencyKey: row.idempotency_key,
    input: JSON.parse(row.input_json) as unknown,
    requiredPermission: row.required_permission ?? undefined,
    status: row.status,
    decisionReason: row.decision_reason ?? undefined,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? undefined,
  }
}

function toSessionMessage(row: {
  message_id: string
  session_id: string
  run_id: string
  sequence: number
  role: import('./session.js').SessionMessageRole
  content: string
  created_at: number
}): DurableSessionMessage {
  return {
    messageId: row.message_id,
    sessionId: row.session_id,
    runId: row.run_id,
    sequence: row.sequence,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  }
}

function toMemoryCandidate(row: MemoryCandidateRow): DurableMemoryCandidate {
  return {
    candidateId: row.candidate_id,
    agentScopeId: row.agent_scope_id,
    kind: row.memory_kind,
    claimKey: row.claim_key,
    content: row.content,
    source: row.source,
    scope: row.scope,
    confidence: row.confidence,
    sensitive: row.sensitive === 1,
    status: row.status,
    decisionReason: row.decision_reason ?? undefined,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? undefined,
  }
}

function toClaim(row: ClaimRow): DurableClaim {
  return {
    claimId: row.claim_id,
    candidateId: row.candidate_id,
    agentScopeId: row.agent_scope_id,
    kind: row.memory_kind,
    claimKey: row.claim_key,
    content: row.content,
    source: row.source,
    scope: row.scope,
    confidence: row.confidence,
    sensitive: row.sensitive === 1,
    acceptedAt: row.accepted_at,
  }
}

function toEvidenceItem(row: EvidenceItemRow): DurableEvidenceItem {
  return {
    itemId: row.item_id,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    source: row.source,
    applicability: row.applicability,
    confidence: row.confidence,
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
