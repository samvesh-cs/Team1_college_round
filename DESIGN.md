---
name: Handsfree Utility
colors:
  surface: '#faf8ff'
  surface-dim: '#d2d9f4'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f3ff'
  surface-container: '#eaedff'
  surface-container-high: '#e2e7ff'
  surface-container-highest: '#dae2fd'
  on-surface: '#131b2e'
  on-surface-variant: '#3e4947'
  inverse-surface: '#283044'
  inverse-on-surface: '#eef0ff'
  outline: '#6e7977'
  outline-variant: '#bdc9c6'
  surface-tint: '#006a63'
  primary: '#005c55'
  on-primary: '#ffffff'
  primary-container: '#0f766e'
  on-primary-container: '#a3faef'
  inverse-primary: '#80d5cb'
  secondary: '#006399'
  on-secondary: '#ffffff'
  secondary-container: '#7bc2ff'
  on-secondary-container: '#004f7b'
  tertiary: '#7d4200'
  on-tertiary: '#ffffff'
  tertiary-container: '#a15600'
  on-tertiary-container: '#ffe6d5'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#9cf2e8'
  primary-fixed-dim: '#80d5cb'
  on-primary-fixed: '#00201d'
  on-primary-fixed-variant: '#00504a'
  secondary-fixed: '#cde5ff'
  secondary-fixed-dim: '#94ccff'
  on-secondary-fixed: '#001d32'
  on-secondary-fixed-variant: '#004b74'
  tertiary-fixed: '#ffdcc3'
  tertiary-fixed-dim: '#ffb77d'
  on-tertiary-fixed: '#2f1500'
  on-tertiary-fixed-variant: '#6e3900'
  background: '#faf8ff'
  on-background: '#131b2e'
  surface-variant: '#dae2fd'
typography:
  headline-lg:
    fontFamily: Atkinson Hyperlegible Next
    fontSize: 20px
    fontWeight: '700'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Atkinson Hyperlegible Next
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.005em
  headline-sm:
    fontFamily: Atkinson Hyperlegible Next
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
  body-lg:
    fontFamily: Atkinson Hyperlegible Next
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
  body-md:
    fontFamily: Atkinson Hyperlegible Next
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  body-sm:
    fontFamily: Atkinson Hyperlegible Next
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-lg:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.03em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 12px
    letterSpacing: 0.04em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 0.75rem
  margin: 0.75rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system is engineered for assistive productivity, built specifically around non-traditional desktop interaction models including eye-tracking, dwell-clicks, voice commands, and switch navigation. The design aesthetic is utilitarian, precise, and dependable—evoking the structural reliability of industrial operating system utilities, laboratory tooling, and classic physical accessibility hardware rather than transient SaaS trends, hyper-saturated gradients, or decorative glassmorphism.

Key brand values include:
- **Absolute Legibility:** Every pixel serves functional legibility and orientation. High-contrast typography and explicit spatial relationships eliminate cognitive friction.
- **Physical Feedback Simulation:** Tactile affordances, clear state transformations, and spatial stability reassure users whose primary input modality may have latency or limited dexterity.
- **Operational Calm:** Muted, neutral substrates keep users focused during prolonged computing sessions, mitigating sensory fatigue.

## Colors

The palette adheres to strict WCAG 2.1 AAA contrast targets for core body and control text against their relative containers.

- **Backgrounds & Canvas:** Root extension canvas resides on `#F8F9FA` with nested panel cards sitting on pure white `#FFFFFF` or recessed utility wells on `#F1F3F5`.
- **Text & Foreground:** Primary reading text uses deep charcoal-slate `#0F172A` (exceeding 13:1 contrast against `#FFFFFF`), secondary supporting labels use `#334155`, and disabled states never drop below 4.5:1 against surfaces using `#64748B`.
- **Accents:**
  - Primary Accent: Deep Teal (`#0F766E`), selected for clinical clarity and rock-solid AAA contrast against light backgrounds. Active/pressed state deepens to `#115E59`.
  - Secondary Accent: Deep Sky Slate (`#0369A1`), utilized for secondary action cues and contextual link behaviors.
  - Tertiary Accent: Dense Amber (`#D97706`), designated strictly for dwell timers, pending action states, and alert callouts.
- **Borders & Dividers:** Subtle structural delineation via `#E2E8F0`, hardening to `#CBD5E1` for actionable borders.
- **Focus Indicator:** Dedicated high-visibility focus outer outline rendered in `#0284C7` paired with a high-contrast white `#FFFFFF` inner separation offset.

## Typography

Typography prioritizes character discrimination and optical distinction. `Atkinson Hyperlegible Next` handles all headlines and running body text, ensuring zero ambiguity between similar glyphs (such as uppercase 'I', lowercase 'l', and number '1'). Monospaced numerical values, status badges, shortcut bindings, and dwell readouts utilize `JetBrains Mono` for rigid tabular alignment.

Sizes are tightly controlled to fit compact Chrome extension popup viewports (standard 360px–420px widths) while guaranteeing effortless parsing at desktop distances. Heading scales remain restrained to preserve critical interactive vertical space.

## Layout & Spacing

Chrome extensions require efficient use of space within bounded dimensions (typically 380px fixed width, variable height capped at 600px). Layout structure relies on a strict single-column stacked stack architecture or a 2-column balanced split for discrete metric displays.

- **Hit Targets:** Interactive hit targets never drop below 36px in physical height, maintaining a minimum 40px standard where dwell-selection or motor tremors are anticipated.
- **Rhythm:** Spacing follows an intentional 4px base increment (`0.25rem`, `0.5rem`, `0.75rem`, `1rem`, `1.5rem`). Nested items leverage `space-xs` and `space-sm` for tight association, while decoupled operational groups separate via `space-lg`.
- **Edge Buffer:** A persistent root boundary padding of `margin` (`0.75rem` / 12px) isolates interactive nodes from the Chrome browser shell frame to eliminate edge clip errors during pointer approach.

## Elevation & Depth

Visual hierarchy uses physical surface containment and low-contrast perimeter pinning rather than prominent floating drop shadows.

- **Surface Tiers:**
  - Base: `#F8F9FA` represents the non-clickable extension substrate.
  - Raised (Interactive Blocks / Panels): Pure `#FFFFFF` surfaces rimmed with a 1px solid border (`#E2E8F0`).
  - Inset (Data Readouts / Logs): `#F1F3F5` with a 1px inner stroke border (`#CBD5E1`) communicating immutable output.
- **Shadow Profiles:**
  - Level 0 (Cards, static panels): Completely flat, defined strictly by 1px borders.
  - Level 1 (Hovered / Focused interactive items): `0 1px 2px 0 rgba(15, 23, 42, 0.06), 0 1px 3px 1px rgba(15, 23, 42, 0.04)`.
  - Level 2 (Flyout menus / Popovers): `0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -2px rgba(15, 23, 42, 0.05)`.
- **Focus Elevation:** Focused elements avoid depth changes to prevent visual jitter. Instead, they receive a high-visibility, 2px solid `#0284C7` ring with a 2px `#FFFFFF` outline offset that renders above adjacent content.

## Shapes

The design system employs controlled geometric discipline with crisp, low-radius curvature (`roundedness: 1`). 

- Default interactive elements (buttons, inputs, switches, standard chips) apply a 4px (`rounded`) to 6px (`rounded-md`) radius.
- Cards, modal sub-panels, and segmented option groups cap out at 8px (`rounded-lg`).
- Fully rounded pills are strictly reserved for Dwell Progress Rings and Binary Status indicators (Active/Inactive state dots), anchoring them as discrete technical feedback mechanisms rather than soft consumer UI decorations.

## Components

### Buttons
- **Primary:** Background `#0F766E`, text `#FFFFFF`, font-weight 600, height 38px, border: 1px solid `#115E59`. Hover: `#115E59`. Active: `#134E4A`.
- **Secondary:** Background `#FFFFFF`, text `#0F172A`, border: 1px solid `#CBD5E1`. Hover: `#F8F9FA`, border `#94A3B8`.
- **Target Mode:** Dwell-selectable buttons contain a circular track (20px) indicating remaining dwell duration before triggering.

### Dwell Timer Indicators
- Integrated radially or as a bottom-pinned linear border progress line (height 3px, color `#D97706`) inside actionable targets.
- Transitions are deterministic and linear (`transition-timing-function: linear`), visually syncing dwell intervals down to the millisecond.

### Switches & Toggles
- Physical mechanical feel: Track width 40px, height 22px, background `#CBD5E1` (off) to `#0F766E` (on).
- Thumb: 18px pure white `#FFFFFF` solid circle with a subtle drop shadow (`0 1px 2px rgba(0,0,0,0.15)`), shifting with zero overshoot.

### Input Fields & Controls
- Height: 38px. Background: `#FFFFFF`. Border: 1px solid `#CBD5E1`.
- Typography: Atkinson Hyperlegible Next, 13px (`body-md`), text `#0F172A`. Placeholder: `#64748B`.
- Keyboard & Eye-Gaze Focus: Unbroken dual-stroke (`box-shadow: 0 0 0 2px #FFFFFF, 0 0 0 4px #0284C7`).

### Badges & Status Chips
- Height 22px, padding 2px 6px. Font: `JetBrains Mono`, 11px uppercase (`label-md`).
- Positive (Active Mode): Background `#CCFBF1`, text `#0F766E`, border 1px solid `#99F6E4`.
- Warning / Dwell Active: Background `#FEF3C7`, text `#92400E`, border 1px solid `#FDE68A`.
- Neutral (System Idle): Background `#F1F3F5`, text `#475569`, border 1px solid `#E2E8F0`.

### Tabular Lists & Data Cards
- Container: Surface `#FFFFFF`, border 1px solid `#E2E8F0`, corner radius 6px.
- List Rows: Minimum height 40px, flex layout with centered items, separated by 1px solid `#F1F3F5`. Alternating rows maintain strict `#FFFFFF` backgrounds to avoid visual vibration, relying on structural dividing lines.
- Hover states on clickable rows show a distinct 2px left border accent in `#0F766E` alongside a subtle `#F8F9FA` fill.
