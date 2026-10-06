---
name: Coche del Día
description: Daily car-guessing game styled as an instrument panel — graphite and bone, surfaces instead of rules, the photograph framed like a viewfinder.
theme: Asfalto
colors:
  primary: "#131416"
  signal: "#c9321c"
  reward: "#85631a"
  neutral-bg: "#f4f3ef"
  neutral-surface: "#ffffff"
  neutral-surface2: "#ebeae5"
  neutral-text: "#131416"
  neutral-muted: "#5b6068"
  good: "#117548"
  warn: "#9a5600"
  bad: "#c9321c"
typography:
  display:
    fontFamily: "Barlow Condensed, 'Arial Narrow', sans-serif"
    fontSize: "21px"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "0.005em"
  body:
    fontFamily: "Barlow, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.45
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "10.5px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.06em"
rounded:
  sello: "6px"
  celda: "10px"
  boton: "12px"
  tarjeta: "16px"
  foto: "18px"
  hoja: "24px"
spacing:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.neutral-text}"
    textColor: "{colors.neutral-bg}"
    rounded: "{rounded.boton}"
    height: "56px (app) / 60px (web)"
  verdict-cell:
    rounded: "{rounded.celda}"
    padding: "6px 9px"
    states: "correct = green tint · same country = amber tint · wrong = neutral surface, value struck through"
---

# Design System: Coche del Día

> **Maintenance note.** This document describes the **live** skin, «Asfalto».
> The site has been through four: mint neon on graphite → flat amber → «Prensa
> del motor» (a motoring newspaper: cream paper, Fraunces, square corners,
> rules and rubber stamps) → Asfalto. Asfalto ships in **phases**: phase 1
> (this one) changes the whole system — color, type, shape — and redesigns the
> game screen and the end-of-game panel; phase 2 brings tab navigation and
> redesigns Ranking, Archive, Profile and Repesca, which today wear the new
> system on their old layouts. If you find Fraunces, Libre Franklin, Courier
> Prime, `3px double` rules or rubber-stamp borders in code, it is sediment
> from Prensa. The executable source of truth is the RGB triplets and the
> `--radio-*` / `--ms-*` tokens in `:root` of `src/index.css`, plus the
> «PIEL ASFALTO» layer at the end of that file.

## 1. Overview

**Creative North Star: "the instrument panel that frames the photograph"**

The daily car is the only thing the player really looks at, so everything else
behaves like the dashboard around it: quiet surfaces, data set in mono, one
high-contrast control. A car configurator shows the car on dark for a reason,
and the night edition is where this skin is most at home.

**Key characteristics**

- **Surfaces, not rules.** Things separate by stepping up a surface (ground →
  surface → raised) and by air. A hairline exists, but it is a seam, not a
  drawing.
- **The photograph is a viewfinder.** Four camera corners and a magnification
  readout («3,7×» going down) say "this is a window, and this is how much of
  one" — the game's mechanic, made visible.
- **One primary action, in ink.** The guess button is the highest-contrast
  object on the screen: bone on graphite at night, near-black on light by day.
- **Data looks like data.** Years, points, counters, labels and the clock are
  IBM Plex Mono, tabular.

## 2. Themes

Two editions, one system: **día** (light) and **noche** (graphite). The night
edition only rewrites the RGB triplets in `:root[data-tema="noche"]`; every
derived color, border, and shadow follows. A hard-coded hex or a raw Tailwind
color is therefore a bug: it looks right in the edition you tested and
disappears in the other. The default follows the system preference
(`index.html` sets `data-tema` before first paint; `src/lib/theme.js` keeps the
override).

| Token | Día | Noche |
|---|---|---|
| `bg` | `#f4f3ef` | `#0c0d0f` |
| `surface` | `#ffffff` | `#141619` |
| `bg2` / raised | `#ebeae5` | `#1b1e22` |
| `line-strong` (seam) | `#cdcbc4` | `#3a3f46` |
| `tinta` (text, primary fill) | `#131416` | `#f2f0eb` |
| `tinta-2` (muted) | `#5b6068` | `#a7acb4` |
| `rojo` (signal) | `#c9321c` | `#e5402a` |
| `verde` (correct) | `#117548` | `#3fcf8e` |
| `ámbar` (same country / available) | `#9a5600` | `#f5a524` |
| `oro` (reward) | `#85631a` | `#e3c27a` |
| `plata` | `#5f636a` | `#c3c8cf` |
| `bronce` | `#8c522d` | `#c98a5e` |

The platform is stamped the same way on `<html data-plataforma="app">` from
`src/index.jsx` when running inside the APK.

## 3. Colors

### Named rules

**Every accent means one thing.**

- **Rojo** (`rojo`, aliased `accent`) is the brand's red — the two stripes of
  the logo — and in the UI it means **spent / attention**: a used attempt in the
  meter, the active section, an invalid field, a real error. It is **no longer
  the primary button** (that is ink). A wrong verdict uses it only for its ✕
  and its note, never as a fill.
- **Oro** (`gold`) means **this is worth something**: streak, victory points,
  podium, collection. Gold on ordinary chrome stops reading as a reward.
- **Ámbar** means **available / partial**: the "same country" hint, and a
  pending repesca. It is never a warning.

`plata` and `bronce` exist so the podium has three real metals that follow the
theme.

**The verdict rule.** Guess feedback uses the universal convention, and never
color alone — every cell carries its written note and a glyph (§8).

- **Verde** — correct: green-tinted cell, ✓, note «Correcto».
- **Ámbar** — partial, and it means exactly one thing: the guessed brand is
  **from the same country** as the real one. Amber-tinted cell with the flag
  and «Mismo país».
- **Wrong** — neutral surface, the value struck through, note «No es» in red.

The year has no partial state: correct within ±2, wrong otherwise, and a wrong
year carries a **direction arrow** and «Más nuevo / Más antiguo» in muted ink
instead of red — it informs, it does not scold.

**The one-high-contrast-fill rule.** On any screen exactly one element carries
the full-contrast fill, and it is the primary action (ADIVINAR, COMPARTIR).
The verdict tints are low-alpha washes, not fills.

**Contrast floor.** AA (4.5:1) for body and interactive text in **both**
editions; the light-edition red, green, amber and gold were darkened until
they passed on `bg`.

## 4. Typography

Three voices.

| Voice | Family | Used for |
|---|---|---|
| `font-display` | **Barlow Condensed** 600/700 | The game question, section titles, car names, big numbers, the primary button (uppercase, +0.08em) |
| `font-body` | **Barlow** 400–700 | All running text and UI: values in cells and fields, notes, body copy |
| `font-mono` | **IBM Plex Mono** 400/600 | Labels, kickers, years, points, counters, the magnification readout, the clock |

All three are static families, self-hosted from `public/fonts/` via
`src/fonts.css` (generated by `scripts/gen-local-fonts.mjs`), latin and
latin-ext only: 274 KB in total, down from 424 KB for the Prensa trio. The two
faces visible on first paint are preloaded in `index.html`.

**No italics, anywhere.** No italic faces are loaded, and a single rule in the
Asfalto layer neutralizes `font-style: italic` across the app: a synthesized
oblique is the worst thing you can do to a typeface. What Prensa set as an
italic caption is here plain text in muted ink.

## 5. Shape and elevation

**Corners have a radius, chosen by object size**, never ad hoc. Six tokens in
`:root`:

| Token | Value | Used for |
|---|---|---|
| `--radio-sello` | 6px | chips, small seals |
| `--radio-celda` | 10px | verdict cells, web fields, empty slots |
| `--radio-boton` | 12px | buttons, options, the floating peek, the countdown |
| `--radio-tarjeta` | 16px | the grouped coupon and content cards |
| `--radio-foto` | 18px | the photograph frame |
| `--radio-hoja` | 24px | top corners of the app's bottom sheets |

In JSX the rule stays what `test:estetica` enforces: **no Tailwind
`rounded-*` utilities**. Shape lives in tokens, like color and motion.

- Separation is surface and air; a `1px` seam in `--line` where two surfaces
  meet (e.g. the three rows of the app coupon card).
- Depth, when something genuinely floats (dropdown, modal panel, end panel,
  peek), is a real shadow derived from `--velo-rgb`, never from ink — a shadow
  from bone ink would be a pale halo at night.
- **No glows**, no glass, no gradient washes.

## 6. Motion — "el compás"

Motion is the fourth half of the system, and the last one to get written down.
Color had its RGB triplets, shape had its tokens, typography had its three
voices; motion had fourteen ad-hoc durations scattered across `index.css` and,
in most of them, no easing at all — that is, the browser's default `ease`, the
very curve `tailwind.config.js` described as *"too weak, no punch"* two lines
before not using it.

**The rule is that duration follows travel, not taste.** That is all you need
to avoid inventing another `.17s`. Six steps live in `:root` (`--ms-*`), each
with a job:

| Step | Value | Job |
|---|---|---|
| `--ms-pulso` | 90ms | something sinks under a finger and comes back. One pixel. |
| `--ms-roce` | 160ms | a color or a seam changes; geometry never notices. |
| `--ms-hoja` | 200ms | a panel enters or leaves. **Contractual** — see below. |
| `--ms-sello` | 280ms | the stamp: verdict cells, seals, the attempt meter. |
| `--ms-escena` | 460ms | something changes shape or face: a card flips, a bar fills. |
| `--ms-revelado` | 720ms | **the photograph, and nothing else.** |

`--ms-latido` (1.2s) sits outside the scale on purpose: it is not a journey
from A to B but an ambient pulse that never ends (the dashed row waiting on the
server). And `--ms-paso` (40ms) is not a duration either — it is the *distance
in time* between pieces in a cascade.

**`--ms-revelado` has exactly one consumer and stays that way.** The photograph
is the only thing in the app the player is actually watching while it moves, so
it is the only thing allowed to take most of a second.

**The step beats the name.** The end-of-game seal falls from `scale(1.7)`
rotating, so it *travels* like a scene even though it is called a stamp, and it
carries `--ms-escena`.

### The five curves

| Curve | Used for |
|---|---|
| `--curva-entra` | strong ease-out. Everything that arrives and settles. |
| `--curva-sale` | ease-in. Everything that gets out of the way. |
| `--curva-roce` | standard, symmetric. No geometry in play. |
| `--curva-sello` | **the only overshoot in the system.** A stamp bounces. |
| `--curva-lente` | long tail, for the photograph. A lens does not hesitate. |

### Named rules

**Exits are quicker than entrances.** `ModalShell` leaves in `--ms-roce` with
`--curva-sale` and enters in `--ms-hoja` with `--curva-entra`. The one
exception is the coupon sheet (`salidaRapida={false}`), because sheet, photo
frame and the chrome above it are one choreography (CLAUDE.md #18).

**The verdict is a four-beat phrase — seen and felt.** Make → model → year
stamp at 0/110/220ms (`PASO_VEREDICTO_MS` in `lib/veredicto.js`), and the
photograph opens on the fourth beat at 280ms (the transition delay in
`CarImage.jsx`). The attempt meter spends its segment and the magnification
readout re-stamps on that same fourth beat. The haptic phrase
(`haptic.veredicto`) taps on the same three beats, weighted by result; the end
of the game is felt when the end seal lands (`useSelloSentido`).

**Stamps fade in; they never slide.** Entrances animate opacity (and a 0.94 →
1 scale for cells), not position — `useEncajeEscenario` and
`useEscenarioApartado` measure those boxes with `getBoundingClientRect`.

**Hover is gated.** Every `:hover` rule lives inside `@media (hover: hover)`,
and Tailwind's `hover:` utilities compile the same way via
`future.hoverOnlyWhenSupported`. On a touch screen the browser applies hover on
*tap* and leaves it stuck.

**Every tap target answers the finger.** The app switches off
`-webkit-tap-highlight-color`; an **object** (button, card, chip, row) sinks one
pixel and a delegated `pointerdown` listener (`lib/tacto.js`) fires a selection
tick on anything tappable.

**Reduced motion is one rule, not a list.** A single universal rule kills
`animation` and drops `transition-duration` to 1ms — 1ms rather than `none`
because `transitionend` still has to fire for the sheet's settle cleanup.

### The guardrail is automated

`npm run test:estetica` fails on a loose duration or easing in `index.css`
(`compas-duracion` / `compas-curva`). Literals are allowed in exactly two
places: the token definitions themselves and inside the reduced-motion
silencer, where `1ms` is a zero and not a tempo.

## 7. Components

### Buttons
- **Primary** (`prensa-submit`, `cdd-submit`, `pm-btn`): ink fill, background
  colored text, Barlow Condensed 700 uppercase +0.08em, `--radio-boton`, 56px
  in the app and 60px on the web. Hover lowers the fill a step; press sinks one
  pixel. **Incomplete** stays tappable, as a pale raised fill with muted text;
  **working** keeps the ink fill with a sweeping band (`is-trabajando`).
- **Ghost**: transparent with a 1px seam ring.
- **Close** on photographs: a dark translucent rounded square with a white ✕.

### The game screen
- **Question + meter**: «¿Qué coche es?» on the left, «Intento 3 de 5» on the
  right, and between them the five-segment attempt meter (spent = red, current
  = ink, remaining = seam).
- **Photograph**: `--radio-foto`, no mat, the viewfinder corners and the
  magnification readout (`useGame` computes the real magnification over the
  full photo with the same formula as the server crop — the CSS scale alone
  would read 1,0× on the last attempt while the photo is still cropped).
- **History**: numbered rows of three verdict cells (§3).
- **Coupon** — app: the three selector rows grouped in one card
  (`prensa-renglones`); web: three rounded fields, ink focus ring, red only when
  invalid.

### End-of-game panel
Rounded floating panel (8px air on phones), the photograph band, the verdict
seal as a chip («Resuelto» on green, «Sin resolver» on a neutral surface —
losing is told, not painted red), points and streak, share in ink, the
countdown in a rounded box, the day's distribution with your bar in ink.

### Icons
Line icons (`components/configurator/icons.jsx`, 1.6 stroke on a 24 box;
`AchievementIcons.jsx` for achievements). The brand mark is the logo's car as a
CSS mask (`public/marca-coche.png`) over its two red stripes. **Emoji are banned
in the UI entirely** (§9).

## 8. Accessibility

- AA contrast minimum for text and interactive states, verified in both
  editions.
- **Color is never the sole carrier.** Every verdict cell has a written note and
  a glyph; the attempt meter is backed by the written «Intento n de 5».
- `prefers-reduced-motion` is honoured by **one** universal rule (§6), and
  haptics go silent with it.
- Keyboard navigation with a visible focus indicator on every interactive
  element.
- The game photo carries a localized `alt`; decorative flags, marks, viewfinder
  corners and verdict notes are `aria-hidden` (the exact verdict travels in
  `sr-only`).

## 9. Do's and Don'ts

### Do
- **Do** take every color from the theme tokens, so both editions follow.
- **Do** take every radius from `--radio-*`, by object size.
- **Do** set data (years, points, counters, labels) in mono.
- **Do** let the component supply the ornament, never the string.

### Don't
- **Don't** put **emoji** in JSX or in UI strings.
- **Don't** use the raw Tailwind palette or Tailwind `rounded-*` utilities.
- **Don't** add **glows** (`shadow-[0_0_…]`) or loose hex values in classes.
- **Don't** use red as a fill for anything but a real error, or for the primary
  button.
- **Don't** spend gold on anything that is not a reward.
- **Don't** set anything in italic.

### The guardrail is automated

`npm run test:estetica` (`scripts/check-estetica.mjs`, included in `npm test`)
fails the build on emoji in UI, raw Tailwind palette, Tailwind `rounded-*`,
glows, and loose hex in classes. `npm run test:layout` measures the app game
screen in six phones, both editions, with and without the keyboard: run it
whenever a change touches heights in the game screen or the sheets.

Three exceptions are encoded in the estética script **with their reason**, and
all three share it: they are painted outside our canvas — the plain-text share
string, the push notification title, and the flag map. `src/admin/` is exempt
as an internal tool.
