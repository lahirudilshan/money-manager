/**
 * Everything Dayly does, as one slide each: a name, one line, and a tiny
 * real-looking example — shown on the welcome / terms screen as an animated
 * tour.
 *
 * KEEP THIS LIST CURRENT. Every new feature, add-on or big change gets a slide
 * here (or an edit to its slide) in the same change — see the `feature-tour`
 * skill (.claude/skills/feature-tour/SKILL.md). `featureTour.test.ts` checks
 * that every add-on in `miniApps.ts` has a slide, so a new add-on without one
 * fails the tests.
 */

export interface TourSlide {
  /** Stable id; add-on slides use the add-on's id. */
  key: string;
  /** Ionicons name. */
  icon: string;
  /** Tile colour (a category colour from the design system). */
  color: string;
  title: string;
  /** What it does, in one short line. */
  line: string;
  /** A small example of it in use — what the person would actually see. */
  example: string;
  /** Uses AI: the slide wears the AI mark, so nobody is surprised later. */
  ai?: boolean;
  /** An optional extra, switched on in Settings → Add-ons. */
  addOn?: boolean;
  /** Shown with a NEW badge — remove once it has been out a while. */
  isNew?: boolean;
}

export const TOUR: TourSlide[] = [
  {
    key: 'plan',
    icon: 'grid-outline',
    color: '#2563EB',
    title: 'Plan your month',
    line: 'Salary in, then move it to each bill’s account and tick it off.',
    example: 'Rent · LKR 85,000 · Paid ✓',
  },
  {
    key: 'sms',
    icon: 'chatbox-ellipses-outline',
    color: '#0891B2',
    title: 'Smart Detect',
    line: 'Bank SMS turn into ready-to-save payments. Read on your phone.',
    example: '“LKR 4,250 spent at Keells” → Groceries',
  },
  {
    key: 'loans',
    icon: 'pie-chart-outline',
    color: '#4F46E5',
    title: 'Loans & income',
    line: 'See what you owe, what comes in, and what is left.',
    example: 'Car loan · 14 of 60 paid',
  },
  {
    key: 'search',
    icon: 'search-outline',
    color: '#475569',
    title: 'Search everything',
    line: 'Bills, SMS, documents and health results in one search box.',
    example: '“sugar last 3 months” → 2 results',
  },
  {
    key: 'backup',
    icon: 'cloud-upload-outline',
    color: '#059669',
    title: 'Backup & App lock',
    line: 'Save to your own Google Drive. Lock with Face ID.',
    example: 'Backed up today · 9:41',
  },
  {
    key: 'health',
    icon: 'heart-outline',
    color: '#DB2777',
    title: 'Health records',
    line: 'Lab reports in simple words: what is high or low, and what to do.',
    example: 'Blood sugar 101 · a little high ↑',
    ai: true,
    addOn: true,
    isNew: true,
  },
  {
    key: 'documents',
    icon: 'folder-open-outline',
    color: '#CA8A04',
    title: 'Documents',
    line: 'Keep PDFs and photos in folders, with notes and tags.',
    example: 'Insurance › Car policy 2026.pdf',
    addOn: true,
  },
  {
    key: 'fuel',
    icon: 'car-outline',
    color: '#16A34A',
    title: 'Fuel & vehicles',
    line: 'Fill-ups, mileage, service bills and alerts when each part is due.',
    example: 'Engine oil · due in 300 km',
    ai: true,
    addOn: true,
    isNew: true,
  },
  {
    key: 'buddyloans',
    icon: 'people-outline',
    color: '#0D9488',
    title: 'Buddy loans',
    line: 'Money you lend to friends, and when it comes back.',
    example: 'Nimal owes LKR 15,000 · due Friday',
    addOn: true,
  },
  {
    key: 'trackers',
    icon: 'repeat-outline',
    color: '#7C3AED',
    title: 'Usage tracker',
    line: 'How long things last, and when to buy the next one.',
    example: 'Gas cylinder · lasts ~32 days',
    addOn: true,
  },
];
