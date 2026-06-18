---
name: Coche del Día
description: Daily car-guessing game inspired by high-end automotive configurators.
colors:
  primary: "#7af0c8"
  secondary: "#e8c87a"
  neutral-bg: "#0d1014"
  neutral-surface: "#14181e"
  neutral-surface2: "#1b212a"
  neutral-text: "#eef2f6"
  neutral-muted: "#8b95a3"
  bad: "#e26060"
  warn: "#eab44e"
typography:
  display:
    fontFamily: "Archivo, sans-serif"
    fontSize: "clamp(16px, 4.2vw, 19px)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Archivo, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.2
  label:
    fontFamily: "Space Mono, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.26em"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
spacing:
  sm: "8px"
  md: "14px"
  lg: "20px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#05131d"
    rounded: "{rounded.md}"
    padding: "14px 14px"
  button-primary-hover:
    backgroundColor: "#5bd3ab"
  input-flat:
    backgroundColor: "{colors.neutral-surface2}"
    textColor: "{colors.neutral-text}"
    rounded: "{rounded.md}"
    padding: "14px 14px"
---

# Design System: Coche del Día

## 1. Overview

**Creative North Star: "The Precision Cockpit"**

Structured, clean, and engineered. Coche del Día feels like premium automotive equipment rather than a casual web toy. The interface emphasizes high information density, crisp dividers, and tactile micro-interactions. The design focuses the player's full attention on the main game flow (guessing the car from a zoomed image) while placing statistics, streaks, and the virtual garage in refined overlays that evoke the feeling of a digital instrument cluster.

This system explicitly rejects standard Wordle clones, cheap ad-laden mobile game layouts, generic SaaS dashboard grids, and generic AI templates utilizing neon purple-to-blue gradients.

**Key Characteristics:**
- **High Information Density**: UI elements are compact, letting the central car image dominate the viewport.
- **Engineered Layouts**: Borders are fine, spacing is precise, and inputs feel like physical cockpit buttons.
- **Immediate Engagement**: Zero splash screens or blocking animations; instant feedback on every keypress.

## 2. Colors

A technical dark palette featuring sharp menta neon actions and premium gold rewards.

### Primary
- **Menta Neon** (#7af0c8 / oklch(88% 0.18 162)): Used for active buttons, successful guesses, and interactive states to denote progress and success.

### Secondary
- **Oro Bruñido** (#e8c87a / oklch(82% 0.13 85)): Reserved for premium achievements, streaks, and status indications (valuable states).

### Neutral
- **Grafito Profundo** (#0d1014): The base application background, providing a deep, high-contrast canvas.
- **Obsidiana** (#14181e): Used for surface containers, cards, and modal panels.
- **Carbón** (#1b212a): Used for input fields, listbox options, and secondary surface layers.
- **Platino** (#eef2f6): Primary body and heading text color.
- **Acero Muto** (#8b95a3): Secondary description text, placeholders, and inactive labels.

### Named Rules
**The 10% Accent Rule.** The primary accent (Menta Neon) is used strictly on active controls and successful feedback. It must never occupy more than 10% of any screen to maintain its value as an action trigger.
**The Fallback Fail Rule.** Bad states (failed guesses) must use a sober, non-fluorescent red (#e26060) to prevent the screen from looking overly chaotic or cheap.

## 3. Typography

**Display Font:** Archivo (with sans-serif fallback)
**Body Font:** Archivo (with sans-serif fallback)
**Label/Mono Font:** Space Mono (with monospace fallback)

**Character:** A pairing that balances readable humanist readability (Archivo) with technical, mechanical precision (Space Mono).

### Hierarchy
- **Display** (Bold (700), clamp(16px, 4.2vw, 19px), 1): Brand wordmark and main headers. Compact and clean.
- **Headline** (ExtraBold (800), 14px, 1.2): Section headers and primary action text.
- **Body** (Medium (500), 14px/15px, 1.2): Readouts, options, and input values.
- **Label** (Regular (400), 11px, 1.0, tracking 0.26em, uppercase): Technical labels, metadata, and column headers.

### Named Rules
**The Technical Label Rule.** Every input label and metadata field must use Space Mono in uppercase with wide tracking to reinforce the instrument panel aesthetic.

## 4. Elevation

The interface is flat-by-default with tactile physical responses. Depth is conveyed using fine borders and elevation colors rather than fuzzy shadows.

### Named Rules
**The Flat-Border Rule.** Containers use a fine 1px border with a low-opacity white (rgba(255,255,255,0.06)) to define surfaces instead of drop shadows.
**The Active State Rule.** Depth is created dynamically through interactive feedback: active buttons scale down (98%) and focused inputs receive a solid Menta Neon outline.

## 5. Components

### Buttons
- **Shape:** Soft-cornered rectangle (12px border-radius)
- **Primary:** Menta Neon background with dark ink text (#05131d), padded with 14px vertically and horizontally.
- **Hover / Focus:** Transition to a slightly lighter menta (#5bd3ab) with a scale down on active tap (98%).
- **Ghost:** Transparent background with a border mixed from Menta Neon and surface lines.

### Inputs / Fields
- **Style:** Flat dark container (#1b212a) with 1px border. Height is 44px (12px border-radius).
- **Focus:** Sharp border outline in Menta Neon with a subtle glow ring.

### Cards / Containers
- **Corner Style:** Medium curves (16px / 18px border-radius)
- **Background:** Obsidiana (#14181e) with 1px border.
- **Padding:** 16px internal padding.

### Chips
- **Style:** Compact container (10px border-radius), colored based on validation state (Menta tint for correct, Red tint for incorrect, Yellow tint for near-correct).

## 6. Do's and Don'ts

### Do:
- **Do** use uppercase Space Mono with at least 0.26em letter-spacing for all form labels.
- **Do** ensure active buttons scale down to 98% on press to simulate a mechanical button.
- **Do** keep borders at exactly 1px thickness with low opacity (rgba(255,255,255,0.06)) to define containers.

### Don't:
- **Don't** use neon purple or blue gradients anywhere in the UI.
- **Don't** use side-stripe borders (e.g., border-left-4) on cards or list items.
- **Don't** use glassmorphism or blur filters as default background decorations.
- **Don't** let text overflow grids; headlines must clamp correctly on mobile layouts.
