import {
  DurabilityStore,
  type DurablePushOccurrence,
  type DurablePushSchedule,
  type DurablePushSubscription,
} from '@ev-agent/durability'

export interface PushScheduleBudget {
  readonly maxSchedules: number
  readonly maxOccurrences: number
  readonly maxFetchItems: number
  readonly maxRetries: number
}

export interface PushScheduleRunnerOptions {
  readonly databasePath: string
  readonly workerId: string
  readonly now?: () => number
  readonly claimLeaseMs?: number
  readonly budget?: Partial<PushScheduleBudget>
}

const defaultBudget: PushScheduleBudget = {
  maxSchedules: 32,
  maxOccurrences: 32,
  maxFetchItems: 50,
  maxRetries: 3,
}

export class PushScheduleRunner {
  private readonly store: DurabilityStore
  private readonly now: () => number
  private readonly workerId: string
  private readonly claimLeaseMs: number
  readonly budget: PushScheduleBudget

  constructor(options: PushScheduleRunnerOptions) {
    this.store = new DurabilityStore(options.databasePath)
    this.now = options.now ?? (() => Date.now())
    this.workerId = requireText(options.workerId, 'workerId')
    this.claimLeaseMs = options.claimLeaseMs ?? 60_000
    if (!Number.isSafeInteger(this.claimLeaseMs) || this.claimLeaseMs <= 0) throw new RangeError('claimLeaseMs must be a positive integer')
    this.budget = validateBudget({ ...defaultBudget, ...options.budget })
  }

  getSchedule(subscriptionId: string): DurablePushSchedule | undefined {
    return this.store.getPushScheduleBySubscription(subscriptionId)
  }

  listOccurrences(subscriptionId: string): readonly DurablePushOccurrence[] {
    const schedule = this.store.getPushScheduleBySubscription(subscriptionId)
    return schedule ? this.store.listPushOccurrences(schedule.scheduleId) : []
  }

  reconcile(subscriptionId: string, reconciledAt = this.now()): readonly DurablePushOccurrence[] {
    const active = this.activeSchedule(subscriptionId, reconciledAt)
    if (!active) return []
    const { schedule, subscription } = active
    const dueResult = dueDailyOccurrences(schedule, subscription, reconciledAt, this.budget.maxOccurrences)
    const due = schedule.catchUp === 'all' || !dueResult.truncated
      ? dueResult.occurrences
      : latestDueDailyOccurrence(schedule, subscription, reconciledAt)
    if (due.length === 0) {
      this.store.setPushScheduleLastReconciledAt(schedule.scheduleId, reconciledAt)
      return []
    }

    const lastIndex = due.length - 1
    const stored = due.map((dueOccurrence, index) => {
      const skipped = schedule.catchUp === 'skip' || schedule.catchUp === 'latest' && index !== lastIndex
      const reason = schedule.catchUp === 'skip' ? 'catch_up_skipped' : schedule.catchUp === 'latest' && index !== lastIndex ? 'catch_up_superseded' : undefined
      return this.store.createPushOccurrence({
        occurrenceId: occurrenceId(schedule.scheduleId, dueOccurrence.localDate),
        scheduleId: schedule.scheduleId,
        subscriptionId,
        intendedLocalDate: dueOccurrence.localDate,
        intendedAt: dueOccurrence.intendedAt,
        status: skipped ? 'skipped' : 'pending',
        ...(reason === undefined ? {} : { reason }),
      })
    })
    const lastReconciledAt = schedule.catchUp === 'all' && dueResult.truncated
      ? due[due.length - 1]!.intendedAt
      : reconciledAt
    this.store.setPushScheduleLastReconciledAt(schedule.scheduleId, lastReconciledAt)
    return stored
  }

  claimDue(subscriptionId: string, claimedAt = this.now()): readonly DurablePushOccurrence[] {
    this.reconcile(subscriptionId, claimedAt)
    const schedule = this.store.getPushScheduleBySubscription(subscriptionId)
    if (!schedule) return []
    return this.store.listPushOccurrences(schedule.scheduleId)
      .filter((occurrence) => occurrence.status === 'pending' && occurrence.intendedAt <= claimedAt)
      .slice(0, this.budget.maxOccurrences)
      .flatMap((occurrence) => {
        const claimed = this.store.claimPushOccurrence(occurrence.occurrenceId, this.workerId, claimedAt, this.claimLeaseMs)
        return claimed ? [claimed] : []
      })
  }

  complete(occurrenceId: string, completedAt = this.now()): DurablePushOccurrence {
    return this.store.completePushOccurrence(occurrenceId, this.workerId, completedAt)
  }

  close(): void {
    this.store.close()
  }

  private activeSchedule(subscriptionId: string, at: number): { readonly schedule: DurablePushSchedule; readonly subscription: DurablePushSubscription } | undefined {
    const subscription = this.store.getPushSubscription(subscriptionId)
    if (!subscription || subscription.status !== 'active' || at < subscription.draft.validFrom) return undefined
    if (subscription.draft.validUntil !== undefined && at > subscription.draft.validUntil) {
      this.store.setPushSubscriptionStatus(subscriptionId, 'expired', at)
      return undefined
    }
    const schedule = this.store.getPushScheduleBySubscription(subscriptionId)
    return schedule?.status === 'active' ? { schedule, subscription } : undefined
  }
}

function dueDailyOccurrences(
  schedule: DurablePushSchedule,
  subscription: DurablePushSubscription,
  reconciledAt: number,
  maxOccurrences: number,
): { readonly occurrences: readonly { readonly localDate: string; readonly intendedAt: number }[]; readonly truncated: boolean } {
  const time = parseDailySchedule(schedule.schedule)
  const startDate = localDate(schedule.lastReconciledAt, schedule.timezone)
  const endDate = localDate(reconciledAt, schedule.timezone)
  const occurrences: Array<{ readonly localDate: string; readonly intendedAt: number }> = []
  for (let date = startDate; date <= endDate; date = nextLocalDate(date)) {
    const intendedAt = localDateTimeToUtc(date, time.hour, time.minute, schedule.timezone)
    if (intendedAt > schedule.lastReconciledAt && intendedAt <= reconciledAt && intendedAt >= subscription.draft.validFrom
      && (subscription.draft.validUntil === undefined || intendedAt <= subscription.draft.validUntil)) {
      occurrences.push({ localDate: date, intendedAt })
      if (occurrences.length === maxOccurrences) return { occurrences, truncated: true }
    }
  }
  return { occurrences, truncated: false }
}

function latestDueDailyOccurrence(
  schedule: DurablePushSchedule,
  subscription: DurablePushSubscription,
  reconciledAt: number,
): readonly { readonly localDate: string; readonly intendedAt: number }[] {
  const time = parseDailySchedule(schedule.schedule)
  let date = localDate(reconciledAt, schedule.timezone)
  let intendedAt = localDateTimeToUtc(date, time.hour, time.minute, schedule.timezone)
  if (intendedAt > reconciledAt) {
    date = previousLocalDate(date)
    intendedAt = localDateTimeToUtc(date, time.hour, time.minute, schedule.timezone)
  }
  if (intendedAt <= schedule.lastReconciledAt || intendedAt < subscription.draft.validFrom
    || subscription.draft.validUntil !== undefined && intendedAt > subscription.draft.validUntil) return []
  return [{ localDate: date, intendedAt }]
}

function parseDailySchedule(value: string): { readonly hour: number; readonly minute: number } {
  const match = /^daily@(\d{2}):(\d{2})$/.exec(value)
  if (!match) throw new Error(`Unsupported Push Schedule "${value}"`)
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) throw new Error(`Invalid Push Schedule "${value}"`)
  return { hour, minute }
}

function occurrenceId(scheduleId: string, localDateValue: string): string {
  return `${scheduleId}:${localDateValue}`
}

function localDate(timestamp: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(timestamp)
  const year = part(parts, 'year')
  const month = part(parts, 'month')
  const day = part(parts, 'day')
  return `${year}-${month}-${day}`
}

function localDateTimeToUtc(date: string, hour: number, minute: number, timezone: string): number {
  const [year, month, day] = date.split('-').map(Number)
  const naiveUtc = Date.UTC(year!, month! - 1, day!, hour, minute)
  let timestamp = naiveUtc
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const adjusted = naiveUtc - timezoneOffset(timestamp, timezone)
    if (adjusted === timestamp) return adjusted
    timestamp = adjusted
  }
  return timestamp
}

function timezoneOffset(timestamp: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(timestamp)
  return Date.UTC(Number(part(parts, 'year')), Number(part(parts, 'month')) - 1, Number(part(parts, 'day')), Number(part(parts, 'hour')), Number(part(parts, 'minute')), Number(part(parts, 'second'))) - timestamp
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const value = parts.find((entry) => entry.type === type)?.value
  if (!value) throw new Error(`Time zone formatting omitted ${type}`)
  return value
}

function nextLocalDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const next = new Date(Date.UTC(year!, month! - 1, day! + 1))
  return `${next.getUTCFullYear().toString().padStart(4, '0')}-${(next.getUTCMonth() + 1).toString().padStart(2, '0')}-${next.getUTCDate().toString().padStart(2, '0')}`
}

function previousLocalDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const previous = new Date(Date.UTC(year!, month! - 1, day! - 1))
  return `${previous.getUTCFullYear().toString().padStart(4, '0')}-${(previous.getUTCMonth() + 1).toString().padStart(2, '0')}-${previous.getUTCDate().toString().padStart(2, '0')}`
}

function validateBudget(budget: PushScheduleBudget): PushScheduleBudget {
  for (const [key, value] of Object.entries(budget)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${key} must be a positive integer`)
  }
  return budget
}

function requireText(value: string, field: string): string {
  if (value.trim().length === 0) throw new Error(`${field} is required`)
  return value.trim()
}
