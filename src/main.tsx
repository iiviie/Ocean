import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "./styles/global.css";
import { Editor } from "./ui/Editor";
import { useStore } from "./model/store";
import { createSampleProject } from "./model/sample";
import { loadPersisted, installPersistence } from "./model/persist";
import { installAgentBridge } from "./agent/bridge";
import { installSync } from "./agent/sync";

// Restore saved work; fall back to the sample project on first run. This makes
// edits survive reloads / Vite HMR instead of being wiped by a re-seed.
useStore.getState().loadProject(loadPersisted() ?? createSampleProject());
// Autosave the document on every change (after the initial load).
installPersistence();
// Expose the agent bridge (window.ocean) for the devtools console.
installAgentBridge();
// Connect to the MCP server bridge (optional; retries quietly if absent).
installSync();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Editor />
  </React.StrictMode>,
);
