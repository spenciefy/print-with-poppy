// Poppy 0.4 §5: Sessions are keyed by client_id, sid and User ID.
// Agent ID is recorded once; ended Sessions remain refused.
import { get, put, id, hash, HttpError } from "./store.js";
import type { Session } from "./types.js";

/** How long a Session lasts from its first request. */
export const sessionLifetimeMs = 30 * 86400000;
/** How long an ended Session's `sid` stays refused. */
export const endedRetentionMs = 90 * 86400000;

export const sessionIndexKey = (clientId: string, sid: string, userId: string) => hash(JSON.stringify([clientId, sid, userId]));
const invalid = (message: string) => new HttpError(400, "invalid_session", message);

export function sessionEnded(session: Session) {
  return !!session.ended || (!!session.sid && session.created + sessionLifetimeMs <= Date.now());
}

export function endSession(session: Session) {
  put("session", session.id, { ...session, ended: true });
  if (session.sid)
    put("session-sid", sessionIndexKey(session.clientId, session.sid, session.userId), {
      sessionId: session.id,
      ended: true,
      expires: Date.now() + endedRetentionMs,
    });
}

/** The Session for this client_id and sid, started signed out if it's new (§5.3 step 4). */
export function sessionFor(
  clientId: string,
  sid: string,
  claims: { userId: string; agentId?: string; extensions: boolean; protocolVersion?: string },
): Session {
  const key = sessionIndexKey(clientId, sid, claims.userId);
  const ref = get("session-sid", key);
  if (ref) {
    const session = ref.ended ? undefined : get<Session>("session", ref.sessionId);
    if (!session || sessionEnded(session)) {
      if (session && !session.ended) endSession(session);
      throw new HttpError(400, "session_ended", "This Session has ended. Start a new Session with a new sid.");
    }
    // Agent ID is fixed at creation. It is not an authentication binding (0.4 §5.3).
    if (session.protocolVersion !== claims.protocolVersion)
      throw invalid("Start a new Session to change protocol versions.");
    return { ...session, extensions: claims.extensions };
  }
  const session: Session = {
    id: id("ses"),
    sid,
    clientId,
    userId: claims.userId,
    ...(claims.agentId ? { agentId: claims.agentId } : {}),
    extensions: claims.extensions,
    protocolVersion: claims.protocolVersion,
    created: Date.now(),
  };
  put("session", session.id, session);
  put("session-sid", key, { sessionId: session.id });
  return session;
}
