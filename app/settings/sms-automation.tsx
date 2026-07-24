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
        {/* Why + how it flows. */}
        <T variant="small" tone="secondary">
          iOS won&apos;t let any app read your messages. Instead, a one-time{' '}
          <T variant="small" color={colors.ink} style={{ fontWeight: '700' }}>
            Shortcuts automation
          </T>{' '}
          watches for a bank SMS and hands it to Money Manager. After setup, a matching text quietly
          opens a draft on your dashboard.
        </T>

        <Surface style={{ gap: space.md }}>
          <FlowStep k="Trigger" v="Bank SMS arrives" />
          <FlowStep k="Shortcut" v="Opens a link" />
          <FlowStep k="Money Manager" v="Draft appears to confirm" last />
        </Surface>

        {/* Part A — trigger. */}
        <PartHeader tag="Part A" title="Set the trigger" />
        <Surface padded={false} style={{ overflow: 'hidden' }}>
          <Step n={1}>
            Open the <Tap>Shortcuts</Tap> app, then tap the <Tap>Automation</Tap> tab at the bottom.
          </Step>
          <Step n={2} note="First automation? Tap the big “Create Personal Automation” button instead.">
            Tap <Tap>＋</Tap> in the top-right corner.
          </Step>
          <Step n={3}>
            Scroll the trigger list and tap <Tap>Message</Tap>.
          </Step>
          <Step
            n={4}
            code="LKR"
            codeNote="Every bank alert — NDB and HNB, purchases, ATM, transfers and loan payments — contains “LKR”, so this one word catches them all. Money Manager ignores OTPs, promos and balance texts, so a broad keyword is safe."
          >
            Leave <B>Sender</B> as <Tap>Any</Tap>. Tap <Tap>Message Contains</Tap>, type this exactly
            (uppercase), then tap <Tap>Done</Tap>:
          </Step>
          <Step
            n={5}
            last
            warn="If you pick “Run After Confirmation”, you'll tap a prompt every time. Run Immediately is what makes it hands-free."
          >
            Choose <Tap>Run Immediately</Tap>, then tap <Tap>Next</Tap>.
          </Step>
        </Surface>

        {/* Part B — actions. */}
        <PartHeader tag="Part B" title="Build the link — 3 actions in order" />
        <T variant="caption" tone="muted" style={{ marginTop: -space.sm }}>
          Search each action by name, add it, then wire it up exactly as shown.
        </T>
        <Surface padded={false} style={{ overflow: 'hidden' }}>
          <Step n={6} result={<Result label="URL Encode" chip="Shortcut Input" />}>
            <B>Encode the message.</B> Tap <Tap>Add Action</Tap>, search <Tap>URL Encode</Tap>, add
            it. Tap its blue <Tap>Text</Tap> slot and choose the <Chip>Shortcut Input</Chip> variable.
          </Step>
          <Step
            n={7}
            code="moneymanager://sms?text="
            codeNote="Type this exactly — no space at the end. Then insert the encoded result right after the = so it ends with a chip:"
            result={<Result prefix="moneymanager://sms?text=" chip="URL Encoded Text" />}
            warn="This is the step people miss — the chip is inserted, not typed. Tap the box, then tap the “URL Encoded Text” suggestion in the bar above the keyboard. If it's not there, type a space, tap it, pick URL Encoded Text, then delete the space."
          >
            <B>Write the link.</B> Search the plain <Tap>Text</Tap> action and add it. Tap into its
            box and type:
          </Step>
          <Step n={8} last result={<Result label="Open" chip="Text" />}>
            <B>Open it.</B> Search <Tap>Open URLs</Tap> and add it. Tap its blue <Tap>URLs</Tap> slot
            and choose the <Chip>Text</Chip> variable — the output of step 7.
          </Step>
        </Surface>

        <Surface style={{ gap: space.sm, borderColor: colors.accentSoft }}>
          <Row gap={space.sm}>
            <Ionicons name="checkmark-circle" size={20} color={colors.completed} />
            <T variant="bodyStrong">Then tap Done — it&apos;s live</T>
          </Row>
          <T variant="small" tone="secondary">
            Test it: have someone text you a message containing <B>LKR</B>, e.g.{' '}
            <T variant="small" tone="muted" style={{ fontStyle: 'italic' }}>
              “LKR 500.00 debited from AC XXXX6796 at TEST SHOP”.
            </T>{' '}
            When it lands, Money Manager opens and a draft appears under “From your messages”.
          </T>
        </Surface>

        {/* Why one keyword is enough — proven against real bank formats. */}
        <PartHeader tag="Why LKR" title="One word catches them all" />
        <T variant="caption" tone="muted" style={{ marginTop: -space.sm }}>
          Every alert format below contains “LKR”, so a single automation covers your whole bank.
          The word that would otherwise seem obvious (“debited”) misses HNB purchases and ATM
          withdrawals.
        </T>
        <Surface padded={false} style={{ overflow: 'hidden' }}>
          <Keyword word="LKR …debited" desc="NDB purchases, transfers, utilities, loan payment" />
          <Keyword word="LKR …credited" desc="Money coming in (incoming transfers, salary)" />
          <Keyword word="PURCHASE …LKR" desc="HNB card purchases — no “debited” word" />
          <Keyword word="Withdrawal …LKR" desc="HNB ATM cash — no “debited” word" last />
        </Surface>

        <T variant="caption" tone="muted" style={{ lineHeight: 18 }}>
          These steps live in Apple&apos;s Shortcuts app — Money Manager can&apos;t create the
          automation for you, because iOS keeps message access out of apps&apos; hands. The link the
          Shortcut opens is one this app already handles; nothing about your bank or account is ever
          exposed.
        </T>
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
