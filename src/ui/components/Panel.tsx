import type { ReactNode } from "react";
import { cn } from "@/ui/lib/cn";

interface PanelProps {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

/** A panel with a consistent header bar + scrollable body. */
export function Panel({ title, right, children, className, bodyClassName }: PanelProps) {
  return (
    <section className={cn("flex min-h-0 min-w-0 flex-col bg-card", className)}>
      {title !== undefined && (
        <header className="flex h-9 flex-none items-center justify-between border-b border-border-soft px-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
          {right}
        </header>
      )}
      <div className={cn("min-h-0 flex-1 overflow-auto", bodyClassName)}>{children}</div>
    </section>
  );
}
