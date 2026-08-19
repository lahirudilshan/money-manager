import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import type { BankBrand } from '~/shared/data/banks';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { Text } from '~/shared/components/ui';

/**
 * Whether this brand's artwork can actually be drawn right now.
 *
 * A `url` is a *claim* that a logo exists, not a guarantee: most are still
 * remote URIs (see data/banks.ts) that can 404, time out, or simply be
 * unreachable on a plane. Nothing tells us that until the `Image` reports it,
 * so every logo starts optimistic and demotes itself to the monogram the
 * instant it fails.
 *
 * The failure is remembered per brand id, module-wide and not in state, for two
 * reasons: a bank's tile appears in several places at once (picker grid, card
 * face, loan row) and one failure should settle all of them, and a list that
 * recycles rows must not re-attempt — and re-flicker — a URL already known to
 * be dead. The listener set is what wakes the other mounted tiles, since a
 * mutable Set is not something React can diff.
 */
const FAILED = new Set<string>();
const failureListeners = new Set<() => void>();

/**
 * The brand hue, darkened until it is legible as text on a white chip.
 *
 * A monogram wants its bank's colour, but six of the catalog's hues are pale
 * enough to fail WCAG AA against white — BOC's yellow manages 1.57:1, which is
 * barely a smudge. Rather than hand-maintaining a second "ink" colour per bank
 * (a value nobody would remember to update when a brand colour changes), the
 * hue is scaled toward black until it clears 4.5:1 and then left alone. Banks
 * already dark enough are returned untouched, so most keep their exact brand
 * colour.
 */
function readableOnWhite(hex: string): string {
  const parse = (h: string) =>
    [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

  const contrast = (rgb: number[]) => {
    const lin = rgb
      .map((v) => v / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    const luminance = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    return 1.05 / (luminance + 0.05);
  };

  const rgb = parse(hex);
  if (Number.isNaN(rgb[0]) || contrast(rgb) >= 4.5) return hex;

  // Walk the hue toward black in small steps; 20 iterations of 5% reaches
  // near-black, so every hue terminates well before running out.
  let scale = 1;
  for (let step = 0; step < 20; step += 1) {
    scale *= 0.95;
    const scaled = rgb.map((v) => Math.round(v * scale));
    if (contrast(scaled) >= 4.5) {
      return `#${scaled.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    }
  }
  return '#101828';
}

function useBrandArtwork(brand: BankBrand): {
  source: BankBrand['url'] | undefined;
  onError: () => void;
} {
  const [, bump] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    failureListeners.add(bump);
    return () => {
      failureListeners.delete(bump);
    };
  }, []);

  const onError = React.useCallback(() => {
    if (FAILED.has(brand.id)) return;
    FAILED.add(brand.id);
    failureListeners.forEach((listen) => listen());
  }, [brand.id]);

  return { source: FAILED.has(brand.id) ? undefined : brand.url, onError };
}

/**
 * A bank's mark: its real logo when one exists and loads, its monogram
 * otherwise.
 *
 * The monogram is not a placeholder to be embarrassed about — it renders
 * offline, scales to any size and gives every bank identical visual weight, so
 * a half-populated logo folder still looks deliberate rather than broken. Banks
 * gain a logo one file at a time (see data/banks.ts) and nothing else in the
 * app needs to know which have arrived.
 */
export function BankLogo({
  brand,
  size = 44,
  style,
}: {
  brand: BankBrand;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { source, onError } = useBrandArtwork(brand);

  /*
   * A logo sits on WHITE, not on the brand colour.
   *
   * Bank marks are drawn to appear on white and most carry their own colour;
   * putting one on its own brand background either clashes or disappears —
   * a navy logo on navy is invisible. The monogram keeps the coloured tile
   * because that IS its recognisability.
   */
  if (source) {
    return (
      <View
        accessible
        accessibilityLabel={brand.name}
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 3.4,
            backgroundColor: '#FFFFFF',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          },
          style,
        ]}
      >
        <Image
          source={source}
          onError={onError}
          // `contain` so a wide wordmark and a square roundel both fit without
          // being cropped or stretched; the padding keeps it off the corners.
          resizeMode="contain"
          style={{ width: size * 0.76, height: size * 0.76 }}
        />
      </View>
    );
  }

  return (
    <View
      accessible
      accessibilityLabel={brand.name}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 3.4,
          backgroundColor: brand.color,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Text
        variant="label"
        color={brand.onColor}
        style={{
          // Scales with the tile so 2- and 3-letter monograms both fit.
          fontSize: Math.max(10, size * (brand.monogram.length > 2 ? 0.26 : 0.32)),
          letterSpacing: 0.3,
          fontWeight: '800',
        }}
      >
        {brand.monogram}
      </Text>
    </View>
  );
}

/**
 * Selectable bank card used by the onboarding picker.
 *
 * ONE card structure for every bank, whether it has artwork or not: a mark on
 * top, the name underneath, identical geometry throughout. A logo does not get
 * its own kind of card — it swaps into the same white chip the monogram
 * occupies. That matters because logos arrive one file at a time, and a grid
 * where lettered banks and logoed banks are differently shaped reads as two
 * unrelated components rather than one wall of banks.
 *
 * The card is therefore always brand-tinted and the artwork always sits on its
 * own white chip. Bank marks are drawn for white and most carry their own
 * colour, so a logo laid straight onto its brand background either clashes or
 * vanishes outright — navy on navy.
 *
 * Within that structure the mark gets the space: the chip spans the card's
 * full width and the tint survives only as a frame around it. Recognising the
 * bank is the entire task on this screen, and it happens by logo long before
 * anyone reads the label.
 */
export function BankSelectTile({
  brand,
  selected,
  onPress,
}: {
  brand: BankBrand;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, radius, shadow } = useTheme();
  const { source, onError } = useBrandArtwork(brand);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={brand.name}
      style={({ pressed }) => [
        {
          /*
           * A wash of the brand colour, not the full-strength hue.
           *
           * Fifteen saturated tiles at once is a shouting match in which no
           * single bank stands out, and it leaves the check badge nowhere
           * legible to sit. `38` hex ≈ 22% carries enough of each hue to feel
           * like the bank's own card while the grid stays calm enough to scan.
           *
           * The tint deliberately does NOT carry identity: half this catalog
           * is a near-identical navy, and even at full strength NSB, DFCC, NDB
           * and Pan Asia composite to within a few RGB steps of one another.
           * The mark and the name are what tell banks apart, which is exactly
           * why both are always present on every card.
           */
          backgroundColor: selected ? colors.accentSoft : `${brand.color}38`,
          borderRadius: radius.lg,
          /*
           * A square card with the same margin on all four sides.
           *
           * `aspectRatio: 1` makes the grid a true checkerboard — every tile
           * identical, rows evenly pitched — instead of a height that drifts
           * with whatever the chip and label happen to add up to. The single
           * `padding` value is what keeps the frame even; earlier passes tuned
           * top, bottom and sides separately to buy space for the logo, and
           * the asymmetry showed as a mark sitting slightly high in its tile.
           */
          aspectRatio: 1,
          padding: 7,
          alignItems: 'center',
          justifyContent: 'center',
          /*
           * The gap matches the padding, so the space above the chip, beside
           * it, between it and the name, and below the name are all the same.
           * Anything smaller and the label crowds the card's bottom edge — the
           * one place uneven spacing is obvious, because the eye reads the
           * name and the border together.
           */
          gap: 7,
          overflow: 'hidden',
          // Selection reads as a ring plus a badge — never colour alone.
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? colors.accent : colors.hairline,
          opacity: pressed ? 0.85 : 1,
        },
        shadow.card,
      ]}
    >
      <View
        style={{
          /*
           * The chip takes every point the label does not.
           *
           * With the card locked square, giving the chip its own aspect ratio
           * would fight the card for height and reintroduce the uneven margins
           * the square layout exists to remove. Flexing instead means the mark
           * gets the largest area the tile can spare, and the bottom margin
           * ends up matching the top by construction rather than by hand-tuned
           * padding.
           */
          width: '100%',
          flex: 1,
          borderRadius: radius.md,
          backgroundColor: '#FFFFFF',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          // A hairline keeps a white-cornered logo from dissolving into the
          // chip on the palest brand tints.
          borderWidth: 1,
          borderColor: 'rgba(16,24,40,0.08)',
        }}
      >
        {source ? (
          /*
           * `contain`, never `cover`.
           *
           * These marks are mostly wide wordmarks; cropping one to fill the
           * chip slices it mid-word ("BANK OF CEYL", "NDB ba") and destroys
           * the very recognisability the logo was added for. Letterboxing
           * inside the chip is the correct trade.
           */
          <Image
            source={source}
            onError={onError}
            resizeMode="contain"
            // The full chip: `contain` already guarantees the mark keeps its
            // aspect ratio and never crops or touches an edge it shouldn't,
            // so an inset here would only shrink the artwork for nothing.
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          <Text
            variant="label"
            color={readableOnWhite(brand.color)}
            style={{
              // Sized to fill the chip the way a wordmark does — a monogram is
              // this bank's stand-in for a logo, not a caption inside it.
              fontSize: brand.monogram.length > 2 ? 24 : 29,
              fontWeight: '800',
              letterSpacing: 0.4,
            }}
          >
            {brand.monogram}
          </Text>
        )}
      </View>

      {/*
        The name is always the theme's ink on the card, so it stays legible in
        both themes. The old layout painted it with `colors.ink` over a
        hardcoded white band, which in dark mode is near-white on white.
      */}
      <Text
        variant="small"
        color={colors.ink}
        numberOfLines={1}
        style={{ textAlign: 'center', fontWeight: '700' }}
      >
        {brand.shortName}
      </Text>

      {/*
        The badge rides the chip's top-right corner.

        With the chip running the full width of the card there is no margin
        left to tuck it into, so instead of colliding with the artwork by
        accident it overlaps by design: pulled to the corner, where a `contain`
        fit leaves empty chip rather than mark. The ring already carries
        selection, so this only needs to be findable, not prominent.
      */}
      {selected ? (
        <View
          style={{
            position: 'absolute',
            // Matches the card's padding so the badge sits in the corner of
            // the frame, concentric with the even margin around the chip.
            top: 5,
            right: 5,
            width: 20,
            height: 20,
            borderRadius: 10,
            backgroundColor: colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
            // Lifts the badge off whatever it lands on, so it stays a distinct
            // object rather than merging into the artwork behind it.
            borderWidth: 2,
            borderColor: colors.surface,
          }}
        >
          <Ionicons name="checkmark" size={12} color="#FFFFFF" />
        </View>
      ) : null}
    </Pressable>
  );
}
