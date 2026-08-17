import { createRoot } from 'react-dom/client'
import { ChatSurface } from './ChatSurface.js'
import { HttpChatApiClient, type ChatSession } from './client.js'

const session: ChatSession = {
  sessionId: 'local-session',
  agentDefinitionId: 'personal-agent',
  agentDefinitionVersion: '1.0.0',
  agentDefinitionFingerprint: 'local-config',
}

const client = new HttpChatApiClient('/api')
void client.createSession(session).catch(() => undefined)
createRoot(document.getElementById('root')!).render(<ChatSurface client={client} session={session} />)
