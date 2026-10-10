import { authorized, json } from './http.js';
import { SESSION_NAME, isInboxEvent, type Env, type InboxEvent } from './types.js';
export { WeixinSession } from './session.js';

function session(env: Env): DurableObjectStub {
  return env.WEIXIN_SESSION.get(env.WEIXIN_SESSION.idFromName(SESSION_NAME));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true, stage: 'A' });
    const routes: Record<string, string> = {
      '/admin/session/bind': '/bind', '/admin/session/start': '/start',
      '/admin/session/pause': '/pause', '/admin/session/status': '/status',
    };
    const path = routes[url.pathname];
    if (!path) return json({ error: 'not_found' }, 404);
    if (!await authorized(request, env.WEIXIN_ADMIN_TOKEN)) return json({ error: 'unauthorized' }, 401);
    return session(env).fetch(new Request(`https://session.internal${path}`, request));
  },
  async queue(batch: MessageBatch<InboxEvent>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      if (!isInboxEvent(message.body)) {
        console.warn(JSON.stringify({ event: 'invalid_queue_reference' }));
        message.retry({ delaySeconds: 60 }); // Exhaust retries into DLQ rather than discard.
        continue;
      }
      try {
        const response = await session(env).fetch('https://session.internal/consume', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.WEIXIN_ADMIN_TOKEN}` },
          body: JSON.stringify(message.body),
        });
        if (response.ok) message.ack();
        else message.retry({ delaySeconds: 30 });
      } catch {
        console.warn(JSON.stringify({ event: 'consume_transport_error' }));
        message.retry({ delaySeconds: 30 });
      }
    }
  },
} satisfies ExportedHandler<Env, InboxEvent>;
