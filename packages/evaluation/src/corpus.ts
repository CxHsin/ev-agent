import type { ModelMessage } from '@ev-agent/model'

export type FixedTaskMode = 'text' | 'read' | 'approval' | 'failure' | 'recovery'

export interface FixedTaskScenario {
  readonly id: string
  readonly prompt: string
  readonly mode: FixedTaskMode
  readonly expected: string
}

export const FIXED_TASKS: readonly FixedTaskScenario[] = [
  { id: 'task-01-daily-plan', prompt: 'Draft a concise plan for today.', mode: 'text', expected: 'A concise plan is ready.' },
  { id: 'task-02-explain-budget', prompt: 'Explain the execution budget in plain language.', mode: 'text', expected: 'The execution budget is ready.' },
  { id: 'task-03-summarize-goal', prompt: 'Summarize my current goal.', mode: 'text', expected: 'The goal summary is ready.' },
  { id: 'task-04-prioritize-work', prompt: 'Help prioritize three open tasks.', mode: 'text', expected: 'The priorities are ready.' },
  { id: 'task-05-draft-question', prompt: 'Draft a question for a planning review.', mode: 'text', expected: 'The draft question is ready.' },
  { id: 'task-06-compare-options', prompt: 'Compare two implementation options.', mode: 'text', expected: 'The comparison is ready.' },
  { id: 'task-07-summarize-note', prompt: 'Summarize a short project note.', mode: 'text', expected: 'The note summary is ready.' },
  { id: 'task-08-explain-risk', prompt: 'Explain the main risk in this plan.', mode: 'text', expected: 'The risk explanation is ready.' },
  { id: 'task-09-make-checklist', prompt: 'Turn the request into a checklist.', mode: 'text', expected: 'The checklist is ready.' },
  { id: 'task-10-refine-wording', prompt: 'Refine this sentence for clarity.', mode: 'text', expected: 'The refined wording is ready.' },
  { id: 'task-11-read-status', prompt: 'Read the current runtime status.', mode: 'read', expected: 'The read result is ready.' },
  { id: 'task-12-read-version', prompt: 'Read the installed Agent Definition version.', mode: 'read', expected: 'The read result is ready.' },
  { id: 'task-13-read-schedule', prompt: 'Read the next scheduled task.', mode: 'read', expected: 'The read result is ready.' },
  { id: 'task-14-read-source', prompt: 'Read the latest source item.', mode: 'read', expected: 'The read result is ready.' },
  { id: 'task-15-read-preference', prompt: 'Read the current response preference.', mode: 'read', expected: 'The read result is ready.' },
  { id: 'task-16-read-run', prompt: 'Read the last Run outcome.', mode: 'read', expected: 'The read result is ready.' },
  { id: 'task-17-read-evidence', prompt: 'Read the evidence references for this answer.', mode: 'read', expected: 'The read result is ready.' },
  { id: 'task-18-read-budget', prompt: 'Read remaining budget information.', mode: 'read', expected: 'The read result is ready.' },
  { id: 'task-19-read-plugin', prompt: 'Read the active Plugin list.', mode: 'read', expected: 'The read result is ready.' },
  { id: 'task-20-read-session', prompt: 'Read the current Session version.', mode: 'read', expected: 'The read result is ready.' },
  { id: 'task-21-read-claim', prompt: 'Read the current accepted Claim.', mode: 'read', expected: 'The read result is ready.' },
  { id: 'task-22-read-history', prompt: 'Read the last three Agent Events.', mode: 'read', expected: 'The read result is ready.' },
  { id: 'task-23-read-health', prompt: 'Read the local health summary.', mode: 'read', expected: 'The read result is ready.' },
  { id: 'task-24-read-model', prompt: 'Read the resolved model identifier.', mode: 'read', expected: 'The read result is ready.' },
  { id: 'task-25-read-tool', prompt: 'Read the registered read tools.', mode: 'read', expected: 'The read result is ready.' },
  { id: 'task-26-send-message', prompt: 'Send this message to the approved recipient.', mode: 'approval', expected: 'The external action is complete.' },
  { id: 'task-27-create-file', prompt: 'Create the requested external file.', mode: 'approval', expected: 'The external action is complete.' },
  { id: 'task-28-update-record', prompt: 'Update the external record.', mode: 'approval', expected: 'The external action is complete.' },
  { id: 'task-29-publish-note', prompt: 'Publish the prepared note.', mode: 'approval', expected: 'The external action is complete.' },
  { id: 'task-30-send-digest', prompt: 'Send the prepared digest.', mode: 'approval', expected: 'The external action is complete.' },
  { id: 'task-31-archive-item', prompt: 'Archive the selected item.', mode: 'approval', expected: 'The external action is complete.' },
  { id: 'task-32-create-reminder', prompt: 'Create the requested reminder.', mode: 'approval', expected: 'The external action is complete.' },
  { id: 'task-33-change-setting', prompt: 'Change the selected external setting.', mode: 'approval', expected: 'The external action is complete.' },
  { id: 'task-34-share-report', prompt: 'Share the report with the team.', mode: 'approval', expected: 'The external action is complete.' },
  { id: 'task-35-close-task', prompt: 'Close the completed external task.', mode: 'approval', expected: 'The external action is complete.' },
  { id: 'task-36-upload-result', prompt: 'Upload the generated result.', mode: 'approval', expected: 'The external action is complete.' },
  { id: 'task-37-invite-reviewer', prompt: 'Invite a reviewer to the project.', mode: 'approval', expected: 'The external action is complete.' },
  { id: 'task-38-rename-item', prompt: 'Rename the selected external item.', mode: 'approval', expected: 'The external action is complete.' },
  { id: 'task-39-mark-done', prompt: 'Mark the requested work as done.', mode: 'approval', expected: 'The external action is complete.' },
  { id: 'task-40-send-followup', prompt: 'Send the follow-up message.', mode: 'approval', expected: 'The external action is complete.' },
  { id: 'task-41-approve-change', prompt: 'Apply the prepared change.', mode: 'approval', expected: 'The external action is complete.' },
  { id: 'task-42-create-ticket', prompt: 'Create the external ticket.', mode: 'approval', expected: 'The external action is complete.' },
  { id: 'task-43-update-calendar', prompt: 'Update the external calendar entry.', mode: 'approval', expected: 'The external action is complete.' },
  { id: 'task-44-send-summary', prompt: 'Send the summary to the recipient.', mode: 'approval', expected: 'The external action is complete.' },
  { id: 'task-45-delete-draft', prompt: 'Delete the selected external draft.', mode: 'approval', expected: 'The external action is complete.' },
  { id: 'task-46-publish-release', prompt: 'Publish the prepared release.', mode: 'approval', expected: 'The external action is complete.' },
  { id: 'task-47-create-branch', prompt: 'Create the external branch.', mode: 'approval', expected: 'The external action is complete.' },
  { id: 'task-48-request-review', prompt: 'Request an external review.', mode: 'approval', expected: 'The external action is complete.' },
  { id: 'task-49-sync-source', prompt: 'Resume the source sync after a worker restart.', mode: 'recovery', expected: 'The recovered external action is complete.' },
  { id: 'task-50-notify-user', prompt: 'Record the provider failure while notifying the user.', mode: 'failure', expected: 'The provider failure was recorded.' },
]

export function taskMessage(task: FixedTaskScenario): ModelMessage {
  return { role: 'user', content: task.prompt }
}
