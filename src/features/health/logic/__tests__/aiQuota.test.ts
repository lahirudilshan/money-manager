import { describe, expect, it } from 'vitest';
import {
  EMPTY_LOG,
  FREE_TIER_DAILY_DEFAULT,
  modelLabel,
  nextPacificMidnight,
  pacificDayKey,
  parseLog,
  quotaSummary,
  quotaValueFrom,
  recordCall,
} from '../aiQuota';

const MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest'];

describe('Pacific day', () => {
  it('uses UTC−8 in winter and UTC−7 in summer', () => {
    // 07:30 UTC on 10 Dec is still 9 Dec in California (23:30 PST).
    expect(pacificDayKey(new Date('2026-12-10T07:30:00Z'))).toBe('2026-12-09');
    expect(pacificDayKey(new Date('2026-12-10T08:30:00Z'))).toBe('2026-12-10');
    // 06:30 UTC on 10 Jul is 9 Jul 23:30 PDT; 07:30 is the new day.
    expect(pacificDayKey(new Date('2026-07-10T06:30:00Z'))).toBe('2026-07-09');
    expect(pacificDayKey(new Date('2026-07-10T07:30:00Z'))).toBe('2026-07-10');
  });

  it('resets at the next Pacific midnight', () => {
    expect(nextPacificMidnight(new Date('2026-12-10T03:00:00Z')).toISOString()).toBe(
      '2026-12-10T08:00:00.000Z',
    );
    expect(nextPacificMidnight(new Date('2026-07-10T12:00:00Z')).toISOString()).toBe(
      '2026-07-11T07:00:00.000Z',
    );
  });
});

describe('recordCall', () => {
  const at = new Date('2026-11-09T18:00:00Z');

  it('counts successful calls per model', () => {
    let log = recordCall(EMPTY_LOG, { model: MODELS[0], ok: true, at });
    log = recordCall(log, { model: MODELS[0], ok: true, at });
    log = recordCall(log, { model: MODELS[1], ok: true, at });
    const s = quotaSummary(log, MODELS, at);
    expect(s.models.map((m) => m.used)).toEqual([2, 1]);
    expect(s.requestsLeft).toBe(FREE_TIER_DAILY_DEFAULT * 2 - 3);
    expect(s.reportsLeft).toBe(Math.floor((FREE_TIER_DAILY_DEFAULT * 2 - 3) / 2));
  });

  it("takes Google's own limit from a daily 429 and empties that model", () => {
    const body = '{"error":{"code":429,"message":"Quota exceeded for metric generate_content_free_tier_requests, limit: 20 per day","details":[{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier","quotaValue":"25"}]}]}}';
    const log = recordCall(EMPTY_LOG, { model: MODELS[0], ok: false, status: 429, body, at });
    const s = quotaSummary(log, MODELS, at);
    expect(s.models[0]).toMatchObject({ left: 0, limit: 25, fromGoogle: true });
    expect(s.models[1].left).toBe(FREE_TIER_DAILY_DEFAULT);
  });

  it('ignores per-minute limits and other errors', () => {
    const log = recordCall(EMPTY_LOG, {
      model: MODELS[0],
      ok: false,
      status: 429,
      body: 'Quota exceeded: requests per minute',
      at,
    });
    expect(quotaSummary(log, MODELS, at).models[0].left).toBe(FREE_TIER_DAILY_DEFAULT);
  });

  it('starts again on a new Pacific day but remembers learned limits', () => {
    const body = '"quotaValue": "30" per day';
    let log = recordCall(EMPTY_LOG, { model: MODELS[0], ok: false, status: 429, body, at });
    const tomorrow = new Date('2026-11-10T18:00:00Z');
    log = recordCall(log, { model: MODELS[0], ok: true, at: tomorrow });
    expect(quotaSummary(log, MODELS, tomorrow).models[0]).toMatchObject({ used: 1, limit: 30, left: 29 });
  });
});

describe('helpers', () => {
  it('reads quotaValue', () => {
    expect(quotaValueFrom('"quotaValue": "20"')).toBe(20);
    expect(quotaValueFrom('nothing here')).toBeNull();
  });

  it('labels models in plain words', () => {
    expect(modelLabel('gemini-flash-lite-latest')).toBe('Gemini Flash-Lite');
    expect(modelLabel('gemini-3-flash-preview')).toBe('Gemini 3 Flash');
    expect(modelLabel('gemini-flash-latest')).toBe('Gemini Flash');
  });

  it('survives a broken stored log', () => {
    expect(parseLog('{bad')).toEqual(EMPTY_LOG);
    expect(parseLog(undefined)).toEqual(EMPTY_LOG);
  });
});
