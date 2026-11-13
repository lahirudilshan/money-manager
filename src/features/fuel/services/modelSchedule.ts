/**
 * Tailor a vehicle's schedule to its exact model with AI — see
 * logic/modelSchedule.ts. Nothing is written until the user applies it.
 */

import { maintenanceOverrideRepo, vehicleRepo } from '~/db/repositories';
import type { Vehicle } from '~/db/schema';
import { aiAnswerForm } from '~/features/ai/services/aiFill';
import {
  describeModel,
  modelScheduleContext,
  modelScheduleForm,
  proposalsFrom,
  type ScheduleProposal,
} from '~/features/fuel/logic/modelSchedule';
import { syncAllMaintenanceReminders, vehicleItems } from './maintenanceReminders';

export async function lookUpModelSchedule(
  vehicle: Vehicle,
): Promise<
  { ok: true; known: boolean; note: string | null; proposals: ScheduleProposal[] } | { ok: false; error: string }
> {
  if (!describeModel(vehicle)) return { ok: false, error: 'Add the make and model first.' };
  const items = vehicleItems(vehicle);
  const unit = vehicle.odometerUnit;
  const result = await aiAnswerForm({
    form: modelScheduleForm(items),
    purpose:
      "The form tailors a vehicle's maintenance schedule to its exact model, from the manufacturer's owner's manual / maintenance guide.",
    rules: [
      'Base every value on the manufacturer schedule for this model and engine — not generic advice.',
      'If you do not know this model, set known to false and leave the lists empty.',
    ],
    context: modelScheduleContext(vehicle, items, unit),
    live: {
      title: 'Looking up your model’s schedule',
      subtitle: describeModel(vehicle) ?? vehicle.name,
      expectedSeconds: 25,
      done: {
        title: `${describeModel(vehicle) ?? vehicle.name}: schedule found`,
        body: 'Open Dayly to review the suggested changes before they are applied.',
      },
      failed: {
        title: 'Schedule lookup did not finish',
        body: 'Open Dayly to try again.',
      },
    },
  });
  if (!result.ok) return result;
  const known = result.values.known === true;
  return {
    ok: true,
    known,
    note: result.values.modelNote,
    proposals: known ? proposalsFrom(result.values, items, unit) : [],
  };
}

/** Write the proposals the user kept. */
export function applyProposals(vehicle: Vehicle, proposals: readonly ScheduleProposal[]): void {
  for (const p of proposals) {
    const o = p.override;
    maintenanceOverrideRepo.put(vehicle.id, o.itemKey, {
      title: o.title ?? null,
      group: o.group ?? null,
      action: o.action ?? null,
      everyKm: o.everyKm ?? null,
      everyMonths: o.everyMonths ?? null,
      applies: o.applies,
      recommended: o.recommended ?? null,
      detail: o.detail ?? null,
      source: o.source,
    });
  }
  void syncAllMaintenanceReminders(vehicleRepo.all());
}

/** Back to Dayly's defaults. */
export function resetSchedule(vehicle: Vehicle): void {
  maintenanceOverrideRepo.clear(vehicle.id);
  void syncAllMaintenanceReminders(vehicleRepo.all());
}
