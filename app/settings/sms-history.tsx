import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { BottomSheet, Row, Surface, Text } from '~/shared/components/ui';
import { formatMoney } from '~/shared/lib/money';
import { copyToClipboard } from '~/shared/lib/clipboard';
import { smsLogRepo, type SmsLogRow } from '../../src/db/repositories';
import { useModalClose } from '~/shared/hooks/useModalClose';
import { useTheme } from '~/shared/theme/ThemeProvider';

/**
 * The detection log: every bank message the app saw, and what it did with it.
 *
 * Presented as a LOG rather than a list of cards. A card list implies each row
 * is a thing you act on; these are events — read newest-first, scanned for the
 * one that went wrong. So the layout borrows from a console: a continuous
 * left-hand rail with a coloured dot per event, day separators, times in a
 * fixed-width gutter so they line up down the column, and no per-row chrome
 * competing with the content.
 *
 * The most useful signal here is the ABSENCE of a message. If a bank alert is
 * not listed at all, the app never received it — which points at the Shortcuts
 * automation rather than at any parsing rule, and no other screen can make that
 * distinction.
 */

/**
 * The buckets, as GROUPS rather than one chip per raw outcome.
 *
 * Six chips wrapped onto a second row and asked the user to tell "Ignored"
 * from "Unread" from "Cut short" before knowing what any of them meant. The
 * real question is simpler: did it become a transaction, was it deliberately
 * skipped, or did something go wrong?
 */
const FILTERS: { key: string | null; label: string; outcomes?: readonly string[] }[] = [
  { key: null, label: 'All' },
  { key: 'queued', label: 'Added', outcomes: ['queued'] },
  { key: 'skipped', label: 'Skipped', outcomes: ['skipped', 'duplicate', 'ignored'] },
  { key: 'problems', label: 'Problems', outcomes: ['unreadable', 'truncated'] },
];

export default function SmsHistoryScreen() {
  const { colors, space, radius } = useTheme();
  const closeModal = useModalClose();

  const [filter, setFilter] = useState<string | null>(null);
  const [rows, setRows] = useState<SmsLogRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  const reload = useCallback(() => {
    /*
     * Fetched unfiltered and grouped here, because a chip maps to SEVERAL
     * outcomes. Filtering in SQL would need an IN clause per chip for no
     * benefit at this size — the log is a few hundred rows at most.
     */
    const all = smsLogRepo.recent(300);
    const group = FILTERS.find((entry) => entry.key === filter);

    setRows(group?.outcomes ? all.filter((row) => group.outcomes!.includes(row.outcome)) : all);
    setCounts(smsLogRepo.counts());
  }, [filter]);

  useEffect(reload, [reload]);

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const problems = (counts.unreadable ?? 0) + (counts.truncated ?? 0);

  /** Rows grouped under day headings — the log's only structure. */
  const days = useMemo(() => groupByDay(rows), [rows]);

  function handleClear() {
    Alert.alert(
      'Clear the log?',
      'This only removes the history shown here. Transactions already on your board are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            smsLogRepo.clear();
            reload();
          },
        },
      ],
    );
  }

  return (
    <BottomSheet
      visible
      asRoute
      scroll
      onClose={closeModal}
      title="Detection log"
      icon="pulse-outline"
      iconColor={colors.accent}
    >
      {/*
        A banner ONLY when something needs attention.

        The log is usually boring, and a permanent explainer at the top is
        scrolled past. Surfacing problems only when they exist keeps the screen
        silent on a healthy setup and pointed when it is not.
      */}
      {problems > 0 ? (
        <View
          style={{
            gap: 2,
            padding: space.md,
            borderRadius: radius.md,
            backgroundColor: colors.pendingSoft,
          }}
        >
          <Row gap={space.sm}>
            <Ionicons name="warning-outline" size={18} color={colors.pending} />
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              {problems} message{problems === 1 ? '' : 's'} need a look
            </Text>
          </Row>
          <Text variant="caption" tone="secondary">
            Tap Problems below to see what went wrong and how to fix it.
          </Text>
        </View>
      ) : null}

      {/* One row, never wrapping — four chips fit comfortably at any text size. */}
      <View style={{ flexDirection: 'row', flexWrap: 'nowrap', gap: 6 }}>
        {FILTERS.map((entry) => {
          const active = filter === entry.key;
          const n = entry.outcomes
            ? entry.outcomes.reduce((sum, outcome) => sum + (counts[outcome] ?? 0), 0)
            : total;

          return (
            <Pressable
              key={entry.label}
              onPress={() => setFilter(entry.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => ({
                opacity: pressed ? 0.7 : 1,
                flex: 1,
                minWidth: 0,
                alignItems: 'center',
                gap: 1,
                paddingVertical: 8,
                borderRadius: radius.md,
                backgroundColor: active ? colors.accent : colors.surface,
                borderWidth: 1,
                borderColor: active ? colors.accent : colors.hairline,
              })}
            >
              <Text
                variant="bodyStrong"
                color={active ? colors.inkInverse : colors.ink}
                style={{ fontWeight: '800' }}
              >
                {n}
              </Text>
              <Text
                variant="caption"
                color={active ? colors.inkInverse : colors.inkMuted}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
                style={{ fontWeight: '600' }}
              >
                {entry.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {rows.length === 0 ? (
        <Surface style={{ gap: space.xs }}>
          <Text variant="small" tone="secondary">
            {total === 0
              ? 'Nothing yet. Once the automation forwards a bank message it appears here, whether or not it became a transaction.'
              : 'No messages in this group.'}
          </Text>
        </Surface>
      ) : (
        days.map(([day, entries]) => (
          /*
            `space.lg` above each day heading (except the first).

            The groups ran straight into each other — the last row of TODAY sat
            as close to the YESTERDAY heading as to its own siblings, so the
            headings read as interruptions rather than as the tops of sections.
          */
          <View key={day} style={{ gap: 0, marginTop: space.lg }}>
            {/* Day separator — the log's only heading. */}
            <Row gap={space.sm} style={{ paddingLeft: 2, paddingBottom: space.sm }}>
              <Text
                variant="caption"
                tone="muted"
                style={{ fontWeight: '800', letterSpacing: 0.6 }}
              >
                {day.toUpperCase()}
              </Text>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.hairline }} />
            </Row>

            {entries.map((row) => (
              <LogLine
                key={row.id}
                row={row}
                expanded={expanded === row.id}
                onToggle={() => setExpanded((current) => (current === row.id ? null : row.id))}
              />
            ))}
          </View>
        ))
      )}

      {total > 0 ? (
        <Pressable
          onPress={handleClear}
          accessibilityRole="button"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: space.sm })}
        >
          <Row justify="center">
            <Text variant="small" color={colors.danger}>
              Clear log
            </Text>
          </Row>
        </Pressable>
      ) : null}
    </BottomSheet>
  );
}

/**
 * One event in the log.
 *
 * Laid out as a console line: time in a fixed-width gutter, a coloured dot on a
 * continuous rail, then the message. The rail is what makes scanning work — the
 * eye follows one column of colour and stops at the red one, without reading a
 * single word.
 */
function LogLine({
  row,
  expanded,
  onToggle,
}: {
  row: SmsLogRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { colors, space, radius } = useTheme();
  const look = OUTCOME_LOOK[row.outcome] ?? OUTCOME_LOOK.ignored;
  /*
   * Whether the raw message has just been copied.
   *
   * Per-row rather than per-screen so the confirmation appears on the row that
   * was actually copied. Never reset on a timer: the row collapses when the
   * user moves on, which unmounts this and clears it — a tick that vanished
   * while the message was still on screen would read as the copy expiring.
   */
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={`${look.label}: ${row.merchant || 'message'}`}
      style={({ pressed }) => ({
        opacity: pressed ? 0.6 : 1,
        flexDirection: 'row',
        gap: space.md,
      })}
    >
      {/* Gutter: the clock time, monospaced so every row lines up. */}
      <Text
        variant="caption"
        tone="muted"
        style={{ fontFamily: 'Courier', width: 42, paddingTop: 2, textAlign: 'right' }}
      >
        {clockTime(row.seen_at)}
      </Text>

      {/* The rail — a continuous hairline carrying this event's dot. */}
      <View style={{ width: 11, alignItems: 'center' }}>
        <View style={{ width: 1, flex: 1, backgroundColor: colors.hairline }} />
        <View
          style={{
            position: 'absolute',
            top: 4,
            width: 9,
            height: 9,
            borderRadius: 5,
            backgroundColor: colors[look.color],
          }}
        />
      </View>

      {/*
        A row's own two lines sit CLOSER together than two rows sit apart.

        Both gaps used to be about 2pt, so the verdict under one row was as
        near the next row's title as its own — the log read as one dense column
        rather than a list of discrete events. 4 inside, `space.lg` between, is
        the proportion that makes each row read as a unit.
      */}
      <View style={{ flex: 1, gap: 4, paddingBottom: space.lg }}>
        <Row gap={space.xs} align="center">
          {/*
            A recognised merchant is the title; anything else is quoted.

            A message the parser could not read has no merchant, so the row fell
            back to the raw SMS — which rendered marketing copy and OTP text as
            bold headlines, exactly as though they were transactions. Styling
            the fallback as a quotation says "this is what arrived", not "this
            is what it was".
          */}
          <Text
            variant="body"
            /*
              Two lines when collapsed, not one.

              These titles are bank descriptors — "CEFT-KELANIYA HOME ELECTRIC"
              — and a raw promo quote is longer still, so at one line the log
              was a column of ellipses that all looked alike. The row grows by a
              line only where it needs to, and identifying the message is the
              entire point of the screen.
            */
            numberOfLines={expanded ? undefined : 2}
            tone={row.merchant ? undefined : 'secondary'}
            style={{
              flex: 1,
              fontWeight: row.merchant ? '600' : '400',
              fontStyle: row.merchant ? 'normal' : 'italic',
            }}
          >
            {row.merchant || `“${firstWords(row.raw)}”`}
          </Text>
          {/* `flexShrink: 0` — the figure is the row's most scannable value
              and must stay whole; a long merchant truncates instead. */}
          {row.amount_minor ? (
            <Text variant="body" style={{ fontWeight: '700', flexShrink: 0 }}>
              {formatMoney(row.amount_minor)}
            </Text>
          ) : null}

          {/* Nothing on the row said it could be opened, so the detail below
              was effectively undiscoverable. */}
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={13}
            color={colors.inkFaint}
          />
        </Row>

        {/*
          The verdict as a short PILL when collapsed; the full sentence only
          once the row is opened.

          `row.reason` is a fixed explanatory sentence per outcome — "Not a
          transaction — OTP, promo, or no money movement" — so at two lines it
          repeated verbatim down the entire log, spending more vertical space
          than the merchant and amount it was explaining and pushing the next
          row out of view. Ninety of the same sentence is wallpaper, not
          information: the colour and the two-word label already say which
          bucket a row is in, and the full reason matters only for the one row
          being investigated, which is exactly the row that gets expanded.
        */}
        {/*
          The verdict on its own line, under the title.

          It briefly shared the title's line to save vertical space, and that
          was the wrong trade: with a time gutter, a rail, an amount and a
          chevron already on that row, the title — the one part that identifies
          the message — was crushed to "CEFTS…" on nearly every entry. A log you
          cannot read is not compact, it is just short.

          Collapsed it shows the SHORT label; the full explanatory sentence
          appears only when the row is opened, since that sentence is identical
          across every row of a given outcome and reads as wallpaper repeated
          ninety times down the list.
        */}
        <Text variant="caption" color={colors[look.color]} style={{ fontWeight: '600' }}>
          {expanded ? (row.reason ?? look.label) : look.label}
        </Text>

        {expanded ? (
          /* Clear of the verdict above it, so the detail reads as a panel the
             row opened rather than as more of the row. */
          <View style={{ gap: space.md, marginTop: space.sm, marginBottom: space.xs }}>
            {/*
              WHAT THE APP READ, as labelled facts.

              The expanded row used to show the raw text and a timestamp and
              nothing else, which answers "what arrived" but not "what did the
              app make of it" — the question someone opens this log to settle.
              Every field here is already stored; none of it was ever shown.

              Only fields the row actually HAS are rendered: an OTP has no
              amount, merchant or date, and printing "—" four times would make
              a message the app correctly ignored look like a failure.
            */}
            <View
              style={{
                borderRadius: radius.sm,
                backgroundColor: colors.surfaceSunken,
                paddingHorizontal: space.sm,
                paddingVertical: 4,
              }}
            >
              <DetailLine label="Read as" value={row.merchant} />
              <DetailLine
                label="Amount"
                value={row.amount_minor ? formatMoney(row.amount_minor) : null}
              />
              <DetailLine label="Type" value={row.kind ? kindLabel(row.kind) : null} />
              <DetailLine label="Dated" value={row.occurred_on} />
              <DetailLine label="Arrived" value={sourceLabel(row.source)} />
              <DetailLine
                label="Seen"
                value={new Date(row.seen_at).toLocaleString()}
                last
              />
            </View>

            {/* The raw text — what proves the app saw what you think it did,
                and what gets pasted into a bug report. */}
            <View style={{ gap: 4 }}>
              <Row justify="space-between" align="center">
                <Text variant="caption" tone="muted" style={{ fontWeight: '700' }}>
                  ORIGINAL MESSAGE
                </Text>
                {/*
                  Copy, next to the thing it copies.

                  This block is already described as what gets pasted into a
                  bug report — but a `Text` inside a scroll view cannot be
                  selected by dragging on iOS, so the only way to actually get
                  it out was to retype it. The message is also the input to
                  "Paste SMS", so copying one the parser mis-read is the fastest
                  route to re-testing it.

                  `stopPropagation` because the whole row is a Pressable that
                  toggles expansion — without it, copying would collapse the
                  row it just copied from.
                */}
                <Pressable
                  onPress={(event) => {
                    event.stopPropagation();
                    void copyToClipboard(row.raw).then((ok) =>
                      setCopied(ok ? 'done' : 'failed'),
                    );
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Copy message"
                  /*
                    `accessible` explicitly, because the label lives on the
                    child `Text` nodes otherwise: RN only merges children into
                    one accessibility element when told to, so VoiceOver (and
                    UI tests) saw two unlabelled fragments rather than one
                    button called "Copy message".
                  */
                  accessible
                  hitSlop={8}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <Row gap={4} align="center">
                    <Ionicons
                      name={copied === 'done' ? 'checkmark' : 'copy-outline'}
                      size={13}
                      color={copied === 'done' ? colors.completed : colors.accent}
                    />
                    <Text
                      variant="caption"
                      color={copied === 'done' ? colors.completed : colors.accent}
                      style={{ fontWeight: '700' }}
                    >
                      {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Select by hand' : 'Copy'}
                    </Text>
                  </Row>
                </Pressable>
              </Row>
              <View
                style={{
                  padding: space.sm,
                  borderRadius: radius.sm,
                  backgroundColor: colors.surfaceSunken,
                  borderLeftWidth: 2,
                  borderLeftColor: colors[look.color],
                }}
              >
                <Text variant="caption" style={{ fontFamily: 'Courier', lineHeight: 16 }}>
                  {row.raw}
                </Text>
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * One labelled fact in the expanded row, or nothing when there is none.
 *
 * Returning null for an absent value is the point: an OTP has no amount,
 * merchant or date, and printing "—" against four labels would make a message
 * the app correctly ignored look like something went wrong.
 */
function DetailLine({
  label,
  value,
  last,
}: {
  label: string;
  value: string | null | undefined;
  last?: boolean;
}) {
  const { colors, space } = useTheme();
  if (!value) return null;

  return (
    <Row
      gap={space.sm}
      style={{
        paddingVertical: 6,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.hairline,
        alignItems: 'flex-start',
      }}
    >
      <Text variant="caption" tone="muted" style={{ width: 62 }}>
        {label}
      </Text>
      <Text variant="caption" style={{ flex: 1, fontWeight: '600' }}>
        {value}
      </Text>
    </Row>
  );
}

/** The transaction kind in the user's words, not the parser's tag. */
function kindLabel(kind: string): string {
  const LABELS: Record<string, string> = {
    purchase: 'Purchase',
    atm: 'ATM cash',
    transfer_out: 'Transfer out',
    transfer_in: 'Money in',
    loan_payment: 'Loan payment',
    utility: 'Utility bill',
    reversal: 'Reversal',
    bank_charge: 'Bank charge',
    other: 'Other',
  };
  return LABELS[kind] ?? kind;
}

/**
 * How the message reached the app.
 *
 * Worth showing because the two paths fail differently: a `file` message came
 * through the Shortcut's handoff file (where truncation happens), while a
 * `link` arrived by deep link. When something goes wrong, which route it took
 * is the first thing that narrows it down.
 */
function sourceLabel(source: string): string {
  if (source === 'link') return 'Shared to the app';
  if (source === 'file') return 'Shortcut automation';
  return source;
}

/** Group rows under "Today" / "Yesterday" / a date, preserving order. */
function groupByDay(rows: readonly SmsLogRow[]): [string, SmsLogRow[]][] {
  const groups = new Map<string, SmsLogRow[]>();

  for (const row of rows) {
    const label = dayLabel(row.seen_at);
    const bucket = groups.get(label);
    if (bucket) bucket.push(row);
    else groups.set(label, [row]);
  }

  return [...groups.entries()];
}

function dayLabel(at: number): string {
  const date = new Date(at);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);

  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, yesterday)) return 'Yesterday';

  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** "14:05" — the log's gutter. The full timestamp lives in the expanded view. */
function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Enough of a raw message to recognise it, when no merchant was extracted. */
function firstWords(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 38);
}

/** How each outcome reads. Colour carries the verdict before the words do. */
const OUTCOME_LOOK: Record<
  string,
  { label: string; color: 'completed' | 'accent' | 'pending' | 'danger' | 'inkMuted' }
> = {
  queued: { label: 'Added for review', color: 'completed' },
  duplicate: { label: 'Already imported', color: 'inkMuted' },
  skipped: { label: 'Skipped', color: 'accent' },
  ignored: { label: 'Not a payment', color: 'inkMuted' },
  unreadable: { label: 'Could not read', color: 'pending' },
  truncated: { label: 'Arrived cut short', color: 'danger' },
};
