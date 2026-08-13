import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { LayoutAnimation, Platform, Pressable, ScrollView, UIManager, View } from 'react-native';
import { Divider, FOOTER_CLEARANCE, GradientButton, PinnedFooter, Row, StepHeader, Surface, Text } from '../../src/components/ui';
import { ONBOARDING_CATALOG, type CatalogCategory } from '../../src/data/categoryCatalog';
import { hydrateOnboardingDraft, useOnboardingDraft } from '../../src/store/useOnboardingDraft';
import { useTheme } from '../../src/theme/ThemeProvider';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/**
 * How long the expand/collapse transition runs.
 *
 * Shared by the `LayoutAnimation` and the scroll that follows it — the scroll
 * has to measure AFTER the animation settles, so these two cannot drift apart.
 */
const EXPAND_ANIMATION_MS = 200;

/**
 * The height a collapsed category block settles at.
 *
 * Its header row is a 40px icon tile with `space.lg` of padding above and below,
 * inside a 1px-bordered Surface — 40 + 32 + 2. Used to predict how far the list
 * rises when an open block closes, so the scroll can start on the same frame as
 * the expansion instead of waiting for it to finish.
 *
 * An estimate, and deliberately so: it only has to be close enough that the
 * scroll lands within a few pixels, and the ScrollView clamps anything past the
 * end. Restyling that header row is the one thing that would drift it.
 */
const COLLAPSED_BLOCK_HEIGHT = 74;

/**
 * Onboarding step 2: choose which categories apply, and inside each, which
 * lines you actually have.
 *
 * Tapping a category expands it in place to reveal its subcategories, which
 * are then added individually — the "add to cart" pattern the user asked for.
 * Selections live in a draft store rather than the database: nothing is
 * written until step 3 is confirmed, so backing out of onboarding leaves no
 * half-built plan behind.
 */
export default function OnboardingCategoriesScreen() {
  const { colors, space } = useTheme();
  const router = useRouter();

  // Reloads an interrupted setup on whichever step the user re-enters on.
  useState(hydrateOnboardingDraft);
  const draft = useOnboardingDraft();
  const [expanded, setExpanded] = useState<string | null>(ONBOARDING_CATALOG[0]?.id ?? null);

  const pickedCount = draft.picked.size;

  /*
   * Scrolling an opened category up so its lines are actually on screen.
   *
   * A category near the bottom expands downwards into space that is already
   * off-screen, so tapping "Transport" opened a list the user then had to go
   * looking for — the tap appeared to do nothing.
   *
   * ## Predicting the target rather than waiting to measure it
   *
   * Two things move between the tap and the settled layout: the previously-open
   * category collapses, and the tapped one expands. So the block's CURRENT `y`
   * is not where it will end up — a cached or freshly-read offset scrolls too
   * far and cuts the card's header off the top.
   *
   * Waiting out the 200ms expansion and measuring afterwards gets the number
   * right, but stages the motion: the list expands, stops, and only then
   * scrolls. Two animations back to back read as a lurch.
   *
   * Instead the destination is COMPUTED from the pre-tap geometry — the tapped
   * block's offset, minus the height the closing block above it is about to
   * give up — and the scroll starts on the same frame as the expansion. Both
   * animations run together over the same 200ms, so the card glides into place
   * as it opens. The prediction only has to be right about blocks ABOVE the
   * target, which is exactly what `measureLayout` already tells us.
   */
  const scrollRef = React.useRef<ScrollView>(null);
  const contentRef = React.useRef<View>(null);
  const blockRefs = React.useRef(new Map<string, View | null>());

  /** A block's current offset and height within the scroll content. */
  function measureBlock(id: string): Promise<{ y: number; height: number } | null> {
    return new Promise((resolve) => {
      const node = blockRefs.current.get(id);
      const content = contentRef.current;
      if (!node || !content) return resolve(null);

      node.measureLayout(
        content,
        (_x, y, _width, height) => resolve({ y, height }),
        () => resolve(null),
      );
    });
  }

  async function toggleExpanded(id: string) {
    const isOpening = expanded !== id;
    const closingId = expanded;

    /*
     * Measured BEFORE the state change, so these are the pre-tap positions the
     * prediction below is built from.
     */
    const [target, closing] = isOpening
      ? await Promise.all([
          measureBlock(id),
          closingId && closingId !== id ? measureBlock(closingId) : Promise.resolve(null),
        ])
      : [null, null];

    LayoutAnimation.configureNext(
      LayoutAnimation.create(EXPAND_ANIMATION_MS, 'easeInEaseOut', 'opacity'),
    );
    setExpanded((current) => (current === id ? null : id));

    // Only on the way OPEN. Scrolling on collapse would yank the list away from
    // whatever the user was about to tap next.
    if (!isOpening || !target) return;

    /*
     * How far the target rides up when the open block above it collapses.
     *
     * Only blocks ABOVE the target shift it, so a category open further down
     * the list changes nothing. `COLLAPSED_BLOCK_HEIGHT` is what the closing
     * block shrinks TO, so the difference is the space it releases.
     */
    const shift =
      closing && closing.y < target.y ? Math.max(0, closing.height - COLLAPSED_BLOCK_HEIGHT) : 0;

    // A little breathing room, so the card sits below the pinned header rather
    // than flush against it.
    scrollRef.current?.scrollTo({
      y: Math.max(0, target.y - shift - space.sm),
      animated: true,
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
    <StepHeader step={3} title="What do you spend on?" onBack={() => router.back()}>
      Tap a category to open it, then pick the lines you actually have.
      You'll set amounts next.
    </StepHeader>

    <ScrollView
      ref={scrollRef}
      style={{ flex: 1 }}
      contentContainerStyle={{
        // Clears the pinned footer, which overlays this list. See FOOTER_CLEARANCE.
        paddingBottom: space.lg + FOOTER_CLEARANCE,
        paddingHorizontal: space.lg,
        gap: space.lg,
      }}
      showsVerticalScrollIndicator={false}
    >
      {/* The measurement origin for `measureLayout` — the scroll content
          itself, so a block's reported `y` is already a scroll offset. */}
      <View ref={contentRef} collapsable={false} style={{ gap: space.sm }}>
        {ONBOARDING_CATALOG.map((category) => (
          <View
            key={category.id}
            // `collapsable={false}` keeps this View in the native hierarchy on
            // Android; without it the wrapper is optimised away and there is
            // nothing left to measure.
            collapsable={false}
            ref={(node) => {
              blockRefs.current.set(category.id, node);
            }}
          >
            <CategoryBlock
              category={category}
              expanded={expanded === category.id}
              onToggleExpanded={() => toggleExpanded(category.id)}
              picked={draft.picked}
              onTogglePick={draft.toggle}
              onPickAll={draft.pickAll}
            />
          </View>
        ))}
      </View>

    </ScrollView>

    <PinnedFooter>
      <View style={{ gap: space.sm }}>
        <Row justify="center">
          <Text variant="caption" tone="muted">
            {pickedCount === 0
              ? 'Pick at least one line to continue'
              : `${pickedCount} line${pickedCount === 1 ? '' : 's'} selected`}
          </Text>
        </Row>
        <GradientButton
          label="Continue"
          icon="arrow-forward"
          onPress={() => router.push('/onboarding/plan')}
          disabled={pickedCount === 0}
        />
      </View>
    </PinnedFooter>
    </View>
  );
}

/** One catalog category: a header that expands to reveal its lines. */
function CategoryBlock({
  category,
  expanded,
  onToggleExpanded,
  picked,
  onTogglePick,
  onPickAll,
}: {
  category: CatalogCategory;
  expanded: boolean;
  onToggleExpanded: () => void;
  picked: ReadonlySet<string>;
  onTogglePick: (id: string) => void;
  onPickAll: (ids: string[], select: boolean) => void;
}) {
  const { colors, radius, space } = useTheme();

  const ids = useMemo(
    () => category.subcategories.map((subcategory) => subcategory.id),
    [category],
  );
  const selectedCount = ids.filter((id) => picked.has(id)).length;
  const allSelected = selectedCount === ids.length;

  return (
    <Surface padded={false} style={{ overflow: 'hidden' }}>
      <Pressable
        onPress={onToggleExpanded}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${category.name}, ${selectedCount} of ${ids.length} selected`}
        style={({ pressed }) => ({
          padding: space.lg,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <Row gap={space.md}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: radius.md,
              backgroundColor: selectedCount > 0 ? category.color : `${category.color}1F`,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons
              name={category.icon}
              size={20}
              color={selectedCount > 0 ? '#FFFFFF' : category.color}
            />
          </View>

          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">{category.name}</Text>
            <Text variant="caption" tone="muted">
              {selectedCount > 0 ? `${selectedCount} selected` : category.blurb}
            </Text>
          </View>

          {selectedCount > 0 ? (
            <View
              style={{
                minWidth: 24,
                height: 24,
                paddingHorizontal: 7,
                borderRadius: 12,
                backgroundColor: category.color,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text variant="caption" color="#FFFFFF" style={{ fontWeight: '800' }}>
                {selectedCount}
              </Text>
            </View>
          ) : null}

          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.inkMuted}
          />
        </Row>
      </Pressable>

      {expanded ? (
        <View>
          <Divider />
          <View style={{ padding: space.md, gap: space.xs }}>
            <Row justify="flex-end" style={{ paddingHorizontal: space.sm }}>
              <Pressable
                onPress={() => onPickAll(ids, !allSelected)}
                accessibilityRole="button"
                hitSlop={8}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <Text variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
                  {allSelected ? 'Clear all' : 'Select all'}
                </Text>
              </Pressable>
            </Row>

            {category.subcategories.map((subcategory) => {
              const isPicked = picked.has(subcategory.id);
              return (
                <Pressable
                  key={subcategory.id}
                  onPress={() => onTogglePick(subcategory.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isPicked }}
                  accessibilityLabel={subcategory.name}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                    paddingVertical: 11,
                    paddingHorizontal: space.sm,
                    borderRadius: radius.md,
                    backgroundColor: isPicked ? `${category.color}14` : 'transparent',
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Ionicons
                    name={subcategory.icon}
                    size={17}
                    color={isPicked ? category.color : colors.inkMuted}
                  />
                  <Text
                    variant="small"
                    tone={isPicked ? 'ink' : 'secondary'}
                    style={{ flex: 1, fontWeight: isPicked ? '700' : '500' }}
                  >
                    {subcategory.name}
                  </Text>
                  {subcategory.type === 'income' ? (
                    <Text variant="caption" color={colors.completed}>
                      income
                    </Text>
                  ) : null}
                  <Ionicons
                    name={isPicked ? 'checkmark-circle' : 'add-circle-outline'}
                    size={21}
                    color={isPicked ? category.color : colors.inkMuted}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </Surface>
  );
}
