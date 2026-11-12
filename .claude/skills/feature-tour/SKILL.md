---
name: feature-tour
description: Keep Dayly's welcome feature tour and terms current. Use whenever a change adds a feature, add-on or mini-app, renames or removes one, changes what a feature does in a way a user would notice, starts sending any data off the phone, or adds/changes an AI use — and when the user asks to update the "what Dayly does" / welcome / terms screen.
---

# Keeping the feature tour and terms current

The first screen (`app/onboarding/terms.tsx`, also shown once to existing
users when the terms version goes up) shows every feature as a card that rises in as you scroll —
no carousel, nothing hidden — then five short terms. Both are DATA, so a feature
change is a data edit — never a layout change.

| What | File |
|---|---|
| Tour slides | `src/features/tour/logic/featureTour.ts` (`TOUR`) |
| Feature cards + scroll reveal | `src/features/tour/components/FeatureList.tsx`, `ScrollReveal.tsx` |
| Terms points | `src/features/terms/logic/terms.ts` (`TERMS`, `TERMS_VERSION`) |
| Guard tests | `src/features/tour/logic/__tests__/featureTour.test.ts`, `src/features/terms/logic/__tests__/terms.test.ts` |

## A new feature or add-on

1. Add a slide to `TOUR`, in the order a newcomer should meet it (core money
   features first, add-ons after):
   - `key` — for an add-on, the SAME id as in `src/shared/lib/miniApps.ts`
     (the test fails if an add-on has no slide).
   - `icon` — Ionicons name; `color` — a category colour from the design
     system (dayly-ui skill), never a new hex.
   - `title` ≤ 24 chars, `line` ≤ 70, `example` ≤ 45 (tested). Plain words a
     12-year-old understands. `example` is what the person would actually SEE
     on screen ("Rent · LKR 85,000 · Paid ✓"), not a description.
   - `ai: true` if it uses AI; `addOn: true` if it is switched on in
     Settings → Add-ons; `isNew: true` for a fresh feature.
2. Remove `isNew` from slides that have been out for a release or two — a
   tour where everything is NEW says nothing.

## A changed or removed feature

- Changed: edit its `line` / `example` so they match what the screen shows now.
- Removed: delete its slide (and the add-on from `miniApps.ts`).

## Anything that changes what leaves the phone, or how AI is used

This is a TERMS change, not just a tour change:

1. Update the matching point in `TERMS` (`summary` is one sentence; details go
   in `points`). Keep the AI point honest about exactly what is sent — today the
   person's name, age and known conditions go with the report.
2. Update `app/settings/ai.tsx` ("Where AI is used" / "What is sent") to match.
3. Raise `TERMS_VERSION` so every user sees the screen again and agrees to the
   new version. Do NOT raise it for wording-only edits.

## Check

```
node_modules/.bin/vitest run src/features/tour src/features/terms
node_modules/.bin/tsc --noEmit -p .
```

Then look at it: `xcrun simctl openurl <UDID> "exp+dayly:///onboarding/terms"`
and screenshot. Cards rise in as they scroll into view (no motion under Reduce Motion).
