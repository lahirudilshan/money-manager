import { reportTopics, type ReportTopic } from './documentSearch';
import { isOutOfRange, readOverall, type ConditionKey, type LabStatusKey } from './labReports';

/**
 * One AI-read report as a line in "My reports": when, what it covered, and
 * what it found — enough to know which one to open without opening them all.
 */
export interface ReportSummary {
  id: string;
  reportDate: Date;
  headline: string;
  condition: ConditionKey;
  /** "Blood sugar", "Kidney" — out-of-range topics first. */
  topics: ReportTopic[];
  total: number;
  /** Results outside their normal range. */
  flagged: number;
}

interface AnalysisRow {
  id: string;
  reportDate: Date;
  headline: string;
  overallJson: string;
}

interface ResultRow {
  analysisId: string;
  category: string;
  status: LabStatusKey | string;
}

/** Newest first, as the analyses arrive. */
export function summariseReports(
  analyses: readonly AnalysisRow[],
  results: readonly ResultRow[],
): ReportSummary[] {
  const byAnalysis = new Map<string, ResultRow[]>();
  for (const r of results) {
    byAnalysis.set(r.analysisId, [...(byAnalysis.get(r.analysisId) ?? []), r]);
  }
  return analyses.map((a) => {
    const rows = byAnalysis.get(a.id) ?? [];
    return {
      id: a.id,
      reportDate: a.reportDate,
      headline: a.headline,
      condition: readOverall(a.overallJson).condition,
      topics: reportTopics(rows, null),
      total: rows.length,
      flagged: rows.filter((r) => isOutOfRange(r.status as LabStatusKey)).length,
    };
  });
}

/**
 * The plain-words result line: "All 3 tests normal" / "2 of 9 tests to check".
 */
export function reportFindingText(report: Pick<ReportSummary, 'total' | 'flagged'>): string {
  const { total, flagged } = report;
  if (total === 0) return 'No test results saved';
  if (flagged === 0) return total === 1 ? 'Result normal' : `All ${total} tests normal`;
  return `${flagged} of ${total} ${total === 1 ? 'test' : 'tests'} to check`;
}
