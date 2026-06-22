// Ocean MCP server.
//
// Runs under Bun. Speaks MCP over stdio (so Claude Code / Cursor / Claude Desktop
// can spawn it) and bridges every tool call to the running Ocean UI over a local
// WebSocket. The UI executes the call through its command bus and returns a
// compact result — which means every edit the agent makes is visible in the UI.
//
// IMPORTANT: stdout is reserved for the MCP JSON-RPC stream. All logging goes to
// stderr via console.error.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ServerWebSocket } from "bun";

const PORT = Number(process.env.OCEAN_PORT ?? 7331);

// ---------- UI WebSocket bridge ----------
let uiSocket: ServerWebSocket<unknown> | null = null;
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  fetch(req, server) {
    if (server.upgrade(req)) return;
    return new Response("Ocean MCP bridge");
  },
  websocket: {
    open(ws) {
      uiSocket = ws;
      console.error("[ocean-mcp] UI connected");
    },
    close() {
      uiSocket = null;
      console.error("[ocean-mcp] UI disconnected");
    },
    message(_ws, raw) {
      let msg: { type: string; id?: string; ok?: boolean; data?: unknown; error?: string };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === "result" && msg.id) {
        const p = pending.get(msg.id);
        if (!p) return;
        clearTimeout(p.timer);
        pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.data);
        else p.reject(new Error(msg.error ?? "tool failed in UI"));
      }
    },
  },
});
console.error(`[ocean-mcp] bridge listening on ws://127.0.0.1:${PORT}/ui`);

function invokeUI(tool: string, args: Record<string, unknown>): Promise<unknown> {
  if (!uiSocket) {
    return Promise.reject(
      new Error("Ocean UI is not connected. Launch it with `pnpm dev` (http://localhost:5173) or `pnpm tauri:dev`, then retry."),
    );
  }
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`tool '${tool}' timed out after 10s`));
    }, 10_000);
    pending.set(id, { resolve, reject, timer });
    uiSocket!.send(JSON.stringify({ type: "invoke", id, tool, args }));
  });
}

// ---------- tool catalog ----------
// Kept in lockstep with src/agent/tools.ts. (Next step per PRD §8.1: have the UI
// publish this catalog on connect so it's generated from the live registry and
// can never drift.)
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const S = { num: { type: "number" }, str: { type: "string" }, bool: { type: "boolean" }, strArr: { type: "array", items: { type: "string" } } };

const TOOLS = [
  { name: "get_project", description: "Project facts: canvas size, fps, duration, track/asset counts.", inputSchema: obj({}) },
  { name: "list_media", description: "List media library assets (id, kind, name, duration, dimensions).", inputSchema: obj({}) },
  { name: "get_timeline", description: "Windowed timeline view (never dumps the whole project). Times in seconds.", inputSchema: obj({ fromSec: S.num, toSec: S.num, trackIds: S.strArr }) },
  { name: "get_canvas_layout", description: "Spatial awareness at a time: each visible object's normalized box + overlap warnings.", inputSchema: obj({ atSec: S.num }, ["atSec"]) },
  { name: "get_selection", description: "What the human currently has selected in the UI (clips, asset, range, playhead).", inputSchema: obj({}) },
  { name: "recent", description: "Recent command log so you can verify the effect of your own edits.", inputSchema: obj({ n: S.num }) },
  { name: "import_media", description: "Import a media file from an absolute path into the library (probes real metadata). Returns { assetId, kind, dur }.", inputSchema: obj({ path: S.str }, ["path"]) },
  { name: "analyze_media", description: "Kick off perception analysis for an asset (async, non-blocking). Default kinds ['shots','silence']; also 'transcript'. Poll get_analysis_status / read with get_shots/get_silence/get_transcript. Desktop app only.", inputSchema: obj({ assetId: S.str, kinds: S.strArr }, ["assetId"]) },
  { name: "get_analysis_status", description: "Per-kind analysis status for an asset: ready | pending | none | unavailable | unsupported.", inputSchema: obj({ assetId: S.str, kinds: S.strArr }, ["assetId"]) },
  { name: "get_shots", description: "Windowed shot list for a video asset (idx, start, end, dur seconds). Returns { status } if not analyzed yet — call analyze_media first.", inputSchema: obj({ assetId: S.str, fromSec: S.num, toSec: S.num }, ["assetId"]) },
  { name: "get_silence", description: "Silent/low-audio spans (start, end, dur seconds — gaps & dead air, good cut points). Returns { status } if not analyzed — run analyze_media kinds:['silence'].", inputSchema: obj({ assetId: S.str, fromSec: S.num, toSec: S.num }, ["assetId"]) },
  { name: "get_transcript", description: "Windowed speech transcript (segments: id, start, end, text seconds). Returns { status } if not ready ('unavailable' = no speech-to-text backend installed). Run analyze_media kinds:['transcript'] first.", inputSchema: obj({ assetId: S.str, fromSec: S.num, toSec: S.num }, ["assetId"]) },
  { name: "add_track", description: "Add a track/layer ('video'|'audio'). Text overlays live on video tracks — no separate text track. Returns { trackId }.", inputSchema: obj({ kind: { type: "string", enum: ["video", "audio"] }, name: S.str }, ["kind"]) },
  { name: "remove_track", description: "Remove a track by id.", inputSchema: obj({ trackId: S.str }, ["trackId"]) },
  { name: "set_track", description: "Set track/lane properties: name, enabled (false hides a video lane / mutes an audio lane), locked, opacity (0..1, video lanes), volume (0..1, audio lanes).", inputSchema: obj({ trackId: S.str, name: S.str, enabled: S.bool, locked: S.bool, opacity: S.num, volume: S.num }, ["trackId"]) },
  { name: "add_clip", description: "Place a clip on a track. Pass `text` for a text overlay (goes on a video track). A video with audio auto-creates a linked audio clip on the lane beneath. Clips can't overlap on a lane. Returns { clipId }.", inputSchema: obj({ trackId: S.str, assetId: S.str, atSec: S.num, durationSec: S.num, text: S.str }, ["trackId", "atSec"]) },
  { name: "move_clip", description: "Move a clip on the timeline and/or to another track.", inputSchema: obj({ clipId: S.str, toSec: S.num, toTrackId: S.str }, ["clipId", "toSec"]) },
  { name: "trim_clip", description: "Trim a clip's source in/out range (seconds).", inputSchema: obj({ clipId: S.str, sourceInSec: S.num, sourceOutSec: S.num }, ["clipId"]) },
  { name: "split_clip", description: "Split (razor) a clip at a time. Returns { newClipId }.", inputSchema: obj({ clipId: S.str, atSec: S.num }, ["clipId", "atSec"]) },
  { name: "delete_clip", description: "Delete a clip (and its linked audio/video partner); ripple closes the gap.", inputSchema: obj({ clipId: S.str, ripple: S.bool }, ["clipId"]) },
  { name: "unlink_clip", description: "Unlink a video clip from its auto-created audio clip so they move independently.", inputSchema: obj({ clipId: S.str }, ["clipId"]) },
  { name: "set_transform", description: "Set clip transform (center-anchored, normalized 0..1; rotation in degrees).", inputSchema: obj({ clipId: S.str, centerX: S.num, centerY: S.num, scale: S.num, rotation: S.num, flipH: S.bool, flipV: S.bool }, ["clipId"]) },
  { name: "set_text", description: "Edit a text clip's content/font/size/color/align/lineHeight.", inputSchema: obj({ clipId: S.str, content: S.str, fontName: S.str, fontSize: S.num, color: S.str, align: { type: "string", enum: ["left", "center", "right"] }, lineHeight: S.num }, ["clipId"]) },
  { name: "set_opacity", description: "Set clip opacity 0..1.", inputSchema: obj({ clipId: S.str, opacity: S.num }, ["clipId", "opacity"]) },
  { name: "set_fade", description: "Set opacity fade in/out (seconds).", inputSchema: obj({ clipId: S.str, fadeInSec: S.num, fadeOutSec: S.num }, ["clipId"]) },
  { name: "set_volume", description: "Set clip volume 0..1.", inputSchema: obj({ clipId: S.str, volume: S.num }, ["clipId", "volume"]) },
  { name: "set_speed", description: "Retime a clip (2 = 2x faster).", inputSchema: obj({ clipId: S.str, speed: S.num }, ["clipId", "speed"]) },
  { name: "set_canvas", description: "Set canvas/output settings: width/height (px), fps (24|25|30|60), backgroundColor (hex).", inputSchema: obj({ width: S.num, height: S.num, fps: S.num, backgroundColor: S.str }) },
  { name: "add_marker", description: "Add a timeline marker (e.g. a beat).", inputSchema: obj({ atSec: S.num, kind: { type: "string", enum: ["beat", "downbeat", "chapter", "generic"] }, label: S.str }, ["atSec"]) },
  { name: "clear_markers", description: "Clear markers (omit kind to clear all).", inputSchema: obj({ kind: { type: "string", enum: ["beat", "downbeat", "chapter", "generic"] } }) },
  { name: "set_playhead", description: "Move the playhead (seconds).", inputSchema: obj({ atSec: S.num }, ["atSec"]) },
  { name: "select_clips", description: "Select clips in the UI.", inputSchema: obj({ clipIds: S.strArr }, ["clipIds"]) },
];

// ---------- MCP server ----------
const server = new Server({ name: "ocean", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    const data = await invokeUI(name, (args ?? {}) as Record<string, unknown>);
    // If a tool returned a rendered frame (data URL), hand it back as an image
    // block so the model can actually SEE it.
    if (
      data &&
      typeof data === "object" &&
      typeof (data as { image?: unknown }).image === "string" &&
      (data as { image: string }).image.startsWith("data:")
    ) {
      const url = (data as { image: string }).image;
      const mime = url.substring(5, url.indexOf(";"));
      const b64 = url.slice(url.indexOf(",") + 1);
      const rest = { ...(data as Record<string, unknown>) };
      delete (rest as { image?: unknown }).image;
      return {
        content: [
          { type: "image", data: b64, mimeType: mime },
          { type: "text", text: JSON.stringify(rest) },
        ],
      };
    }
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  } catch (e) {
    return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
console.error("[ocean-mcp] MCP stdio server ready");
