/**
 * A small sample record, written the first time the health add-on is enabled.
 *
 * The screens here are built around history — a timeline and a trend chart —
 * and both are blank or meaningless with one day's data. An empty record shows
 * "no readings yet" everywhere and reads as broken rather than as new, which is
 * the same problem `seedFuel` solves for the fuel app.
 *
 * The sample is deliberately ONE person with a handful of records, so it is
 * obviously a demo and takes seconds to delete. Deleting that person cascades
 * to everything below (see the schema), so clearing the sample is one action.
 *
 * A no-op once any person exists, so it cannot duplicate on a re-toggle.
 */

import {
  healthDocumentRepo,
  healthMedicineRepo,
  healthPersonRepo,
  healthReadingRepo,
  healthVisitRepo,
} from '~/db/repositories';

/** Days back from today, at a fixed hour so the timeline groups predictably. */
function daysAgo(days: number, hour = 9): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, 0, 0, 0);
  return date;
}

export function seedHealthSample(): void {
  if (healthPersonRepo.all().length > 0) return;

  const person = healthPersonRepo.create({
    name: 'Sample person',
    relation: 'self',
    bornOn: new Date(1985, 6, 1),
    bloodGroup: 'O+',
    allergies: 'Penicillin',
    conditions: 'Hypertension',
    note: 'Example record — delete this person to clear it.',
    color: '#D6336C',
    icon: 'person-outline',
    isSelf: true,
    sortOrder: 0,
  });

  /*
   * CASE A — a full consultation, recorded as one episode.
   *
   * The shape the real world has: you see a doctor, they measure your
   * pressure in the room, write a diagnosis, prescribe a tablet and hand you
   * a lab form. All of it belongs to this one visit, which is what the case
   * page shows and what `visitId` on each record encodes.
   */
  const review = healthVisitRepo.create({
    personId: person.id,
    visitedAt: daysAgo(30, 10),
    kind: 'consultation',
    doctor: 'Dr Perera',
    facility: 'Nawaloka',
    reason: 'Blood pressure review',
    diagnosis: 'Hypertension, controlled',
    costMinor: 350000,
    followUpOn: daysAgo(-21, 10),
  });

  healthMedicineRepo.create({
    personId: person.id,
    visitId: review.id,
    name: 'Amlodipine',
    dosage: '5 mg',
    form: 'tablet',
    instructions: 'One at night, after meals',
    prescribedBy: 'Dr Perera',
    startedOn: daysAgo(30),
    isActive: true,
  });

  // Measured in the consulting room, so it belongs to the visit.
  healthReadingRepo.create({
    personId: person.id,
    visitId: review.id,
    metric: 'blood_pressure',
    value: 148,
    valueSecondary: 95,
    unit: 'mmHg',
    measuredAt: daysAgo(30, 10),
    context: 'random',
  });

  /*
   * CASE B — a lab test ordered at that visit, collected days later.
   *
   * The document belongs to the visit that ordered it but is DATED when the
   * result came back. The case page shows that gap rather than hiding it,
   * because "blood drawn on the 3rd, result on the 7th" is the real sequence.
   */
  healthDocumentRepo.create({
    personId: person.id,
    visitId: review.id,
    title: 'Lipid profile',
    kind: 'report',
    documentDate: daysAgo(26),
    summary: 'Total cholesterol 214 mg/dL — slightly high',
  });

  /*
   * CASE C — readings taken at HOME, belonging to no visit.
   *
   * The common case, and the reason linking must stay optional: someone
   * checking their pressure every Sunday is not visiting a doctor. Forcing
   * these into a visit would make the record state something untrue.
   */
  const homeSystolic = [145, 142, 138, 141, 135, 132, 129];
  const homeDiastolic = [93, 91, 88, 90, 86, 84, 82];

  homeSystolic.forEach((value, index) => {
    healthReadingRepo.create({
      personId: person.id,
      visitId: null,
      metric: 'blood_pressure',
      value,
      valueSecondary: homeDiastolic[index]!,
      unit: 'mmHg',
      measuredAt: daysAgo(24 - index * 4, 8),
      context: 'morning',
    });
  });

  // Fasting sugar, also at home — a second metric so the trends screen has a
  // picker worth using.
  [112, 104, 98, 94].forEach((value, index) => {
    healthReadingRepo.create({
      personId: person.id,
      visitId: null,
      metric: 'blood_sugar',
      value,
      valueSecondary: null,
      unit: 'mg/dL',
      measuredAt: daysAgo(21 - index * 7, 7),
      context: 'fasting',
    });
  });

  /*
   * CASE F — something already being taken when the record was set up.
   *
   * No visit, because the consultation that started it happened long before
   * the app existed. A prescription with no `visitId` is a first-class row,
   * not a broken one.
   */
  healthMedicineRepo.create({
    personId: person.id,
    visitId: null,
    name: 'Metformin',
    dosage: '500 mg',
    form: 'tablet',
    instructions: 'Twice a day with food',
    startedOn: daysAgo(400),
    isActive: true,
  });
}
