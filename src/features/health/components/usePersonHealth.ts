import { useMemo } from 'react';
import { healthLabRepo, healthReadingRepo } from '~/db/repositories';
import type { HealthAnalysis } from '~/db/schema';
import { buildSeries, flaggedSeries, type MetricSeries } from '~/features/health/logic/healthMetrics';
import { readOverall, type AnalysisOverall } from '~/features/health/logic/labReports';
import { summariseReports, type ReportSummary } from '~/features/health/logic/reportList';

export interface PersonHealth {
  /** Every measure, home readings and lab results merged. */
  series: MetricSeries[];
  /** Measures whose latest value is out of range. */
  flagged: MetricSeries[];
  latestAnalysis: HealthAnalysis | null;
  overall: AnalysisOverall | null;
  analysisCount: number;
  /** Every AI-read report, newest first, with what it found. */
  reports: ReportSummary[];
}

/**
 * One person's health numbers and latest AI verdict, read from the database.
 *
 * Read through the repositories, not the store — see the health home for why
 * medical records stay out of global state. `refreshKey` is any value that
 * changes after a health write (the screens pass `healthPeople`).
 */
export function usePersonHealth(personId: string | undefined, refreshKey: unknown): PersonHealth {
  // `refreshKey` is the re-read trigger, not a value used inside.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => readPersonHealth(personId), [personId, refreshKey]);
}

/** The same, read once outside React — for Ask AI's context. */
export function readPersonHealth(personId: string | undefined): PersonHealth {
  {
    if (!personId) {
      return {
        series: [],
        flagged: [],
        latestAnalysis: null,
        overall: null,
        analysisCount: 0,
        reports: [],
      };
    }
    const readings = healthReadingRepo.byPerson(personId);
    const labs = healthLabRepo.resultsByPerson(personId);
    const analyses = healthLabRepo.analysesByPerson(personId);
    const series = buildSeries(readings, labs);
    const latest = analyses[0] ?? null;
    return {
      series,
      flagged: flaggedSeries(series),
      latestAnalysis: latest,
      overall: latest ? readOverall(latest.overallJson) : null,
      analysisCount: analyses.length,
      reports: summariseReports(analyses, labs),
    };
  }
}
