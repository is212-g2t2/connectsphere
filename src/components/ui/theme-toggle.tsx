import * as React from "react";
import { useTheme } from "../providers/theme-provider";
import { cn } from "cn";
import { Moon, Sun } from "lucide-react";

const emptySubscribe = () => () => {};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  if (!mounted) {
    return <div aria-hidden="true" className="h-8 w-[68px]" />;
  }

  const themes = [
    { id: "light", icon: Sun, label: "Light" },
    { id: "dark", icon: Moon, label: "Dark" },
  ] as const;

  return (
    <div className="flex items-center gap-1">
      {themes.map(t => {
        const Icon = t.icon;
        const isActive = theme === t.id;

        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTheme(t.id)}
            className={cn(
              "flex size-8 items-center justify-center rounded-md transition-colors outline-none",
              "focus-visible:ring-3 focus-visible:ring-ring/50",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            aria-label={`${t.label} theme`}
            aria-pressed={isActive}
            title={t.label}
          >
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}
