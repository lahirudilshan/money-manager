---
name: dayly-ui
description: Design and build Dayly (this app) screens and components with its exact light/dark tokens, type scale, spacing, the one BottomSheet style and the rationed brand gradient. Use for any UI work in app/ or src/**/components, a new screen, restyling, or a web mockup of the app.
---

# Dayly UI

The browsable reference (tokens per theme, component previews, brand book) is the
"Dayly" design system artifact: https://claude.ai/artifact/NUgLtS4JupFaqwkibmgDLH.
The source of truth is the code: `src/shared/theme/index.ts` (tokens),
`src/shared/data/categoryColors.ts`, and `src/shared/components/ui/`. If they
disagree with this file, the code wins. Update this file and the artifact together.

You are designing UI for Dayly, a calm fintech money app built around a monthly
funding plan: salary lands in one account, the user moves it to the accounts each
bucket of bills draws from, then ticks bills off as they are paid. Match the
existing app exactly. Use only the tokens below, never new hex values, and give
every screen both a light and a dark theme.

## Tokens (light / dark)
Grounds   canvas #F7F9FB/#0B1220 · surface #FFFFFF/#141B2C · surfaceRaised #FFFFFF/#1B2438
          surfaceSunken #EEF2F6/#0F1729 · hairline #E3E9EF/#243046 · hairlineStrong #CDD6E0/#334158
Ink       ink #101828/#F3F6FA · inkSecondary #5B6472/#A7B1C2 · inkMuted #8A93A0/#6B7688
          inkFaint #B4BBC6/#525C6D (placeholders only) · inkInverse #FFFFFF/#0B1220
Accent    accent #0F6FDE/#4A9BF5 · accentSoft #E8F1FD/#16273F · accentInk #0A5BC4/#7DBBFF
Gradient  gradientStart #0F6FDE/#1E7FE0 → gradientEnd #0FA8A0/#1FBFAE, 135°
Status    pending #B7791F/#E3A94F on pendingSoft #FBF1DE/#2E240F
          transferred #0F6FDE/#5CA8FA on transferredSoft #E8F1FD/#16263C
          completed #0E9F6E/#3FD79A on completedSoft #E3F9F0/#0F2A20
          danger #DC2626/#F0645F on dangerSoft #FCE8E8/#331717 · positive = completed
Health    healthy #1D4ED8→#0E9F8E · tight #0E7490→#0E9F8E · critical #B45309→#D97706
          overspent #9D174D→#BE185D (hero gradient only, always with its word + icon)
Category  rose #E11D48 red #DC2626 orange #EA580C amber #D97706 gold #CA8A04 lime #65A30D
          green #16A34A emerald #059669 teal #0D9488 cyan #0891B2 sky #0284C7 blue #2563EB
          indigo #4F46E5 violet #7C3AED purple #9333EA fuchsia #C026D3 pink #DB2777
          stone #57534E slate #475569
Space     xs 4 · sm 8 · md 12 · lg 16 · xl 20 · xxl 28 · xxxl 40 (4px grid)
Radius    sm 8 · md 12 · lg 18 · xl 24 · pill 999
Shadow    card 0 4 14 rgba(26,22,37,.06) · lifted 0 10 26 rgba(26,22,37,.14)
          glow 0 6 16 rgba(15,111,222,.35) (centre tab action only)
Type      system font (SF Pro). hero 40/800/-1.4 · display 30/800/-0.9 · title 22/700/-0.5
          heading 17/700/-0.2 · body 15/500 · bodyStrong 15/700 · small 13/500
          figure 15/700 · figureLarge 19/800/-0.3 · label 11/700/+0.8 UPPERCASE · caption 12/500
          All money: tabular numerals.

## Rules
1. Screens sit on canvas. Content sits in cards: surface, 1px hairline border,
   radius lg, shadow card, padding lg. Screen gutter lg; sections gap lg; rows padding md.
2. The gradient appears in three places only: the dashboard hero card (radius xl,
   shadow lifted, padding xl), the ONE primary button per view, and the centre "+" of
   the floating pill tab bar. Never use it for decoration or backgrounds.
3. Status is its own colour family, never the accent, and never colour alone:
   pending = ellipse-outline + "PENDING", transferred = arrow-forward-circle +
   "TRANSFERRED", paid = checkmark-circle + "PAID". Pills: soft background, radius pill,
   label style.
4. Danger is reserved for destructive actions, overdue bills and negative balances.
   An overspent month is magenta (health-overspent), not red.
5. Money: currency code first, sign on the number ("LKR -45,000"). Compact (158.3K)
   on summaries, exact in detail. Money in = completed with "+"; money out = ink with
   "−". A foreign account shows its own currency.
6. Every block gets an UPPERCASE micro-label (label style, inkMuted) above it, with
   gap sm.
7. Modals are the ONE BottomSheet: a native page sheet. Header: a 40px icon tile
   (radius md, filled with the feature colour, white icon), optional eyebrow
   (caption, muted), title (heading), a 40px round close button; hairline divider;
   scrolling body with padding lg and gap lg; optional pinned footer with the
   gradient button. No centred dialogs.
8. Rows (ListRow): leading 44px logo/icon, title bodyStrong, subtitle caption muted,
   trailing figure (figureLarge) with a caption under it, chevron inkMuted 16.
9. Progress bars: height 8, track surfaceSunken, radius pill, clamped to 0–100%;
   say "over budget" in words rather than overflowing the bar.
10. Icons: Ionicons. Outline for actions and navigation; filled only for status
    and health.
11. Unset values read "Not set" in inkMuted. Never a dash, never a guessed value.
12. Copy: sentence case, verb-first buttons ("Save transaction"), plain and calm,
    no emoji, no exclamation marks. Name figures by meaning ("Holds now",
    "Still to pay").
13. Contrast: body text uses ink or inkSecondary only. inkMuted, and status colours
    on their soft tints, are below 4.5:1 in light mode, so use them only for small
    bold labels paired with an icon. Small white text belongs at the gradientStart
    side of the gradient.
14. Brand or category colour used as TEXT must be darkened (light theme) or
    lightened (dark theme) until it reaches 4.5:1. As a background it becomes a wash:
    ~86% toward white in light, ~72% toward black in dark.
15. Dark theme is not an inversion: use the dark values above, and keep the same
    hierarchy and the same single gradient.

## In the codebase (React Native, Expo)
Read tokens through `const { colors, space, radius, type, shadow } = useTheme()`
(src/shared/theme). Never write hex values in a screen. Reuse the components in
src/shared/components/ui: Surface, Label, Text (variants = type names), Row,
Divider, ListRow, DetailRow, Stat, StatusPill, StatusStrip, FundingBar, Button
(primary | secondary | ghost | danger | success), GradientButton, GradientCard,
Segmented, AppHeader, BottomSheet. Feature code goes in src/features/<name>/;
imports use the ~/ alias.

## On the web
Declare the tokens as CSS custom properties on :root (light) and redefine them
under @media (prefers-color-scheme: dark) and [data-theme="dark"]. Use
font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif
and font-variant-numeric: tabular-nums on every money figure.
