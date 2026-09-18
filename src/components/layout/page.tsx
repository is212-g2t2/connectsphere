import type { ReactNode } from "react";

import { cn } from "#/lib/utils";

const WIDTHS = {
  page: "max-w-page",
  wide: "max-w-wide",
} as const;

interface PageProps extends React.ComponentProps<"main"> {
  /** `page` is the 880px column; `wide` is the 1120px column. See docs/DESIGN.md §Layout. */
  width: keyof typeof WIDTHS;
  /** Renders a 1.6:1 two-column at 860px and up: primary content beside this panel. */
  sidebar?: ReactNode;
}

export function Page({ width, sidebar, className, children, ...props }: PageProps) {
  return (
    <main className={cn("mx-auto w-full px-6 py-8 pb-16", WIDTHS[width], className)} {...props}>
      {sidebar ? (
        <div className="grid items-start gap-8 split:grid-cols-[1.6fr_1fr]">
          <div className="min-w-0">{children}</div>
          {sidebar}
        </div>
      ) : (
        children
      )}
    </main>
  );
}

interface PageHeaderProps {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div>
        {eyebrow ? <p className="eyebrow text-muted-foreground">{eyebrow}</p> : null}
        <h1 className="mt-3 display-h1">{title}</h1>
        {description ? <p className="mt-2 body-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
