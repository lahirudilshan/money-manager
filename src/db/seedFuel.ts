import { fuelEntryRepo, serviceItemRepo, vehicleRepo, vehicleServiceRepo } from './repositories';

/**
 * A realistic fuel history, so the mini app has something to show on first open.
 *
 * An empty tracker cannot demonstrate the thing it exists for: tank-to-tank
 * consumption needs at least two full tanks before it can report anything at
 * all, so a brand-new install would show "—" everywhere and look broken.
 *
 * The data is deliberately imperfect, because a perfect log would hide the
 * behaviour that matters:
 *
 *   - one PARTIAL fill, so the folding-into-the-window rule is visible;
 *   - efficiency that drifts between tanks, so best/worst differ;
 *   - a service with both a date and an odometer due, so reminders have
 *     something to compute.
 *
 * Idempotent: seeds nothing when a vehicle already exists, so opening the app
 * twice does not double the history.
 */
export function seedFuelSample(): void {
  if (vehicleRepo.all().length > 0) return;

  const car = vehicleRepo.create({
    name: 'Hyundai Venue N Line',
    registration: null,
    kind: 'car',
    // 2026 Venue N Line is the 1.0 turbo petrol.
    fuelType: 'petrol',
    tankLitres: 45,
    odometerUnit: 'km',
    color: '#0E9F6E',
    icon: 'car-sport-outline',
    sortOrder: 0,
  });

  const bike = vehicleRepo.create({
    name: 'Honda Dio',
    registration: null,
    kind: 'bike',
    fuelType: 'petrol',
    tankLitres: 5.3,
    odometerUnit: 'km',
    color: '#0F6FDE',
    icon: 'bicycle-outline',
    sortOrder: 1,
  });

  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  /*
   * The car's history, oldest first.
   *
   * Litres and odometer are chosen so the reported figures land where a 1.0
   * turbo petrol actually sits (12-13 km/l) rather than on round numbers that
   * look synthetic.
   */
  const carFills: [days: number, odo: number, litres: number, full: boolean, total: number][] = [
    [96, 8_240, 38.6, true, 2_084_00],
    [82, 8_712, 36.4, true, 1_966_00],
    [69, 9_178, 37.9, true, 2_047_00],
    // A top-up on a long trip — folded into the next full tank's window.
    [61, 9_460, 14.0, false, 756_00],
    [55, 9_690, 26.2, true, 1_415_00],
    [41, 10_155, 36.8, true, 1_987_00],
    [28, 10_640, 37.4, true, 2_020_00],
    [14, 11_098, 35.9, true, 1_939_00],
    [3, 11_570, 38.1, true, 2_057_00],
  ];

  for (const [days, odometer, litres, isFullTank, totalMinor] of carFills) {
    fuelEntryRepo.create({
      vehicleId: car.id,
      filledAt: daysAgo(days),
      odometer,
      litres,
      isFullTank,
      totalMinor,
      pricePerLitreMinor: Math.round(totalMinor / litres),
      station: 'Ceypetco',
    });
  }

  const bikeFills: [days: number, odo: number, litres: number, total: number][] = [
    [58, 18_240, 4.8, 259_00],
    [44, 18_452, 4.6, 248_00],
    [30, 18_669, 4.9, 264_00],
    [16, 18_881, 4.7, 253_00],
    [5, 19_098, 4.9, 264_00],
  ];

  for (const [days, odometer, litres, totalMinor] of bikeFills) {
    fuelEntryRepo.create({
      vehicleId: bike.id,
      filledAt: daysAgo(days),
      odometer,
      litres,
      isFullTank: true,
      totalMinor,
      pricePerLitreMinor: Math.round(totalMinor / litres),
      station: 'IOC',
    });
  }

  const fullService = vehicleServiceRepo.create({
    vehicleId: car.id,
    servicedAt: daysAgo(70),
    odometer: 9_000,
    kind: 'service',
    title: 'Full service + oil change',
    costMinor: 18_500_00,
    // Both measures set, exactly as a service book words it: whichever comes
    // first. The date has passed, so this reads overdue even though the
    // odometer has not reached 14,000 yet.
    nextDueOdometer: 14_000,
    nextDueDate: daysAgo(-25),
  });

  /*
   * The parts behind that total.
   *
   * Seeded so the itemised view has something to show — and deliberately NOT
   * summing to the invoice, because a real bill carries tax and labour rounding
   * that the lines never quite match.
   */
  const serviceItems: [name: string, qty: number, unit: number][] = [
    ['Engine oil 5W-30', 4, 2_650_00],
    ['Oil filter', 1, 2_400_00],
    ['Air filter', 1, 3_100_00],
    ['Labour', 1, 4_500_00],
  ];
  serviceItems.forEach(([name, quantity, unitPriceMinor], index) =>
    serviceItemRepo.create({
      serviceId: fullService.id,
      name,
      quantity,
      unitPriceMinor,
      kind: name === 'Labour' ? 'labour' : name.includes('oil') ? 'fluid' : 'part',
      sortOrder: index,
    }),
  );

  const tyres = vehicleServiceRepo.create({
    vehicleId: car.id,
    servicedAt: daysAgo(40),
    odometer: 10_200,
    kind: 'tyres',
    title: 'Front tyres replaced',
    costMinor: 42_000_00,
  });

  serviceItemRepo.create({
    serviceId: tyres.id,
    name: 'Tyre 195/60 R16',
    quantity: 2,
    unitPriceMinor: 19_500_00,
    kind: 'part',
    sortOrder: 0,
  });
  serviceItemRepo.create({
    serviceId: tyres.id,
    name: 'Fitting & balancing',
    quantity: 1,
    unitPriceMinor: 3_000_00,
    kind: 'labour',
    sortOrder: 1,
  });

  vehicleServiceRepo.create({
    vehicleId: bike.id,
    servicedAt: daysAgo(35),
    odometer: 18_600,
    kind: 'service',
    title: 'Oil change',
    costMinor: 3_200_00,
    nextDueOdometer: 20_600,
  });
}
