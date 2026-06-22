// Ocean MCP bridge (broker).
//
// Owns the fixed port and multiplexes N MCP adapter processes against the single
// Ocean UI. The UI and every adapter connect here as WebSocket *clients*; the
// broker relays each tool call to the UI and routes the result back to the
// adapter that asked. This is what lets multiple agents / MCP clients
// (Claude Code, Cursor, Desktop, parallel subagents) drive ONE UI concurrently —
// previously every adapter tried to bind the port itself, so only one could run.
//
// Singleton by construction: if the port is already held by another broker, this
// process exits 0 and defers to it. Adapters auto-spawn this on demand, so there
// is no separate launch step. All logging goes to stderr.
import type { ServerWebSocket } from "bun";

const PORT = Number(process.env.OCEAN_PORT ?? 7331);

type Role = "ui" | "agent" | null;
interface SockData { role: Role; id: string }

let ui: ServerWebSocket<SockData> | null = null;
// brokerId → which adapter asked, and under what request id, so results route home.
const pending = new Map<string, { agent: ServerWebSocket<SockData>; agentReqId: string; timer: ReturnType<typeof setTimeout> }>();

interface Msg { type: string; id?: string; role?: string; tool?: string; args?: unknown; ok?: boolean; data?: unknown; error?: string }

try {
  Bun.serve<SockData, undefined>({
    port: PORT,
    hostname: "127.0.0.1",
    fetch(req, server) {
      if (server.upgrade(req, { data: { role: null, id: crypto.randomUUID() } })) return;
      return new Response("Ocean MCP bridge");
    },
    websocket: {
      message(ws, raw) {
        let msg: Msg;
        try { msg = JSON.parse(String(raw)); } catch { return; }

        if (msg.type === "hello") {
          ws.data.role = msg.role === "ui" ? "ui" : "agent";
          if (ws.data.role === "ui") { ui = ws; console.error("[ocean-bridge] UI connected"); }
          else console.error(`[ocean-bridge] agent connected ${ws.data.id.slice(0, 8)}`);
          return;
        }

        // agent → broker → UI
        if (msg.type === "invoke" && msg.id) {
          if (!ui) {
            ws.send(JSON.stringify({ type: "result", id: msg.id, ok: false, error: "Ocean UI is not connected. Launch the app (pnpm dev / pnpm electron:dev) and retry." }));
            return;
          }
          const brokerId = crypto.randomUUID();
          const timer = setTimeout(() => pending.delete(brokerId), 30_000); // leak guard
          pending.set(brokerId, { agent: ws, agentReqId: msg.id, timer });
          ui.send(JSON.stringify({ type: "invoke", id: brokerId, tool: msg.tool, args: msg.args }));
          return;
        }

        // UI → broker → originating agent
        if (msg.type === "result" && msg.id) {
          const p = pending.get(msg.id);
          if (!p) return;
          clearTimeout(p.timer);
          pending.delete(msg.id);
          try {
            p.agent.send(JSON.stringify({ type: "result", id: p.agentReqId, ok: msg.ok, data: msg.data, error: msg.error }));
          } catch { /* agent went away mid-flight */ }
          return;
        }
      },
      close(ws) {
        if (ws === ui) { ui = null; console.error("[ocean-bridge] UI disconnected"); }
        if (ws.data.role === "agent") {
          for (const [bid, p] of pending) if (p.agent === ws) { clearTimeout(p.timer); pending.delete(bid); }
        }
      },
    },
  });
  console.error(`[ocean-bridge] listening on ws://127.0.0.1:${PORT} (pid ${process.pid})`);
} catch {
  // Port already held → another broker is live; defer to it.
  console.error(`[ocean-bridge] port ${PORT} already in use; deferring to existing broker`);
  process.exit(0);
}
