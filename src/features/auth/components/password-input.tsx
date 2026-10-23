import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";

const RULES = [
  { id: "length", label: "At least 8 characters", test: (value: string) => value.length >= 8 },
  { id: "number", label: "Contains a number", test: (value: string) => /\d/.test(value) },
  { id: "symbol", label: "Contains a symbol", test: (value: string) => /[^A-Za-z0-9]/.test(value) },
] as const;

interface PasswordInputProps extends React.ComponentProps<typeof Input> {
  /** Show the live 8-characters, number, and symbol checklist under the field. */
  showRules?: boolean;
}

/**
 * An `Input` with a reveal button. The button never submits the form, and the optional
 * rule checklist stays wired to the field through `aria-describedby`.
 */
export function PasswordInput({
  id,
  showRules,
  "aria-describedby": described,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const value = typeof props.value === "string" ? props.value : "";
  const rulesId = id ? `${id}-rules` : undefined;
  const describedBy =
    showRules && rulesId ? [described, rulesId].filter(Boolean).join(" ") : described;

  return (
    <div>
      <div className="flex gap-2">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          aria-describedby={describedBy}
          {...props}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          onClick={() => setVisible(current => !current)}
        >
          {visible ? <EyeOff /> : <Eye />}
        </Button>
      </div>
      {showRules && rulesId ? (
        <ul id={rulesId} aria-label="Password rules" className="mt-2 flex flex-col gap-1 text-sm">
          {RULES.map(rule => {
            const met = rule.test(value);
            return (
              <li
                key={rule.id}
                data-valid={met}
                className={met ? "text-foreground" : "text-muted-foreground"}
              >
                {met ? "✓ " : ""}
                {rule.label}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
