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
  const { colors, radius, space } = useTheme();
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

  // The extra tile only starts a row of its own when the categories already
  // filled the last one; otherwise it slots into the short final row.
  const hasTrailingExtraRow = Boolean(extraTile) && shown.length % COLUMNS === 0;

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
          borderWidth: 1,
          borderColor: colors.hairline,
          borderRadius: radius.md,
          // Clips the cells' own square corners to the rounded frame, so the
          // outer shape reads as one card rather than a grid of squares.
          overflow: 'hidden',
        }}
      >
        {rows.map((row, rowIndex) => {
          const openInRow = row.find((category) => category.id === openId) ?? null;

          /*
           * Which element closes the grid decides who omits a bottom border —
           * the container's frame already draws that edge, and a cell border
           * there too would stack two 1px lines and look thicker.
           *
           * The closing element is: the trailing extra-tile row if one exists,
           * else this row's expanded bills if it has any, else the last row.
           */
          const isFinalRow = rowIndex === rows.length - 1 && !hasTrailingExtraRow;
          const rowClosesGrid = isFinalRow && !openInRow;
          const billsCloseGrid = isFinalRow && Boolean(openInRow);

          return (
            <React.Fragment key={`row-${rowIndex}`}>
              <View style={{ flexDirection: 'row' }}>
                {row.map((category, columnIndex) => (
                  <CategoryCell
                    key={category.id}
                    category={category}
                    expandable={billsOf(category.id).length > 1}
                    open={openId === category.id}
                    selected={selectedCategoryId === category.id}
                    onPress={() => press(category)}
                    lastInRow={columnIndex === COLUMNS - 1}
                    lastRow={rowClosesGrid}
                  />
                ))}

                {/* Only the final row can be short; pad it so the frame stays
                    rectangular. Rows above are always full. */}
                {row.length < COLUMNS && !extraTile
                  ? Array.from({ length: COLUMNS - row.length }, (_, i) => (
                      <FillerCell
                        key={`tail-${rowIndex}-${i}`}
                        lastInRow={row.length + i === COLUMNS - 1}
                        lastRow={rowClosesGrid}
                      />
                    ))
                  : null}

                {row.length < COLUMNS && extraTile && rowIndex === rows.length - 1 ? (
                  <>
                    <ExtraCell
                      tile={extraTile}
                      lastInRow={row.length === COLUMNS - 1}
                      lastRow={rowClosesGrid}
                    />
                    {Array.from({ length: COLUMNS - row.length - 1 }, (_, i) => (
                      <FillerCell
                        key={`tail-extra-${i}`}
                        lastInRow={row.length + 1 + i === COLUMNS - 1}
                        lastRow={rowClosesGrid}
                      />
                    ))}
                  </>
                ) : null}
              </View>

              {/* The opened category's bills, full width, directly beneath the
                  row they belong to. */}
              {openInRow ? (
                <BillRows
                  category={openInRow}
                  bills={billsOf(openInRow.id)}
                  selectedId={selectedId}
                  lastRow={billsCloseGrid}
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
        {hasTrailingExtraRow && extraTile ? (
          <View style={{ flexDirection: 'row' }}>
            <ExtraCell tile={extraTile} lastInRow={false} lastRow />
            {Array.from({ length: COLUMNS - 1 }, (_, i) => (
              <FillerCell key={`extra-pad-${i}`} lastInRow={i === COLUMNS - 2} lastRow />
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
  lastInRow,
  lastRow,
}: {
  category: GridCategory;
  expandable: boolean;
  open: boolean;
  selected: boolean;
  onPress: () => void;
  /** Omit the right border — the container's frame supplies that edge. */
  lastInRow: boolean;
  /** Omit the bottom border for the same reason. */
  lastRow: boolean;
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
          // Only internal separators: the container draws the outer frame, so a
          // border here as well would stack two 1px lines on the last row and
          // column and read as a thicker edge.
          borderRightWidth: lastInRow ? 0 : 1,
          borderBottomWidth: lastRow ? 0 : 1,
          borderColor: colors.hairline,
          backgroundColor: selected
            ? category.color
            : open
              ? `${category.color}0F`
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
  lastRow,
}: {
  category: GridCategory;
  bills: readonly GridDestination[];
  selectedId: string | null;
  onSelect: (billId: string) => void;
  /** True when this block closes the grid, so it drops its bottom border. */
  lastRow?: boolean;
}) {
  const { colors, radius, space } = useTheme();

  return (
    <View
      style={{
        // The same wash the open category cell uses, so the block and the cell
        // above it read as one continuous piece rather than two surfaces.
        backgroundColor: `${category.color}0F`,
        borderBottomWidth: lastRow ? 0 : 1,
        borderColor: colors.hairline,
        // Inset so the opened bills sit *within* the grey block rather than
        // butting against the grid frame — the padding is what makes the
        // expansion read as contained by its category.
        padding: space.sm,
      }}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {bills.map((bill) => {
        const chosen = bill.id === selectedId;
        return (
          <View key={bill.id} style={{ width: `${100 / COLUMNS}%`, padding: 3 }}>
            <Pressable
              onPress={() => onSelect(bill.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: chosen }}
              accessibilityLabel={bill.name}
              style={({ pressed }) => ({
                height: 74,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                paddingHorizontal: 4,
                borderRadius: radius.sm,
                borderWidth: 1,
                borderColor: chosen ? category.color : colors.hairline,
                backgroundColor: chosen
                  ? category.color
                  : pressed
                    ? colors.hairline
                    : colors.surface,
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

      </View>
    </View>
  );
}

/** The trailing "New line" cell, sized like any category cell. */
function ExtraCell({
  tile,
  lastInRow,
  lastRow,
}: {
  tile: { label: string; icon: keyof typeof Ionicons.glyphMap; selected: boolean; onPress: () => void };
  lastInRow: boolean;
  lastRow: boolean;
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
          borderRightWidth: lastInRow ? 0 : 1,
          borderBottomWidth: lastRow ? 0 : 1,
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
function FillerCell({
  tinted,
  lastInRow,
  lastRow,
}: {
  tinted?: boolean;
  lastInRow?: boolean;
  lastRow?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: `${100 / COLUMNS}%`,
        height: 82,
        borderRightWidth: lastInRow ? 0 : 1,
        borderBottomWidth: lastRow ? 0 : 1,
        borderColor: colors.hairline,
        backgroundColor: tinted ? colors.surfaceSunken : colors.surface,
      }}
    />
  );
}
