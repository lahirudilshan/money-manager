import { describe, expect, it } from 'vitest';
import {
  addQuestion,
  ASK_MODELS,
  buildAskPrompt,
  buildHealthContext,
  cleanAnswer,
  parseQuestionLog,
  questionsUsedToday,
  routeQuestion,
  sourcesFrom,
  starterQuestions,
  inSentence,
} from '~/features/health/logic/askHealth';

describe('routing a question to the right model', () => {
  it('sends a quick lookup over the record to Flash-Lite, no web', () => {
    const r = routeQuestion('What is my sugar level?');
    expect(r).toMatchObject({ depth: 'quick', web: false });
    expect(r.models[0]).toMatch(/lite/);
  });

  it('grounds questions about the world in Google Search, on Flash', () => {
    const r = routeQuestion('What foods lower cholesterol?');
    expect(r.web).toBe(true);
    expect(r.depth).toBe('deep');
    expect(r.models).toEqual(ASK_MODELS.deep);
    expect(routeQuestion('Side effects of metformin').web).toBe(true);
  });

  it('a personal question about food still searches; reasoning goes deep', () => {
    expect(routeQuestion('What should I eat for my high sugar?').web).toBe(true);
    expect(routeQuestion('Why is my HbA1c going up?')).toMatchObject({ depth: 'deep', web: false });
    expect(routeQuestion('Is my sugar getting worse?').depth).toBe('deep');
  });
});

describe('what is sent', () => {
  const series = [
    {
      testName: 'Fasting blood sugar',
      refLow: 70,
      refHigh: 99,
      history: [
        { valueText: '110', unit: 'mg/dL', status: 'borderline' as const, measuredAt: new Date('2026-01-05') },
        { valueText: '142', unit: 'mg/dL', status: 'high' as const, measuredAt: new Date('2026-10-03') },
      ],
    },
  ];

  it('lists each test newest first with its range, and the person', () => {
    const text = buildHealthContext({
      person: { name: 'Amma', age: 61, sex: 'female', conditions: 'Diabetes', allergies: null },
      series,
      latestReport: { reportDate: new Date('2026-10-03'), headline: 'Sugar is high', summary: null, watchOut: ['Sugar'] },
      medicines: ['Metformin 500 mg'],
      today: new Date('2026-11-11'),
    });
    expect(text).toContain('Amma, 61 years, female');
    expect(text).toContain('Known conditions: Diabetes');
    expect(text).toContain('Fasting blood sugar (normal 70–99): 142 mg/dL high on 2026-10-03; 110 mg/dL borderline on 2026-01-05');
    expect(text).toContain('Medicines now: Metformin 500 mg');
    expect(text).not.toContain('Allergies');
  });

  it('keeps only the last few turns of the chat', () => {
    const earlier = Array.from({ length: 6 }, (_, i) => ({ question: `q${i}`, answer: `a${i}` }));
    const prompt = buildAskPrompt({ context: 'CTX', earlier, question: ' new? ' });
    expect(prompt).not.toContain('q1');
    expect(prompt).toContain('Q: q5');
    expect(prompt.endsWith('QUESTION\nnew?')).toBe(true);
  });
});

describe('reading the answer', () => {
  it('collects web sources once each', () => {
    const sources = sourcesFrom({
      groundingChunks: [
        { web: { uri: 'https://a', title: 'NHS' } },
        { web: { uri: 'https://a', title: 'NHS' } },
        { web: { uri: 'https://b' } },
        {},
      ],
    });
    expect(sources).toEqual([
      { title: 'NHS', uri: 'https://a' },
      { title: 'Web page', uri: 'https://b' },
    ]);
    expect(sourcesFrom(null)).toEqual([]);
  });

  it('strips markdown to plain text with dash bullets', () => {
    expect(cleanAnswer('## Hi\n**Bold** text\n* one\n\n\n\n• two')).toBe('Hi\nBold text\n- one\n\n- two');
  });

  it('suggests questions from what is off', () => {
    const qs = starterQuestions([{ testName: 'LDL', latest: { status: 'high' } }]);
    expect(qs[0]).toMatch(/latest results/);
    expect(qs).toContain('My LDL is high. What should I do?');
  });
});

describe('daily question count', () => {
  it('counts per local day', () => {
    const now = new Date(2026, 10, 11, 9);
    let log = parseQuestionLog('garbage');
    log = addQuestion(addQuestion(log, now), now);
    expect(questionsUsedToday(log, now)).toBe(2);
    expect(questionsUsedToday(log, new Date(2026, 10, 12, 9))).toBe(0);
    expect(questionsUsedToday(parseQuestionLog(JSON.stringify(log)), now)).toBe(2);
  });
});

describe('inSentence', () => {
  it('drops brackets and keeps acronyms', () => {
    expect(inSentence('Liver enzyme (AST)')).toBe('liver enzyme');
    expect(inSentence('LDL (“bad”) cholesterol')).toBe('LDL cholesterol');
    expect(inSentence('Fasting blood sugar')).toBe('fasting blood sugar');
  });
});
