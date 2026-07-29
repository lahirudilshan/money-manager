import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { LayoutAnimation, Platform, Pressable, UIManager, View } from 'react-native';
import { formatMoney } from '../core/money';
import { useTheme } from '../theme/ThemeProvider';
import { Label, Row, T } from './ui';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** Cells per row. */
const COLUMNS = 4;

/**
 * Pick where a transaction belongs, as a grid of category cells that open into
 * their bills.
 *
 * This replaces a search box over a flat list. Typing to find "Groceries"
 * summons the keyboard, covers half the screen, and asks the user to *recall* a
 * name — when what they want is to *recognise* one.
 *
 * Opening a category inserts its bills into the grid itself, filling the row
 * directly beneath the category's own row, so they read as that category's
 * contents rather than as a detached panel. A chevron under an expandable
 * category's label points down when closed and up when open, and the open
 * category's own label takes the accent colour — the same affordance the user
 * already knows from other category pickers.
 */

/** One selectable destination: a bill, with the category it lives in. */
export interface GridDestination {
  id: string;
  name: string;
  categoryId: string;
  plannedMinor: number;
  icon?: string | null;
}

export interface GridCategory {
  id: string;
  name: string;
  color: string;
  icon?: string | null;
}

const animate = () =>
  LayoutAnimation.configureNext(LayoutAnimation.create(180, 'easeInEaseOut', 'opacity'));

export function CategoryGridPicker({
  categories,
  destinations,
  selectedId,
  onSelect,
  extraTile,
}: {
  categories: readonly GridCategory[];
  destinations: readonly GridDestination[];
  selectedId: string | null;
  onSelect: (destinationId: string) => void;
  extraTile?: {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    selected: boolean;
    onPress: () => void;
  };
}) {
  const { colors, space } = useTheme();
  const [openId, setOpenId] = React.useState<string | null>(null);

  const billsOf = React.useCallback(
    (categoryId: string) => destinations.filter((d) => d.categoryId === categoryId),
    [destinations],
  );

  const selectedDestination = destinations.find((d) => d.id === selectedId) ?? null;
  const selectedCategoryId = selectedDestination?.categoryId ?? null;

  const shown = categories.filter((category) => billsOf(category.id).length > 0);

  function press(category: GridCategory) {
    const bills = billsOf(category.id);
    // A single-bill category is the common case and needs no drill-down: one
    // tap selects it outright. Only a genuine choice opens.
    animate();
    if (bills.length === 1) {
      setOpenId(null);
      onSelect(bills[0].id);
      return;
    }
    setOpenId((current) => (current === category.id ? null : category.id));
  }

  /**
   * The grid, split into whole rows.
   *
   * An opened category's bills are NOT spliced into the columns: doing so
   * forced blank filler cells beside the category to finish its row, which
   * read as missing tiles. Instead the bills render as one full-width strip
   * inserted after the row that holds the open category — every grid slot
   * stays occupied, and the strip has the whole width to lay its bills out in.
   */
  const rows: GridCategory[][] = [];
  for (let i = 0; i < shown.length; i += COLUMNS) {
    rows.push(shown.slice(i, i + COLUMNS));
  }

  return (
    <View style={{ gap: space.sm }}>
      <Row justify="space-between" align="center">
        <Label>WHAT WAS IT FOR?</Label>
        {selectedDestination ? (
          <Row gap={4}>
            <Ionicons name="checkmark-circle" size={13} color={colors.completed} />
            <T
              variant="caption"
              color={colors.completed}
              style={{ fontWeight: '700' }}
              numberOfLines={1}
            >
              {selectedDestination.name}
            </T>
          </Row>
        ) : (
          <T variant="caption" tone="muted">
            Tap a category
          </T>
        )}
      </Row>

      <View
        style={{
          borderTopWidth: 1,
          borderLeftWidth: 1,
          borderColor: colors.hairline,
        }}
      >
        {rows.map((row, rowIndex) => {
          const openInRow = row.find((category) => category.id === openId) ?? null;

          return (
            <React.Fragment key={`row-${rowIndex}`}>
              <View style={{ flexDirection: 'row' }}>
                {row.map((category) => (
                  <CategoryCell
                    key={category.id}
                    category={category}
                    expandable={billsOf(category.id).length > 1}
                    open={openId === category.id}
                    selected={selectedCategoryId === category.id}
                    onPress={() => press(category)}
                  />
                ))}
                {/* Only the final row can be short; pad it so the frame stays
                    rectangular. Rows above are always full. */}
                {row.length < COLUMNS && !extraTile
                  ? Array.from({ length: COLUMNS - row.length }, (_, i) => (
                      <FillerCell key={`tail-${rowIndex}-${i}`} />
                    ))
                  : null}
                {row.length < COLUMNS && extraTile && rowIndex === rows.length - 1 ? (
                  <ExtraCell tile={extraTile} />
                ) : null}
              </View>

              {/* The opened category's bills, full width, directly beneath the
                  row they belong to. */}
              {openInRow ? (
                <BillRows
                  category={openInRow}
                  bills={billsOf(openInRow.id)}
                  selectedId={selectedId}
                  onSelect={(billId) => {
                    animate();
                    setOpenId(null);
                    onSelect(billId);
                  }}
                />
              ) : null}
            </React.Fragment>
          );
        })}

        {/* When the last row was already full, the extra tile starts a new one. */}
        {extraTile && shown.length % COLUMNS === 0 ? (
          <View style={{ flexDirection: 'row' }}>
            <ExtraCell tile={extraTile} />
            {Array.from({ length: COLUMNS - 1 }, (_, i) => (
              <FillerCell key={`extra-pad-${i}`} />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * A category cell: icon medallion, name, and — when it holds more than one
 * bill — a chevron marking that tapping opens rather than selects. The chevron
 * flips and the label takes the category colour while open.
 */
function CategoryCell({
  category,
  expandable,
  open,
  selected,
  onPress,
}: {
  category: GridCategory;
  expandable: boolean;
  open: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();

  return (
    <View style={{ width: `${100 / COLUMNS}%` }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected, expanded: open }}
        accessibilityLabel={category.name}
        style={({ pressed }) => ({
          height: 82,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
          paddingHorizontal: 4,
          borderRightWidth: 1,
          borderBottomWidth: 1,
          borderColor: colors.hairline,
          backgroundColor: selected
            ? category.color
            : open
              ? `${category.color}1F`
              : pressed
                ? colors.surfaceSunken
                : colors.surface,
        })}
      >
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: selected ? 'rgba(255,255,255,0.28)' : `${category.color}26`,
          }}
        >
          <Ionicons
            name={(category.icon ?? 'albums-outline') as keyof typeof Ionicons.glyphMap}
            size={15}
            color={selected ? colors.inkInverse : category.color}
          />
        </View>

        <T
          variant="caption"
          color={selected ? colors.inkInverse : open ? category.color : colors.ink}
          numberOfLines={2}
          style={{
            fontWeight: selected || open ? '700' : '600',
            textAlign: 'center',
            width: '100%',
            lineHeight: 13,
          }}
        >
          {category.name}
        </T>

        {expandable ? (
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={11}
            color={selected ? colors.inkInverse : open ? category.color : colors.inkMuted}
          />
        ) : null}
      </Pressable>
    </View>
  );
}

/**
 * The opened category's bills, laid out as grid cells in the same columns as
 * the categories above.
 *
 * Sits on a light grey wash spanning the full width, which is what marks the
 * block as "inside" the category that was tapped — no border, no header, and
 * no colour tint competing with the category cells. Short final rows are
 * padded so the wash stays rectangular.
 */
function BillRows({
  category,
  bills,
  selectedId,
  onSelect,
}: {
  category: GridCategory;
  bills: readonly GridDestination[];
  selectedId: string | null;
  onSelect: (billId: string) => void;
}) {
  const { colors } = useTheme();
  const remainder = bills.length % COLUMNS;
  const padding = remainder === 0 ? 0 : COLUMNS - remainder;

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', backgroundColor: colors.surfaceSunken }}>
      {bills.map((bill) => {
        const chosen = bill.id === selectedId;
        return (
          <View key={bill.id} style={{ width: `${100 / COLUMNS}%` }}>
            <Pressable
              onPress={() => onSelect(bill.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: chosen }}
              accessibilityLabel={bill.name}
              style={({ pressed }) => ({
                height: 82,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                paddingHorizontal: 4,
                borderRightWidth: 1,
                borderBottomWidth: 1,
                borderColor: colors.hairline,
                backgroundColor: chosen
                  ? category.color
                  : pressed
                    ? colors.hairline
                    : 'transparent',
              })}
            >
              <T
                variant="caption"
                color={chosen ? colors.inkInverse : colors.ink}
                numberOfLines={2}
                style={{
                  fontWeight: chosen ? '700' : '600',
                  textAlign: 'center',
                  width: '100%',
                  lineHeight: 13,
                }}
              >
                {bill.name}
              </T>
              <T
                variant="caption"
                color={chosen ? colors.inkInverse : colors.inkMuted}
                style={{ fontSize: 10 }}
              >
                {formatMoney(bill.plannedMinor, { compact: true })}
              </T>
            </Pressable>
          </View>
        );
      })}

      {Array.from({ length: padding }, (_, i) => (
        <View
          key={`bill-pad-${i}`}
          style={{
            width: `${100 / COLUMNS}%`,
            height: 82,
            borderRightWidth: 1,
            borderBottomWidth: 1,
            borderColor: colors.hairline,
          }}
        />
      ))}
    </View>
  );
}

/** The trailing "New line" cell, sized like any category cell. */
function ExtraCell({
  tile,
}: {
  tile: { label: string; icon: keyof typeof Ionicons.glyphMap; selected: boolean; onPress: () => void };
}) {
  const { colors } = useTheme();
  return (
    <View style={{ width: `${100 / COLUMNS}%` }}>
      <Pressable
        onPress={tile.onPress}
        accessibilityRole="button"
        accessibilityState={{ selected: tile.selected }}
        accessibilityLabel={tile.label}
        style={({ pressed }) => ({
          height: 82,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 5,
          borderRightWidth: 1,
          borderBottomWidth: 1,
          borderColor: colors.hairline,
          backgroundColor: tile.selected
            ? colors.accentSoft
            : pressed
              ? colors.surfaceSunken
              : colors.surface,
        })}
      >
        <Ionicons
          name={tile.icon}
          size={17}
          color={tile.selected ? colors.accent : colors.inkMuted}
        />
        <T
          variant="caption"
          color={tile.selected ? colors.accent : colors.inkMuted}
          numberOfLines={1}
          style={{ fontWeight: '600' }}
        >
          {tile.label}
        </T>
      </Pressable>
    </View>
  );
}

/** An empty cell, keeping the grid rectangular where a block doesn't divide. */
function FillerCell({ tinted }: { tinted?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: `${100 / COLUMNS}%`,
        height: 82,
        borderRightWidth: 1,
        borderBottomWidth: 1,
        borderColor: colors.hairline,
        backgroundColor: tinted ? colors.surfaceSunken : colors.surface,
      }}
    />
  );
}
