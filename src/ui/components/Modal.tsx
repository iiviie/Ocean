import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/ui/lib/cn";

/** A minimal centered modal with a dimmed backdrop. Escape / backdrop-click
 *  closes (unless `dismissable={false}`). Rendered into <body> via a portal so
 *  it sits above every panel. */
export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 420,
  dismissable = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  dismissable?: boolean;
}) {
  useEffect(() => {
    if (!dismissable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, dismissable]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/60 backdrop-blur-sm"
      onMouseDown={() => dismissable && onClose()}
    >
      <div
        className={cn("flex max-h-[90vh] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl")}
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex flex-none items-center justify-between border-b border-border-soft px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {dismissable && (
            <button onClick={onClose} className="grid size-6 place-items-center rounded-md text-subtle hover:bg-accent hover:text-foreground">
              <X size={14} />
            </button>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-4">{children}</div>
        {footer && <footer className="flex flex-none items-center justify-end gap-2 border-t border-border-soft px-4 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
