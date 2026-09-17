export { cn } from "cn";

export const NAV_LINK_CLASSNAME =
  "body-md underline decoration-border underline-offset-4 hover:decoration-foreground";

/** Keeps log lines traceable without writing a full address to stdout. */
export function maskEmail(address: string): string {
  const [local, domain] = address.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}
