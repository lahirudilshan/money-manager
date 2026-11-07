import { describe, expect, it } from 'vitest';
import { healthStory, type StoryAnalysis, type TimelineEntry } from '~/features/health/logic/health';

const entry = (p: Partial<TimelineEntry> & Pick<TimelineEntry, 'id' | 'kind'>): TimelineEntry => ({
  refId: p.id,
  personId: 'p1',
  at: new Date(2026, 2, 14),
  title: p.id,
  ...p,
});

const analysis = (documentIds: string[]): StoryAnalysis => ({
  id: 'a1',
  at: new Date(2026, 2, 14),
  headline: 'Mostly fine',
  flagged: 1,
  condition: 'fair',
  documentIds,
});

describe('scan sessions on the timeline', () => {
  it('keeps reports scanned together in one session', () => {
    const story = healthStory(
      [
        entry({ id: 'd1', kind: 'document' }),
        entry({ id: 'd2', kind: 'document' }),
        entry({ id: 'd3', kind: 'document', at: new Date(2026, 0, 1) }),
      ],
      [analysis(['d1', 'd2'])],
    );
    const session = story.find((b) => b.kind === 'session');
    expect(session?.kind === 'session' && session.documents.map((d) => d.id)).toEqual(['d1', 'd2']);
    // The unrelated report stays on its own.
    expect(story.filter((b) => b.kind === 'single').map((b) => b.id)).toEqual(['d3']);
  });

  it('puts a visit’s scanned reports, and the verdict, inside the visit', () => {
    const story = healthStory(
      [
        entry({ id: 'v1', kind: 'visit' }),
        entry({ id: 'd1', kind: 'document', visitId: 'v1' }),
        entry({ id: 'd2', kind: 'document', visitId: 'v1' }),
      ],
      [analysis(['d1', 'd2'])],
    );
    expect(story).toHaveLength(1);
    const episode = story[0];
    expect(episode.kind).toBe('episode');
    if (episode.kind === 'episode') {
      expect(episode.records.map((r) => r.id).sort()).toEqual(['d1', 'd2']);
      expect(episode.analyses?.map((a) => a.id)).toEqual(['a1']);
    }
  });

  it('works without any analyses, as before', () => {
    const story = healthStory([entry({ id: 'd1', kind: 'document' })]);
    expect(story.map((b) => b.kind)).toEqual(['single']);
  });
});
