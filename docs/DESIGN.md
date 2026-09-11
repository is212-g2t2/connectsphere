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

ConnectSphere is an internal event-operations platform wearing a consumer, Luma-style front door. It spans five roles — attendee, organiser, coordinator, venue staff, tech support — each with its own dashboard, so the system has to stay legible dense (approval queues, tables, checklists) as well as inviting on the public discover and event pages.

The personality is **editorial and quiet**: warm off-white paper, near-black ink, a single neutral "harbor" accent for anything actionable, and two reserved semantic colors held back for status only. No brand blue, no saturated primary — restraint is the brand. Corners are soft, motion is minimal, and the one moment of visual flourish is the pink-to-amber gradient reserved for headline text and event cover art.

## Colors

Neutrals carry almost the entire interface; color is spent deliberately, only where it means something.

- **Paper / Paper Tint:** the page background, and a slightly deeper tint for grouped or quiet sections (approval rows, table headers).
- **Surface:** cards and inputs sit on pure white to lift off the paper.
- **Ink** with **Ink-60** and **Ink-30**: the entire text hierarchy is one color at three opacities — full ink for headings and primary text, 60% for body, secondary and meta, 30% for the quietest metadata. **Ink-30 is never a text role in a primitive**: at 2.5:1 on paper it is a timestamp gray, not readable body copy.
- **Harbor:** the sole interactive accent — primary buttons, focus rings, links on hover, progress fills, the "confirmed" status. Near-black in light mode, white in dark. It is a role ("the accent"), not a fixed hue.
- **Amber / Coral:** reserved exclusively for status semantics — amber for in-progress or pending, coral for stopped, destructive and error. Each ships with a pale `-tint` background for pill and icon fills.
- **Mist / Mist-dark:** ink-tinted transparent grays for hairline borders and dividers only, never for text or fills. Mist is the default hairline — it is what `--border` resolves to, and the radius the card carries; mist-dark is for the denser table and section rules.
- **Stroke:** the border that identifies a _form control_, distinct from a divider. Mist is a 1.3:1 hairline — right for a decorative rule, and not enough for the border that tells a user where an input is. Stroke clears 3:1 on both paper and surface.
- **Accent gradient** (pink `#d93384` → amber `#f59e0b`, 90°): the one expressive color moment, reserved for headline accents and event cover art. Not a token — no screen uses it yet; the first one that does adds `--accent-gradient` and a line here.

### Dark mode

Class-based on `<html>` through `next-themes` — the `.dark` block in `globals.css`, not `prefers-color-scheme`. Only the palette inverts; every semantic alias follows from it. Paper goes to `#131313`, ink to white, harbor to white, and the mist and ink overlays flip to white at the same alphas.

**Amber and coral do not simply invert.** The design they came from held its light amber and coral against near-black tints in dark mode, which lands status-pill text near 2:1 on its own background — a clear AA failure on a named primitive. Both are lightened here instead: amber to `#c9a154` (5.5:1 on its tint) and coral to `#dc8271` (5.5:1). The light values are a shade darker than the originals `#9a6a00` / `#c1432b`, which sat at 4.3–4.4:1 — just under the 4.5:1 that 12px pill text needs. Re-derive from these, not from the originals.

Every text-and-background pair the primitives use clears WCAG AA in both themes: 4.5:1 for body and pill text, 3:1 for the focus ring and control borders.

## Typography

Everything runs on a single family — **Inter Variable** (`@fontsource-variable/inter`) — with system fallbacks. There is no display/body split; voice comes from weight, size and negative letter-spacing rather than a second typeface. `--font-sans`, `--font-heading` and `--font-mono` all resolve to it: "mono" signals _data_ (timestamps, reference codes) at 0.8125rem/500, not a genuine monospace rhythm.

- **Headings (h1–h3)** are 600-weight with tight `-0.03em` tracking and a 1.08–1.2 line-height, giving an editorial, slightly condensed feel even though they are small by marketing standards — h1 and h2 top out at 1.75rem. The tracking and weight are applied globally in `globals.css`, so a heading never has to ask.
- **Event title / hero headline** are the only oversized type in the system — 3rem fixed, or a fluid `clamp(2.5rem, 6vw, 4rem)` on the homepage hero. One moment per page that should feel like a poster.
- **Body** is 0.9375rem at 1.5 line-height, set on `body` as the base size. Secondary body text is ink-60, never full ink, which keeps paragraphs visually behind headings and UI chrome.
- **Label / caption** (0.8125rem, 0.75rem) carry the UI: form labels, pill text, table meta. Table headers go uppercase at 0.6875rem with `0.05em` tracking for a technical, spec-sheet tone.

## Layout

The shell is a single centered column, not a multi-column app frame — even coordinator and organiser dashboards are one 880px or 1120px column, occasionally splitting into a 1.6:1 two-column at 860px and up for a primary panel plus sidebar.

Spacing follows a compact 4/8/16/24/32/48/64px scale, which is Tailwind's own 4px-based scale rather than a token tier of its own — `1/2/4/6/8/12/16` in class names. 16px (`4`) is the workhorse; card padding is 24px (`6`); 64px (`16`) is reserved for the biggest vertical separations. Below the 640–860px breakpoints, two-column layouts collapse to one and side-by-side rows stack, rather than shrinking proportionally.

The nav is a slim sticky bar with a translucent, blurred paper background rather than a hard border — chrome recedes, content floats underneath it.

## Elevation & Depth

Nearly flat by design: the dominant separators are 1px hairline borders (mist, mist-dark) and a one-step background shift (paper → paper-tint, or surface → a mist-tinted fill), not shadows.

Shadow gets heavier only as content gets more featured: cards get a barely-there `0 1px 2px rgba(0,0,0,.03)`, event cover art a real lift, and the floating hero collage tiles the strongest shadow in the system, because they are meant to read as physically stacked cards. In dark mode, borders take over even more of this job, since shadows read poorly on near-black.

## Shapes

Two corner languages coexist on purpose:

- **Pill** (Tailwind `rounded-full`) for anything you act on or that represents status — buttons at every size, status pills, avatars, chips.
- **Soft rectangle** for anything you read inside — inputs at 8px (`--rounded-sm`), cards at 16px (`--rounded-md`), hero cover art and sign-in cards at 20px (`--rounded-lg`).

No surface the system defines uses a sharp 0px corner, and none exceeds 20px. Two things sit below the 8px floor and should stay there: a control glyph too small to carry it — a 16px checkbox at 8px is a circle, which `questionnaire.tsx` uses to mean _radio_ — and a corner nested inside another, where the inner radius is derived from `--radius` rather than chosen. Tailwind's radius scale is mapped onto these in `globals.css` — `--radius-sm` and `--radius-md` both resolve to 8px, `--radius-lg` and `--radius-xl` to 16px, `--radius-2xl` to 20px — so `rounded-md` on an input and `rounded-xl` on a card land on the right value without either primitive naming a pixel.

## Components

### Buttons

Primary is solid harbor with surface text, filled pill, hover an opacity fade rather than a color swap. Secondary is the same pill at a 5% ink tint with ink text. Ghost drops the fill for the lowest-emphasis actions. Danger keeps a surface background with coral text and border, filling to the coral tint only on hover — destructive actions stay quiet until touched.

Pill radius holds at **every** size, the `sm`, `xs` and icon variants included — inline table and row actions are exactly where the treatment matters most, so no size may re-declare a radius of its own.

### Status pills

A tint background under saturated text from the same family, always pill-shaped: `confirmed` (harbor), `progress` (amber), `stopped` (coral) on `Badge`. This is the only place amber and coral appear in light-mode chrome.

### Cards & list rows

`Card` is the base container — surface, 16px radius, a mist hairline, a whisper of shadow. A list row — a date block, title and meta, a trailing status — is the denser alternative for scannable collections, and is what the role dashboards use instead of nesting a card per row.

### Forms

Inputs are boxy at 8px rather than pill — the one place the system breaks from pills, treating a field as a read/write surface like a card rather than an action like a button. Their border is stroke, not mist.

### Focus

One affordance for the whole system: a 2px harbor outline at 2px offset, declared once on `:focus-visible` in `globals.css`, so links and bare buttons get it for free and keyboard behaviour is never special-cased per component. A primitive that suppresses the outline with `outline-none` carries the same indicator as a ring instead — `focus-visible:ring-2 focus-visible:ring-ring`, 2px and solid harbor, never a softened `/50` variant.

## Scope

This document and `globals.css` deliver the system and its shared primitives, not a redesign of every screen. Every primitive in `src/components/ui/` is on the system's focus ring and takes its radii from the tokens, but the pages that compose them still carry the old layout and spacing; those are restyled as feature stories replace them.

## Do's and Don'ts

- Do treat harbor as the only accent for actions and links; don't introduce a second brand hue.
- Do reserve amber and coral for status semantics; don't use them decoratively.
- Do build text hierarchy with the ink / ink-60 / ink-30 steps; don't introduce new grays, and don't set body text in ink-30.
- Do use pill radius for anything actionable or status-like and soft-rectangle radius for anything you read inside; don't mix a sharp corner into either language.
- Do use mist for dividers and stroke for control borders; don't use mist where a user has to find an input.
- Do keep shadows minimal and let borders and background tint carry separation; don't add shadow to justify hierarchy a border already communicates.
- Do route every color and radius value through the custom properties in `src/globals.css`, and spacing through Tailwind's scale; don't hardcode a hex or px value that already has a token.
- Do re-check contrast when changing a palette value — both themes, and the pill text pairs first; they have the least headroom in the system.
