import type { Ionicons } from '@expo/vector-icons';
import type { MaintenanceGroup } from '~/features/fuel/logic/maintenance';

/** A glyph per kind of work, so the schedule can be scanned rather than read. */
export const GROUP_ICON: Record<MaintenanceGroup, keyof typeof Ionicons.glyphMap> = {
  engine: 'water-outline',
  brakes: 'disc-outline',
  tyres: 'ellipse-outline',
  drivetrain: 'cog-outline',
  electrical: 'flash-outline',
  body: 'snow-outline',
};
