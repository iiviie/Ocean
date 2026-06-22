import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "./styles/global.css";
import { Editor } from "./ui/Editor";
import { bootstrap, installAutosave } from "./model/projectFile";
import { installAgentBridge } from "./agent/bridge";
import { installSync } from "./agent/sync";

// Restore the last project (desktop) or scratch doc (browser); show the welcome
// screen when there's nothing to restore. Autosave keeps the open project in sync.
void bootstrap();
installAutosave();
// Expose the agent bridge (window.ocean) for the devtools console.
installAgentBridge();
// Connect to the MCP server bridge (optional; retries quietly if absent).
installSync();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Editor />
  </React.StrictMode>,
);
