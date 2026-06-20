import { useStore, createEmptyProject } from "@/model/store";
import { createSampleProject } from "@/model/sample";
import { MediaLibrary } from "./panels/MediaLibrary";
import { PreviewCanvas } from "./panels/PreviewCanvas";
import { Timeline } from "./panels/Timeline";
import { Inspector } from "./panels/Inspector";
import { AgentChat } from "./panels/AgentChat";

export function Editor() {
  const name = useStore((s) => s.project.name);
  const loadProject = useStore((s) => s.loadProject);
  return (
    <div className="app">
      <header className="titlebar">
        <div className="brand">
          <span className="dot" />
          Ocean
          <span className="proj">— {name}</span>
        </div>
        <div className="actions">
          <button
            className="ghost"
            title="Start a new empty project"
            onClick={() => {
              if (confirm("Start a new empty project? Unsaved changes will be lost.")) {
                const p = createEmptyProject();
                p.name = "Untitled";
                loadProject(p);
              }
            }}
          >
            New
          </button>
          <button className="ghost" title="Load the sample project" onClick={() => loadProject(createSampleProject())}>
            Sample
          </button>
          <button className="ghost">Save</button>
          <button className="primary">Export</button>
        </div>
      </header>

      <MediaLibrary />
      <PreviewCanvas />
      <div className="right-col">
        <Inspector />
        <AgentChat />
      </div>
      <Timeline />
    </div>
  );
}
