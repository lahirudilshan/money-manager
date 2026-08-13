# Persona test plan

Manual end-to-end passes for the real app on a real phone, each one a different
kind of person with different money to manage. The point is not to exercise
every code path — the unit tests do that — but to find the places where the app
is *technically working and still wrong*: a question that makes no sense for
this user, a default that is absurd for their age, a screen that says nothing
when it should say something.

## How to run a pass

1. **Settings → Clear all data.** This wipes every table and returns to
   onboarding, which is the same state a fresh install starts from.
2. Walk the persona below **as that person**, not as someone testing software.
   Enter their real numbers. If a question is confusing *for them*, that is a
   finding even when nothing crashes.
3. Record findings against the checkpoints. Anything surprising counts.

Between passes the previous persona's board is discarded, so ordering does not
matter — except where a case explicitly says otherwise (the restore cases need a
backup from an earlier pass).

## What counts as a finding

- **Bug** — crash, wrong number, a control that does nothing.
- **UX** — the app is working but the user cannot tell what to do, or is asked
  something they have no way to answer, or is shown a figure they cannot act on.
- **Absurdity** — a default that is nonsense for this persona (retirement
  savings pre-ticked for a 19-year-old, childcare for someone with no children).

Absurdities matter most. They are the ones no test suite can catch and the ones
that make a real user distrust the whole app.

---

## Persona 1 — Kasun, 23, first job, no dependants

Just started work. Rents a room, no vehicle, pays a phone bill and sends
something home occasionally. Has never used a budgeting app.

**Money:** salary 85,000. Room 22,000. Phone 2,500. Groceries ~15,000.
No loans. One bank account (Commercial).

**Steps**

1. Onboarding step 1 — pick Commercial Bank only.
2. Step 2 — "Just me", "Neither" (no vehicle), birth year 2003.
3. Step 3 — accept the suggested plan, then set amounts.
4. Step 4 — set every line's amount and account.
5. Step 5 — skip, no loans.

**Checkpoints**

- [ ] Does the suggested plan contain anything absurd for a 23-year-old with no
      car and no children? (Watch for: vehicle lines, childcare, retirement.)
- [ ] With no vehicle chosen, are fuel/service/insurance genuinely absent?
- [ ] Is "Build my plan" correctly blocked until every line has an amount AND an
      account? Does the footer say which is missing?
- [ ] Can he finish without ever being asked something he cannot answer?
- [ ] Dashboard afterwards: does it read as *his* month, or as a mostly-empty
      template?

## Persona 2 — Nilanthi, 41, two children, a car, a housing loan

The main case. Married, two kids in school, runs a car, paying a housing loan
and a lease. Pays her parents' electricity too.

**Money:** household income 450,000. Housing loan 7,200,000 @ 11.5% over 20y.
Lease 2,400,000 @ 13% over 5y. School fees 35,000. Fuel ~25,000.
Two accounts (Sampath, HNB).

**Steps**

1. Step 1 — Sampath and HNB.
2. Step 2 — "Partner", "Children", "Parents"; "Car"; birth year 1985.
3. Step 3 — the plan should be substantial. Review what was suggested.
4. Step 4 — set amounts; put school fees on Sampath, fuel on HNB.
5. Step 5 — add BOTH the housing loan and the lease.

**Checkpoints**

- [ ] Does choosing "Parents" produce a *house* for them rather than a flat
      "support to parents" line?
- [ ] Is "Loans & credit" absent from step 3's category list? (It must be —
      step 5 collects loans properly.)
- [ ] **Loan maths.** A brand-new loan must show **0 installments paid**, not 1.
      Housing loan 7,200,000 @ 11.5% / 20y — check the monthly figure against a
      real calculator. The 5y case should give 158,347.
- [ ] Can she EDIT a loan after adding it (tap the row), or must she delete and
      retype?
- [ ] Does editing a loan's rate update the monthly figure on the board?
- [ ] Vehicle insurance is yearly — can she choose to save for it monthly, and
      does the plan total then use the monthly set-aside?
- [ ] Two accounts: does the dashboard's transfer section split correctly?

## Persona 3 — Rohan, 58, near retirement, no dependants at home

Children grown and independent. Owns his house outright. Runs an older car.
Main concerns are health cover and not outliving his savings.

**Money:** income 320,000 (salary + rent received 45,000).
Health insurance 18,000/mo. No loans. Medicine ~8,000.

**Steps**

1. Step 2 — "Just me"; "Car"; birth year 1968.
2. Note what the plan suggests before editing.
3. Add the rent-received income line.
4. Finish and inspect the dashboard.

**Checkpoints**

- [ ] Does the plan lean toward retirement/health, or still suggest
      student-shaped lines (streaming, tuition)?
- [ ] Two income lines — does the ratio dashboard total them correctly?
- [ ] Is "housing loan" absent given he owns outright and the Loans category is
      no longer in step 3?
- [ ] Does anything assume dependants he does not have?

## Persona 4 — Dilini, 29, freelancer paid in USD

Irregular income in dollars, several USD subscriptions. This is the currency
case.

**Money:** freelance income ~$1,800/mo. Subscriptions: Figma $15, iCloud $3,
Netflix LKR 1,790. Rent 45,000. No loans, no car.

**Steps**

1. Step 2 — "Just me"; "Neither"; birth year 1997.
2. Step 3 — include software/cloud/streaming subscriptions.
3. Step 4 — set the income in **USD**, and set Figma and iCloud in **USD**,
   Netflix in **LKR**.
4. Finish.

**Checkpoints**

- [ ] Is the USD/LKR toggle available on **expense** lines, not just income?
- [ ] Does the converted figure show the rate ("≈ LKR X at Y/USD")?
- [ ] Do plan totals stay in one currency and add up?
- [ ] Does the board later still show the original USD figure, or has it
      collapsed to a stale local number?

## Persona 5 — the destructive pass (any persona's board)

Run after any completed pass. This is where the crash-shaped bugs live.

**Checkpoints**

- [ ] **Delete a subcategory.** The app must NOT crash. (Old bug: hook-order
      violation on the "not found" guard.)
- [ ] Delete a category that still has lines under it.
- [ ] Delete a loan — does its board line go with it?
- [ ] Change a subcategory's **account** from its edit screen. Does it stick?
- [ ] Move a subcategory to a different parent category.
- [ ] Mark a bill paid, then reopen it — does the status survive?

## Persona 6 — backup and restore

The case that matters most for a real user, and the one that was broken.

**Checkpoints**

- [ ] Connect Google Drive. Does it back up **automatically**? (It must NOT —
      connecting is not a request to upload.)
- [ ] Back up manually. Does it appear under **Restore** afterwards?
- [ ] Does the Restore list show **both** phone and Drive copies, each labelled?
- [ ] Open "Backups in Drive" — does tapping a row open its contents panel?
- [ ] **Restore from a Drive backup.** Does the board actually come back?
- [ ] Clear all data, then restore from Drive — the new-phone case. Does
      everything return?
- [ ] Restore a partial scope (setup only, no transactions) — is the result what
      the panel promised?

## Persona 7 — the "Coming up" / dates pass

Needs a board with bills on various days.

**Checkpoints**

- [ ] Does "Coming up" reflect the NEXT due date rather than the browsed month?
- [ ] Scroll the board back to a previous month — do its lines wrongly become
      "late"?
- [ ] Scroll forward — is a bill due in three days still shown as near?
- [ ] A bill due on the 31st — does it resolve sensibly in February?
