import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { LayoutAnimation, Platform, Pressable, ScrollView, UIManager, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Divider, GradientButton, Label, Row, Surface, T } from '../../src/components/ui';
import { CATEGORY_CATALOG, type CatalogCategory } from '../../src/data/categoryCatalog';
import { useOnboardingDraft } from '../../src/store/useOnboardingDraft';
import { useTheme } from '../../src/theme/ThemeProvider';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const draft = useOnboardingDraft();
  const [expanded, setExpanded] = useState<string | null>(CATEGORY_CATALOG[0]?.id ?? null);

  const pickedCount = draft.picked.size;

  function toggleExpanded(id: string) {
    LayoutAnimation.configureNext(LayoutAnimation.create(200, 'easeInEaseOut', 'opacity'));
    setExpanded((current) => (current === id ? null : id));
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={{
        paddingTop: insets.top + space.lg,
        paddingBottom: insets.bottom + space.xl,
        paddingHorizontal: space.lg,
        gap: space.lg,
      }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ gap: 2 }}>
        <Label>STEP 2 OF 3</Label>
        <T variant="title">What do you spend on?</T>
        <T variant="small" tone="muted">
          Tap a category to open it, then pick the lines you actually have.
          You'll set amounts next.
        </T>
      </View>

      <View style={{ gap: space.sm }}>
        {CATEGORY_CATALOG.map((category) => (
          <CategoryBlock
            key={category.id}
            category={category}
            expanded={expanded === category.id}
            onToggleExpanded={() => toggleExpanded(category.id)}
            picked={draft.picked}
            onTogglePick={draft.toggle}
            onPickAll={draft.pickAll}
          />
        ))}
      </View>

      <View style={{ gap: space.sm }}>
        <Row justify="center">
          <T variant="caption" tone="muted">
            {pickedCount === 0
              ? 'Pick at least one line to continue'
              : `${pickedCount} line${pickedCount === 1 ? '' : 's'} selected`}
          </T>
        </Row>
        <GradientButton
          label="Continue"
          icon="arrow-forward"
          onPress={() => router.push('/onboarding/plan')}
          disabled={pickedCount === 0}
        />
      </View>
    </ScrollView>
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
            <T variant="bodyStrong">{category.name}</T>
            <T variant="caption" tone="muted">
              {selectedCount > 0 ? `${selectedCount} selected` : category.blurb}
            </T>
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
              <T variant="caption" color="#FFFFFF" style={{ fontWeight: '800' }}>
                {selectedCount}
              </T>
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
                <T variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
                  {allSelected ? 'Clear all' : 'Select all'}
                </T>
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
                  <T
                    variant="small"
                    tone={isPicked ? 'ink' : 'secondary'}
                    style={{ flex: 1, fontWeight: isPicked ? '700' : '500' }}
                  >
                    {subcategory.name}
                  </T>
                  {subcategory.type === 'income' ? (
                    <T variant="caption" color={colors.completed}>
                      income
                    </T>
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
