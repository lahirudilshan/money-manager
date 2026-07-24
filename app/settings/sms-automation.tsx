import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SheetHeader } from '../../src/components/forms';
import { Label, Row, Surface, T } from '../../src/components/ui';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * In-app setup guide for the iOS Shortcuts automation that turns incoming bank
 * SMS into Money Manager drafts. Lives under Settings → Auto-detect
 * transactions. iOS gives no app access to the SMS inbox, so this documents the
 * one mechanism that does work — a Shortcuts personal automation opening the
 * app's `moneymanager://sms?text=…` deep link — as numbered, tappable-labelled
 * steps mirroring what the user sees in the Shortcuts app.
 */
export default function SmsAutomationGuide() {
  const { colors, radius, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{ paddingTop: insets.top + space.sm, paddingHorizontal: space.lg }}>
        <SheetHeader title="Auto-detect transactions" onClose={() => router.back()} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingTop: space.md,
          paddingBottom: insets.bottom + space.xxl,
          gap: space.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Short why. */}
        <T variant="small" tone="secondary">
          iOS won&apos;t let apps read your messages, so a quick{' '}
          <T variant="small" color={colors.ink} style={{ fontWeight: '700' }}>
            Shortcut
          </T>{' '}
          does it: when a bank SMS arrives, it opens the app and a draft appears for you to confirm.
          Set it up once in the <B>Shortcuts</B> app.
        </T>

        {/* The 6 essential steps, in order. */}
        <PartHeader tag="Shortcuts app" title="Create the automation" />
        <Surface padded={false} style={{ overflow: 'hidden' }}>
          <Step n={1}>
            <Tap>Automation</Tap> tab → <Tap>＋</Tap> → <Tap>Create Personal Automation</Tap> →{' '}
            <Tap>Message</Tap>.
          </Step>
          <Step
            n={2}
            code="LKR"
            codeNote="Every bank alert contains “LKR”, so this one word catches them all — the app ignores OTPs and promos."
          >
            Set <Tap>Message Contains</Tap> to this word, choose <Tap>Run Immediately</Tap>, then{' '}
            <Tap>Next</Tap>.
          </Step>
          <Step n={3} result={<Result label="URL Encode" chip="Shortcut Input" />}>
            Add the <Tap>URL Encode</Tap> action, and set its input to <Chip>Shortcut Input</Chip>.
          </Step>
          <Step
            n={4}
            code="moneymanager://sms?text="
            result={<Result prefix="moneymanager://sms?text=" chip="URL Encoded Text" />}
            warn="The chip is inserted, not typed — after the =, tap the “URL Encoded Text” suggestion above the keyboard."
          >
            Add a <Tap>Text</Tap> action. Type the link below, then insert the encoded result right
            after it:
          </Step>
          <Step n={5} last result={<Result label="Open" chip="Text" />}>
            Add <Tap>Open URLs</Tap> and set it to the <Chip>Text</Chip> from step 4. Tap{' '}
            <Tap>Done</Tap>.
          </Step>
        </Surface>

        {/* Test. */}
        <Surface style={{ gap: space.sm, borderColor: colors.accentSoft }}>
          <Row gap={space.sm}>
            <Ionicons name="checkmark-circle" size={20} color={colors.completed} />
            <T variant="bodyStrong">Test it</T>
          </Row>
          <T variant="small" tone="secondary">
            Text yourself a message with <B>LKR</B> in it. Money Manager should open with a draft
            under &ldquo;From your messages&rdquo;.
          </T>
        </Surface>
      </ScrollView>
    </View>
  );
}

/** One row of the flow diagram. */
function FlowStep({ k, v, last }: { k: string; v: string; last?: boolean }) {
  const { colors, space } = useTheme();
  return (
    <View>
      <Row gap={space.md}>
        <Label>{k}</Label>
        <T variant="small" style={{ fontWeight: '600', flex: 1, textAlign: 'right' }}>
          {v}
        </T>
      </Row>
      {!last ? (
        <Ionicons
          name="arrow-down"
          size={13}
          color={colors.inkMuted}
          style={{ marginTop: 6, marginBottom: -2 }}
        />
      ) : null}
    </View>
  );
}

/** A "Part A / Part B" section heading with a pill tag. */
function PartHeader({ tag, title }: { tag: string; title: string }) {
  const { colors, space } = useTheme();
  return (
    <Row gap={space.sm} style={{ marginTop: space.sm }}>
      <View
        style={{
          paddingHorizontal: space.sm,
          paddingVertical: 3,
          borderRadius: 999,
          backgroundColor: colors.accentSoft,
        }}
      >
        <T variant="caption" color={colors.accent} style={{ fontWeight: '800' }}>
          {tag.toUpperCase()}
        </T>
      </View>
      <T variant="heading" style={{ flex: 1 }}>
        {title}
      </T>
    </Row>
  );
}

/** A numbered step card with optional code block, result preview, and callouts. */
function Step({
  n,
  children,
  note,
  code,
  codeNote,
  result,
  warn,
  last,
}: {
  n: number;
  children: React.ReactNode;
  note?: string;
  code?: string;
  codeNote?: string;
  result?: React.ReactNode;
  warn?: string;
  last?: boolean;
}) {
  const { colors, radius, space } = useTheme();
  return (
    <View>
      <View style={{ flexDirection: 'row', gap: space.md, padding: space.lg }}>
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <T variant="small" color="#FFFFFF" style={{ fontWeight: '800' }}>
            {n}
          </T>
        </View>
        <View style={{ flex: 1, gap: space.sm }}>
          <T variant="body" style={{ lineHeight: 22 }}>
            {children}
          </T>
          {note ? (
            <T variant="caption" tone="muted">
              {note}
            </T>
          ) : null}
          {codeNote ? (
            <T variant="caption" tone="muted">
              {codeNote}
            </T>
          ) : null}
          {code ? <CodeBlock>{code}</CodeBlock> : null}
          {result ? result : null}
          {warn ? <Warn>{warn}</Warn> : null}
        </View>
      </View>
      {!last ? <View style={{ height: 1, backgroundColor: colors.hairline }} /> : null}
    </View>
  );
}

/** Monospace string the user must type verbatim. */
function CodeBlock({ children }: { children: React.ReactNode }) {
  const { colors, radius, space } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surfaceSunken,
        borderWidth: 1,
        borderColor: colors.hairlineStrong,
        borderRadius: radius.sm,
        paddingHorizontal: space.md,
        paddingVertical: 10,
      }}
    >
      <T variant="small" style={{ fontFamily: 'Courier', color: colors.ink }}>
        {children}
      </T>
    </View>
  );
}

/** An inline pill styling a phrase the user taps in the Shortcuts UI. */
function Tap({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <T variant="body" color={colors.ink} style={{ fontWeight: '700' }}>
      {children}
    </T>
  );
}

function B({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <T variant="body" color={colors.ink} style={{ fontWeight: '700' }}>
      {children}
    </T>
  );
}

/** A Shortcuts variable chip, shown inline in prose. */
function Chip({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <T variant="small" color={colors.accent} style={{ fontWeight: '700' }}>
      {`[${children}]`}
    </T>
  );
}

/** "Result should read" preview mimicking a finished Shortcuts action. */
function Result({ label, prefix, chip }: { label?: string; prefix?: string; chip: string }) {
  const { colors, radius, space } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surfaceSunken,
        borderWidth: 1,
        borderColor: colors.hairlineStrong,
        borderRadius: radius.sm,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          paddingHorizontal: space.md,
          paddingVertical: 6,
          borderBottomWidth: 1,
          borderBottomColor: colors.hairline,
        }}
      >
        <Label>Result should read</Label>
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 4,
          paddingHorizontal: space.md,
          paddingVertical: 10,
        }}
      >
        {label ? (
          <T variant="small" color={colors.ink} style={{ fontWeight: '600' }}>
            {label}
          </T>
        ) : null}
        {prefix ? (
          <T variant="small" style={{ fontFamily: 'Courier', color: colors.ink }}>
            {prefix}
          </T>
        ) : null}
        <View
          style={{
            backgroundColor: colors.accentSoft,
            borderRadius: 6,
            paddingHorizontal: 8,
            paddingVertical: 2,
          }}
        >
          <T variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
            {chip}
          </T>
        </View>
      </View>
    </View>
  );
}

/** Amber "watch out" callout for the tricky steps. */
function Warn({ children }: { children: React.ReactNode }) {
  const { colors, radius, space } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: space.sm,
        backgroundColor: colors.pendingSoft,
        borderWidth: 1,
        borderColor: colors.pending,
        borderRadius: radius.sm,
        padding: space.md,
      }}
    >
      <Ionicons name="alert-circle" size={16} color={colors.pending} style={{ marginTop: 1 }} />
      <T variant="caption" tone="secondary" style={{ flex: 1, lineHeight: 18 }}>
        {children}
      </T>
    </View>
  );
}

/** One keyword row in the "catch more" list. */
function Keyword({ word, desc, last }: { word: string; desc: string; last?: boolean }) {
  const { colors, radius, space } = useTheme();
  return (
    <View>
      <Row gap={space.md} style={{ padding: space.lg }}>
        <View
          style={{
            backgroundColor: colors.surfaceSunken,
            borderWidth: 1,
            borderColor: colors.hairlineStrong,
            borderRadius: radius.sm,
            paddingHorizontal: 10,
            paddingVertical: 5,
          }}
        >
          <T variant="small" style={{ fontFamily: 'Courier', color: colors.ink }}>
            {word}
          </T>
        </View>
        <T variant="caption" tone="secondary" style={{ flex: 1 }}>
          {desc}
        </T>
      </Row>
      {!last ? <View style={{ height: 1, backgroundColor: colors.hairline }} /> : null}
    </View>
  );
}
