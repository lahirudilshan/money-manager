import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, View } from 'react-native';
import { Label, Row, Surface, Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';
import {
  analyseProgress,
  expectedReadSeconds,
  formatElapsed,
  type AnalyseStage,
} from '../logic/analyseProgress';

export interface AnalyseLogLine {
  /** Seconds since the run started. */
  at: number;
  text: string;
}

export interface AnalyseRunState {
  stage: AnalyseStage;
  done?: number;
  total?: number;
  pages: number;
  startedAt: number;
  /** When the AI read began — the clock for its estimated stretch. */
  thinkingAt: number | null;
  /** When the explanation call began — step 2's clock. */
  explainAt?: number | null;
  log: AnalyseLogLine[];
}

const STAGES: { key: AnalyseStage; label: string }[] = [
  { key: 'saving-files', label: 'Saving your reports' },
  { key: 'reading', label: 'Preparing the pages' },
  // Covers both 'thinking' (Gemini looking) and 'writing' (its answer arriving).
  { key: 'thinking', label: 'Gemini reading every result' },
  { key: 'saving', label: 'Saving the results' },
  { key: 'explaining', label: 'Writing it up in simple words' },
];

/**
 * The analysis in progress: one bar for the whole job, a live line of what is
 * happening now, and the four stages with the current one's detail.
 *
 * Under the bar, one line says what is happening right now ("Asking Gemini…",
 * "Found 18 results…") — a 30-second wait with only a spinner reads as
 * "stuck"; a line that changes reads as work.
 */
export function AnalyseProgressCard({
  run,
  personName,
}: {
  run: AnalyseRunState;
  personName: string;
}) {
  const { colors, radius, space } = useTheme();
  const [now, setNow] = useState(Date.now());

  // A clock for the elapsed time and the AI stretch's estimate.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const elapsed = (now - run.startedAt) / 1000;
  const thinkingSeconds = run.thinkingAt ? (now - run.thinkingAt) / 1000 : 0;
  const target = analyseProgress({
    stage: run.stage,
    done: run.done,
    total: run.total,
    thinkingSeconds,
    written: run.done,
    pages: run.pages,
    explainSeconds: run.explainAt ? (now - run.explainAt) / 1000 : 0,
    results: run.total,
  });

  // Glide between values so the bar never jumps.
  const width = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(width, {
      toValue: target,
      duration: 400,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [target, width]);

  const latest = run.log[run.log.length - 1]?.text.replace(/[.…]+$/, '');
  const expected = expectedReadSeconds(run.pages);
  // Gemini looking and Gemini writing are one row on screen.
  const rowStage: AnalyseStage = run.stage === 'writing' ? 'thinking' : run.stage;
  const current = STAGES.findIndex((s) => s.key === rowStage);

  function detail(stage: AnalyseStage): string | null {
    if (stage !== rowStage) return null;
    if (run.stage === 'writing') {
      const found = run.total ?? 0;
      return found > 0
        ? `${found} ${found === 1 ? 'result' : 'results'} found so far`
        : 'Writing the summary';
    }
    if (stage === 'reading' && run.total)
      return `Page ${Math.min((run.done ?? 0) + 1, run.total)} of ${run.total}`;
    if (stage === 'thinking') {
      return thinkingSeconds > expected * 1.3
        ? 'Taking longer than usual — still working'
        : `Looking at the pages — usually about ${Math.round(expected / 5) * 5} seconds`;
    }
    if (stage === 'saving' && run.total) return `${run.total} results`;
    if (stage === 'explaining')
      return run.total ? `${run.total} results saved — opening them` : 'Results saved';
    return null;
  }

  return (
    <Surface>
      <View style={{ gap: space.lg, paddingVertical: space.xs }}>
        <View style={{ gap: space.sm }}>
          <Row style={{ alignItems: 'baseline', gap: space.sm }}>
            <Text variant="heading" style={{ flex: 1 }}>
              {`Reading ${personName}’s reports`}
            </Text>
            <Text
              variant="bodyStrong"
              color={colors.accent}
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {`${Math.round(target * 100)}%`}
            </Text>
          </Row>
          <View
            style={{
              height: 8,
              borderRadius: radius.pill,
              backgroundColor: colors.surfaceSunken,
              overflow: 'hidden',
            }}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(target * 100) }}
          >
            <Animated.View
              style={{
                height: '100%',
                borderRadius: radius.pill,
                backgroundColor: colors.accent,
                width: width.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
              }}
            />
          </View>
          {/* What is happening right now — the latest event, in place. */}
          <Row style={{ gap: space.sm, alignItems: 'flex-start' }}>
            <Text variant="small" style={{ flex: 1 }} numberOfLines={2}>
              {latest ? `${latest}…` : 'Starting…'}
            </Text>
            <Text variant="caption" tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
              {formatElapsed(elapsed)}
            </Text>
          </Row>
        </View>

        <View style={{ gap: space.md }}>
          {STAGES.map((stage, index) => {
            const done = index < current;
            const active = index === current;
            const sub = detail(stage.key);
            return (
              <Row key={stage.key} style={{ gap: space.md, alignItems: 'center' }}>
                <View style={{ width: 20, alignItems: 'center' }}>
                  {done ? (
                    <Ionicons name="checkmark-circle" size={20} color={colors.completed} />
                  ) : active ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Ionicons name="ellipse-outline" size={20} color={colors.inkFaint} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    variant={active ? 'bodyStrong' : 'body'}
                    tone={done || active ? 'ink' : 'muted'}
                  >
                    {stage.label}
                  </Text>
                  {sub ? (
                    <Text variant="caption" tone="secondary">
                      {sub}
                    </Text>
                  ) : null}
                </View>
              </Row>
            );
          })}
        </View>
      </View>
    </Surface>
  );
}

/** What happened in a run that failed, step by step. Collapsed until asked for. */
export function AnalyseLog({
  log,
  initiallyOpen = false,
}: {
  log: AnalyseLogLine[];
  initiallyOpen?: boolean;
}) {
  const { colors, radius, space } = useTheme();
  const [open, setOpen] = useState(initiallyOpen);
  if (log.length === 0) return null;
  return (
    <View style={{ gap: space.sm }}>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button">
        <Row style={{ alignItems: 'center', gap: space.xs }}>
          <Label>WHAT HAPPENED</Label>
          <View style={{ flex: 1 }} />
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.inkMuted} />
        </Row>
      </Pressable>
      {open ? (
        <View
          style={{
            gap: 6,
            padding: space.md,
            borderRadius: radius.md,
            backgroundColor: colors.surfaceSunken,
          }}
        >
          {log.map((line, index) => (
            <Row key={index} style={{ gap: space.sm, alignItems: 'flex-start' }}>
              <Text
                variant="caption"
                tone="muted"
                style={{ fontVariant: ['tabular-nums'], width: 34 }}
              >
                {formatElapsed(line.at)}
              </Text>
              <Text
                variant="caption"
                tone={index === log.length - 1 ? 'ink' : 'secondary'}
                style={{ flex: 1 }}
              >
                {line.text}
              </Text>
            </Row>
          ))}
        </View>
      ) : null}
    </View>
  );
}
