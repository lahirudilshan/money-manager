import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Row, Surface, Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { analyseProgress } from '../logic/analyseProgress';
import { dismissAnalyseRun, useActiveAnalyseRun } from '../services/analyseRun';

/**
 * The AI reading that is still going (or just ended), shown where its results
 * will appear — Health home, Documents, Labs — after the user left the
 * Analyse screen.
 *
 * Running: a compact bar and the latest line; tapping opens the full progress.
 * Finished: what was found, tapping opens the summary. Failed: the reason,
 * tapping tries the same saved reports again.
 */
export function AnalyseRunBanner({ personId }: { personId: string | null | undefined }) {
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  const active = useActiveAnalyseRun(personId ?? null);
  const running = active !== null && active.outcome === null;
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [running]);

  if (!active) return null;
  const { run, outcome } = active;

  if (!outcome) {
    const fraction = analyseProgress({
      stage: run.stage,
      done: run.done,
      total: run.total,
      thinkingSeconds: run.thinkingAt ? (now - run.thinkingAt) / 1000 : 0,
      written: run.done,
      pages: run.pages,
      explainSeconds: run.explainAt ? (now - run.explainAt) / 1000 : 0,
      results: run.total,
    });
    const latest = run.log[run.log.length - 1]?.text.replace(/[.…]+$/, '');
    return (
      <Pressable
        onPress={() =>
          // Step 2: the numbers are already saved — open them, not the progress.
          router.push(
            active.analysisId
              ? `/mini/health/analysis?id=${active.analysisId}`
              : `/mini/health/analyze?person=${active.personId}`,
          )
        }
        accessibilityRole="button"
        accessibilityLabel={`AI is reading ${active.personName}’s reports, ${Math.round(fraction * 100)} percent`}
      >
        <Surface>
          <View style={{ gap: space.sm }}>
            <Row style={{ gap: space.sm, alignItems: 'center' }}>
              <Ionicons name="sparkles" size={16} color={colors.accent} />
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                {`Reading ${run.pages} ${run.pages === 1 ? 'page' : 'pages'} with AI`}
              </Text>
              <Text
                variant="bodyStrong"
                color={colors.accent}
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {`${Math.round(fraction * 100)}%`}
              </Text>
            </Row>
            <View
              style={{
                height: 6,
                borderRadius: radius.pill,
                backgroundColor: colors.surfaceSunken,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  height: '100%',
                  width: `${Math.round(fraction * 100)}%`,
                  borderRadius: radius.pill,
                  backgroundColor: colors.accent,
                }}
              />
            </View>
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {latest ? `${latest}…` : 'Starting…'}
            </Text>
          </View>
        </Surface>
      </Pressable>
    );
  }

  const ok = outcome.ok;
  const title = ok ? 'Reports read by AI' : 'AI could not finish reading';
  const detail = outcome.ok
    ? `${outcome.results} ${outcome.results === 1 ? 'result' : 'results'}` +
      (outcome.flagged > 0 ? ` · ${outcome.flagged} to check` : ' · all in range') +
      ' · Tap to see'
    : `${outcome.error} Tap to try again.`;

  function open() {
    if (!active || !outcome) return;
    dismissAnalyseRun();
    if (outcome.ok) router.push(`/mini/health/analysis?id=${outcome.analysisId}`);
    else
      router.push(
        `/mini/health/analyze?person=${active.personId}&docs=${active.documentIds.join(',')}`,
      );
  }

  return (
    <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`${title}. ${detail}`}>
      <Surface>
        <Row style={{ gap: space.md, alignItems: 'center' }}>
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: radius.sm,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: ok ? colors.accentSoft : colors.dangerSoft,
            }}
          >
            <Ionicons
              name={ok ? 'sparkles' : 'alert-circle'}
              size={17}
              color={ok ? colors.accent : colors.danger}
            />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">{title}</Text>
            <Text variant="caption" tone="secondary" numberOfLines={2}>
              {detail}
            </Text>
          </View>
          <Pressable
            onPress={dismissAnalyseRun}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          >
            <Ionicons name="close" size={18} color={colors.inkMuted} />
          </Pressable>
        </Row>
      </Surface>
    </Pressable>
  );
}
