---
name: Coche del Día
description: Daily car-guessing game styled as a motoring newspaper — ink on paper, rules instead of shadows.
theme: Prensa del motor
colors:
  primary: "#b3271b"
  secondary: "#7a5c10"
  neutral-bg: "#f3eee1"
  neutral-surface: "#fbf7ec"
  neutral-surface2: "#e9e2cf"
  neutral-text: "#1b1712"
  neutral-muted: "#6e6553"
  good: "#146e33"
  warn: "#9a5510"
  bad: "#b3271b"
typography:
  display:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "clamp(28px, 9vw, 44px)"
    fontWeight: 900
    lineHeight: 0.95
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Libre Franklin, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.35
  label:
    fontFamily: "Courier Prime, monospace"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.22em"
rounded:
  sm: "0"
  md: "0"
  lg: "0"
spacing:
  sm: "8px"
  md: "14px"
  lg: "26px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral-bg}"
    rounded: "0"
    padding: "14px 16px"
  button-primary-hover:
    backgroundColor: "#8f1f16"
  input-flat:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.neutral-text}"
    rounded: "0"
    padding: "14px 14px"
    borderBottom: "2px solid {colors.primary} on focus"
---

# Design System: Coche del Día

> **Nota de mantenimiento.** Este documento describe la piel **viva**, «Prensa
> del motor». La web ha pasado por tres: neón menta sobre grafito → plano ámbar
> → prensa. Si encuentras menta (`#7af0c8`), `Archivo`, `Space Mono` o esquinas
> redondeadas en código o en un documento, es sedimento de una migración
> anterior, no el sistema. La fuente de verdad ejecutable son las ternas RGB de
> `:root` en `src/index.css` y los tokens de `tailwind.config.js`, que apuntan a
> ellas.

## 1. Overview

**Creative North Star: "La prensa del motor"**

The interface is a motoring newspaper, not an app chrome. Ink printed on paper:
rules and rifling instead of shadows, rubber stamps instead of icons, a masthead
and a folio instead of a navbar. The daily car is the front-page photograph, and
everything around it behaves like the page that frames it — captions, kickers,
a closing time at the foot.

This is deliberately **not** a dashboard, not a casual mobile game, and not a
Wordle clone with a dark mode. It rejects glassmorphism, neon gradients, glows,
and pill-shaped everything.

**Key characteristics**

- **Print, not screen.** Every separation is a rule (`border`) or a double rule
  (`arch-filete`). Nothing floats without reason; what floats does so with one
  single shadow recipe.
- **Typography does the decorating.** Where another system reaches for an icon
  or a colored badge, this one reaches for a stamp, a kicker, or a caption.
- **The photograph rules the page.** Layout, cropping, and fitting all serve
  keeping the car visible and the primary action reachable.

## 2. Themes

Two editions, one system: **día** (default, paper) and **edición de noche**
(warm graphite). The night edition is not a second design — it **only rewrites
the RGB triplets** in `:root[data-tema="noche"]`. Every derived color, border,
and shadow follows automatically.

That is why a hard-coded hex or a raw Tailwind color (`amber-400`, `zinc-300`)
is a bug and not a shortcut: it looks fine in the edition you were testing and
disappears in the other. A silver medal written as `zinc-300` scored 1.4:1 on
cream paper — invisible.

| Token | Día | Noche |
|---|---|---|
| `papel` (bg) | `#f3eee1` | `#17130d` |
| `papel-2` | `#e9e2cf` | `#211b12` |
| `papel-mat` (surface) | `#fbf7ec` | `#1e1a13` |
| `tinta` (text) | `#1b1712` | `#ece1cf` |
| `tinta-2` (muted) | `#6e6553` | `#9a8d76` |
| `rojo` / `accent` | `#b3271b` | `#e0574a` |
| `oro-viejo` / `gold` | `#7a5c10` | `#d9b877` |
| `verde` | `#146e33` | `#6bbf88` |
| `ámbar` | `#9a5510` | `#e0a04a` |
| `plata` | `#5f636a` | `#babec7` |
| `bronce` | `#8c522d` | `#cd855a` |

The theme is stamped on `<html data-tema>` by an inline script in `index.html`
(before first paint, so there is no flash) and toggled by `src/lib/theme.js`.
The platform is stamped the same way on `<html data-plataforma="app">` from
`src/index.jsx` when running inside the APK.

## 3. Colors

### Named rules

**The two-currency rule.** Red and gold are not interchangeable accents; they
say different things.

- **Rojo de rotativa** (`rojo`, aliased `accent`) means **action and
  attention**: the ADIVINAR button, the active link, the season kicker, the
  first-visit nudge on the rules link.
- **Oro viejo** (`gold` / `oro-viejo`) means **this is worth something**, and is
  reserved for the premium moments: streak, victory, podium, achievements. Gold
  spent on ordinary chrome stops reading as a reward.

`plata` and `bronce` exist so the podium has three real metals that follow the
theme.

**The verdict rule.** Guess feedback uses the universal convention, and never
color alone — every hint carries text or shape as well (see §8).

- **Verde** — correct.
- **Ámbar** — partial, and it means exactly one thing: the guessed brand is
  **from the same country** as the real one. It is not a general "close".
- **Rojo** — wrong.

The year has no partial state: it is correct within a tolerance of ±2 and wrong
otherwise, and a wrong year carries a **direction arrow** (up/down) instead of a
color of its own.

**The one-saturated-fill rule.** On any given screen exactly one element may
carry a saturated fill, and it is the primary action. Everything else is
typography and rules. The end-of-game screen is the canonical example: it once
had three green emoji, a gold box, and a double-ruled frame competing with the
share button, which made the CTA the fifth most eye-catching object on a screen
with one job.

**Contrast floor.** AA (4.5:1) for body and interactive text, in **both**
editions. Placeholders included — they were at 2.4:1 as a `.62`-alpha tint until
they were moved onto the muted ink token.

## 4. Typography

Three voices, and they never collapse into one.

| Voice | Family | Used for |
|---|---|---|
| `font-display` | **Fraunces** (Georgia, serif) | Mastheads, headlines, ordinals, car names |
| `font-body` | **Libre Franklin** (Arial, sans) | All UI: buttons, labels, running text |
| `font-mono` | **Courier Prime** (monospace) | Technical labels, kickers, counters, stamps, the closing clock |

All three are self-hosted in `src/fonts.css`. The families are declared on
`:root`, not only inside `.prensa` — modals, the archive, and the leaderboard
render *outside* that root, and when the variables were scoped to `.prensa`
their `font-family: var(--font-display)` silently resolved to nothing and fell
back to the body sans. Three voices became one everywhere except the game
screen.

### Named rules

**The kicker rule.** Metadata, section labels, and counters are set in Courier
Prime, uppercase, tracking ≥ 0.2em (`pm-kicker`). It is the typographic
equivalent of a caption in a newspaper — small, technical, and never competing
with the headline.

**The stamp rule.** Verdicts and status are **rubber stamps** (`pm-sello`,
`prensa-sello`): a rotated rectangle with a ruled border and mono type. This is
the system's answer to badges and emoji.

## 5. Shape and elevation

**No rounding. No glows.** Both are absolute in this skin.

- Corners are square (`rounded-none`). Any `border-radius` still present in base
  CSS is legacy from the previous skin and is explicitly neutralized under
  `.prensa` — e.g. `.prensa .cdd-stage-frame { border-radius: 0 }` overrides the
  16px left over from the flat-amber era.
- Separation is a **filete**: `1px solid` in ink. Section breaks use the
  **doble filete** `arch-filete` (`3px double`).
- Depth, when something genuinely floats (dropdown, modal panel, toast, a cover
  lifting on hover), is one single recipe: `--sombra-flota`. It is defined once
  per edition — a light touch on paper (18% alpha), real weight on graphite
  (55%) — because a shadow tuned for cream paper is invisible on graphite, and
  a shadow derived from *ink* inverts into a pale halo at night, which is
  precisely the glow the system forbids.
- Photographs are mounted, not bled: `arch-paspartu` gives them a paper mat, so
  leftover space reads as mounting board rather than as a gap.

## 6. Motion — "el compás"

Motion is the fourth half of the system, and the last one to get written down.
Color had its RGB triplets, shape had its rule, typography had its three
voices; motion had fourteen ad-hoc durations scattered across `index.css` and,
in most of them, no easing at all — that is, the browser's default `ease`, the
very curve `tailwind.config.js` described as *"too weak, no punch"* two lines
before not using it.

**The rule is that duration follows travel, not taste.** That is all you need
to avoid inventing another `.17s`. Six steps live in `:root` (`--ms-*`), each
with a job:

| Step | Value | Job |
|---|---|---|
| `--ms-pulso` | 90ms | the paper sinks under a finger and comes back. One pixel. |
| `--ms-roce` | 160ms | a color or a rule changes; geometry never notices. |
| `--ms-hoja` | 200ms | a panel enters or leaves. **Contractual** — see below. |
| `--ms-sello` | 280ms | the rubber stamp. |
| `--ms-escena` | 460ms | something changes shape or face: a card flips, a bar fills. |
| `--ms-revelado` | 720ms | **the photograph, and nothing else.** |

`--ms-latido` (1.2s) sits outside the scale on purpose: it is not a journey
from A to B but an ambient pulse that never ends (the inked row waiting on the
server). And `--ms-paso` (40ms) is not a duration either — it is the *distance
in time* between pieces in a cascade.

**`--ms-revelado` has exactly one consumer and stays that way.** The photograph
is the only thing in the app the player is actually watching while it moves, so
it is the only thing allowed to take most of a second. A second consumer is
either a photo or a bug.

**The step beats the name.** The big end-of-game seal falls from `scale(1.7)`
rotating seven degrees, so it *travels* like a scene even though it is called a
stamp, and it carries `--ms-escena`. The alternative — steps that lie about how
long they last so the name matches the object — is worse.

### The five curves

| Curve | Used for |
|---|---|
| `--curva-entra` | strong ease-out. Everything that arrives and settles. |
| `--curva-sale` | ease-in. Everything that gets out of the way. |
| `--curva-roce` | standard, symmetric. No geometry in play. |
| `--curva-sello` | **the only overshoot in the system.** A stamp bounces. |
| `--curva-lente` | long tail, for the photograph. A lens does not hesitate. |

### Named rules

**Exits are quicker than entrances.** Opening presents something worth watching
arrive; closing is the user already having decided. `ModalShell` leaves in
`--ms-roce` with `--curva-sale` and enters in `--ms-hoja` with `--curva-entra`.
The one exception is the coupon sheet (`salidaRapida={false}`), because sheet,
photo frame and the chrome above it are one choreography (CLAUDE.md #18).

**The verdict is a four-beat phrase.** Make → model → year stamp at 0/110/220ms
(`STAGGER_MS` in `AttemptList.jsx`), and the photograph opens on the fourth beat
at 280ms (the transition delay in `CarImage.jsx`). They used to fire together,
with opposite curves. The delay does not make it slower, it makes it *legible*:
verdict first, consequence second.

**Ink appears; it never slides.** Entrances animate opacity, not `transform` —
both because that is what ink does and because `useEncajeEscenario` and
`useEscenarioApartado` measure those same boxes with `getBoundingClientRect`.
The metaphor and the safety constraint want the same thing.

**Hover is gated.** Every `:hover` rule lives inside `@media (hover: hover)`,
and Tailwind's `hover:` utilities compile the same way via
`future.hoverOnlyWhenSupported`. On a touch screen the browser applies hover on
*tap* and leaves it stuck: the guess button used to stay lifted with its hard
shadow after every attempt.

**Every tap target answers the finger.** The app switches off
`-webkit-tap-highlight-color`, and that highlight *was* the acknowledgement. Two
dialects replace it: an **object** (button, card, chip, row) sinks one pixel; a
**line of text** (service links, masthead) turns red. Plus a delegated
`pointerdown` listener (`lib/tacto.js`) that fires a selection tick on anything
tappable, so the modals are no longer mute while the game screen buzzes.

**Reduced motion is one rule, not a list.** There used to be eight
`prefers-reduced-motion` blocks each naming its own selectors, and two had
already fallen behind. Now a single universal rule kills `animation` and drops
`transition-duration` to 1ms — 1ms rather than `none` because `transitionend`
still has to fire for the sheet's settle cleanup.

### The guardrail is automated

`npm run test:estetica` fails on a loose duration or easing in `index.css`
(`compas-duracion` / `compas-curva`). Literals are allowed in exactly two
places: the token definitions themselves and inside the reduced-motion
silencer, where `1ms` is a zero and not a tempo.

## 7. Components

### Buttons
- **Primary** (`prensa-submit`, `cdd-submit`): square, red fill, paper-colored
  ink, 14–16px padding. Presses down (scale ~0.98) — mechanical, not springy.
- **Ghost / service links**: no fill, muted ink, red on hover.
- **Close**: a ruled square with a stroked ✕ glyph, never a circle.

### Inputs
- Flat surface, square, with a **2px red underline on focus** rather than a
  ring — a form filled in by hand, not a control panel. Native focus rings are
  suppressed only where the editorial indicator replaces them.
- Keyboard focus elsewhere is a uniform red `focus-ring`, `:focus-visible` only.

### Cards and containers
- Surface `papel-mat`, `1px` ink rule, square corners, 16px padding.
- The archive covers are **magazine covers**: masthead strip, issue number,
  4:3 photo in a paspartú, headline in Fraunces.

### Icons
There is a line-icon set (`components/configurator/icons.jsx`, 1.6 stroke on a
24 box; `AchievementIcons.jsx` for achievements). Prefer typography over icons,
and icons over emoji — **emoji are banned in the UI entirely** (§9).

## 8. Accessibility

- AA contrast minimum for text and interactive states, verified in both
  editions.
- **Color is never the sole carrier.** Verdict hints always pair color with text
  or shape; the attempt pips are ruled squares, not just colored dots.
- `prefers-reduced-motion` is honoured by **one** universal rule rather than a
  list of selectors to keep up to date (§6): animations off, transitions down to
  1ms, smooth scrolling down to instant, haptics silent, and the day/night
  crossfade never requested in the first place.
- Keyboard navigation with a visible focus indicator on every interactive
  element.
- The game photo carries a localized `alt`; decorative flags and rules are
  `aria-hidden`.

## 9. Do's and Don'ts

### Do
- **Do** take every color from the theme tokens (`papel`, `tinta`, `rojo`,
  `gold`, `plata`, `bronce`, `muted`), so both editions follow.
- **Do** reach for typography first: a kicker, a caption, or a stamp usually
  replaces the badge you were about to draw.
- **Do** keep rules at 1px ink, and use `arch-filete` when a section genuinely
  ends.
- **Do** let the component supply the ornament, never the string.

### Don't
- **Don't** put **emoji** in JSX or in UI strings.
- **Don't** use the raw Tailwind palette (`amber-400`, `zinc-300`, `slate-…`).
- **Don't** add **glows** (`shadow-[0_0_…]`) or loose hex values in classes.
- **Don't** round corners, and don't reintroduce blur/glass as decoration.
- **Don't** spend gold on anything that is not a reward.

### The guardrail is automated

`npm run test:estetica` (`scripts/check-estetica.mjs`, included in `npm test`)
fails the build on emoji in UI, raw Tailwind palette, glows, and loose hex in
classes. It exists because none of those break the build or the tests on their
own — they just make the site look like three different apps stitched together,
which is exactly what happened across the three skins.

Three exceptions are encoded in the script **with their reason**, and all three
share it: they are painted outside our canvas — the plain-text share string
(where emoji is the lingua franca of Wordle results and the destination app
draws them), the push notification title (drawn by Android), and the flag map.
`src/admin/` is exempt as an internal tool.
