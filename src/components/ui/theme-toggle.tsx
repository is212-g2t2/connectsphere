import * as React from "react";
import { Moon, Sun } from "lucide-react";

import { useTheme } from "../providers/theme-provider";

const emptySubscribe = () => () => {};

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  if (!mounted) {
    return <div aria-hidden="true" className="size-8" />;
  }

  const dark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring outline-none disabled:pointer-events-none disabled:opacity-50"
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
