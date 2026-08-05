import React from 'react';
import { PillSelect } from './forms';
import { shouldAskForHouse, type HouseLike } from '../core/houses';

/**
 * "Which house was this for?" — shown ONLY when the question is real.
 *
 * The component renders nothing at all unless there is more than one house AND
 * the line being paid is house-scoped (see `shouldAskForHouse`). That guard
 * lives here rather than at every call site because it is the whole design
 * contract of the feature: a user with one home must never see this, and a
 * subscription or a salary must never ask it even when several houses exist.
 * Putting the check in one place means a new form cannot forget it and start
 * nagging.
 *
 * `null` is not offered as a choice. Leaving a house-scoped payment
 * unattributed is a state the data model allows (a row whose house was later
 * deleted), but it is not something to invite — the picker always has a
 * sensible default selected, so the user's only decision is whether to change
 * it.
 */
export function HousePicker({
  houses,
  houseScoped,
  selectedHouseId,
  onSelect,
  label = 'WHICH HOUSE',
}: {
  houses: readonly (HouseLike & { name: string })[];
  /** Whether this budget line's payments are per-property. */
  houseScoped: boolean;
  selectedHouseId: string | null;
  onSelect: (houseId: string) => void;
  label?: string;
}) {
  if (!shouldAskForHouse(houses, houseScoped)) return null;

  return (
    <PillSelect
      label={label}
      options={houses.map((house) => ({
        key: house.id,
        label: house.name,
        // The user's own home is marked, so a list of place names does not
        // require remembering which one is theirs.
        icon: house.isPrimary ? ('home' as const) : ('home-outline' as const),
      }))}
      selectedKey={selectedHouseId}
      onSelect={onSelect}
    />
  );
}
