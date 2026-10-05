---
name: ConnectSphere
description: Editorial, high-contrast warm-neutral system for a multi-role event-ops product — Luma-style public surfaces over dense internal dashboards.
colors:
  paper: "#f6f6f4"
  paper-tint: "#efefec"
  surface: "#ffffff"
  ink: "#151515"
  ink-60: "rgba(21, 21, 21, 0.64)"
  ink-30: "rgba(21, 21, 21, 0.4)"
  harbor: "#1c1c1e"
  harbor-tint: "rgba(21, 21, 21, 0.05)"
  amber: "#926500"
  amber-tint: "#faf3e3"
  coral: "#b93f28"
  coral-tint: "#fbeae6"
  mist: "rgba(21, 21, 21, 0.08)"
  mist-dark: "rgba(21, 21, 21, 0.14)"
  stroke: "rgba(21, 21, 21, 0.46)"
colorsDark:
  paper: "#131313"
  paper-tint: "#1a1a1a"
  surface: "#1e1e1e"
  ink: "#ffffff"
  ink-60: "rgba(255, 255, 255, 0.64)"
  ink-30: "rgba(255, 255, 255, 0.4)"
  harbor: "#ffffff"
  harbor-tint: "rgba(255, 255, 255, 0.08)"
  amber: "#c9a154"
  amber-tint: "#3a2e12"
  coral: "#dc8271"
  coral-tint: "#431610"
  mist: "rgba(255, 255, 255, 0.1)"
  mist-dark: "rgba(255, 255, 255, 0.14)"
  stroke: "rgba(255, 255, 255, 0.36)"
typography:
  display-h1:
    fontFamily: Inter Variable
    fontSize: 1.75rem
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.03em
  display-h2:
    fontFamily: Inter Variable
    fontSize: 1.75rem
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: -0.03em
  display-h3:
    fontFamily: Inter Variable
    fontSize: 1.0625rem
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: -0.03em
  event-title:
    fontFamily: Inter Variable
    fontSize: 3rem
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.03em
  hero-headline:
    fontFamily: Inter Variable
    fontSize: clamp(2.5rem, 6vw, 4rem)
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.03em
  body-md:
    fontFamily: Inter Variable
    fontSize: 0.9375rem
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: Inter Variable
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: Inter Variable
    fontSize: 0.8125rem
    fontWeight: 600
    lineHeight: 1.4
  caption:
    fontFamily: Inter Variable
    fontSize: 0.75rem
    fontWeight: 500
    lineHeight: 1.4
  eyebrow-caps:
    fontFamily: Inter Variable
    fontSize: 0.6875rem
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0.05em
  mono:
    fontFamily: Inter Variable
    fontSize: 0.8125rem
    fontWeight: 500
    lineHeight: 1.5
rounded:
  sm: 8px
  md: 16px
  lg: 20px
  pill: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
  3xl: 64px
components:
  button-primary:
    backgroundColor: "{colors.harbor}"
    textColor: "{colors.surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.pill}"
    padding: 10px 20px
  button-secondary:
    backgroundColor: "{colors.harbor-tint}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.pill}"
    padding: 10px 20px
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.ink-60}"
    typography: "{typography.body-md}"
    rounded: "{rounded.pill}"
    padding: 10px 20px
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.coral}"
    typography: "{typography.body-md}"
    rounded: "{rounded.pill}"
    padding: 10px 20px
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: 10px 12px
  status-pill-confirmed:
    backgroundColor: "{colors.harbor-tint}"
    textColor: "{colors.harbor}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: 2px 10px
  status-pill-progress:
    backgroundColor: "{colors.amber-tint}"
    textColor: "{colors.amber}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: 2px 10px
  status-pill-stopped:
    backgroundColor: "{colors.coral-tint}"
    textColor: "{colors.coral}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: 2px 10px
  focus-ring:
    borderColor: "{colors.harbor}"
    width: 2px
    offset: 2px
---

## Brand & Style

ConnectSphere is an internal event-operations platform with a consumer-style public entry, in the manner of Luma. It spans five roles (attendee, organiser, coordinator, venue staff, and technical support), and each role has its own dashboard. The system must stay legible where it is dense (approval queues, tables, checklists), and it must stay inviting on the public discover and event pages.

The visual character is **editorial and quiet**. It uses warm off-white paper, near-black ink, a single neutral "harbor" accent for anything actionable, and two reserved semantic colors for status only. The system uses no brand blue and no saturated primary. Restraint is the brand. Corners are soft, motion is minimal, and the one moment of visual flourish is the pink-to-amber gradient for headline text and event cover art.

## Colors

Neutrals carry almost the entire interface. The system uses color deliberately, only where it has meaning.

- **Paper / Paper Tint:** the page background, and a slightly deeper tint for grouped or quiet sections (approval rows, table headers).
- **Surface:** cards and inputs sit on pure white, above the paper.
- **Ink** with **Ink-60** and **Ink-30**: the entire text hierarchy is one color at three opacities. Full ink is for headings and primary text, 60% for body, secondary, and meta text, and 30% for the quietest metadata. **Ink-30 is never a text role in a primitive**: at 2.5:1 on paper it is a timestamp gray, not readable body copy.
- **Harbor:** the sole interactive accent, used for primary buttons, focus rings, links on hover, progress fills, and the "confirmed" status. It is near-black in light mode and white in dark. It is a role ("the accent"), not a fixed hue.
- **Amber and Coral:** reserved exclusively for status semantics: amber for in-progress or pending, coral for stopped, destructive, and error states. Each color has a pale `-tint` background for pill and icon fills.
- **Mist and Mist-dark:** ink-tinted transparent grays for hairline borders and dividers only, never for text or fills. Mist is the default hairline: `--border` resolves to it, and the card border carries it. Mist-dark is for the denser table and section rules.
- **Stroke:** the border that identifies a _form control_, distinct from a divider. Mist is a 1.3:1 hairline, right for a decorative rule but not enough for the border that shows a user where an input is. Stroke clears 3:1 on both paper and surface.
- **Overlay:** modal scrims use `--color-overlay`, a 10% black. It is the one place where a raw black fills a surface. The card shadow carries the only other literal black.
- **Accent gradient** (pink `#d93384` → amber `#f59e0b`, 90°): the one expressive color moment, reserved for headline accents and event cover art. It lives as `--accent-gradient`, and the attendee event page cover uses it through the `cover-art` utility.

### Dark mode

Dark mode is class-based on `<html>` through `next-themes`: the `.dark` block in `globals.css`, not `prefers-color-scheme`. Only the palette inverts, and every semantic alias follows from it. Paper goes to `#131313`, ink to white, harbor to white, and the mist and ink overlays flip to white at the same alphas.

**Amber and coral do not simply invert.** The design that they came from held its light amber and coral against near-black tints in dark mode. That choice puts status-pill text near 2:1 on its own background, a clear AA failure on a named primitive.

This system lightens both colors instead: amber to `#c9a154` (5.5:1 on its tint) and coral to `#dc8271` (5.5:1). The light values are a shade darker than the originals `#9a6a00` / `#c1432b`, which sat at 4.3–4.4:1. That is just under the 4.5:1 that 12px pill text needs. Re-derive from these values, not from the originals.

Every text-and-background pair that the primitives use clears the Web Content Accessibility Guidelines (WCAG) AA in both themes. Body and pill text need 4.5:1, and the focus ring and control borders need 3:1.

## Typography

The whole system uses a single font family, **Inter Variable** (`@fontsource-variable/inter`), with system fallbacks. There is no display/body split: voice comes from weight, size, and negative letter-spacing, not from a second typeface. `--font-sans`, `--font-heading`, and `--font-mono` all resolve to it. "Mono" signals _data_ (timestamps, reference codes) at 0.8125rem/500, not a genuine monospace rhythm.

- **Headings (h1–h3)** are 600-weight, with tight `-0.03em` tracking and a 1.08–1.2 line-height. H1 and h2 top out at 1.75rem. The tracking and weight come from `globals.css`.
- **Event title and hero headline** are the only oversized type roles. The hero headline is a fluid `clamp(2.5rem, 6vw, 4rem)` on the homepage, and the fixed 3rem event title (`event-title` in `globals.css`) heads the attendee event page. One moment per page must feel like a poster.
- **Body** is 0.9375rem at 1.5 line-height, set on `body` as the base size. Secondary body text is ink-60, never full ink, so paragraphs stay visually behind headings and UI chrome.
- **Label and caption** (0.8125rem and 0.75rem) carry the UI: form labels, pill text, and table meta. Table headers go uppercase at 0.6875rem with `0.05em` tracking, for a technical, spec-sheet tone.

## Layout

The shell is a single centered column, not a multi-column application frame. Even the coordinator and organiser dashboards are one 880px or 1120px column. At 860px and up, they sometimes split into a 1.6:1 two-column layout, for a primary panel plus a sidebar.

Spacing follows a compact 4/8/16/24/32/48/64px scale, which is Tailwind's own 4px-based scale, not a token tier of its own: `1/2/4/6/8/12/16` in class names. 16px (`4`) is the most used step. Card padding is 24px (`6`), and 64px (`16`) is reserved for the biggest vertical separations. Below the 640–860px breakpoints, two-column layouts collapse to one, and side-by-side rows stack. They do not shrink proportionally.

The nav is a slim sticky bar with a translucent, blurred paper background, not a hard border. Chrome recedes, and content floats underneath it.

## Elevation and Depth

The design is nearly flat. The dominant separators are 1px hairline borders (mist, mist-dark) and a one-step background shift (paper → paper-tint, or surface → a mist-tinted fill), not shadows.

Shadow gets heavier only as content gets more featured. Cards get a faint `0 1px 2px rgba(0,0,0,.03)`, and event cover art gets a real lift. The floating hero collage tiles get the strongest shadow in the system, because they must read as physically stacked cards. In dark mode, borders take over even more of this job, because shadows read poorly on near-black.

## Shapes

Two corner styles coexist on purpose:

- **Pill** (Tailwind `rounded-full`) for anything you act on or that represents status: buttons at every size, status pills, avatars, chips.
- **Soft rectangle** for anything you read inside: inputs at 8px (`--rounded-sm`), cards at 16px (`--rounded-md`), hero cover art and sign-in cards at 20px (`--rounded-lg`).

No surface that the system defines uses a sharp 0px corner, and none exceeds 20px. Two things sit below the 8px floor and must stay there. The first is a control glyph that is too small to carry a radius. A 16px checkbox at 8px is a circle, which reads as _radio_. The second is a corner nested inside another, where the inner radius comes from `--radius` and is not chosen. `globals.css` maps Tailwind's radius scale onto these values: `--radius-sm` and `--radius-md` both resolve to 8px, `--radius-lg` and `--radius-xl` to 16px, and `--radius-2xl` to 20px. `rounded-md` on an input and `rounded-xl` on a card therefore reach the right value, and neither primitive names a pixel.

## Components

### Buttons

The primary button is solid harbor with surface text and a filled pill. On hover, it fades its opacity rather than swapping the color. The secondary button is the same pill at a 5% ink tint with ink text. The ghost button drops the fill for the lowest-emphasis actions. The danger button keeps a surface background with coral text and border, and it fills to the coral tint only on hover. Destructive actions stay quiet until the user touches them.

Pill radius holds at **every** size, including the `sm`, `xs`, and icon variants. Inline table and row actions are exactly where the treatment matters most, so no size can declare a radius of its own.

### Status pills

A tint background under saturated text from the same family, always pill-shaped: `confirmed` (harbor), `progress` (amber), and `stopped` (coral) on `Badge`. This is the only place where amber and coral appear in light-mode chrome.

### Cards and list rows

`Card` is the base container: surface, 16px radius, a mist hairline, and a faint shadow. A list row (a date block, a title and meta, and a trailing status) is the denser alternative for scannable collections. The role dashboards use list rows instead of a card per row.

### Forms

Inputs are boxy at 8px, not pill. This is the one place where the system breaks from pills. A field is a read/write surface like a card, not an action like a button. An input border is stroke, not mist.

### Focus

One affordance covers the whole system: a 2px harbor outline at a 2px offset, declared once on `:focus-visible` in `globals.css`. Links and bare buttons get it for free, and keyboard behaviour is never special-cased per component. A primitive that suppresses the outline with `outline-none` carries the same indicator as a ring instead. The ring is `focus-visible:ring-2 focus-visible:ring-ring`, 2px and solid harbor, never a softened `/50` variant. Inside menus, popovers, and listboxes, the highlighted row carries the accent fill instead, and those surfaces do not draw the ring.

## Scope

This document and `globals.css` deliver the system and its shared primitives, not a redesign of every screen. Focusable primitives carry the system focus ring and take their radii from the tokens. The documented sub-8px glyphs, the nested corners, and the menu rows that highlight with the accent fill are the exceptions. Feature pages consume the primitives and the tokens, and new work must not reintroduce a hardcoded value that a token already owns. Email templates are the one surface that reads the palette's literal values, because email clients do not support CSS custom properties.

## Rules

- Do treat harbor as the only accent for actions and links. Do not introduce a second brand hue.
- Do reserve amber and coral for status semantics. Do not use them decoratively.
- Do build the text hierarchy with the ink / ink-60 / ink-30 steps. Do not introduce new grays, and do not set body text in ink-30.
- Do use pill radius for anything actionable or status-like, and soft-rectangle radius for anything that you read inside. Do not mix a sharp corner into either style.
- Do use mist for dividers and stroke for control borders. Do not use mist where a user must find an input.
- Do keep shadows minimal, and let borders and background tint carry the separation. Do not add shadow to justify a hierarchy that a border already communicates.
- Do route every color and radius value through the custom properties in `src/globals.css`, and spacing through Tailwind's scale. Do not hardcode a hex or px value that already has a token.
- Do re-check contrast when you change a palette value. Check both themes, and check the pill text pairs first: they have the least headroom in the system.
