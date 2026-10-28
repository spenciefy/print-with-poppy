// Sessions (Poppy 0.3 §5): named by the Personal Agent's `client_id` and the
// `sid` in its Session JWTs. An unknown `sid` starts a signed-out Session; a
// known one must keep its User ID and Agent ID. Ended Sessions are remembered and
// refused with `invalid_session`.
import { get, put, id, hash, HttpError } from "./store.js";
import type { Session } from "./types.js";

/** How long a Session lasts from its first request. */
export const sessionLifetimeMs = 30 * 86400000;
/** How long an ended Session's `sid` stays refused. */
export const endedRetentionMs = 90 * 86400000;

const indexKey = (clientId: string, sid: string) => hash(`${clientId}\n${sid}`);
const invalid = (message: string) => new HttpError(400, "invalid_session", message);

export function sessionEnded(session: Session) {
  return !!session.ended || (!!session.sid && session.created + sessionLifetimeMs <= Date.now());
}

export function endSession(session: Session) {
  put("session", session.id, { ...session, ended: true });
  if (session.sid)
    put("session-sid", indexKey(session.clientId, session.sid), {
      sessionId: session.id,
      ended: true,
      expires: Date.now() + endedRetentionMs,
    });
}

/** The Session for this client_id and sid, started signed out if it's new (§5.3 step 4). */
export function sessionFor(
  clientId: string,
  sid: string,
  claims: { userId: string; agentId?: string; extensions: boolean },
): Session {
  const key = indexKey(clientId, sid);
  const ref = get("session-sid", key);
  if (ref) {
    const session = ref.ended ? undefined : get<Session>("session", ref.sessionId);
    if (!session || sessionEnded(session)) {
      if (session && !session.ended) endSession(session);
      throw invalid("This Session has ended. Start a new Session with a new sid.");
    }
    if (session.userId !== claims.userId || (session.agentId ?? null) !== (claims.agentId ?? null))
      throw invalid("A Session keeps the sub and agent_id it started with.");
    // The client's metadata can change; follow its current extensions.
    if (session.extensions !== claims.extensions) {
      session.extensions = claims.extensions;
      put("session", session.id, session);
    }
    return session;
  }
  const session: Session = {
    id: id("ses"),
    sid,
    clientId,
    userId: claims.userId,
    ...(claims.agentId ? { agentId: claims.agentId } : {}),
    extensions: claims.extensions,
    created: Date.now(),
  };
  put("session", session.id, session);
  put("session-sid", key, { sessionId: session.id });
  return session;
}
