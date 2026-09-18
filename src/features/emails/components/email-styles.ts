/**
 * Email clients cannot read CSS custom properties, so these mirror the palette in
 * `src/globals.css` as literal values. See docs/DESIGN.md §Scope.
 */
export const emailHeading = {
  color: "#151515",
  fontSize: "28px",
  fontWeight: "600",
  letterSpacing: "-0.03em",
  lineHeight: "33.6px",
  margin: "0 0 20px",
};

export const emailText = {
  color: "rgba(21, 21, 21, 0.64)",
  fontSize: "15px",
  lineHeight: "22.5px",
  margin: "0 0 24px",
};

export const emailCaption = {
  color: "rgba(21, 21, 21, 0.64)",
  fontSize: "12px",
  fontWeight: "500",
  lineHeight: "16.8px",
};

export const emailButton = {
  backgroundColor: "#1c1c1e",
  borderRadius: "999px",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: "600",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "block",
  width: "fit-content",
  padding: "10px 20px",
};
