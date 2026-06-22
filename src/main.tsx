import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "./styles/global.css";
import { Editor } from "./ui/Editor";
import { useStore } from "./model/store";
import { createSampleProject } from "./model/sample";
import { installAgentBridge } from "./agent/bridge";
import { installSync } from "./agent/sync";

// Load a sample project so the editor isn't empty on first run.
useStore.getState().loadProject(createSampleProject());
// Expose the agent bridge (window.ocean) for the devtools console.
installAgentBridge();
// Connect to the MCP server bridge (optional; retries quietly if absent).
installSync();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Editor />
  </React.StrictMode>,
);
