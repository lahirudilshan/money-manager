/**
 * "Fill this form from the photo" — the one shape every AI read in Dayly takes.
 *
 * A feature describes the form it wants filled: each field's type and, most
 * importantly, a description of what to look for ("the mileage written on the
 * job card, not the invoice number"). From that ONE description come both
 *
 *   - the JSON Schema sent as Gemini's `responseJsonSchema`, so the reply is
 *     constrained to exactly these fields, types and choices, and every
 *     field's description travels with it as the instruction for that field;
 *   - `readForm`, which checks the reply against the same description, because
 *     a schema constrains the shape, not the truth: a date in 2031, a negative
 *     price or a choice that is not one of ours are dropped to null here.
 *
 * Pure and tested. The call itself is services/aiFill.ts.
 */

export type FieldSpec =
  | { type: 'text'; description: string }
  | { type: 'number'; description: string; min?: number; max?: number }
  | { type: 'date'; description: string }
  | { type: 'boolean'; description: string }
  | { type: 'choice'; description: string; options: readonly string[] }
  | { type: 'list'; description: string; of: FormSpec };

export type FormSpec = { readonly [key: string]: FieldSpec };

export const field = {
  text: (description: string) => ({ type: 'text', description }) as const,
  number: (description: string, range: { min?: number; max?: number } = {}) =>
    ({ type: 'number', description, ...range }) as const,
  /** Read as YYYY-MM-DD. */
  date: (description: string) => ({ type: 'date', description }) as const,
  boolean: (description: string) => ({ type: 'boolean', description }) as const,
  choice: <const O extends readonly string[]>(description: string, options: O) =>
    ({ type: 'choice', description, options }) as const,
  list: <const S extends FormSpec>(description: string, of: S) =>
    ({ type: 'list', description, of }) as const,
};

type ValueOf<F> = F extends { type: 'text' }
  ? string | null
  : F extends { type: 'number' }
    ? number | null
    : F extends { type: 'date' }
      ? Date | null
      : F extends { type: 'boolean' }
        ? boolean | null
        : F extends { type: 'choice'; options: readonly (infer O)[] }
          ? O | null
          : F extends { type: 'list'; of: infer S extends FormSpec }
            ? FormValues<S>[]
            : never;

export type FormValues<S extends FormSpec> = { -readonly [K in keyof S]: ValueOf<S[K]> };

/** The field every read gets: is this even the right kind of document? */
export const MATCHES_KEY = 'documentMatches';

type JsonSchema = Record<string, unknown>;

function fieldSchema(spec: FieldSpec): JsonSchema {
  switch (spec.type) {
    case 'text':
      return { type: ['string', 'null'], description: spec.description };
    case 'number':
      return {
        type: ['number', 'null'],
        description: `${spec.description} A plain number: no currency, units or thousands separators.`,
      };
    case 'date':
      return { type: ['string', 'null'], description: `${spec.description} As YYYY-MM-DD.` };
    case 'boolean':
      return { type: ['boolean', 'null'], description: spec.description };
    case 'choice':
      return {
        type: ['string', 'null'],
        enum: [...spec.options, null],
        description: spec.description,
      };
    case 'list':
      return { type: 'array', description: spec.description, items: objectSchema(spec.of) };
  }
}

function objectSchema(spec: FormSpec): JsonSchema {
  const keys = Object.keys(spec);
  return {
    type: 'object',
    properties: Object.fromEntries(keys.map((k) => [k, fieldSchema(spec[k])])),
    // Every field is asked for, each may be null: a model told a field is
    // optional tends to skip it even when the value is on the page.
    required: keys,
  };
}

/**
 * The JSON Schema for a form. With a `documentKind` (a form filled from a
 * file), the document-check field is added.
 */
export function schemaFor(spec: FormSpec, documentKind?: string): JsonSchema {
  const schema = objectSchema(spec);
  if (!documentKind) return schema;
  return {
    ...schema,
    properties: {
      [MATCHES_KEY]: {
        type: 'boolean',
        description: `True only if the file really is ${documentKind}.`,
      },
      ...(schema.properties as JsonSchema),
    },
    required: [MATCHES_KEY, ...(schema.required as string[])],
  };
}

/** The rules for a form answered from what the model knows, with no file. */
export function knowledgeInstruction(input: { purpose: string; rules?: readonly string[] }): string {
  return [
    'You fill in a form from what you reliably know. There is no attached file.',
    input.purpose,
    'Each field in the response schema has a description saying exactly what is wanted. Follow it.',
    'Only give a value you are confident is correct for exactly what is asked. When unsure, use null — a null is always better than a plausible guess.',
    'Write in short, plain English.',
    ...(input.rules ?? []),
  ].join('\n');
}

/** The rules every form read follows — the per-field detail is in the schema. */
export function formInstruction(input: { purpose: string; documentKind: string; rules?: readonly string[] }): string {
  return [
    `You fill in a form from the attached file, which should be ${input.documentKind}.`,
    input.purpose,
    'Each field in the response schema has a description saying exactly what to look for. Follow it.',
    'Fill a field only from what you can actually read in the file. If it is not there or not legible, use null. Never guess or invent.',
    'The file may be printed or handwritten, in English, Sinhala or Tamil, and photographed at an angle. Write text values in short, plain English.',
    'For lists, give one entry per item you can see, in the order shown; an empty list if there are none.',
    ...(input.rules ?? []),
  ].join('\n');
}

const toNumber = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const cleaned = v.replace(/[,\s]/g, '').replace(/[^\d.-]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

function readValue(spec: FieldSpec, raw: unknown, today: Date): unknown {
  switch (spec.type) {
    case 'text': {
      const text = typeof raw === 'string' ? raw.trim() : '';
      return text && text.toLowerCase() !== 'null' ? text : null;
    }
    case 'number': {
      const n = toNumber(raw);
      if (n === null) return null;
      if (spec.min != null && n < spec.min) return null;
      if (spec.max != null && n > spec.max) return null;
      return n;
    }
    case 'date': {
      const m = typeof raw === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim()) : null;
      if (!m) return null;
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (d.getMonth() !== Number(m[2]) - 1) return null; // 2026-02-31
      if (d.getFullYear() < 1990 || d.getTime() > today.getTime() + 86_400_000) return null;
      return d;
    }
    case 'boolean':
      return typeof raw === 'boolean' ? raw : null;
    case 'choice':
      return typeof raw === 'string' && spec.options.includes(raw) ? raw : null;
    case 'list':
      return Array.isArray(raw)
        ? raw
            .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
            .map((row) => readObject(spec.of, row, today))
        : [];
  }
}

function readObject(spec: FormSpec, raw: Record<string, unknown>, today: Date) {
  return Object.fromEntries(Object.keys(spec).map((k) => [k, readValue(spec[k], raw[k], today)]));
}

/**
 * The model's reply, checked field by field against the form.
 *
 * `matches` is false when the model said the file is not the document asked
 * for (a selfie instead of a receipt) — the caller says so instead of filling
 * the form with nothing.
 */
export function readForm<S extends FormSpec>(
  spec: S,
  data: unknown,
  today = new Date(),
): { matches: boolean; values: FormValues<S> } {
  const raw = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  return {
    matches: raw[MATCHES_KEY] !== false,
    values: readObject(spec, raw, today) as FormValues<S>,
  };
}
