import { cloneElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { cn } from "cn";

import { Button, buttonVariants } from "#/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip";

type IconActionTone = "default" | "danger";

const TONE_CLASS: Record<IconActionTone, string | undefined> = {
  default: undefined,
  danger: "text-destructive hover:text-destructive",
};

type IconActionProps = Omit<
  ComponentProps<typeof Button>,
  "children" | "aria-label" | "variant"
> & {
  /** The accessible name. The tooltip shows this same phrase. */
  label: string;
  /** The icon shown in the button. */
  icon: ReactNode;
  /** Danger tints the icon destructive. Default keeps the ghost icon color. */
  tone?: IconActionTone;
};

/**
 * An icon-only button with a hover and focus tooltip. The tooltip repeats the `aria-label`,
 * so tests and assistive technology keep the same name as the text button it replaces.
 * The button always uses the ghost style, so it shows no border or fill at rest.
 */
export function IconAction({
  label,
  icon,
  tone = "default",
  size = "icon-sm",
  type = "button",
  className,
  ...props
}: IconActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        delay={0}
        render={
          <Button
            type={type}
            variant="ghost"
            size={size}
            aria-label={label}
            className={cn(TONE_CLASS[tone], className)}
            {...props}
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

type LinkElementProps = {
  className?: string;
  "aria-label"?: string;
};

/**
 * An icon-only router link styled as a button, with a hover and focus tooltip. The link
 * element carries its destination (`to`, `params`, `search`); the icon and style come from
 * here. The tooltip repeats the `aria-label`.
 */
export function IconActionLink({
  label,
  icon,
  link,
  tone = "default",
  size = "icon-sm",
  className,
}: {
  /** The accessible name. The tooltip shows this same phrase. */
  label: string;
  /** The icon shown in the link. */
  icon: ReactNode;
  /** A router `Link` (or anchor) element with its destination. Its own class is replaced. */
  link: ReactElement<LinkElementProps>;
  /** Danger tints the icon destructive. Default keeps the ghost icon color. */
  tone?: IconActionTone;
  size?: "icon" | "icon-xs" | "icon-sm" | "icon-lg";
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        delay={0}
        render={cloneElement(link, {
          "aria-label": label,
          className: cn(buttonVariants({ variant: "ghost", size }), TONE_CLASS[tone], className),
        })}
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
