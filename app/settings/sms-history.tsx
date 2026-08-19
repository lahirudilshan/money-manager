import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { BottomSheet, Row, Surface, Text } from '~/shared/components/ui';
import { formatMoney } from '~/shared/lib/money';
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
          <View key={day} style={{ gap: 0 }}>
            {/* Day separator — the log's only heading. */}
            <Row gap={space.sm} style={{ paddingLeft: 2, paddingBottom: 6 }}>
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

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={`${look.label}: ${row.merchant || 'message'}`}
      style={({ pressed }) => ({
        opacity: pressed ? 0.6 : 1,
        flexDirection: 'row',
        gap: space.sm,
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

      <View style={{ flex: 1, gap: 2, paddingBottom: space.md }}>
        <Row gap={space.xs}>
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
            numberOfLines={1}
            tone={row.merchant ? undefined : 'secondary'}
            style={{
              flex: 1,
              fontWeight: row.merchant ? '600' : '400',
              fontStyle: row.merchant ? 'normal' : 'italic',
            }}
          >
            {row.merchant || `“${firstWords(row.raw)}”`}
          </Text>
          {row.amount_minor ? (
            <Text variant="body" style={{ fontWeight: '700' }}>
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
          Two lines, not one.

          The reason is the whole point of a row the app did NOT act on, and at
          one line the most important ones were cut mid-sentence: "Not a
          transaction — OTP, promo, or no money mov…" and "Arrived cut short —
          add a URL Encode step to you…", which hides the actual instruction.
        */}
        <Text variant="caption" color={colors[look.color]} numberOfLines={expanded ? undefined : 2}>
          {row.reason ?? look.label}
        </Text>

        {expanded ? (
          <View style={{ gap: space.sm, marginTop: 6 }}>
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
              <Text variant="caption" tone="muted" style={{ fontWeight: '700' }}>
                ORIGINAL MESSAGE
              </Text>
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
