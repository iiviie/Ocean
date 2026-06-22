// WebSocket bridge to the Ocean MCP server. The MCP server relays each tool call
// here; the UI executes it through the command bus (so the edit is visible) and
// returns a compact result. The UI is the single executor — no duplicate state.
//
// This connection is OPTIONAL: if the MCP server isn't running, the editor works
// normally and quietly retries in the background.
import { runTool } from "@/agent/tools";

const PORT = 7331;
let ws: WebSocket | null = null;
let retry = 0;

type Inbound =
  | { type: "invoke"; id: string; tool: string; args: Record<string, unknown> }
  | { type: "ping" };

function connect(): void {
  try {
    ws = new WebSocket(`ws://127.0.0.1:${PORT}/ui`);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    retry = 0;
    // Identify as the UI so the broker knows which socket executes tool calls.
    ws?.send(JSON.stringify({ type: "hello", role: "ui" }));
    console.info("[ocean] connected to MCP bridge :%d", PORT);
  };

  ws.onmessage = async (ev) => {
    let msg: Inbound;
    try {
      msg = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    if (msg.type === "ping") return;
    if (msg.type === "invoke") {
      let result: { id: string; ok: boolean; data?: unknown; error?: string };
      try {
        const data = await runTool(msg.tool, msg.args);
        result = { id: msg.id, ok: true, data };
      } catch (e) {
        result = { id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      ws?.send(JSON.stringify({ type: "result", ...result }));
    }
  };

  ws.onclose = () => scheduleReconnect();
  ws.onerror = () => ws?.close();
}

function scheduleReconnect(): void {
  ws = null;
  retry = Math.min(retry + 1, 6);
  setTimeout(connect, 500 * retry); // backoff up to 3s
}

export function installSync(): void {
  connect();
}
