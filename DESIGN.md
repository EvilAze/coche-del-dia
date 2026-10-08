---
name: Coche del Día
description: Daily car-guessing game styled as an instrument panel — graphite and bone, surfaces instead of rules, the photograph framed like a viewfinder.
theme: Asfalto
colors:
  primary: "#131416"
  signal: "#c9321c"
  reward: "#806610"
  neutral-bg: "#f4f3ef"
  neutral-surface: "#ffffff"
  neutral-surface2: "#ebeae5"
  neutral-text: "#131416"
  neutral-muted: "#5b6068"
  good: "#117548"
  warn: "#8a4604"
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
| `rojo` (signal) | `#c9321c` | `#f0533b` |
| `verde` (correct) | `#117548` | `#3fcf8e` |
| `ámbar` (same country / available) | `#8a4604` | `#f08c28` |
| `oro` (reward) | `#806610` | `#e8c86e` |
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
- Gold and amber are kept apart **in hue and in light**, not just by name:
  gold leans to brass (≈46°), amber to burnt orange (≈30°), with at least
  1.25:1 luminance between them in both editions. Until Oct 2026 they were the
  same ochre at 1.02:1, and the gold streak and the amber rescue row read as
  one family.

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
they passed on `bg`. **Measure on the lightest surface the color is written
on, not on the floor.** The night red passed on `bg` (4.7:1) and failed where
it is actually read — «No es» inside a history cell, on `surface` (4.4:1) — so
it was lifted to `#f0533b`: 5.2:1 on `surface`, 4.8:1 on `bg2`.

**A field that is not ready yet is sunk, not washed out.** Text that tells the
player what to do («Primero la marca») is an instruction and keeps AA; the
"not yet" lives in the surface (the cell drops to `bg`), never in an opacity
or a `--faint` that takes the sentence below 3:1.

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

**One scale, thirteen named steps** (`--t-*` in `:root`; Tailwind names them
too: `text-etiqueta`, `text-ui`…). Taken from what the product actually uses,
not from a ratio: until Oct 2026 there were 32 distinct sizes, eight of them on
a half pixel and five below 11px.

| Token | Size | Used for |
|---|---|---|
| `--t-etiqueta` | 11px | the FLOOR: labels, kickers, chips — nothing smaller |
| `--t-dato` | 12px | small figures, the tab bar |
| `--t-nota` | 13px | notes under a line |
| `--t-ui` | 14px | interface and card text (the most used size) |
| `--t-cuerpo` | 15px | running text, options |
| `--t-campo` | 16px | what you type (16 avoids iOS zoom on focus) |
| `--t-boton` | 17px | button words, header figures |
| `--t-pregunta` | 21px | «¿Qué coche es?», ADIVINAR, sheet titles |
| `--t-titulo` | 24px | card titles |
| `--t-cabecera` | 28px | dialog titles |
| `--t-seccion` | 30px | section names, the car's name |
| `--t-cifra` | 40px | big figures (profile, Archivo, position) |
| `--t-heroe` | 64px | today's points. Only one. |

A pixel `font-size` outside the tokens fails `test:estetica` (`tipo-suelto`),
and so does a `text-[Npx]` in JSX. `clamp()` stays allowed: a range, not a step.

**No italics, anywhere.** No italic faces are loaded, and a single rule in the
Asfalto layer neutralizes `font-style: italic` across the app: a synthesized
oblique is the worst thing you can do to a typeface. What Prensa set as an
italic caption is here plain text in muted ink.

## 5. Shape and elevation

**Corners have a radius, chosen by object size**, never ad hoc. Eight tokens in
`:root`, plus `0` (a hard corner) and `50%` (a circle) — nothing else:

| Token | Value | Used for |
|---|---|---|
| `--radio-mini` | 3px | what barely has a corner: flags, bars, 2px marks |
| `--radio-sello` | 6px | chips, small seals |
| `--radio-celda` | 10px | verdict cells, web fields, empty slots |
| `--radio-boton` | 12px | buttons, options, the floating peek, the countdown |
| `--radio-tarjeta` | 16px | the grouped coupon and content cards |
| `--radio-foto` | 18px | the photograph frame |
| `--radio-hoja` | 24px | top corners of the app's bottom sheets; centred dialogs |
| `--radio-pildora` | 999px | capsules: switches, pill chips |

In JSX the rule stays what `test:estetica` enforces: **no Tailwind
`rounded-*` utilities**. In `index.css` a numeric radius outside the token
definitions fails the same script (`forma-radio`): until Oct 2026, 97 loose
radii (1 to 22px) lived next to the tokens. Shape lives in tokens, like color
and motion.

- Separation is surface and air; a `1px` seam in `--line` where two surfaces
  meet (e.g. the three rows of the app coupon card).
- Depth, when something genuinely floats (dropdown, modal panel, end panel,
  peek), is a real shadow derived from `--velo-rgb`, never from ink — a shadow
  from bone ink would be a pale halo at night.
- **No glows**, no glass, no gradient washes.

**Layers** (`--capa-*`, and `z-hoja`, `z-dialogo`… in Tailwind). Only one App
overlay is open at a time, so all that needs ordering is what opens ON TOP of
another: barra 40 (tab bar, peek, coupon dropdown) · panel 60 (end panel, below
the sheets it opens) · hoja 80 (navigation surfaces) · hoja-sobre 90 (a sheet
over a sheet, the coupon sheet) · dialogo 100 · dialogo-sobre 120 (a dialog over
a sheet or a dialog, the day change) · aviso 200 (toasts). Inside a component,
1–10 is local order. Anything above 10 that is not a token, or a `z-[N]` in JSX,
fails `test:estetica` (`capa-suelta`). There used to be fourteen loose values,
each new overlay one notch above the last one anybody remembered.

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
  pixel. **Incomplete** stays tappable, as a raised `surface2` fill with a
  `line-strong` seam and ink text — a button waiting for you, not a broken
  one; **disabled** (`pm-btn:disabled`, e.g. the nickname dialog before you
  type) wears the same shape with muted text. **Working** keeps the ink fill
  with a sweeping band (`is-trabajando`).
- **Ghost**: transparent with a 1px seam ring.
- **Close** on photographs: a dark translucent rounded square with a white ✕.

### The game screen
- **Question + counter**: «¿Qué coche es?» on the left and, on the right, the
  counter (`prensa-contador`): «Intento 3 de 5» with the five-segment attempt
  meter **directly under it, at the label's width** (spent = red, current =
  ink, remaining = seam). The label is the meter's caption — the "step N of M"
  pattern nobody needs a legend for. It used to stretch across the gap between
  question and label, and players asked what the red and the white meant. The
  stack still fits in the question's line height, so it costs the photo nothing.
- **Photograph**: `--radio-foto`, no mat, the viewfinder corners and the
  magnification readout (`useGame` computes the real magnification over the
  full photo with the same formula as the server crop — the CSS scale alone
  would read 1,0× on the last attempt while the photo is still cropped). The
  readout is a **pill at the bottom centre, digits only** («2,5×»), where a
  phone camera puts its zoom chip: it used to sit bottom-left with a magnifier
  icon, on top of the bottom-left corner. Centred with auto margins, never with
  `translateX`, because the re-stamp animates `transform`.
- **History**: numbered rows of three verdict cells (§3). The ordinal sits on
  the page margin in a 22px column; the cells are already the container, so
  the row gets no card of its own.
- **Coupon** — app: the three selector rows grouped in one card
  (`prensa-renglones`), each ending in a **down** chevron (it opens a sheet over
  the same screen; `›` would promise a new screen). The model cell waiting for a
  brand drops to `bg`, loses its chevron and keeps its text in `tinta-2`. Web:
  three rounded fields, ink focus ring, red only when invalid; a disabled field
  is sunk the same way instead of fading to 45%.
- **A rejected guess is told where the problem is** (web): an empty, repeated
  or out-of-range field, or no network, writes one red line under the fields
  (`prensa-aviso`, `role="alert"`), marks the field `aria-invalid` and moves
  focus to it — never a toast at the foot of the screen. The app keeps the
  toast: its coupon is laid out to the pixel against the photo and the sheet.
  The brand and model fields are ARIA comboboxes (`aria-activedescendant` on
  the highlighted option).
- **What the player knows moves up the list.** After a «same country» brand,
  that country's brands leave their alphabetical place for a group at the
  top, «Mismo país que Nissan», in both coupons (web combo and app sheet).
  Nothing is hidden or dimmed: the list helps find, it doesn't rule out for
  the player.
- **Air around the primary action**: 12px above ADIVINAR (to the coupon) and
  12px below it (to the tab bar). The button must not rest on the bar's seam:
  the active tab's red line lives there and reads as the button's underline.

### End-of-game panel
A column of **cards** that enter one step after another (`fin-*`): the
photograph with the verdict chip («Resuelto en 3 de 5» on green, «Sin
resolver» on a neutral surface — losing is told, not painted red), the car in
a headline with its country and year as plates, what you did (the points with
the attempt grid when you win; your game line by line and one sentence on what
was missing when you lose), share in ink and the countdown, and below it what
is read if you stay: the broken streak, the rescue, your standing, the world's
distribution and the spec sheet. The rescue's own end panel is the same object
— and the same code: `PanelFin` owns the dialog, focus, Escape, back button,
Tab trap and the ✕, whose bar gains a background once the card scrolls.

- **The attempt grid speaks in shape too**: correct cells carry ✓, same-country
  cells (amber fill) carry ~, misses carry ✕, and each attempt is read out in
  words for screen readers («Intento 1 de 5: Fiat, mismo país; …»).
- **Share** is the ink button. The copied text opens with the result
  («Coche del Día · 08/10 · 4/5», «X/5» on a loss: a chat preview only shows
  the first line), keeps the three states (✅ correct · 🟨 same country ·
  ❌ miss), and if neither the share sheet nor the clipboard works the text
  appears in a box, selected, to copy by hand.
- **From 1024px the panel is two columns**: what happened (photo, car, score,
  share) on the left, what is read if you stay on the right. On phones the two
  groups are `display: contents` and it is the usual single column.
- **Offers inside the panel are secondary buttons** (surface + seam): the panel
  already has its one ink fill, Share.

### Navigation and sections
- **Tab bar** (`BarraSecciones`, phones only): Jugar · Clasificación · Archivo ·
  Perfil, with a red 2px line over the active tab and an amber dot on Archivo
  when a rescue is waiting. It is a door, not a router: the sections still open
  as sheets over the game (CLAUDE.md rule 24). While it is visible, the menu
  does not repeat its doors (nor the «?» of the header): it keeps account,
  settings and legal — unless a row carries a notice.
- **Desktop header** (≥1100px, no tab bar): Clasificación, Archivo and Perfil
  as words, not icons; once the game is over, VER RESULTADO moves up next to
  the photo, as on phones.
- **Doors for players without an account** share one shape: what is behind,
  shown without revealing it (the veiled table; the unprinted, numbered covers
  of the Archivo with today's dashed slot), then a left-aligned card with the
  benefit and «Entrar». A player who won today is told the points that will not
  count until they sign in.
- **Section screens** (Clasificación, Archivo, Perfil, Menú): the floor is
  `--bg` and everything on it is a card on `--surface` with a 1px seam. The
  section name is a 30px Barlow Condensed headline with the close button in its
  row — no kicker above it. Every section is a dialog for assistive tech
  (named, focus inside, Tab trapped via `lib/foco.js`), including the Archivo,
  which does not mount ModalShell; and a veil that is leaving stops taking taps
  the moment it closes.
- **An anonymous session is not an account.** The profile of a player without
  account shows their figures, offers «Iniciar sesión» under them and has no
  «Cerrar sesión»: closing an anonymous session cannot be undone.
- **Grouped lists** (`grupo-lista` / `grupo-fila`): settings and the menu.
  58px rows, hairline separators, a plain line icon in the secondary grey when
  the row needs one, a chevron or a control at the end.
- **Segmented control** (`Segmentado`, `components/Ajustes.jsx`): theme
  (Noche · Día · Auto), language, contact type. **Switch** (`.interruptor`):
  green when on.

### Dialogs
Decision dialogs (`dlg-*`: sign in, nickname, contact, delete account, the
rescue draw) are centred cards on both platforms. Text is **left-aligned**, the
title is a 28px headline sharing its row with the close button, fields are
boxes with a seam (`dlg-input`, ink focus ring), the primary action is the ink
button and «Ahora no» is a text line, not a second button of the same weight.
The only filled red button in the product is «Eliminar mi cuenta».

### Offers
The end-of-game offers (daily reminder, Android edition, create an account) are
cards with the question as a headline, one secondary button and an «Ahora no»
line (see the end panel: Share is its only ink fill).

### Legal pages
Privacy and account deletion open with a «Volver al juego» line at the top and
a grey kicker — nothing there is spent or needs attention, which is all red
says.

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
  element, **in ink** (`--cdd-text`), never red: red already means a field is
  invalid, and a focused field must not look like a wrong one.
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
- **Don't** put icons inside tinted squares. It is the most recognisable tic
  of mass-produced interfaces and here it never distinguished anything the
  text or the card colour did not already say. Icons go loose, in their
  colour, aligned to the first line — or not at all.
- **Don't** centre forms or paragraphs in a block; centre a single line at
  most.
- **Don't** stack a mono uppercase kicker over every title. Kickers label
  **data** (`TEMPORADA 5`, `PUNTOS SEGÚN EL INTENTO`); a section name or a
  dialog title stands on its own.
- **Don't** use the raw Tailwind palette or Tailwind `rounded-*` utilities.
- **Don't** add **glows** (`shadow-[0_0_…]`) or loose hex values in classes.
- **Don't** use red as a fill for anything but an irreversible action
  (deleting the account). The primary button is ink; red marks what is spent
  or needs attention, and a «new» badge is neither.
- **Don't** spend gold on anything that is not a reward.
- **Don't** set anything in italic.

### The guardrail is automated

`npm run test:estetica` (`scripts/check-estetica.mjs`, included in `npm test`)
fails the build on emoji in UI, raw Tailwind palette, Tailwind `rounded-*`,
glows, loose hex in classes, loose durations and curves, loose radii, loose
font sizes and loose z-index layers. `npm run test:layout` measures the app game
screen in six phones, both editions, with and without the keyboard: run it
whenever a change touches heights in the game screen or the sheets.

Three exceptions are encoded in the estética script **with their reason**, and
all three share it: they are painted outside our canvas — the plain-text share
string, the push notification title, and the flag map. `src/admin/` is exempt
as an internal tool.
