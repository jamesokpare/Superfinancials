/**
 * The artifact runtime's `room` capability (live events + presence)
 * on Supabase Realtime broadcast and presence channels.
 */
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

type Json = unknown;
type Sender = { peer: string; by: string | null; isMe: boolean; sameTab: boolean; kind: "viewer"; guest: boolean };
type Message = Sender & { topic: string; data?: Json };
type Peer = Sender & { presence: Readonly<Record<string, Json>>; updatedAt: number };
type PeersChange = { peers: readonly Peer[]; joined: readonly Peer[]; left: readonly Peer[]; updated: readonly Peer[] };

const peerId = () => Math.random().toString(36).slice(2, 12);

async function openRoom(sb: SupabaseClient, name: string) {
  const { data } = await sb.auth.getSession();
  const by = data.session?.user.id ?? null;
  const me = peerId();
  const handlers = new Map<string, Set<(m: Message) => void>>();
  const peerHandlers = new Set<(c: PeersChange) => void>();
  const connHandlers = new Set<(ok: boolean) => void>();
  let peers: Peer[] = [];
  let mine: Record<string, Json> = {};
  let connected = false;

  const ch: RealtimeChannel = sb.channel(`sf-room:${name}`, { config: { presence: { key: me }, broadcast: { self: false } } });
  ch.on("broadcast", { event: "msg" }, ({ payload }) => {
    const p = payload as { topic: string; data?: Json; peer: string; by: string | null };
    handlers.get(p.topic)?.forEach((h) => h({ topic: p.topic, data: p.data, peer: p.peer, by: p.by, isMe: false, sameTab: false, kind: "viewer", guest: false }));
  });
  ch.on("presence", { event: "sync" }, () => {
    const state = ch.presenceState() as Record<string, Array<{ by?: string | null; presence?: Record<string, Json>; at?: number }>>;
    const next: Peer[] = Object.entries(state).map(([peer, metas]) => {
      const m = metas[metas.length - 1] ?? {};
      return { peer, by: m.by ?? null, isMe: peer === me, sameTab: peer === me, kind: "viewer", guest: false, presence: m.presence ?? {}, updatedAt: m.at ?? Date.now() };
    });
    const old = new Map(peers.map((p) => [p.peer, p]));
    const now = new Map(next.map((p) => [p.peer, p]));
    const change: PeersChange = {
      peers: next,
      joined: next.filter((p) => !old.has(p.peer)),
      left: peers.filter((p) => !now.has(p.peer)),
      updated: next.filter((p) => old.has(p.peer) && JSON.stringify(old.get(p.peer)!.presence) !== JSON.stringify(p.presence)),
    };
    peers = next;
    peerHandlers.forEach((h) => h(change));
  });
  ch.subscribe((status) => {
    connected = status === "SUBSCRIBED";
    connHandlers.forEach((h) => h(connected));
    if (connected) ch.track({ by, presence: mine, at: Date.now() });
  });

  return {
    name,
    async emit(topic: string, data?: Json) { await ch.send({ type: "broadcast", event: "msg", payload: { topic, data, peer: me, by } }); },
    on(topic: string, h: (m: Message) => void) {
      if (!handlers.has(topic)) handlers.set(topic, new Set());
      handlers.get(topic)!.add(h);
      return () => handlers.get(topic)?.delete(h);
    },
    async presence(patch: Record<string, Json | null>) {
      mine = { ...mine };
      for (const [k, v] of Object.entries(patch)) { if (v === null) delete mine[k]; else mine[k] = v; }
      if (connected) await ch.track({ by, presence: mine, at: Date.now() });
    },
    peers: () => peers,
    onPeers(h: (c: PeersChange) => void) { peerHandlers.add(h); h({ peers, joined: peers, left: [], updated: [] }); return () => peerHandlers.delete(h); },
    connected: () => connected,
    onConnection(h: (ok: boolean) => void) { connHandlers.add(h); return () => connHandlers.delete(h); },
    async leave() { await sb.removeChannel(ch); },
  };
}

export async function createRoom(sb: SupabaseClient) {
  const lobby = await openRoom(sb, "lobby");
  return Object.freeze({
    ...lobby,
    join: (name: string) => openRoom(sb, name),
    async canSendToClaudeSession() { return "unsupported" as const; },
    async sendToClaudeSession() { throw { code: "claude_unavailable", message: "Not available outside claude.ai" }; },
  });
}
