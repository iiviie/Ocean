// Demo/verification: act as an MCP client (like Claude Code does), spawn the
// Ocean MCP server, and drive a few tool calls. Edits appear live in the open UI.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "bun",
  args: ["run", "mcp/server.ts"],
  cwd: "/home/iiviie/cursor-projects/ocean",
});
const client = new Client({ name: "drive", version: "1" }, { capabilities: {} });
await client.connect(transport);

const call = async (name, args = {}) => (await client.callTool({ name, arguments: args })).content[0].text;

// Wait for the open browser tab to connect to the bridge.
let connected = false;
for (let i = 0; i < 20; i++) {
  const r = await call("get_project");
  if (!r.includes("not connected")) {
    console.log("UI connected. project:", r);
    connected = true;
    break;
  }
  console.log(`waiting for Ocean tab to connect... (${i + 1})`);
  await new Promise((r) => setTimeout(r, 1000));
}

if (connected) {
  console.log("timeline:", await call("get_timeline", { fromSec: 0, toSec: 6 }));
  console.log(await call("set_text", { clipId: "c3", content: "HELLO FROM\nCLAUDE CODE", color: "#4f8cff" }));
  console.log(await call("set_transform", { clipId: "c3", centerY: 0.5, scale: 1.3 }));
  console.log(await call("set_playhead", { atSec: 2 }));
  console.log(await call("add_marker", { atSec: 2, kind: "beat", label: "drop" }));
  console.log("layout@2s:", await call("get_canvas_layout", { atSec: 2 }));
}

await client.close();
console.log("done (server stopped, port freed)");
