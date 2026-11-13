/**
 * The maintenance schedule: what to replace, inspect or check, and when.
 *
 * Reference data, not rows. The schedule is the same for every Aqua and
 * changes with research rather than with the user, so it lives here as code;
 * only the user's FACTS — "brake fluid done at 48,200 km", "this car has a
 * timing chain" — are stored (`maintenance_marks`).
 *
 * WHICH SCHEDULE. Intervals follow the manufacturers' "severe conditions"
 * column, not the normal one. Toyota, Honda and Suzuki all define severe as
 * heat, dust, short trips and stop-and-go traffic — which describes ordinary
 * driving in Sri Lanka, not an edge case. Sources: Toyota NZ petrol / hybrid
 * service requirements, Toyota Canada Corolla Hybrid guide, Honda / Yamaha /
 * Kawasaki / Suzuki 125cc owner schedules, Bajaj's RE 4S maintenance guide.
 * Every interval is a sensible default; the owner's book for a specific model
 * wins, which the UI says.
 *
 * "WHICHEVER COMES FIRST". Most items carry both a distance and a time, and a
 * car that sits in a garage still needs its brake fluid changed — fluid
 * absorbs moisture by the calendar, not by the kilometre.
 */

import type { FuelType, VehicleCondition, VehicleKind } from '~/db/schema';

export type MaintenanceAction = 'replace' | 'inspect' | 'service';

export type MaintenanceGroup = 'engine' | 'brakes' | 'tyres' | 'drivetrain' | 'electrical' | 'body';

export interface MaintenanceItem {
  key: string;
  title: string;
  action: MaintenanceAction;
  group: MaintenanceGroup;
  /** Distance between services, in the vehicle's own unit. */
  everyKm?: number;
  everyMonths?: number;
  /**
   * The FIRST interval on a new vehicle, when it differs.
   *
   * Break-in oil is changed early (the first free service at 1,000 km), and
   * long-life coolant gets a longer first run than later ones.
   */
  firstKm?: number;
  firstMonths?: number;
  /** One line on why it matters / what to ask for at the garage. */
  detail: string;
  /** Recognises this item in a service record's title or a bill line. */
  match?: RegExp;
  /** A hit on `match` that is really something else — "gear oil" is not engine oil. */
  notMatch?: RegExp;
  /** Mostly-optional items a user may well mark "does not apply". */
  oftenNotApplicable?: boolean;
  /** This model's exact spec, from its schedule override ("0W-20, 3.4 L"). */
  recommended?: string | null;
  /** A note for this model, from its override. */
  modelNote?: string | null;
  /** Changed for this vehicle — by the model lookup or by hand. */
  changedBy?: 'ai' | 'user' | null;
  /** Added for this vehicle; not in the catalogue. */
  custom?: boolean;
}

const ICE: readonly FuelType[] = ['petrol', 'diesel', 'hybrid'];

interface CatalogEntry extends MaintenanceItem {
  kinds: readonly VehicleKind[];
  fuels: readonly FuelType[];
}

const CARS: readonly VehicleKind[] = ['car', 'van', 'other'];
const BIKES: readonly VehicleKind[] = ['bike'];
const TUKS: readonly VehicleKind[] = ['three_wheeler'];
const ALL_FUELS: readonly FuelType[] = ['petrol', 'diesel', 'hybrid', 'electric'];

const OTHER_OILS = /\b(gear|transmission|gearbox|atf|cvt|brake|diff|differential|fork|2t|two.?stroke)\b/i;

/**
 * The catalogue.
 *
 * Ordered roughly by how often it comes round, which is also the order a
 * garage visit runs through them.
 */
const CATALOG: readonly CatalogEntry[] = [
  // ---------------------------------------------------------------- cars / vans
  {
    key: 'engine_oil',
    title: 'Engine oil change',
    action: 'replace',
    group: 'engine',
    everyKm: 5_000,
    everyMonths: 6,
    firstKm: 1_000,
    detail:
      'Severe-use interval — heat, dust and traffic thin the oil faster. Fully synthetic oil can stretch to 10,000 km if your manual allows it.',
    match: /\b(engine\s*oil|oil\s*change|oil\s*(&|and)\s*filter|motor\s*oil|[0-2]?\dw-?\d\d)\b/i,
    notMatch: OTHER_OILS,
    kinds: CARS,
    fuels: ICE,
  },
  {
    key: 'oil_filter',
    title: 'Oil filter',
    action: 'replace',
    group: 'engine',
    everyKm: 10_000,
    everyMonths: 12,
    firstKm: 1_000,
    detail: 'Many garages here change it every second oil change; changing it with every oil change is never wrong.',
    match: /\boil\s*(&|and\s*)?filter|\boil\s*(strainer|screen)\b/i,
    kinds: CARS,
    fuels: ICE,
  },
  {
    key: 'lights_check',
    title: 'Lights, horn & washers',
    action: 'inspect',
    group: 'electrical',
    everyKm: 10_000,
    everyMonths: 6,
    detail: 'Headlights, brake lights, indicators, horn and the washer jets.',
    match: /\b(bulb|head\s*light|lamp|horn|washer)\b/i,
    kinds: CARS,
    fuels: ALL_FUELS,
  },
  {
    key: 'tyre_rotation',
    title: 'Tyre rotation & pressure',
    action: 'service',
    group: 'tyres',
    everyKm: 10_000,
    detail: 'Swapping front and rear evens out wear so the set lasts longer.',
    match: /\b(tyre|tire)s?\s*(rotation|rotate|swap)|\brotat(e|ion)\b/i,
    kinds: CARS,
    fuels: ALL_FUELS,
  },
  {
    key: 'cabin_filter',
    title: 'A/C cabin filter',
    action: 'replace',
    group: 'body',
    everyKm: 10_000,
    everyMonths: 12,
    detail: 'A clogged filter weakens the A/C and fills the cabin with dust and smell.',
    match: /\b(cabin|a\/?c|ac|aircon|pollen)\s*filter\b/i,
    kinds: CARS,
    fuels: ALL_FUELS,
  },
  {
    key: 'brake_inspect',
    title: 'Brake pads, discs & shoes',
    action: 'inspect',
    group: 'brakes',
    everyKm: 10_000,
    everyMonths: 12,
    detail: 'Check pad thickness and disc wear. Stop-and-go traffic eats pads fastest.',
    match: /\bbrake\s*(pad|disc|disk|shoe|lining|check|inspect|service|clean)/i,
    kinds: CARS,
    fuels: ALL_FUELS,
  },
  {
    key: 'air_filter',
    title: 'Engine air filter',
    action: 'replace',
    group: 'engine',
    everyKm: 20_000,
    everyMonths: 24,
    detail: 'Clean it at every service on dusty roads; replace at this interval.',
    match: /\b(engine\s*)?air\s*(filter|cleaner|element)\b/i,
    notMatch: /\b(cabin|a\/?c|pollen)\b/i,
    kinds: CARS,
    fuels: ICE,
  },
  {
    key: 'wheel_alignment',
    title: 'Wheel alignment & balancing',
    action: 'inspect',
    group: 'tyres',
    everyKm: 20_000,
    everyMonths: 12,
    detail: 'Potholes knock it out. Uneven tyre wear or pulling to one side means it is overdue.',
    match: /\b(alignment|balancing|wheel\s*balance)\b/i,
    kinds: CARS,
    fuels: ALL_FUELS,
  },
  {
    key: 'suspension',
    title: 'Suspension, steering & CV boots',
    action: 'inspect',
    group: 'drivetrain',
    everyKm: 20_000,
    everyMonths: 12,
    detail: 'Shocks, bushes, ball joints, tie-rod ends and the rubber driveshaft boots.',
    match: /\b(suspension|shock|strut|bush|ball\s*joint|tie\s*rod|cv\s*boot|steering)\b/i,
    kinds: CARS,
    fuels: ALL_FUELS,
  },
  {
    key: 'hybrid_battery_filter',
    title: 'Hybrid battery cooling filter',
    action: 'service',
    group: 'electrical',
    everyKm: 20_000,
    everyMonths: 12,
    detail:
      'The intake behind the rear seat clogs with dust; a blocked one overheats the hybrid battery and shortens its life.',
    match: /\b(hybrid\s*battery|hv\s*battery|battery\s*(fan|cooling|intake))\b.*\b(filter|fan|clean)/i,
    kinds: CARS,
    fuels: ['hybrid'],
  },
  {
    key: 'diesel_fuel_filter',
    title: 'Diesel fuel filter',
    action: 'replace',
    group: 'engine',
    everyKm: 20_000,
    everyMonths: 24,
    detail: 'Drain the water separator at every service; replace the filter at this interval.',
    match: /\b(fuel|diesel)\s*filter\b/i,
    kinds: CARS,
    fuels: ['diesel'],
  },
  {
    key: 'radiator_hoses',
    title: 'Radiator & coolant hoses',
    action: 'inspect',
    group: 'engine',
    everyKm: 20_000,
    everyMonths: 12,
    detail: 'Look for cracks, soft or swollen hoses and leaks at the clamps.',
    match: /\b(radiator|coolant)\s*(hose|leak|check|clean)|\bhoses?\b/i,
    kinds: CARS,
    fuels: ICE,
  },
  {
    key: 'exhaust',
    title: 'Exhaust & underbody',
    action: 'inspect',
    group: 'body',
    everyKm: 20_000,
    everyMonths: 12,
    detail: 'Rusted or loose exhaust parts, and anything hanging after a hard speed bump.',
    match: /\b(exhaust|silencer|muffler|underbody|under\s*wash)\b/i,
    kinds: CARS,
    fuels: ICE,
  },
  {
    key: 'throttle_body',
    title: 'Throttle body clean',
    action: 'service',
    group: 'engine',
    everyKm: 40_000,
    everyMonths: 24,
    detail: 'Carbon builds up and makes the idle rough or unsteady.',
    match: /\b(throttle\s*(body)?\s*(clean|service)|tb\s*clean|injector\s*clean)/i,
    kinds: CARS,
    fuels: ['petrol', 'hybrid'],
  },
  {
    key: 'fuel_filter',
    title: 'Petrol fuel filter',
    action: 'replace',
    group: 'engine',
    everyKm: 40_000,
    everyMonths: 48,
    detail: 'Many modern cars have it inside the tank for life — if yours does, mark it as not applying.',
    match: /\b(petrol\s*|fuel\s*)filter\b/i,
    oftenNotApplicable: true,
    kinds: CARS,
    fuels: ['petrol'],
  },
  {
    key: 'power_steering_fluid',
    title: 'Power steering fluid',
    action: 'replace',
    group: 'drivetrain',
    everyKm: 40_000,
    everyMonths: 24,
    detail: 'Only for hydraulic power steering — most cars since about 2010 use electric steering and have none.',
    match: /\b(power\s*steering|ps)\s*(fluid|oil)\b/i,
    oftenNotApplicable: true,
    kinds: CARS,
    fuels: ICE,
  },
  {
    key: 'clutch_fluid',
    title: 'Clutch fluid',
    action: 'replace',
    group: 'drivetrain',
    everyKm: 40_000,
    everyMonths: 24,
    detail: 'Manual gearboxes with a hydraulic clutch only. Same fluid as the brakes on most cars.',
    match: /\bclutch\s*(fluid|oil|bleed)\b/i,
    oftenNotApplicable: true,
    kinds: CARS,
    fuels: ICE,
  },
  {
    key: 'differential_oil',
    title: 'Differential oil (4WD / rear-drive)',
    action: 'replace',
    group: 'drivetrain',
    everyKm: 40_000,
    everyMonths: 48,
    detail: 'Only 4WD, AWD and rear-wheel-drive vehicles have a separate differential to service.',
    match: /\b(diff(erential)?|transfer\s*case)\s*(oil|fluid)\b/i,
    oftenNotApplicable: true,
    kinds: CARS,
    fuels: ['petrol', 'diesel', 'hybrid'],
  },
  {
    key: 'brake_fluid',
    title: 'Brake fluid',
    action: 'replace',
    group: 'brakes',
    everyKm: 40_000,
    everyMonths: 24,
    detail: 'It absorbs moisture over time, which lowers its boiling point — change it by the calendar even on a low-mileage car.',
    match: /\bbrake\s*(fluid|oil|bleed)|\bdot\s*[345]\b/i,
    kinds: CARS,
    fuels: ALL_FUELS,
  },
  {
    key: 'drive_belt',
    title: 'Drive (fan / A/C) belt',
    action: 'inspect',
    group: 'engine',
    everyKm: 40_000,
    everyMonths: 24,
    detail: 'Look for cracks and squeal. A snapped belt stops the alternator and A/C.',
    match: /\b(drive|fan|v|serpentine|alternator|a\/?c|ribbed)\s*belt\b/i,
    kinds: CARS,
    fuels: ICE,
  },
  {
    key: 'transmission_fluid',
    title: 'Gearbox fluid (ATF / CVT / manual)',
    action: 'replace',
    group: 'drivetrain',
    everyKm: 60_000,
    everyMonths: 48,
    detail:
      'Many books say "lifetime" fluid, but severe use cooks it. A CVT especially needs the exact fluid it was built for.',
    match: /\b(atf|cvt\s*(fluid|oil)|transmission\s*(fluid|oil)|gear\s*(box)?\s*oil|gearbox\s*(fluid|oil)|transaxle)\b/i,
    kinds: CARS,
    fuels: ICE,
  },
  {
    key: 'coolant',
    title: 'Engine coolant',
    action: 'replace',
    group: 'engine',
    everyKm: 80_000,
    everyMonths: 60,
    firstKm: 160_000,
    firstMonths: 120,
    detail: 'Long-life coolant. Top up only with the same type — mixing colours can gel.',
    match: /\b(coolant|radiator\s*(fluid|flush|water)|llc|antifreeze)\b/i,
    notMatch: /\binverter\b/i,
    kinds: CARS,
    fuels: ICE,
  },
  {
    key: 'inverter_coolant',
    title: 'Inverter coolant',
    action: 'replace',
    group: 'electrical',
    everyKm: 80_000,
    everyMonths: 60,
    firstKm: 160_000,
    firstMonths: 120,
    detail: 'A separate loop that cools the hybrid inverter. Intervals vary by model — check your book.',
    match: /\binverter\s*coolant\b/i,
    kinds: CARS,
    fuels: ['hybrid'],
  },
  {
    key: 'spark_plugs',
    title: 'Spark plugs',
    action: 'replace',
    group: 'engine',
    everyKm: 100_000,
    detail: 'Iridium plugs last this long. Older copper / nickel plugs need changing every 20,000 km.',
    match: /\bspark\s*plugs?\b/i,
    kinds: CARS,
    fuels: ['petrol', 'hybrid'],
  },
  {
    key: 'timing_belt',
    title: 'Timing belt',
    action: 'replace',
    group: 'engine',
    everyKm: 100_000,
    everyMonths: 84,
    detail:
      'Only if your engine has a BELT — many have a chain that needs no change. A snapped belt can wreck the engine.',
    match: /\btiming\s*belt\b/i,
    oftenNotApplicable: true,
    kinds: CARS,
    fuels: ['petrol', 'diesel'],
  },
  {
    key: 'tyres',
    title: 'Tyres',
    action: 'replace',
    group: 'tyres',
    everyKm: 50_000,
    everyMonths: 72,
    detail: 'Sooner if tread is under 1.6 mm. Rubber hardens with age, so replace six-year-old tyres even with tread left.',
    match: /\b(new|replace|replaced|change|changed)?\s*(tyres?|tires?)\b/i,
    notMatch: /\b(rotation|rotate|pressure|puncture|repair|alignment|balanc)/i,
    kinds: CARS,
    fuels: ALL_FUELS,
  },
  {
    key: 'battery_12v',
    title: '12V battery',
    action: 'replace',
    group: 'electrical',
    everyMonths: 36,
    detail: 'Heat kills batteries — two to three years is typical here. Have it load-tested at each service.',
    match: /\b(12\s*v\s*)?battery\b/i,
    notMatch: /\b(hybrid|hv|traction|cooling|fan|check|test|charg\w*|terminal)\b/i,
    kinds: CARS,
    fuels: ALL_FUELS,
  },
  {
    key: 'ac_service',
    title: 'A/C gas & condenser',
    action: 'inspect',
    group: 'body',
    everyMonths: 24,
    detail: 'Weak cooling usually means low gas or a dirty condenser.',
    match: /\b(a\/?c|aircon)\s*(gas|service|regas|recharge|condenser)|\bcondenser\b/i,
    kinds: CARS,
    fuels: ALL_FUELS,
  },
  {
    key: 'wipers',
    title: 'Wiper blades',
    action: 'replace',
    group: 'body',
    everyMonths: 12,
    detail: 'Sun cracks the rubber long before the monsoon shows it.',
    match: /\bwiper/i,
    kinds: CARS,
    fuels: ALL_FUELS,
  },

  // ---------------------------------------------------------------- motorbikes
  {
    key: 'bike_chain',
    title: 'Chain clean, lube & adjust',
    action: 'service',
    group: 'drivetrain',
    everyKm: 1_000,
    everyMonths: 1,
    detail: 'And after every ride in the rain. A dry chain wears the sprockets with it.',
    match: /\bchain\s*(lube|clean|adjust|service|tension|spray)/i,
    kinds: BIKES,
    fuels: ['petrol'],
  },
  {
    key: 'engine_oil',
    title: 'Engine oil change',
    action: 'replace',
    group: 'engine',
    everyKm: 2_000,
    everyMonths: 6,
    firstKm: 500,
    detail: 'Small engines rev hard and run hot — change mineral oil at 2,000 km.',
    match: /\b(engine\s*oil|oil\s*change|oil\s*(&|and)\s*filter|motor\s*oil|[0-2]?\dw-?\d\d)\b/i,
    notMatch: OTHER_OILS,
    kinds: BIKES,
    fuels: ['petrol'],
  },
  {
    key: 'oil_filter',
    title: 'Oil filter / strainer',
    action: 'replace',
    group: 'engine',
    everyKm: 6_000,
    everyMonths: 12,
    detail: 'Replace a paper filter, or clean the mesh strainer, at every second or third oil change.',
    match: /\boil\s*(&|and\s*)?filter|\boil\s*(strainer|screen)\b/i,
    kinds: BIKES,
    fuels: ['petrol'],
  },
  {
    key: 'lights_check',
    title: 'Lights & horn',
    action: 'inspect',
    group: 'electrical',
    everyKm: 3_000,
    everyMonths: 3,
    detail: 'Headlight, brake light, indicators and horn — a bike needs to be seen.',
    match: /\b(bulb|head\s*light|lamp|horn|indicator)\b/i,
    kinds: BIKES,
    fuels: ['petrol', 'electric'],
  },
  {
    key: 'bike_brakes',
    title: 'Brake pads / shoes & cables',
    action: 'inspect',
    group: 'brakes',
    everyKm: 3_000,
    everyMonths: 6,
    detail: 'Check pad and shoe wear and adjust drum brake free play.',
    match: /\bbrake\s*(pad|shoe|lining|check|adjust|cable|service)/i,
    kinds: BIKES,
    fuels: ['petrol', 'electric'],
  },
  {
    key: 'bike_cables',
    title: 'Clutch & throttle cables',
    action: 'service',
    group: 'drivetrain',
    everyKm: 6_000,
    everyMonths: 12,
    detail: 'Lubricate and set the free play — a sticky throttle is dangerous.',
    match: /\b(clutch|throttle|accelerator)\s*(cable|adjust|free\s*play)/i,
    kinds: BIKES,
    fuels: ['petrol'],
  },
  {
    key: 'spark_plugs',
    title: 'Spark plug',
    action: 'replace',
    group: 'engine',
    everyKm: 8_000,
    detail: 'Hard starting and poor mileage are the first signs it is worn.',
    match: /\bspark\s*plugs?\b/i,
    kinds: BIKES,
    fuels: ['petrol'],
  },
  {
    key: 'air_filter',
    title: 'Air filter',
    action: 'replace',
    group: 'engine',
    everyKm: 12_000,
    everyMonths: 12,
    detail: 'Clean it every 3,000 km on dusty roads.',
    match: /\bair\s*(filter|cleaner|element)\b/i,
    kinds: BIKES,
    fuels: ['petrol'],
  },
  {
    key: 'valve_clearance',
    title: 'Valve clearance',
    action: 'inspect',
    group: 'engine',
    everyKm: 12_000,
    detail: 'Tappet noise or rough idle means it needs setting.',
    match: /\b(valve|tappet)\s*(clearance|adjust|setting)?/i,
    kinds: BIKES,
    fuels: ['petrol'],
  },
  {
    key: 'tyres',
    title: 'Tyres',
    action: 'replace',
    group: 'tyres',
    everyKm: 15_000,
    everyMonths: 60,
    detail: 'Rear wears about twice as fast as the front. Check pressure weekly.',
    match: /\b(new|replace|replaced|change|changed)?\s*(tyres?|tires?)\b/i,
    notMatch: /\b(pressure|puncture|repair|tube)/i,
    kinds: BIKES,
    fuels: ['petrol', 'electric'],
  },
  {
    key: 'fork_oil',
    title: 'Front fork oil',
    action: 'replace',
    group: 'drivetrain',
    everyKm: 20_000,
    everyMonths: 24,
    detail: 'Old fork oil makes the front bouncy and leaks past the seals.',
    match: /\bfork\s*(oil|seal|service)\b/i,
    kinds: BIKES,
    fuels: ['petrol', 'electric'],
  },
  {
    key: 'scooter_belt',
    title: 'Scooter drive belt & rollers',
    action: 'replace',
    group: 'drivetrain',
    everyKm: 20_000,
    detail: 'Scooters only (Dio, Pleasure, Ray, NTorq…) — geared bikes have a chain instead.',
    match: /\b(drive|v|cvt)\s*belt|\broller/i,
    oftenNotApplicable: true,
    kinds: BIKES,
    fuels: ['petrol'],
  },
  {
    key: 'bike_chain_kit',
    title: 'Chain & sprocket kit',
    action: 'replace',
    group: 'drivetrain',
    everyKm: 20_000,
    detail: 'Always replace the chain and both sprockets together.',
    match: /\b(sprocket|chain\s*(kit|set|replace|change)|new\s*chain)\b/i,
    kinds: BIKES,
    fuels: ['petrol'],
  },
  {
    key: 'brake_fluid',
    title: 'Brake fluid (disc brakes)',
    action: 'replace',
    group: 'brakes',
    everyMonths: 24,
    detail: 'Only for hydraulic disc brakes — drum brakes have none.',
    match: /\bbrake\s*(fluid|oil|bleed)|\bdot\s*[345]\b/i,
    oftenNotApplicable: true,
    kinds: BIKES,
    fuels: ['petrol', 'electric'],
  },
  {
    key: 'battery_12v',
    title: 'Battery',
    action: 'replace',
    group: 'electrical',
    everyMonths: 24,
    detail: 'Small bike batteries rarely last past two years in the heat.',
    match: /\bbattery\b/i,
    notMatch: /\b(check|test|charg\w*|terminal)\b/i,
    kinds: BIKES,
    fuels: ['petrol'],
  },

  // ---------------------------------------------------------------- three-wheelers
  {
    key: 'engine_oil',
    title: 'Engine oil change',
    action: 'replace',
    group: 'engine',
    everyKm: 2_500,
    everyMonths: 4,
    firstKm: 1_000,
    detail: 'Bajaj recommends 2,000–3,000 km by use.',
    match: /\b(engine\s*oil|oil\s*change|oil\s*(&|and)\s*filter|motor\s*oil|[0-2]?\dw-?\d\d)\b/i,
    notMatch: OTHER_OILS,
    kinds: TUKS,
    fuels: ['petrol', 'diesel'],
  },
  {
    key: 'oil_filter',
    title: 'Oil filter',
    action: 'replace',
    group: 'engine',
    everyKm: 5_000,
    everyMonths: 8,
    detail: 'Change it at least every second oil change.',
    match: /\boil\s*(&|and\s*)?filter|\boil\s*(strainer|screen)\b/i,
    kinds: TUKS,
    fuels: ['petrol', 'diesel'],
  },
  {
    key: 'lights_check',
    title: 'Lights, horn & indicators',
    action: 'inspect',
    group: 'electrical',
    everyKm: 3_000,
    everyMonths: 3,
    detail: 'Headlight, brake light, indicators and horn.',
    match: /\b(bulb|head\s*light|lamp|horn|indicator)\b/i,
    kinds: TUKS,
    fuels: ['petrol', 'diesel', 'electric'],
  },
  {
    key: 'tuk_cables',
    title: 'Clutch, brake & throttle adjustment',
    action: 'service',
    group: 'drivetrain',
    everyKm: 3_000,
    everyMonths: 6,
    detail: 'Set free play on all three cables and grease the pivots.',
    match: /\b(clutch|throttle|cable)\s*(adjust|free\s*play|setting)?/i,
    kinds: TUKS,
    fuels: ['petrol', 'diesel', 'electric'],
  },
  {
    key: 'brake_inspect',
    title: 'Brake shoes',
    action: 'inspect',
    group: 'brakes',
    everyKm: 5_000,
    everyMonths: 6,
    detail: 'Drum brakes on a loaded three-wheeler wear quickly in traffic.',
    match: /\bbrake\s*(shoe|lining|pad|check|adjust|service)/i,
    kinds: TUKS,
    fuels: ['petrol', 'diesel', 'electric'],
  },
  {
    key: 'tyre_rotation',
    title: 'Tyre rotation & pressure',
    action: 'service',
    group: 'tyres',
    everyKm: 5_000,
    detail: 'Rotate across all three wheels and the spare.',
    match: /\b(tyre|tire)s?\s*(rotation|rotate|swap)|\brotat(e|ion)\b/i,
    kinds: TUKS,
    fuels: ['petrol', 'diesel', 'electric'],
  },
  {
    key: 'carburettor',
    title: 'Carburettor clean & tune',
    action: 'service',
    group: 'engine',
    everyKm: 6_000,
    detail: 'Fuel-injected and CNG models: have the injectors and idle checked instead.',
    match: /\b(carb|carburet+or|carburet+er|tune\s*up|tuning)\b/i,
    kinds: TUKS,
    fuels: ['petrol'],
  },
  {
    key: 'spark_plugs',
    title: 'Spark plug',
    action: 'replace',
    group: 'engine',
    everyKm: 10_000,
    detail: 'Clean and gap it at each service; replace at this interval.',
    match: /\bspark\s*plugs?\b/i,
    kinds: TUKS,
    fuels: ['petrol'],
  },
  {
    key: 'air_filter',
    title: 'Air filter',
    action: 'replace',
    group: 'engine',
    everyKm: 12_000,
    everyMonths: 12,
    detail: 'Clean every 3,000 km — an open three-wheeler swallows road dust.',
    match: /\bair\s*(filter|cleaner|element)\b/i,
    kinds: TUKS,
    fuels: ['petrol', 'diesel'],
  },
  {
    key: 'valve_clearance',
    title: 'Valve clearance',
    action: 'inspect',
    group: 'engine',
    everyKm: 10_000,
    detail: 'Set tappets at this interval on four-stroke engines.',
    match: /\b(valve|tappet)\s*(clearance|adjust|setting)?/i,
    kinds: TUKS,
    fuels: ['petrol', 'diesel'],
  },
  {
    key: 'transmission_fluid',
    title: 'Gearbox oil',
    action: 'replace',
    group: 'drivetrain',
    everyKm: 12_000,
    everyMonths: 12,
    detail: 'The gearbox and differential share one oil on most three-wheelers.',
    match: /\b(gear\s*(box)?\s*oil|transmission\s*oil|diff(erential)?\s*oil)\b/i,
    kinds: TUKS,
    fuels: ['petrol', 'diesel', 'electric'],
  },
  {
    key: 'tyres',
    title: 'Tyres',
    action: 'replace',
    group: 'tyres',
    everyKm: 30_000,
    everyMonths: 60,
    detail: 'Sooner if the tread is worn flat or the sidewalls crack.',
    match: /\b(new|replace|replaced|change|changed)?\s*(tyres?|tires?)\b/i,
    notMatch: /\b(rotation|rotate|pressure|puncture|repair|tube)/i,
    kinds: TUKS,
    fuels: ['petrol', 'diesel', 'electric'],
  },
  {
    key: 'brake_fluid',
    title: 'Brake fluid',
    action: 'replace',
    group: 'brakes',
    everyMonths: 24,
    detail: 'Hydraulic brakes only.',
    match: /\bbrake\s*(fluid|oil|bleed)|\bdot\s*[345]\b/i,
    oftenNotApplicable: true,
    kinds: TUKS,
    fuels: ['petrol', 'diesel', 'electric'],
  },
  {
    key: 'battery_12v',
    title: 'Battery',
    action: 'replace',
    group: 'electrical',
    everyMonths: 24,
    detail: 'Check the terminals for corrosion at each service.',
    match: /\bbattery\b/i,
    notMatch: /\b(traction|lithium|ev|check|test|charg\w*|terminal)\b/i,
    kinds: TUKS,
    fuels: ['petrol', 'diesel'],
  },
];

/** The schedule for one vehicle, in catalogue order. */
export function scheduleFor(kind: VehicleKind, fuel: FuelType): MaintenanceItem[] {
  return CATALOG.filter((entry) => entry.kinds.includes(kind) && entry.fuels.includes(fuel)).map(
    ({ kinds: _kinds, fuels: _fuels, ...item }) => item,
  );
}

/** One vehicle's change to the schedule — see `maintenance_overrides`. */
export interface ScheduleOverrideInput {
  itemKey: string;
  title?: string | null;
  group?: string | null;
  action?: string | null;
  everyKm?: number | null;
  everyMonths?: number | null;
  applies: boolean;
  recommended?: string | null;
  detail?: string | null;
  source: 'ai' | 'user';
}

const GROUPS: readonly MaintenanceGroup[] = ['engine', 'brakes', 'tyres', 'drivetrain', 'electrical', 'body'];
const ACTIONS: readonly MaintenanceAction[] = ['replace', 'inspect', 'service'];
export const CUSTOM_PREFIX = 'custom:';

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The schedule for ONE vehicle: the catalogue for its kind and fuel, with its
 * own overrides applied and its custom items added. `turnedOff` lists the
 * items its model does not have (a timing chain, electric steering).
 */
export function vehicleSchedule(
  kind: VehicleKind,
  fuel: FuelType,
  overrides: readonly ScheduleOverrideInput[] = [],
  /** The vehicle's service interval: the engine oil follows it. */
  service: { km?: number | null; months?: number | null } = {},
): { items: MaintenanceItem[]; turnedOff: Set<string> } {
  const byKey = new Map(overrides.map((o) => [o.itemKey, o]));
  const turnedOff = new Set<string>();

  const items = scheduleFor(kind, fuel).map((base) => {
    // "Serviced every 10,000 km" means an oil change every 10,000 km — unless
    // the oil has its own interval set, which is more specific.
    const item =
      base.key === 'engine_oil' && (service.km || service.months)
        ? {
            ...base,
            everyKm: service.km ?? base.everyKm,
            everyMonths: service.months ?? base.everyMonths,
            firstKm: base.firstKm != null && service.km != null && base.firstKm < service.km ? base.firstKm : undefined,
          }
        : base;
    const o = byKey.get(item.key);
    if (!o) return item;
    if (!o.applies) turnedOff.add(item.key);
    const everyKm = o.everyKm ?? item.everyKm;
    const everyMonths = o.everyMonths ?? item.everyMonths;
    return {
      ...item,
      everyKm,
      everyMonths,
      // A longer manual interval keeps the early first service only where it is still earlier.
      firstKm: item.firstKm != null && everyKm != null && item.firstKm < everyKm ? item.firstKm : undefined,
      firstMonths:
        item.firstMonths != null && everyMonths != null && item.firstMonths > everyMonths ? item.firstMonths : undefined,
      recommended: o.recommended ?? null,
      modelNote: o.detail ?? null,
      changedBy: o.source,
    };
  });

  for (const o of overrides) {
    if (!o.itemKey.startsWith(CUSTOM_PREFIX) || !o.title?.trim()) continue;
    if (o.everyKm == null && o.everyMonths == null) continue;
    if (!o.applies) turnedOff.add(o.itemKey);
    items.push({
      key: o.itemKey,
      title: o.title.trim(),
      action: ACTIONS.includes(o.action as MaintenanceAction) ? (o.action as MaintenanceAction) : 'inspect',
      group: GROUPS.includes(o.group as MaintenanceGroup) ? (o.group as MaintenanceGroup) : 'body',
      everyKm: o.everyKm ?? undefined,
      everyMonths: o.everyMonths ?? undefined,
      detail: o.detail ?? '',
      match: new RegExp(`\\b${escapeRe(o.title.trim())}\\b`, 'i'),
      recommended: o.recommended ?? null,
      changedBy: o.source,
      custom: true,
    });
  }
  return { items, turnedOff };
}

/** Every item key the catalogue knows — validates stored marks in tests. */
export const ALL_ITEM_KEYS: ReadonlySet<string> = new Set(CATALOG.map((entry) => entry.key));

/* ------------------------------------------------------------------ status */

export interface MaintenanceMarkInput {
  itemKey: string;
  action: 'done' | 'not_applicable';
  doneAt: Date;
  odometer?: number | null;
  brand?: string | null;
  spec?: string | null;
}

/** A past service visit, reduced to what matching needs. */
export interface ServiceHistoryInput {
  servicedAt: Date;
  odometer?: number | null;
  title: string;
  /** Names of the parts / labour lines on the bill. */
  itemNames: readonly string[];
  /**
   * Set once the user has confirmed what this visit covered. Its marks then
   * speak for it, and the name matching (which the user may have corrected)
   * is skipped. Null / absent on older records: matched by name.
   */
  confirmed?: boolean;
}

export interface MaintenanceVehicle {
  kind: VehicleKind;
  fuelType: FuelType;
  condition?: VehicleCondition | null;
  acquiredOdometer?: number | null;
  acquiredAt?: Date | null;
  createdAt: Date;
  /** The vehicle's own service interval — see `vehicles.serviceIntervalKm`. */
  serviceIntervalKm?: number | null;
  serviceIntervalMonths?: number | null;
}

export type MaintenanceStatus = 'overdue' | 'soon' | 'ok' | 'unknown' | 'not_applicable';

export interface LastDone {
  date: Date;
  odometer: number | null;
  source: 'mark' | 'service' | 'purchase' | 'factory';
  /** What was fitted, when the user noted it on a mark. */
  brand?: string | null;
  spec?: string | null;
  /** The bill line that matched, for a service record ("Mobil 5W-30 x4"). */
  partName?: string | null;
}

export interface MaintenanceItemStatus {
  item: MaintenanceItem;
  status: MaintenanceStatus;
  /** When it was last done — or the baseline it is counted from. Null when unknown. */
  lastDone: LastDone | null;
  dueOdometer: number | null;
  dueDate: Date | null;
  /** Distance still to run. Negative once overdue. */
  remainingKm: number | null;
  /** Days until the date limit. Negative once overdue. */
  remainingDays: number | null;
  /**
   * When it will PROBABLY fall due, from the distance limit at the usual daily
   * distance, or the date limit — whichever is sooner. What a reminder is
   * scheduled for.
   */
  expectedDate: Date | null;
}

export interface MaintenancePlan {
  items: MaintenanceItemStatus[];
  currentOdometer: number | null;
  /** Average distance per day, from the fill-up log. Null until it is measurable. */
  dailyDistance: number | null;
  /** The same, with what it rests on — for "about 1,600 km a month since March". */
  rate: DrivingRate | null;
  counts: Record<MaintenanceStatus, number>;
}

const DAY_MS = 86_400_000;

function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime());
  const day = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const daysInMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, daysInMonth));
  return next;
}

/** True when a service record names this item in its title or on a bill line. */
export function serviceCovers(item: MaintenanceItem, service: ServiceHistoryInput): boolean {
  return [service.title, ...service.itemNames].some((text) => matches(item, text));
}

function matches(item: MaintenanceItem, text: string): boolean {
  return !!item.match && item.match.test(text) && !(item.notMatch?.test(text) ?? false);
}

export interface DrivingRate {
  /** Average distance a day. */
  perDay: number;
  /** The first reading the average is taken from. */
  since: Date;
  /** How many days of readings it rests on. */
  days: number;
}

/**
 * How far the vehicle usually goes in a day, from the odometer readings.
 *
 * Needs a span of at least two weeks: two fill-ups three days apart say more
 * about one road trip than about how the vehicle is normally used, and every
 * projected date is built on this number. Uses the last year when that alone
 * spans a month or more, so a change of job or a move shows up within months
 * rather than being averaged away by years of old readings.
 */
export function drivingRate(readings: readonly { at: Date; odometer: number }[]): DrivingRate | null {
  const clean = trustworthyReadings(readings);
  if (clean.length < 2) return null;
  const last = clean[clean.length - 1];
  const yearAgo = last.at.getTime() - 365 * DAY_MS;
  const recent = clean.filter((r) => r.at.getTime() >= yearAgo);
  const use =
    recent.length >= 2 && (last.at.getTime() - recent[0].at.getTime()) / DAY_MS >= 30 ? recent : clean;
  const first = use[0];
  const days = (last.at.getTime() - first.at.getTime()) / DAY_MS;
  const distance = last.odometer - first.odometer;
  if (days < 14 || distance <= 0) return null;
  return { perDay: distance / days, since: first.at, days };
}

/**
 * The readings whose DATES can be believed, oldest first.
 *
 * Two ways a date lies, both seen on a real phone:
 *   - Backfilling. Three old fill-ups typed in one sitting all carry that
 *     evening's time, and read as 500 km driven in seven minutes. Readings
 *     within six hours of each other are one moment: only the highest is kept.
 *   - A reading dated after a HIGHER one — "bought at 28 km" stamped with the
 *     day the car was added to the app, a month after a 1,499 km oil change.
 *     An odometer never goes down, so the misdated one is dropped.
 */
export function trustworthyReadings(
  readings: readonly { at: Date; odometer: number }[],
): { at: Date; odometer: number }[] {
  const sorted = [...readings]
    .filter((r) => Number.isFinite(r.odometer) && r.odometer >= 0)
    .sort((a, b) => a.at.getTime() - b.at.getTime() || a.odometer - b.odometer);

  const merged: { at: Date; odometer: number }[] = [];
  for (const r of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && r.at.getTime() - prev.at.getTime() < 6 * 3_600_000) {
      if (r.odometer >= prev.odometer) merged[merged.length - 1] = r;
      continue;
    }
    merged.push(r);
  }

  // Keep the longest run where the odometer only goes up: a reading lower than
  // an earlier one is the one with the wrong date.
  const n = merged.length;
  const best = new Array<number>(n).fill(1);
  const from = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (merged[j].odometer <= merged[i].odometer && best[j] + 1 > best[i]) {
        best[i] = best[j] + 1;
        from[i] = j;
      }
    }
  }
  let end = 0;
  for (let i = 1; i < n; i += 1) if (best[i] >= best[end]) end = i;
  const chain: { at: Date; odometer: number }[] = [];
  for (let i = n > 0 ? end : -1; i >= 0; i = from[i]) chain.unshift(merged[i]);
  return chain;
}

/** Average distance a day — see `drivingRate`. */
export function dailyDistance(readings: readonly { at: Date; odometer: number }[]): number | null {
  return drivingRate(readings)?.perDay ?? null;
}

/** How close counts as "due soon": a tenth of the interval, kept between 100 and 1,000. */
function soonKm(intervalKm: number): number {
  return Math.max(100, Math.min(1_000, intervalKm * 0.1));
}

function soonDays(intervalMonths: number): number {
  return intervalMonths <= 2 ? 7 : intervalMonths <= 6 ? 14 : 30;
}

function latestDone(
  item: MaintenanceItem,
  marks: readonly MaintenanceMarkInput[],
  services: readonly ServiceHistoryInput[],
): LastDone | null {
  const candidates: LastDone[] = [];
  for (const mark of marks) {
    if (mark.itemKey === item.key && mark.action === 'done') {
      candidates.push({
        date: mark.doneAt,
        odometer: mark.odometer ?? null,
        source: 'mark',
        brand: mark.brand ?? null,
        spec: mark.spec ?? null,
      });
    }
  }
  for (const service of services) {
    if (service.confirmed) continue;
    if (serviceCovers(item, service)) {
      candidates.push({
        date: service.servicedAt,
        odometer: service.odometer ?? null,
        source: 'service',
        partName: service.itemNames.find((name) => matches(item, name)) ?? null,
      });
    }
  }
  if (candidates.length === 0) return null;

  // Highest odometer wins where both have one — a late-typed receipt has a
  // truthful reading and a misleading date. Otherwise the latest date.
  return candidates.sort((a, b) => {
    if (a.odometer != null && b.odometer != null && a.odometer !== b.odometer) {
      return b.odometer - a.odometer;
    }
    return b.date.getTime() - a.date.getTime();
  })[0];
}

/**
 * Where an item with no record of being done is counted from.
 *
 *   - NEW: from delivery. Nothing has been done, and the first interval runs
 *     from the odometer it was handed over at.
 *   - USED, below the first interval: assume the original part, counted from
 *     zero on the odometer. A two-year-old car at 18,000 km has not had its
 *     spark plugs changed. Distance only — its age is unknown, so a time limit
 *     cannot be applied honestly.
 *   - USED otherwise: unknown. Pretending the timing belt was changed at
 *     purchase would hide exactly the work a second-hand buyer most needs.
 */
function baselineFor(
  item: MaintenanceItem,
  vehicle: MaintenanceVehicle,
  currentOdometer: number | null,
): LastDone | null {
  if (vehicle.condition === 'new') {
    return {
      date: vehicle.acquiredAt ?? vehicle.createdAt,
      odometer: vehicle.acquiredOdometer ?? 0,
      source: 'purchase',
    };
  }

  const interval = item.firstKm ?? item.everyKm;
  if (interval != null && currentOdometer != null && currentOdometer < interval) {
    // Only when there is no time limit to break: a 3-year-old car at 4,000 km
    // still has three-year-old brake fluid.
    if (item.everyMonths == null) {
      return { date: vehicle.acquiredAt ?? vehicle.createdAt, odometer: 0, source: 'factory' };
    }
  }
  return null;
}

/**
 * The status of every item on a vehicle's schedule.
 *
 * Sorted most urgent first: overdue, then due soon, then by how soon it is
 * expected; unknown and not-applicable items after.
 */
export function maintenancePlan(input: {
  vehicle: MaintenanceVehicle;
  marks: readonly MaintenanceMarkInput[];
  services: readonly ServiceHistoryInput[];
  readings: readonly { at: Date; odometer: number }[];
  /** This vehicle's own schedule changes. */
  overrides?: readonly ScheduleOverrideInput[];
  today?: Date;
}): MaintenancePlan {
  const today = input.today ?? new Date();
  const { vehicle, marks, services, readings } = input;

  // Every odometer the app has seen — a service or a mark can be newer than
  // the last fill-up.
  const allReadings = [
    ...readings,
    ...services.flatMap((s) => (s.odometer != null ? [{ at: s.servicedAt, odometer: s.odometer }] : [])),
    ...marks.flatMap((m) => (m.odometer != null ? [{ at: m.doneAt, odometer: m.odometer }] : [])),
  ];
  const currentOdometer =
    allReadings.length > 0 ? Math.max(...allReadings.map((r) => r.odometer)) : null;
  // Every reading off the dash: fill-ups, garage visits, things marked done,
  // and the odometer the vehicle was got at. Misdated ones are filtered out
  // inside (see `trustworthyReadings`).
  const rate = drivingRate([
    ...allReadings,
    ...(vehicle.acquiredOdometer != null
      ? [{ at: vehicle.acquiredAt ?? vehicle.createdAt, odometer: vehicle.acquiredOdometer }]
      : []),
  ]);
  const perDay = rate?.perDay ?? null;

  const schedule = vehicleSchedule(vehicle.kind, vehicle.fuelType, input.overrides, {
    km: vehicle.serviceIntervalKm,
    months: vehicle.serviceIntervalMonths,
  });
  const notApplicable = new Set([
    ...marks.filter((m) => m.action === 'not_applicable').map((m) => m.itemKey),
    ...schedule.turnedOff,
  ]);

  const items = schedule.items.map<MaintenanceItemStatus>((item) => {
    const empty = {
      item,
      lastDone: null,
      dueOdometer: null,
      dueDate: null,
      remainingKm: null,
      remainingDays: null,
      expectedDate: null,
    };
    if (notApplicable.has(item.key)) return { ...empty, status: 'not_applicable' };

    const done = latestDone(item, marks, services);
    const base = done ?? baselineFor(item, vehicle, currentOdometer);
    if (!base) return { ...empty, status: 'unknown' };

    // The first interval applies only when counting from delivery or the factory.
    const isFirst = base.source === 'purchase' || base.source === 'factory';
    const km = isFirst ? (item.firstKm ?? item.everyKm) : item.everyKm;
    const months =
      base.source === 'factory' ? undefined : isFirst ? (item.firstMonths ?? item.everyMonths) : item.everyMonths;

    const dueOdometer = km != null && base.odometer != null ? base.odometer + km : null;
    const dueDate = months != null ? addMonths(base.date, months) : null;
    const remainingKm =
      dueOdometer != null && currentOdometer != null ? dueOdometer - currentOdometer : null;
    const remainingDays =
      dueDate != null ? Math.ceil((dueDate.getTime() - today.getTime()) / DAY_MS) : null;

    // A distance limit with no known odometer (a mark saved without a reading)
    // and no time limit cannot be judged at all.
    if (remainingKm === null && remainingDays === null) return { ...empty, lastDone: base, status: 'unknown' };

    const byDistance =
      remainingKm != null && perDay != null
        ? new Date(today.getTime() + Math.max(0, remainingKm / perDay) * DAY_MS)
        : null;
    const expected = [byDistance, dueDate]
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

    let status: MaintenanceStatus = 'ok';
    if ((remainingKm != null && remainingKm <= 0) || (remainingDays != null && remainingDays <= 0)) {
      status = 'overdue';
    } else if (
      (remainingKm != null && km != null && remainingKm <= soonKm(km)) ||
      (remainingDays != null && months != null && remainingDays <= soonDays(months))
    ) {
      status = 'soon';
    }

    return {
      item,
      status,
      lastDone: base,
      dueOdometer,
      dueDate,
      remainingKm,
      remainingDays,
      expectedDate: expected,
    };
  });

  const rank: Record<MaintenanceStatus, number> = {
    overdue: 0,
    soon: 1,
    ok: 2,
    unknown: 3,
    not_applicable: 4,
  };
  items.sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    if (a.status === 'overdue' || a.status === 'soon' || a.status === 'ok') {
      const ad = a.expectedDate?.getTime() ?? urgencyFallback(a);
      const bd = b.expectedDate?.getTime() ?? urgencyFallback(b);
      return ad - bd;
    }
    return 0;
  });

  const counts: Record<MaintenanceStatus, number> = {
    overdue: 0,
    soon: 0,
    ok: 0,
    unknown: 0,
    not_applicable: 0,
  };
  for (const entry of items) counts[entry.status] += 1;

  return { items, currentOdometer, dailyDistance: perDay, rate, counts };
}

/** Without a projected date, order by remaining distance as a proxy. */
function urgencyFallback(entry: MaintenanceItemStatus): number {
  return Number.MAX_SAFE_INTEGER / 2 + (entry.remainingKm ?? Number.MAX_SAFE_INTEGER / 4);
}

/**
 * Items that became due (soon or overdue) between two plans.
 *
 * What a notification fires for, right after a fill-up moves the odometer —
 * the transition, not the state. An item that was already overdue yesterday
 * was already announced; telling the user again on every fill-up trains them
 * to ignore the notification.
 */
export function newlyDue(before: MaintenancePlan, after: MaintenancePlan): MaintenanceItemStatus[] {
  const previous = new Map(before.items.map((entry) => [entry.item.key, entry.status]));
  const severity = (s: MaintenanceStatus | undefined) => (s === 'overdue' ? 2 : s === 'soon' ? 1 : 0);
  return after.items.filter(
    (entry) => severity(entry.status) > severity(previous.get(entry.item.key)),
  );
}

/** "in 1,200 km · or by 4 Mar" / "800 km overdue" — the row's subtitle. */
export function describeDue(entry: MaintenanceItemStatus, unit: string): string {
  const parts: string[] = [];
  const fmtDate = (d: Date) =>
    d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  if (entry.status === 'not_applicable') return 'Marked as not applying to this vehicle';
  if (entry.status === 'unknown') {
    return entry.lastDone
      ? 'Last done date known, no odometer — add a reading'
      : 'No record yet — get it checked, then mark it done';
  }

  if (entry.remainingKm != null) {
    const km = Math.round(Math.abs(entry.remainingKm)).toLocaleString();
    parts.push(entry.remainingKm <= 0 ? `${km} ${unit} overdue` : `Due in ${km} ${unit}`);
    // The reading itself — what to watch for on the dash.
    if (entry.remainingKm > 0 && entry.dueOdometer != null) {
      parts.push(`at ${Math.round(entry.dueOdometer).toLocaleString()}`);
    }
  }
  const overdueByKm = entry.remainingKm != null && entry.remainingKm <= 0;
  if (entry.remainingDays != null && entry.dueDate) {
    // Once one limit has passed, the other one's future date is noise.
    if (overdueByKm && entry.remainingDays > 0) {
      // nothing to add
    } else if (entry.remainingDays <= 0) {
      if (entry.remainingKm != null && !overdueByKm) parts.length = 0;
      parts.push(`${Math.abs(entry.remainingDays)} days overdue`);
    } else {
      parts.push(`${parts.length ? 'or by' : 'Due by'} ${fmtDate(entry.dueDate)}`);
    }
  }
  return parts.join(' · ');
}

/** "Every 5,000 km or 6 months, whichever comes first" — the interval, stated. */
export function describeInterval(item: MaintenanceItem, unit: string): string {
  const parts: string[] = [];
  if (item.everyKm) parts.push(`${item.everyKm.toLocaleString()} ${unit}`);
  if (item.everyMonths) parts.push(monthsText(item.everyMonths));
  const text = `Every ${parts.join(' or ')}`;
  return parts.length > 1 ? `${text}, whichever comes first` : text;
}

/** "First one at 1,000 km on a new vehicle" — null when the first is not special. */
export function describeFirst(item: MaintenanceItem, unit: string): string | null {
  if (item.firstKm && item.firstKm !== item.everyKm) {
    return `On a new vehicle, the first one is at ${item.firstKm.toLocaleString()} ${unit}`;
  }
  if (item.firstMonths && item.firstMonths !== item.everyMonths) {
    return `On a new vehicle, the first one is after ${monthsText(item.firstMonths)}`;
  }
  return null;
}

function monthsText(months: number): string {
  return months % 12 === 0
    ? `${months / 12} year${months === 12 ? '' : 's'}`
    : `${months} month${months === 1 ? '' : 's'}`;
}

/** "9 days", "3 weeks", "4 months" — a span a person reads at a glance. */
export function spanText(days: number): string {
  const d = Math.max(0, Math.round(days));
  if (d < 14) return `${d} day${d === 1 ? '' : 's'}`;
  if (d < 60) return `${Math.round(d / 7)} weeks`;
  if (d < 730) return `${Math.round(d / 30.4)} months`;
  return `${Math.round(d / 365)} years`;
}

/**
 * The item sheet's headline, in plain words: "Due in 300 km",
 * "Overdue by 2 weeks", "Not sure when this was last done".
 */
export function headline(entry: MaintenanceItemStatus, unit: string, today = new Date()): {
  title: string;
  detail: string | null;
} {
  const km = (n: number) => `${Math.round(Math.abs(n)).toLocaleString()} ${unit}`;
  const { remainingKm, remainingDays } = entry;

  switch (entry.status) {
    case 'not_applicable':
      return { title: 'Turned off for this vehicle', detail: 'You said this does not apply. Turn it back on any time.' };
    case 'unknown':
      return entry.lastDone
        ? {
            title: 'Add an odometer reading',
            detail: 'We know when it was done, but not at what reading, so we cannot count the distance.',
          }
        : {
            title: 'Not sure when this was last done',
            detail: 'Ask your garage to check it at the next service, then record it here. The schedule counts from there.',
          };
    case 'overdue': {
      const byKm = remainingKm != null && remainingKm <= 0;
      const byDays = remainingDays != null && remainingDays <= 0;
      const title = byKm
        ? `Overdue by ${km(remainingKm!)}`
        : byDays
          ? `Overdue by ${spanText(-remainingDays!)}`
          : 'Overdue';
      return { title, detail: 'Get this done as soon as you can.' };
    }
    default: {
      // Whichever limit comes first leads.
      const daysByKm =
        entry.expectedDate != null ? (entry.expectedDate.getTime() - today.getTime()) / DAY_MS : null;
      const kmFirst =
        remainingKm != null && (remainingDays == null || daysByKm == null || daysByKm <= remainingDays);
      const verb = entry.status === 'soon' ? 'Due' : 'Next one';
      const title = kmFirst
        ? `${verb} in ${km(remainingKm!)}`
        : `${verb} in ${spanText(remainingDays ?? 0)}`;
      let detail: string | null = null;
      if (kmFirst && entry.expectedDate) {
        detail = `About ${spanText(daysByKm ?? 0)} away at your usual driving${
          entry.dueOdometer != null ? ` · at ${km(entry.dueOdometer)}` : ''
        }`;
      } else if (kmFirst && entry.dueOdometer != null) {
        detail = `When the odometer reaches ${km(entry.dueOdometer)}`;
      } else if (entry.dueDate) {
        detail = `By ${entry.dueDate.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}${
          remainingKm != null ? `, or in ${km(remainingKm)} if that comes first` : ''
        }`;
      }
      return { title, detail };
    }
  }
}

/**
 * How much of the interval is used up, 0–1 (clamped), from whichever limit is
 * closer. Null when there is nothing to measure against.
 */
export function progressOf(entry: MaintenanceItemStatus, today = new Date()): number | null {
  const base = entry.lastDone;
  if (!base) return null;
  const fractions: number[] = [];
  if (entry.dueOdometer != null && base.odometer != null && entry.remainingKm != null) {
    const span = entry.dueOdometer - base.odometer;
    if (span > 0) fractions.push((span - entry.remainingKm) / span);
  }
  if (entry.dueDate) {
    const span = entry.dueDate.getTime() - base.date.getTime();
    if (span > 0) fractions.push((today.getTime() - base.date.getTime()) / span);
  }
  if (fractions.length === 0) return null;
  return Math.max(0, Math.min(1, Math.max(...fractions)));
}

export interface ServiceMilestone {
  /**
   * 'now' — already due; 'service' — one of the vehicle's regular services
   * ("10,000 km service"); 'due' — when the next job falls due (no fixed
   * service interval set).
   */
  type: 'now' | 'service' | 'due';
  /** The odometer the visit is planned for; null for "now" (already due). */
  atOdometer: number | null;
  /** Distance still to drive to reach it. */
  kmAway: number | null;
  /**
   * When it is likely: the odometer reached at the usual daily distance, or a
   * date limit on one of its items if that comes first.
   */
  expectedDate: Date | null;
  /** Days until `expectedDate`. */
  daysAway: number | null;
  /** The date comes from an item's time limit, not from driving there. */
  byDate: boolean;
  items: MaintenanceItemStatus[];
  /** What the parts cost last time, for the items with a past price. */
  estimateMinor: number | null;
  /** How many of the items that estimate covers. */
  pricedItems: number;
}

/**
 * The next few garage visits: what falls due at each odometer milestone, and
 * roughly when and for how much.
 *
 * Items due within the same stretch (5,000 km on a car, 1,000 on a bike or
 * three-wheeler) are done in one visit, so they are grouped at the end of that
 * stretch — "At 50,000 km: oil, oil filter, air filter". Anything already due
 * is the first group, "now". Date-only items (a battery by age) join the
 * milestone they will be reached by.
 *
 * WHEN is the distance left at the usual daily distance (`plan.rate`) — "5,000
 * km at ~55 km a day is about 3 months" — unless an item's own time limit
 * comes sooner. COST is the sum of each item's last bill line, so the user
 * knows roughly what to take to the garage; items never billed are left out
 * and counted, rather than guessed.
 */
export function serviceMilestones(
  plan: MaintenancePlan,
  kind: VehicleKind,
  count = 3,
  options: {
    today?: Date;
    lastCosts?: ReadonlyMap<string, number>;
    /** The vehicle's service interval, and its last service — see `regularServices`. */
    service?: {
      km: number;
      months?: number | null;
      last?: { odometer: number; date: Date } | null;
    } | null;
  } = {},
): ServiceMilestone[] {
  const today = options.today ?? new Date();
  if (options.service && options.service.km > 0 && plan.currentOdometer != null) {
    return regularServices(plan, count, { ...options, today, service: options.service });
  }
  const small = kind === 'bike' || kind === 'three_wheeler';
  // Jobs due within this much driving of each other are one garage visit.
  const windowKm = small ? 500 : 2_000;
  const perDay = plan.dailyDistance;
  const current = plan.currentOdometer;

  const now: MaintenanceItemStatus[] = [];
  const upcoming: { entry: MaintenanceItemStatus; when: Date | null; at: number | null; byDate: boolean }[] = [];

  for (const entry of plan.items) {
    if (entry.status === 'overdue' || entry.status === 'soon') {
      now.push(entry);
      continue;
    }
    if (entry.status !== 'ok') continue;
    // When each limit is reached: the distance at the usual driving, the date as is.
    const kmDate =
      entry.remainingKm != null && perDay != null
        ? new Date(today.getTime() + (Math.max(0, entry.remainingKm) / perDay) * DAY_MS)
        : null;
    const byDate =
      entry.dueDate != null && (kmDate == null || entry.dueDate.getTime() < kmDate.getTime()) &&
      (entry.dueOdometer == null || perDay != null);
    const when = byDate ? entry.dueDate : kmDate;
    const at = byDate
      ? current != null && perDay != null
        ? current + Math.max(0, (entry.dueDate!.getTime() - today.getTime()) / DAY_MS) * perDay
        : null
      : entry.dueOdometer;
    if (when == null && at == null) continue;
    upcoming.push({ entry, when, at, byDate });
  }

  // In the order they fall due: by date when the driving rate is known,
  // otherwise by reading (with date-only items after, by date).
  upcoming.sort((a, b) => {
    if (perDay != null) return (a.when?.getTime() ?? Infinity) - (b.when?.getTime() ?? Infinity);
    if (a.at != null && b.at != null) return a.at - b.at;
    if (a.at != null) return -1;
    if (b.at != null) return 1;
    return (a.when?.getTime() ?? 0) - (b.when?.getTime() ?? 0);
  });

  const windowDays = perDay != null ? Math.min(60, Math.max(14, windowKm / perDay)) : 30;
  const groups: (typeof upcoming)[] = [];
  for (const u of upcoming) {
    const lead = groups[groups.length - 1]?.[0];
    const close =
      lead &&
      (perDay != null || (lead.at != null) === (u.at != null)) &&
      (perDay != null || lead.at == null
        ? lead.when != null && u.when != null && (u.when.getTime() - lead.when.getTime()) / DAY_MS <= windowDays
        : u.at! - lead.at! <= windowKm);
    if (close) groups[groups.length - 1].push(u);
    else groups.push([u]);
  }

  const cost = (list: MaintenanceItemStatus[]) => {
    let total = 0;
    let priced = 0;
    for (const e of list) {
      const c = options.lastCosts?.get(e.item.key);
      if (c != null && c > 0) {
        total += c;
        priced += 1;
      }
    }
    return { estimateMinor: priced > 0 ? total : null, pricedItems: priced };
  };

  const milestones: ServiceMilestone[] = [];
  if (now.length > 0) {
    milestones.push({ type: 'now', atOdometer: null, kmAway: null, expectedDate: null, daysAway: null, byDate: false, items: now, ...cost(now) });
  }
  for (const group of groups) {
    // The visit is when its FIRST job falls due.
    const lead = group[0];
    const at = lead.at != null ? Math.round(lead.at / 100) * 100 : null;
    const items = group.map((g) => g.entry);
    milestones.push({
      type: 'due',
      atOdometer: at,
      kmAway: at != null && current != null ? Math.max(0, at - current) : null,
      expectedDate: lead.when,
      daysAway: lead.when ? Math.max(0, Math.round((lead.when.getTime() - today.getTime()) / DAY_MS)) : null,
      byDate: lead.byDate,
      items,
      ...cost(items),
    });
  }
  return milestones.slice(0, count);
}

/**
 * The schedule as the vehicle's regular services — "every 10,000 km".
 *
 * Services fall every `km` from the last one (from zero when there is none),
 * or every `months`, whichever comes first. Each job goes into the last
 * service before it falls due — up to a tenth of an interval late is allowed,
 * because a garage does the oil at the 10,000 km service, not at 9,850 km on
 * a separate trip. Anything already due is "now".
 */
function regularServices(
  plan: MaintenancePlan,
  count: number,
  options: {
    today: Date;
    lastCosts?: ReadonlyMap<string, number>;
    service: { km: number; months?: number | null; last?: { odometer: number; date: Date } | null };
  },
): ServiceMilestone[] {
  const { today, service } = options;
  const current = plan.currentOdometer!;
  const perDay = plan.dailyDistance;
  const step = service.km;
  const anchor = service.last?.odometer ?? 0;
  const anchorDate = service.last?.date ?? null;

  const cost = (list: MaintenanceItemStatus[]) => {
    let total = 0;
    let priced = 0;
    for (const e of list) {
      const c = options.lastCosts?.get(e.item.key);
      if (c != null && c > 0) {
        total += c;
        priced += 1;
      }
    }
    return { estimateMinor: priced > 0 ? total : null, pricedItems: priced };
  };

  // The first service still ahead.
  const firstN = Math.max(1, Math.floor((current - anchor) / step) + 1);
  const nth = (n: number) => anchor + n * step;

  const now: MaintenanceItemStatus[] = [];
  const byService = new Map<number, MaintenanceItemStatus[]>();
  for (const entry of plan.items) {
    if (entry.status === 'overdue' || entry.status === 'soon') {
      now.push(entry);
      continue;
    }
    if (entry.status !== 'ok') continue;
    // Where the odometer will be when it falls due (a date limit read as distance).
    let at = entry.dueOdometer;
    if (entry.dueDate && perDay != null) {
      const byDate = current + Math.max(0, (entry.dueDate.getTime() - today.getTime()) / DAY_MS) * perDay;
      at = at == null ? byDate : Math.min(at, byDate);
    }
    if (at == null) continue;
    const n = Math.max(firstN, Math.floor((at + step * 0.1 - anchor) / step));
    byService.set(n, [...(byService.get(n) ?? []), entry]);
  }

  const milestones: ServiceMilestone[] = [];
  if (now.length > 0) {
    milestones.push({ type: 'now', atOdometer: null, kmAway: null, expectedDate: null, daysAway: null, byDate: false, items: now, ...cost(now) });
  }
  for (const n of [...byService.keys()].sort((a, b) => a - b)) {
    const at = nth(n);
    const items = byService.get(n)!;
    const kmAway = Math.max(0, at - current);
    const byDriving = perDay != null ? new Date(today.getTime() + (kmAway / perDay) * DAY_MS) : null;
    const byMonths = service.months && anchorDate ? addMonths(anchorDate, service.months * n) : null;
    const byDate = byMonths != null && (byDriving == null || byMonths.getTime() < byDriving.getTime());
    const expectedDate = byDate ? byMonths : byDriving;
    milestones.push({
      type: 'service',
      atOdometer: at,
      kmAway,
      expectedDate,
      daysAway: expectedDate ? Math.max(0, Math.round((expectedDate.getTime() - today.getTime()) / DAY_MS)) : null,
      byDate,
      items,
      ...cost(items),
    });
  }
  return milestones.slice(0, count);
}

/** "about 1,650 km a month" — the usual distance, in a unit people think in. */
export function describeRate(rate: DrivingRate, unit: string): string {
  const month = rate.perDay * 30.4;
  const rounded = month >= 1_000 ? Math.round(month / 50) * 50 : Math.round(month / 10) * 10;
  return `about ${rounded.toLocaleString()} ${unit} a month`;
}
