/**
 * The plain-words side of the maintenance schedule.
 *
 * maintenance.ts says WHEN. This says what the thing is, what goes wrong if it
 * is skipped, what to watch for, and which parts people here actually buy —
 * written for someone who has never opened a bonnet, because "severe-use
 * interval" means nothing to most drivers and "the engine wears out faster"
 * means something to all of them.
 *
 * Brand lists are what Sri Lankan garages and parts shops commonly stock.
 * They are suggestions to tap, never a closed list: the field takes any text.
 */

import type { FuelType, VehicleKind } from '~/db/schema';

export interface ItemGuide {
  /** What it is, in one plain sentence. */
  what: string;
  /** What happens if it is skipped. */
  why: string;
  /** "Do it sooner if you notice…" — things a driver can see, hear or feel. */
  sooner?: readonly string[];
  /** What to say at the garage. */
  ask?: string;
}

export interface PartSuggestions {
  /** What the variant is called for this item: "Oil grade", "Size". */
  specLabel: string;
  specPlaceholder: string;
  /** Common variants, offered as chips. */
  specs: readonly string[];
  brands: readonly string[];
  /** One line on picking the right variant. */
  hint?: string;
}

const GUIDE: Record<string, ItemGuide> = {
  engine_oil: {
    what: 'Draining the old engine oil and putting in fresh oil. The oil filter is its own item below — often changed at the same visit.',
    why: 'Oil stops the metal parts inside the engine rubbing together. Old, dirty oil stops protecting them, and the engine wears out much faster — the most expensive thing to skip.',
    sooner: [
      'The oil warning light comes on',
      'The oil on the dipstick is black and gritty, or below the low mark',
      'The engine sounds louder or rougher than usual',
    ],
    ask: '"Oil change, please." Say which oil grade your vehicle takes, and whether to change the filter too.',
  },
  oil_filter: {
    what: 'The small filter that catches dirt and metal bits from the engine oil.',
    why: 'A clogged filter lets dirty oil go round the engine, so even fresh oil stops protecting it.',
    sooner: ['The oil looks dirty soon after a change'],
    ask: '"Change the oil filter as well." Ask for a genuine or good-brand filter, not the cheapest.',
  },
  lights_check: {
    what: 'Checking that every light, the horn and the windscreen washers work.',
    why: 'A dead brake light or indicator is how you get hit from behind — and a police fine.',
    sooner: ['Someone flashes or hoots at you for no reason', 'A dashboard bulb warning'],
    ask: '"Check all the lights and the horn."',
  },
  radiator_hoses: {
    what: 'Looking at the rubber pipes that carry coolant between the engine and the radiator.',
    why: 'An old hose can split without warning, the coolant pours out and the engine overheats within minutes.',
    sooner: ['Coolant level keeps dropping', 'Wet patches or a sweet smell near the engine'],
    ask: '"Check the radiator hoses and clamps."',
  },
  exhaust: {
    what: 'Checking the exhaust pipe, silencer and the underside of the vehicle.',
    why: 'A rusted or loose exhaust gets loud, can let fumes into the cabin, and can fall off.',
    sooner: ['The engine sounds much louder', 'A rattle from underneath over bumps'],
    ask: '"Check the exhaust and underbody while it is on the lift."',
  },
  throttle_body: {
    what: 'Cleaning the carbon off the valve that lets air into the engine.',
    why: 'Built-up carbon makes the engine idle rough, stall or feel slow to respond.',
    sooner: ['Rough or hunting idle', 'Stalling when the A/C comes on'],
    ask: '"Throttle body cleaning."',
  },
  fuel_filter: {
    what: 'The filter that stops dirt in the petrol reaching the engine.',
    why: 'A blocked filter starves the engine of fuel — jerking, weak pick-up and hard starts.',
    sooner: ['The engine jerks when you accelerate', 'Hard to start after filling up'],
    ask: '"Does my car have a replaceable fuel filter?" Many modern cars do not.',
  },
  power_steering_fluid: {
    what: 'The oil that makes the steering wheel light to turn, on cars with hydraulic steering.',
    why: 'Old or low fluid makes the steering heavy and wears out the pump.',
    sooner: ['A whine when turning the wheel', 'The steering feels heavy'],
    ask: '"Do I have hydraulic power steering? If so, change the fluid."',
  },
  clutch_fluid: {
    what: 'The fluid that works the clutch pedal on a manual car.',
    why: 'It soaks up water like brake fluid, and the clutch pedal can go soft or stop working.',
    sooner: ['The clutch pedal feels soft or sticks down', 'Gears are hard to engage'],
    ask: '"Change the clutch fluid with the brake fluid."',
  },
  differential_oil: {
    what: 'The oil in the gear housing that drives the back wheels (4WD or rear-wheel drive).',
    why: 'Old oil wears the gears, which then whine and eventually fail.',
    sooner: ['A whine or hum from the back that changes with speed'],
    ask: '"Change the differential oil." Only if your vehicle is 4WD or rear-wheel drive.',
  },
  fork_oil: {
    what: 'The oil inside the front suspension forks of a motorbike.',
    why: 'Old oil makes the front bouncy and less stable when braking, and the seals start leaking.',
    sooner: ['Oil on the fork tubes', 'The front dives a lot when braking'],
    ask: '"Change the fork oil and check the seals."',
  },
  scooter_belt: {
    what: 'The rubber belt (and the small rollers) that drive the back wheel on a scooter.',
    why: 'A worn belt slips, then snaps — and the scooter stops.',
    sooner: ['Slow pick-up from a stop', 'A rattle or slipping feeling when you twist the throttle'],
    ask: '"Check the drive belt and rollers."',
  },
  tyre_rotation: {
    what: 'Swapping the tyres between front and back, and setting the air pressure.',
    why: 'Front tyres wear faster. Swapping them evens it out, so all four last longer and you buy tyres less often.',
    sooner: ['One tyre looks more worn than the others', 'The car pulls to one side'],
    ask: '"Rotate the tyres and check the pressure."',
  },
  cabin_filter: {
    what: 'The filter that cleans the air blowing out of the A/C vents.',
    why: 'A blocked filter makes the A/C weak and fills the cabin with dust and a musty smell.',
    sooner: ['A/C airflow feels weak', 'A bad smell when the A/C starts'],
    ask: '"Change the A/C cabin filter."',
  },
  brake_inspect: {
    what: 'Checking how much is left on the brake pads (or shoes) and the discs they press on.',
    why: 'Worn pads make the car take longer to stop, and once they are gone they grind the discs — a much bigger bill.',
    sooner: [
      'A squeak or grinding sound when braking',
      'The brake pedal feels soft or goes down further',
      'The car pulls to one side when you brake',
    ],
    ask: '"Check the brake pads and discs." Replace the pads if they are thin.',
  },
  air_filter: {
    what: 'The filter that cleans the air going into the engine.',
    why: 'A dirty filter chokes the engine: weaker pick-up and more fuel used. Dusty roads clog it fast.',
    sooner: ['Fuel use has gone up', 'The engine feels slow to pull'],
    ask: '"Clean the air filter, or replace it if it is due."',
  },
  wheel_alignment: {
    what: 'Setting the angle of the wheels so they point straight, and balancing them.',
    why: 'Out-of-line wheels wear tyres unevenly and make the car pull. Potholes and speed bumps knock it out.',
    sooner: [
      'The steering wheel is not straight when driving straight',
      'The car drifts to one side',
      'The steering shakes at speed',
    ],
    ask: '"Wheel alignment and balancing."',
  },
  suspension: {
    what: 'Checking the shock absorbers, steering joints and the rubber boots on the drive shafts.',
    why: 'Worn parts make the car bouncy and less safe on corners, and a split boot lets dirt kill the joint inside.',
    sooner: ['Knocking over bumps', 'The car bounces or leans a lot', 'A clicking sound when turning'],
    ask: '"Check the suspension, steering and CV boots."',
  },
  hybrid_battery_filter: {
    what: 'Cleaning the small air intake that cools the hybrid battery — usually beside or behind the back seat.',
    why: 'When dust blocks it, the hybrid battery runs hot and wears out early. That battery is the most expensive part of a hybrid.',
    sooner: ['A loud fan noise from the back seat area', 'Fuel use has gone up'],
    ask: '"Clean the hybrid battery cooling fan and filter."',
  },
  diesel_fuel_filter: {
    what: 'The filter that stops dirt and water in the fuel reaching a diesel engine.',
    why: 'Water and dirt destroy diesel injectors, which are costly to replace.',
    sooner: ['The water-in-fuel light comes on', 'Hard starting or loss of power'],
    ask: '"Drain the water separator and change the fuel filter if due."',
  },
  brake_fluid: {
    what: 'Replacing the liquid that makes the brakes work when you press the pedal.',
    why: 'It soaks up moisture from the air over time, even if you rarely drive. Old fluid can boil on a long downhill and the brakes stop working.',
    sooner: ['The brake pedal feels soft or spongy', 'The fluid in the reservoir looks dark'],
    ask: '"Change the brake fluid." Use the DOT number printed on the cap.',
  },
  drive_belt: {
    what: 'The rubber belt that drives the A/C and the charging system from the engine.',
    why: 'If it snaps, the battery stops charging and the A/C stops — usually far from home.',
    sooner: ['A squeal when starting or turning the A/C on', 'Visible cracks on the belt'],
    ask: '"Check the drive belt."',
  },
  transmission_fluid: {
    what: 'Replacing the oil inside the gearbox.',
    why: 'Heat and traffic wear it out. Old fluid makes gear changes harsh, and a gearbox is one of the costliest repairs.',
    sooner: ['Jerky or slipping gear changes', 'A whining sound from the gearbox'],
    ask: '"Change the gearbox oil." An automatic or CVT must get its exact fluid type.',
  },
  coolant: {
    what: 'Replacing the liquid that keeps the engine from overheating.',
    why: 'Old coolant stops protecting and lets the radiator and engine corrode from inside, which leads to overheating.',
    sooner: ['The temperature gauge climbs higher than usual', 'A sweet smell or green / pink drips under the car'],
    ask: '"Coolant flush." Use the same colour and type already in it — mixing can clog it.',
  },
  inverter_coolant: {
    what: 'A separate coolant that cools the hybrid system\'s electronics.',
    why: 'If it fails, the hybrid system overheats and can shut down.',
    sooner: ['A hybrid system warning on the dashboard'],
    ask: '"Change the inverter coolant." Not every garage knows this one — a hybrid specialist does.',
  },
  spark_plugs: {
    what: 'The small parts that spark to light the fuel inside the engine.',
    why: 'Worn plugs cause hard starting, shaking and more fuel used.',
    sooner: ['Hard to start', 'The engine shakes at idle', 'Fuel use has gone up'],
    ask: '"Change the spark plugs." Ask for the same type that came out.',
  },
  timing_belt: {
    what: 'A belt inside the engine that keeps its parts moving in step. Many engines use a metal chain instead and never need this.',
    why: 'If a belt snaps, the engine can destroy itself in a second — one of the most expensive failures there is.',
    sooner: ['A ticking or slapping noise from the front of the engine'],
    ask: '"Does my engine have a timing belt or a chain?" If a belt, change it with the water pump.',
  },
  tyres: {
    what: 'Fitting new tyres.',
    why: 'Worn tyres slide in the rain and take longer to stop. Rubber also hardens with age even if it looks fine.',
    sooner: [
      'The tread is nearly flat, or level with the small wear bars in the grooves',
      'Cracks on the side of the tyre',
      'A bulge anywhere on the tyre',
    ],
    ask: 'Read the size from the side of your current tyre, e.g. 175/65 R15.',
  },
  battery_12v: {
    what: 'The battery that starts the vehicle and runs the lights.',
    why: 'Heat wears batteries out quickly here. A dead one leaves you stuck, usually in a car park.',
    sooner: ['Slow, tired cranking when starting', 'Lights dim at idle', 'White crust on the terminals'],
    ask: '"Test the battery." Replace it if it fails the test.',
  },
  ac_service: {
    what: 'Checking the A/C gas level and cleaning the radiator-like part at the front that cools it.',
    why: 'Low gas or a dirty condenser means a weak A/C that works the engine harder.',
    sooner: ['The A/C does not get cold enough', 'Cold at night but weak in the midday heat'],
    ask: '"A/C service — check the gas and clean the condenser."',
  },
  wipers: {
    what: 'The rubber blades that wipe the windscreen.',
    why: 'Sun cracks the rubber, and you find out in the first heavy rain.',
    sooner: ['Streaks or smears', 'A judder or squeak across the glass'],
  },
  bike_chain: {
    what: 'Cleaning the chain, oiling it and setting how tight it is.',
    why: 'A dry or loose chain wears out fast and takes the sprockets with it. A loose one can also jump off.',
    sooner: ['The chain looks dry or rusty', 'It hangs low or slaps', 'After riding in rain'],
    ask: '"Clean, lube and adjust the chain."',
  },
  bike_brakes: {
    what: 'Checking the brake pads or shoes and adjusting the brakes.',
    why: 'Worn brakes mean longer stops — on a bike there is no margin for that.',
    sooner: ['The lever or pedal goes further than before', 'Squeaking or grinding'],
    ask: '"Check and adjust the brakes."',
  },
  bike_cables: {
    what: 'Oiling the clutch and throttle cables and setting how much slack they have.',
    why: 'A sticky throttle is dangerous, and a tight clutch cable wears the clutch.',
    sooner: ['The throttle does not snap back', 'The clutch lever feels stiff'],
    ask: '"Oil and adjust the cables."',
  },
  valve_clearance: {
    what: 'Setting the small gap on the engine valves (tappets).',
    why: 'A wrong gap makes the engine noisy, weak and harder to start.',
    sooner: ['A ticking sound from the engine', 'Rough idle'],
    ask: '"Check the tappets."',
  },
  bike_chain_kit: {
    what: 'Replacing the chain and both sprockets (the toothed wheels) together.',
    why: 'A worn chain can snap. A new chain on old sprockets wears out in weeks, so they go together.',
    sooner: ['The chain cannot be tightened any more', 'Sprocket teeth look hooked or sharp'],
    ask: '"Chain and sprocket kit."',
  },
  tuk_cables: {
    what: 'Setting the clutch, brake and throttle cables and greasing the moving joints.',
    why: 'Loose cables mean weak brakes and a clutch that slips; tight ones wear parts out.',
    sooner: ['Brakes feel weak', 'The clutch slips or drags'],
    ask: '"Adjust the cables and grease the pivots."',
  },
  carburettor: {
    what: 'Cleaning the carburettor and tuning the engine so fuel and air mix properly.',
    why: 'A dirty carburettor wastes fuel and makes the engine stall or start badly.',
    sooner: ['Stalling at idle', 'Black smoke', 'Fuel use has gone up'],
    ask: '"Carburettor clean and tune-up."',
  },
};

const GENERIC_GUIDE: ItemGuide = {
  what: 'A regular check on your vehicle.',
  why: 'Catching wear early is cheaper than fixing a breakdown.',
};

export function guideFor(key: string): ItemGuide {
  return GUIDE[key] ?? GENERIC_GUIDE;
}

/* ------------------------------------------------------------------ parts */

type KindGroup = 'car' | 'bike' | 'tuk';

const kindGroup = (kind: VehicleKind): KindGroup =>
  kind === 'bike' ? 'bike' : kind === 'three_wheeler' ? 'tuk' : 'car';

const GENUINE = 'Genuine (dealer)';
const FILTER_BRANDS = [GENUINE, 'Denso', 'Sakura', 'Bosch', 'VIC', 'Mann'];

const PARTS: Record<string, Partial<Record<KindGroup | 'all', PartSuggestions>>> = {
  engine_oil: {
    car: {
      specLabel: 'Oil grade',
      specPlaceholder: 'e.g. 5W-30',
      specs: ['0W-16', '0W-20', '5W-30', '10W-30', '10W-40', '15W-40', '20W-50'],
      brands: [GENUINE, 'Mobil', 'Castrol', 'Shell', 'Caltex Havoline', 'Valvoline', 'Motul', 'Servo', 'Laugfs'],
      hint: 'The grade is printed on the oil filler cap or in the manual.',
    },
    bike: {
      specLabel: 'Oil grade',
      specPlaceholder: 'e.g. 10W-30',
      specs: ['10W-30', '10W-40', '20W-40', '20W-50'],
      brands: ['Honda', 'Yamalube', 'Bajaj', 'TVS', 'Castrol', 'Mobil', 'Motul', 'Servo', 'Shell'],
      hint: 'Use oil made for motorcycles (JASO MA) — car oil can make the clutch slip.',
    },
    tuk: {
      specLabel: 'Oil grade',
      specPlaceholder: 'e.g. 20W-40',
      specs: ['15W-40', '20W-40', '20W-50'],
      brands: ['Bajaj', 'TVS', 'Castrol', 'Servo', 'Mobil', 'Caltex', 'Laugfs'],
    },
  },
  oil_filter: {
    all: {
      specLabel: 'Part number',
      specPlaceholder: 'e.g. 90915-YZZE1',
      specs: [],
      brands: [GENUINE, 'Denso', 'Sakura', 'Bosch', 'VIC', 'Mann', 'Honda', 'Bajaj'],
    },
  },
  fuel_filter: {
    all: { specLabel: 'Part number', specPlaceholder: 'Optional', specs: [], brands: FILTER_BRANDS },
  },
  power_steering_fluid: {
    all: {
      specLabel: 'Fluid type',
      specPlaceholder: 'e.g. Dexron III',
      specs: ['Dexron III', 'PSF'],
      brands: [GENUINE, 'Castrol', 'Mobil', 'Prestone'],
    },
  },
  clutch_fluid: {
    all: {
      specLabel: 'Fluid type',
      specPlaceholder: 'e.g. DOT 4',
      specs: ['DOT 3', 'DOT 4'],
      brands: [GENUINE, 'Castrol', 'Bosch', 'Prestone'],
    },
  },
  differential_oil: {
    all: {
      specLabel: 'Oil grade',
      specPlaceholder: 'e.g. 80W-90',
      specs: ['75W-90', '80W-90', '85W-140', 'LSD'],
      brands: [GENUINE, 'Castrol', 'Mobil', 'Shell', 'Motul'],
    },
  },
  fork_oil: {
    all: {
      specLabel: 'Grade',
      specPlaceholder: 'e.g. 10W',
      specs: ['5W', '10W', '15W'],
      brands: ['Motul', 'Castrol', 'Honda', 'Yamalube', 'Bajaj'],
    },
  },
  scooter_belt: {
    all: {
      specLabel: 'What was replaced',
      specPlaceholder: 'e.g. Belt + rollers',
      specs: ['Belt', 'Belt + rollers', 'Rollers'],
      brands: ['Honda', 'TVS', 'Bando', 'Gates'],
    },
  },
  cabin_filter: {
    all: {
      specLabel: 'Type',
      specPlaceholder: 'e.g. Carbon',
      specs: ['Standard', 'Carbon (blocks smells)'],
      brands: FILTER_BRANDS,
    },
  },
  air_filter: {
    all: {
      specLabel: 'Part number',
      specPlaceholder: 'e.g. 17801-21050',
      specs: [],
      brands: FILTER_BRANDS,
    },
  },
  diesel_fuel_filter: {
    all: { specLabel: 'Part number', specPlaceholder: 'Optional', specs: [], brands: FILTER_BRANDS },
  },
  brake_inspect: {
    car: {
      specLabel: 'What was replaced',
      specPlaceholder: 'e.g. Front pads',
      specs: ['Checked only', 'Front pads', 'Rear pads / shoes', 'Discs'],
      brands: [GENUINE, 'Akebono', 'Bendix', 'Brembo', 'TRW', 'Bosch', 'MK Kashiyama'],
    },
    tuk: {
      specLabel: 'What was replaced',
      specPlaceholder: 'e.g. Rear shoes',
      specs: ['Checked only', 'Front shoes', 'Rear shoes'],
      brands: ['Bajaj', 'TVS', 'Bendix', 'Endurance'],
    },
  },
  bike_brakes: {
    all: {
      specLabel: 'What was replaced',
      specPlaceholder: 'e.g. Front pads',
      specs: ['Checked only', 'Front pads', 'Rear pads / shoes'],
      brands: ['Honda', 'Yamaha', 'Bajaj', 'TVS', 'Brembo', 'Endurance'],
    },
  },
  brake_fluid: {
    all: {
      specLabel: 'Fluid type',
      specPlaceholder: 'e.g. DOT 4',
      specs: ['DOT 3', 'DOT 4', 'DOT 5.1'],
      brands: [GENUINE, 'Castrol', 'Bosch', 'Prestone', 'Motul'],
      hint: 'The DOT number is printed on the reservoir cap. Never use DOT 5 unless the cap says so.',
    },
  },
  transmission_fluid: {
    car: {
      specLabel: 'Fluid type',
      specPlaceholder: 'e.g. CVT FE',
      specs: ['ATF WS', 'CVT FE', 'CVT TC', 'Honda HCF-2', 'Dexron VI', '75W-90 (manual)'],
      brands: [GENUINE, 'Idemitsu', 'Mobil', 'Castrol', 'Shell'],
      hint: 'Automatics and CVTs need their exact fluid — the wrong one can ruin the gearbox.',
    },
    tuk: {
      specLabel: 'Oil grade',
      specPlaceholder: 'e.g. 80W-90',
      specs: ['80W-90', 'SAE 90'],
      brands: ['Bajaj', 'TVS', 'Castrol', 'Servo', 'Mobil'],
    },
  },
  coolant: {
    all: {
      specLabel: 'Type / colour',
      specPlaceholder: 'e.g. Pink long-life',
      specs: ['Pink long-life', 'Green', 'Blue', 'Red'],
      brands: [GENUINE, 'Prestone', 'Mobil', 'Castrol', 'Shell'],
      hint: 'Stay with the colour already in the tank.',
    },
  },
  inverter_coolant: {
    all: {
      specLabel: 'Type',
      specPlaceholder: 'e.g. Pink long-life',
      specs: ['Pink long-life'],
      brands: [GENUINE, 'Prestone'],
    },
  },
  spark_plugs: {
    car: {
      specLabel: 'Type',
      specPlaceholder: 'e.g. Iridium',
      specs: ['Iridium', 'Platinum', 'Copper / nickel'],
      brands: ['NGK', 'Denso', 'Bosch', 'Champion'],
      hint: 'Iridium lasts five times longer than copper — worth it if the price gap is small.',
    },
    bike: {
      specLabel: 'Type',
      specPlaceholder: 'e.g. CPR6EA-9',
      specs: ['Standard', 'Iridium'],
      brands: ['NGK', 'Denso', 'Bosch', 'Champion'],
    },
    tuk: {
      specLabel: 'Type',
      specPlaceholder: 'Optional',
      specs: ['Standard', 'Iridium'],
      brands: ['NGK', 'Bosch', 'Champion', 'Bajaj'],
    },
  },
  timing_belt: {
    all: {
      specLabel: 'What was done',
      specPlaceholder: 'e.g. Belt + water pump',
      specs: ['Belt only', 'Belt + tensioner', 'Belt + water pump kit'],
      brands: [GENUINE, 'Gates', 'Bando', 'Mitsuboshi', 'Aisin'],
    },
  },
  drive_belt: {
    all: {
      specLabel: 'What was done',
      specPlaceholder: 'e.g. Replaced',
      specs: ['Checked only', 'Replaced'],
      brands: [GENUINE, 'Gates', 'Bando', 'Mitsuboshi'],
    },
  },
  tyres: {
    car: {
      specLabel: 'Size',
      specPlaceholder: 'e.g. 175/65 R15',
      specs: ['165/70 R14', '175/65 R14', '175/65 R15', '185/65 R15', '195/65 R15', '205/55 R16'],
      brands: ['Bridgestone', 'Dunlop', 'Yokohama', 'Michelin', 'Kumho', 'Hankook', 'GT Radial', 'Maxxis', 'DSI'],
      hint: 'The size is printed on the side of your current tyre.',
    },
    bike: {
      specLabel: 'Which tyre / size',
      specPlaceholder: 'e.g. Rear 90/90-17',
      specs: ['Front', 'Rear', 'Both'],
      brands: ['CEAT', 'MRF', 'TVS Eurogrip', 'DSI', 'Michelin', 'Pirelli', 'Bridgestone'],
    },
    tuk: {
      specLabel: 'Which tyre / size',
      specPlaceholder: 'e.g. 4.00-8',
      specs: ['Front', 'Rear pair', 'All three'],
      brands: ['CEAT', 'MRF', 'DSI', 'TVS Eurogrip', 'Bridgestone'],
    },
  },
  battery_12v: {
    car: {
      specLabel: 'Size',
      specPlaceholder: 'e.g. NS60',
      specs: ['NS40', 'NS60', 'N50', '46B24', '55B24', '80D26'],
      brands: ['Exide', 'Amaron', 'Dagenite', 'Panasonic', 'GS Yuasa', 'Varta', 'Bosch'],
      hint: 'The size is on the label of your current battery.',
    },
    bike: {
      specLabel: 'Size',
      specPlaceholder: 'e.g. 5Ah',
      specs: ['2.5Ah', '5Ah', '7Ah', '9Ah'],
      brands: ['Exide', 'Amaron', 'Yuasa', 'Dagenite'],
    },
    tuk: {
      specLabel: 'Size',
      specPlaceholder: 'e.g. 32Ah',
      specs: ['32Ah', '35Ah'],
      brands: ['Exide', 'Amaron', 'Dagenite'],
    },
  },
  ac_service: {
    all: {
      specLabel: 'What was done',
      specPlaceholder: 'e.g. Gas top-up',
      specs: ['Checked only', 'Gas top-up', 'Condenser cleaned', 'Full service'],
      brands: [],
    },
  },
  wipers: {
    all: {
      specLabel: 'Size',
      specPlaceholder: 'e.g. 26" + 14"',
      specs: [],
      brands: ['Bosch', 'Denso', 'Valeo', GENUINE],
    },
  },
  bike_chain: {
    all: {
      specLabel: 'Lube used',
      specPlaceholder: 'e.g. Chain spray',
      specs: ['Chain spray', 'Gear oil', 'Wax'],
      brands: ['Motul', 'Castrol', 'Liqui Moly', 'Shell', 'WD-40'],
    },
  },
  bike_chain_kit: {
    all: {
      specLabel: 'Kit',
      specPlaceholder: 'e.g. 428H 14/42',
      specs: [],
      brands: ['Rolon', 'DID', 'RK', 'Honda', 'Bajaj', 'TVS'],
    },
  },
};

/**
 * What to suggest when recording this item, or null when nothing is fitted —
 * an inspection or an adjustment has no brand.
 */
export function partFor(key: string, kind: VehicleKind, fuel?: FuelType): PartSuggestions | null {
  const entry = PARTS[key];
  if (!entry) return null;
  const parts = entry[kindGroup(kind)] ?? entry.all ?? null;
  if (!parts) return null;
  // A hybrid takes the thin oils; say so where the choice is made.
  if (key === 'engine_oil' && fuel === 'hybrid' && kindGroup(kind) === 'car') {
    return { ...parts, hint: 'Most hybrids take 0W-20 or 0W-16 — check the oil cap.' };
  }
  if (key === 'engine_oil' && fuel === 'diesel' && kindGroup(kind) === 'car') {
    return { ...parts, hint: 'Use oil marked for diesel (CF / CK-4, or C2 / C3).' };
  }
  return parts;
}

/** "Mobil · 5W-30" — the part, in one short line. Null when nothing was noted. */
export function describePart(part: { brand?: string | null; spec?: string | null }): string | null {
  const text = [part.brand?.trim(), part.spec?.trim()].filter(Boolean).join(' · ');
  return text || null;
}
