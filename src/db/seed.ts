import { toMinor } from '../core/money';
import { cardRepo, categoryRepo, incomeRepo, subcategoryRepo } from './repositories';

/**
 * A small genericized starter plan — used both by the onboarding wizard's
 * "use a sample template" shortcut and by Settings' dev-only "Seed demo data"
 * button. Deliberately generic placeholder names/round numbers, never a real
 * person's actual financial figures.
 *
 * Reuses `existingCardId` when given (e.g. the account the user already
 * created in onboarding's step 1) instead of always creating a second
 * "Main Account" card.
 */
export function seedSampleTemplate(existingCardId?: string | null): void {
  const mainCard = existingCardId
    ? cardRepo.byId(existingCardId)
    : undefined;
  const card =
    mainCard ??
    cardRepo.create({
      name: 'Main Account',
      kind: 'bank',
      color: '#2A78D6',
      icon: 'wallet-outline',
      sortOrder: 0,
    });

  incomeRepo.create({
    name: 'Salary',
    amountMinor: toMinor(100_000),
    cardId: card.id,
    icon: 'cash-outline',
    color: '#0F8A4D',
    sortOrder: 0,
  });

  function buildCategory(
    name: string,
    icon: string,
    dueDay: number,
    sortOrder: number,
    items: { name: string; planned: number; icon: string }[],
  ) {
    const category = categoryRepo.create({
      name,
      cardId: card.id,
      color: '#6366F1',
      icon,
      dueDay,
      sortOrder,
    });

    items.forEach((item, index) => {
      subcategoryRepo.create({
        name: item.name,
        type: 'expense',
        categoryId: category.id,
        color: '#6366F1',
        icon: item.icon,
        plannedMinor: toMinor(item.planned),
        frequency: 'monthly',
        sortOrder: index,
      });
    });

    return category;
  }

  buildCategory('Housing', 'home-outline', 1, 0, [
    { name: 'Rent', planned: 50_000, icon: 'key-outline' },
    { name: 'Utilities', planned: 10_000, icon: 'flash-outline' },
  ]);

  buildCategory('Living', 'basket-outline', 1, 1, [
    { name: 'Groceries', planned: 30_000, icon: 'restaurant-outline' },
    { name: 'Transport', planned: 10_000, icon: 'speedometer-outline' },
  ]);

  buildCategory('Subscriptions', 'repeat-outline', 5, 2, [
    { name: 'Subscriptions', planned: 5_000, icon: 'wifi-outline' },
  ]);
}
