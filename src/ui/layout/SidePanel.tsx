import { useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { usePanels, PANEL_LIMITS, type PanelId } from "./panels";
import { cn } from "@/ui/lib/cn";

/** A dockable side panel: fixed-width column with a titled header, a close
 *  button, and a drag handle on the edge facing the preview for resizing. */
export function SidePanel({
  id,
  side,
  title,
  actions,
  children,
}: {
  id: PanelId;
  side: "left" | "right";
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const width = usePanels((s) => s.width[id]);
  const setWidth = usePanels((s) => s.setWidth);
  const setOpen = usePanels((s) => s.setOpen);
  const startRef = useRef(0);

  const beginResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    startRef.current = width;
    const move = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      // left panel grows when dragged right; right panel grows when dragged left
      setWidth(id, startRef.current + (side === "left" ? delta : -delta));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const handle = (
    <div
      onMouseDown={beginResize}
      title="Drag to resize"
      className={cn(
        "group absolute inset-y-0 z-20 flex w-1.5 cursor-col-resize items-stretch",
        side === "left" ? "-right-[3px]" : "-left-[3px]",
      )}
    >
      <span className="m-auto h-full w-px bg-transparent transition-colors group-hover:bg-primary/60" />
    </div>
  );

  return (
    <aside
      className={cn("relative flex flex-none flex-col bg-card", side === "left" ? "border-r border-border" : "border-l border-border")}
      style={{ width, minWidth: PANEL_LIMITS[id].min }}
    >
      <header className="flex h-8 flex-none items-center justify-between border-b border-border-soft pl-3 pr-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
        <div className="flex items-center gap-0.5">
          {actions}
          <button
            onClick={() => setOpen(id, false)}
            title={`Close ${title.toLowerCase()}`}
            className="grid size-5 place-items-center rounded text-subtle hover:bg-accent hover:text-foreground"
          >
            <X size={13} />
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      {handle}
    </aside>
  );
}
