import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Alert, Pressable, View } from 'react-native';
import { formatMoney } from '~/shared/lib/money';
import { DEFAULT_CATEGORY_ICON, suggestCategoryIcon } from '~/shared/data/categoryIcons';
import { useAppStore } from '~/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { washFor } from '~/shared/theme';
import { AccountField } from '~/features/accounts/components/AccountPicker';
import { BillFields, useBillDraft } from './BillFields';
import { DayPicker } from './DayPicker';
import { IconPicker, NameWithIconField } from '~/shared/components/forms';
import { BottomSheet, Button, GradientButton, Row, Text } from '~/shared/components/ui';

/**
 * Manage the plan's structure — categories and the bills inside them — without
 * leaving whatever screen opened it.
 *
 * Reached from the category grid's trailing tile. The grid is where a user
 * already thinks about "which category", so it is also where they notice one is
 * missing, misnamed, or no longer wanted; sending them to a different tab to fix
 * it loses the transaction they were part-way through logging.
 *
 * Three modes in one sheet, because they are the same task at different depths:
 * a browsable list, an editor for one category, and an editor for one bill. The
 * list is the root, and both editors return to it, so the sheet never becomes a
 * stack the user has to unwind.
 *
 * The list stays short: categories are collapsed until tapped, one open at a
 * time. Each row offers exactly two actions — tap to expand, pencil to edit —
 * rather than a pencil/trash pair on every row and bill, which turned the sheet
 * into a wall of identical icons with no obvious primary action. Deleting is
 * reached from inside the relevant editor, where a labelled button can say what
 * it will remove.
 */
type Mode =
  | { kind: 'list' }
  | { kind: 'category'; id: string | null }
  | { kind: 'line'; id: string | null; categoryId: string };

/**
 * What an editor contributes to the one shared sheet: its header, its pinned
 * footer, and its fields. The editors are hooks returning this rather than
 * components rendering their own `BottomSheet`, because every `BottomSheet`
 * wraps a native `<Modal>` — swapping between two of them dismisses one and
 * presents the other, which the OS animates as the sheet closing and reopening.
 */
/**
 * Width of every row's leading slot — the category's icon tile, and the dot or
 * plus that marks a bill beneath it. Shared so both indent to the same column.
 */
const ROW_ICON = 34;

interface EditorChrome {
  title: string;
  eyebrow: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  footer: React.ReactNode;
  body: React.ReactNode;
}

export function ManagePlanSheet({
  visible,
  onClose,
  onSelectLine,
  selectedLineId = null,
}: {
  visible: boolean;
  onClose: () => void;
  /**
   * Turns the sheet into a PICKER as well as an editor.
   *
   * When given, tapping a bill row selects it rather than opening its editor,
   * and a "Save selection" button appears in the footer to hand the chosen id
   * back. The caller is a screen that has a destination to correct — the SMS
   * review screen, whose suggested category can be wrong — and the fix and the
   * correction are the same gesture from the user's side: find the right line,
   * creating or renaming one on the way if that is what it takes.
   *
   * Editing stays reachable throughout via each row's pencil, so the sheet does
   * not become two different controls depending on who opened it.
   */
  onSelectLine?: (subcategoryId: string) => void;
  /** The line already chosen by the caller, shown ticked on open. */
  selectedLineId?: string | null;
}) {
  const { colors, radius, space, mode: themeMode } = useTheme();
  const state = useAppStore();
  const [mode, setMode] = React.useState<Mode>({ kind: 'list' });
  /** Which category is showing its bills. One at a time keeps the list short. */
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const picking = Boolean(onSelectLine);
  /**
   * The pending pick, confirmed with "Save selection".
   *
   * Held here rather than pushed straight to the caller so choosing is
   * reversible: the user can tap through several lines, and nothing changes on
   * the screen behind until they commit.
   */
  const [pendingLineId, setPendingLineId] = React.useState<string | null>(selectedLineId);

  // Always reopen at the list — a sheet that resumes mid-edit from last time is
  // disorienting, and the draft state below is seeded per open anyway.
  React.useEffect(() => {
    if (visible) {
      setMode({ kind: 'list' });
      // Open on the category holding the current pick, so the line the caller
      // already has is on screen rather than behind a collapsed row.
      const current = selectedLineId
        ? state.subcategories.find((sub) => sub.id === selectedLineId)
        : undefined;
      setExpandedId(current?.categoryId ?? null);
      setPendingLineId(selectedLineId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, selectedLineId]);

  const categories = state.categories;
  const linesOf = (categoryId: string) =>
    state.subcategories.filter((sub) => sub.categoryId === categoryId);

  function confirmDeleteCategory(id: string, name: string) {
    const lines = linesOf(id);
    // `deleteCategory` refuses outright when a loan line lives here, so say why
    // rather than showing a confirm whose Delete would silently do nothing.
    const holdsLoan = lines.some((line) => line.loanId);
    if (holdsLoan) {
      Alert.alert(
        'Remove the loan first',
        `“${name}” holds a loan installment. Delete the loan from the Loans tab — that removes its bill here too.`,
      );
      return;
    }

    Alert.alert(
      `Delete “${name}”?`,
      lines.length > 0
        ? `This also removes its ${lines.length} ${lines.length === 1 ? 'bill' : 'bills'} and their logged history.`
        : 'This category has no bills yet.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            // The pre-check above should have caught a refusal, but the store is
            // the authority — report rather than closing on a delete that
            // did not happen.
            const result = state.deleteCategory(id);
            if (!result.ok) {
              Alert.alert('Remove the loan first', result.reason);
              return;
            }
            setMode({ kind: 'list' });
          },
        },
      ],
    );
  }

  function confirmDeleteLine(id: string, name: string, loanId: string | null) {
    if (loanId) {
      Alert.alert(
        'Remove the loan instead',
        `“${name}” is a loan installment. Delete the loan from the Loans tab so the debt and its bill go together.`,
      );
      return;
    }

    Alert.alert(`Delete “${name}”?`, 'Its logged history goes with it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          state.deleteSubcategory(id);
          setMode({ kind: 'list' });
        },
      },
    ]);
  }

  /** Zero-arg, for the category editor and every Cancel/Back. */
  const backToList: () => void = () => setMode({ kind: 'list' });

  /**
   * Return to the list after a bill was saved, carrying it into the selection.
   *
   * Only while picking: outside that mode there is no selection for a save to
   * land in, and quietly marking a row would imply a choice the user has not
   * been asked to make.
   */
  const lineSaved = (savedLineId: string) => {
    if (picking) {
      setPendingLineId(savedLineId);
      const saved = state.subcategories.find((sub) => sub.id === savedLineId);
      if (saved) setExpandedId(saved.categoryId);
    }
    setMode({ kind: 'list' });
  };

  // Both editors are evaluated every render — hooks cannot be called
  // conditionally — and the active mode picks which chrome is used. They only
  // read store state and seed local drafts, so the unused one costs nothing.
  const editingCategory =
    mode.kind === 'category' && mode.id ? categories.find((c) => c.id === mode.id) : undefined;
  const categoryChrome = useCategoryEditor({
    categoryId: mode.kind === 'category' ? mode.id : null,
    onCancel: backToList,
    onDone: backToList,
    onDelete: editingCategory
      ? () => confirmDeleteCategory(editingCategory.id, editingCategory.name)
      : undefined,
  });

  const editingLine =
    mode.kind === 'line' && mode.id
      ? state.subcategories.find((s) => s.id === mode.id)
      : undefined;
  const lineChrome = useLineEditor({
    lineId: mode.kind === 'line' ? mode.id : null,
    categoryId: mode.kind === 'line' ? mode.categoryId : (categories[0]?.id ?? ''),
    onCancel: backToList,
    onDone: lineSaved,
    onDelete: editingLine
      ? () => confirmDeleteLine(editingLine.id, editingLine.name, editingLine.loanId)
      : undefined,
  });

  const active: EditorChrome =
    mode.kind === 'category'
      ? categoryChrome
      : mode.kind === 'line'
        ? lineChrome
        : {
            title: picking ? 'Pick a category' : 'Manage plan',
            eyebrow: 'Categories & bills',
            icon: 'options-outline',
            /*
             * Picking mode leads with the commit, because that is the task the
             * user came to finish; "New category" stays reachable beside it,
             * since the right line not existing yet is exactly the case that
             * sent them here. Disabled until something is picked, so the button
             * never returns the caller's original wrong answer.
             */
            footer: picking ? (
              <Row gap={space.sm}>
                <View style={{ flex: 1 }}>
                  <Button
                    label="New category"
                    icon="add"
                    variant="secondary"
                    onPress={() => setMode({ kind: 'category', id: null })}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <GradientButton
                    label="Save selection"
                    icon="checkmark"
                    disabled={!pendingLineId}
                    onPress={() => {
                      if (pendingLineId) onSelectLine!(pendingLineId);
                    }}
                  />
                </View>
              </Row>
            ) : (
              <GradientButton
                label="New category"
                icon="add"
                onPress={() => setMode({ kind: 'category', id: null })}
              />
            ),
            body: null,
          };

  // One sheet for all three modes, so moving between the list and an editor
  // swaps content inside the presented modal instead of dismissing it.
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={active.title}
      eyebrow={active.eyebrow}
      icon={active.icon}
      iconColor={active.iconColor ?? colors.accent}
      scroll
      footer={active.footer}
    >
      {mode.kind !== 'list' ? (
        active.body
      ) : (
        <>
      {categories.length === 0 ? (
        <Text variant="small" tone="muted">
          No categories yet. Create one to start building the plan.
        </Text>
      ) : (
        <Text variant="caption" tone="muted">
          {picking
            ? 'Tap a category to see its bills, then tap the right one. The pencil edits a row.'
            : 'Tap a category to see its bills. Tap any row to edit it.'}
        </Text>
      )}

      {/* One collapsed row per category, expanding in place. Showing every
          category's bills at once buried the list in dozens of rows before the
          user had said which one they came for. */}
      <View style={{ gap: space.sm }}>
        {categories.map((category) => {
          const lines = linesOf(category.id);
          const open = expandedId === category.id;
          const tint = category.color;
          const planned = lines.reduce((sum, line) => sum + line.plannedMinor, 0);

          return (
            <View
              key={category.id}
              style={{
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: open ? tint : colors.hairline,
                backgroundColor: colors.surface,
                overflow: 'hidden',
              }}
            >
              {/* Header and bill rows share one column grid — a leading 34px
                  slot, the flexible middle, then a fixed edit button. Every row
                  therefore lines up down the card, which is what the previous
                  passes lacked: the header and its contents were built from
                  unrelated layouts and never aligned. */}
              <Row gap={0}>
                <Pressable
                  onPress={() => setExpandedId(open ? null : category.id)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityLabel={`${category.name}, ${lines.length} bills`}
                  style={({ pressed }) => ({
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.sm,
                    paddingVertical: 10,
                    paddingLeft: space.md,
                    backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
                  })}
                >
                  <View
                    style={{
                      width: ROW_ICON,
                      height: ROW_ICON,
                      borderRadius: radius.sm,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: washFor(tint, themeMode),
                    }}
                  >
                    <Ionicons
                      name={(category.icon ?? 'albums-outline') as never}
                      size={17}
                      color={tint}
                    />
                  </View>

                  <View style={{ flex: 1, gap: 1 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {category.name}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {lines.length === 0
                        ? 'No bills yet'
                        : `${lines.length} ${lines.length === 1 ? 'bill' : 'bills'} · ${formatMoney(planned, { compact: true })}`}
                    </Text>
                  </View>

                  <Ionicons
                    name={open ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colors.inkMuted}
                  />
                </Pressable>

                <RowEdit
                  label={`Edit ${category.name}`}
                  onPress={() => setMode({ kind: 'category', id: category.id })}
                />
              </Row>

              {open ? (
                <View style={{ borderTopWidth: 1, borderTopColor: colors.hairline }}>
                  {lines.length === 0 ? (
                    <Text
                      variant="caption"
                      tone="muted"
                      style={{ paddingVertical: 12, paddingHorizontal: space.md }}
                    >
                      No bills in {category.name} yet.
                    </Text>
                  ) : null}

                  {lines.map((line, index) => (
                    <Row key={line.id} gap={0}>
                      <Pressable
                        onPress={() =>
                          picking
                            ? setPendingLineId(line.id)
                            : setMode({ kind: 'line', id: line.id, categoryId: category.id })
                        }
                        accessibilityRole={picking ? 'radio' : 'button'}
                        accessibilityState={
                          picking ? { selected: pendingLineId === line.id } : undefined
                        }
                        accessibilityLabel={`${line.name}, ${formatMoney(line.plannedMinor)}`}
                        style={({ pressed }) => ({
                          flex: 1,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: space.sm,
                          paddingVertical: 10,
                          paddingLeft: space.md,
                          borderTopWidth: index === 0 ? 0 : 1,
                          borderTopColor: colors.hairline,
                          backgroundColor: pressed
                            ? colors.surfaceSunken
                            : picking && pendingLineId === line.id
                              ? washFor(tint, themeMode)
                              : 'transparent',
                        })}
                      >
                        {/* A dot in the leading slot, centred in the same width
                            the category's icon occupies — so bills indent under
                            it without needing a separate rail. */}
                        <View style={{ width: ROW_ICON, alignItems: 'center' }}>
                          {/* The picked row swaps its dot for a tick, in the
                              same slot — the selection reads without the list
                              reflowing as it moves between rows. */}
                          {picking && pendingLineId === line.id ? (
                            <Ionicons name="checkmark-circle" size={18} color={tint} />
                          ) : (
                            <View
                              style={{
                                width: 7,
                                height: 7,
                                borderRadius: 4,
                                backgroundColor: tint,
                              }}
                            />
                          )}
                        </View>

                        <Text variant="small" numberOfLines={1} style={{ flex: 1 }}>
                          {line.name}
                        </Text>

                        {line.loanId ? (
                          <Ionicons name="trending-down" size={12} color={colors.inkMuted} />
                        ) : null}
                        <Text variant="small" tone="secondary">
                          {formatMoney(line.plannedMinor)}
                        </Text>
                      </Pressable>

                      <RowEdit
                        label={`Edit ${line.name}`}
                        onPress={() =>
                          setMode({ kind: 'line', id: line.id, categoryId: category.id })
                        }
                        dividerAbove={index > 0}
                      />
                    </Row>
                  ))}

                  <Pressable
                    onPress={() => setMode({ kind: 'line', id: null, categoryId: category.id })}
                    accessibilityRole="button"
                    accessibilityLabel={`Add a bill to ${category.name}`}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.sm,
                      paddingVertical: 11,
                      paddingLeft: space.md,
                      borderTopWidth: 1,
                      borderTopColor: colors.hairline,
                      backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
                    })}
                  >
                    {/* Plus sits in the same leading slot as the dots above it. */}
                    <View style={{ width: ROW_ICON, alignItems: 'center' }}>
                      <Ionicons name="add" size={16} color={colors.accent} />
                    </View>
                    <Text variant="small" color={colors.accent} style={{ fontWeight: '700' }}>
                      Add a bill
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
        </>
      )}
    </BottomSheet>
  );
}

/**
 * The trailing edit button shared by category and bill rows.
 *
 * A fixed-width column at the end of every row, so the pencils line up down the
 * card and each row has exactly one obvious "change this" target. Bills carry it
 * too: tapping the row opens the same editor, but without the icon there was
 * nothing saying a bill could be edited at all.
 */
function RowEdit({
  label,
  onPress,
  dividerAbove,
}: {
  label: string;
  onPress: () => void;
  /** Continues the row divider across this column. */
  dividerAbove?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: 46,
        alignSelf: 'stretch',
        alignItems: 'center',
        justifyContent: 'center',
        borderTopWidth: dividerAbove ? 1 : 0,
        borderTopColor: colors.hairline,
        backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
      })}
    >
      <Ionicons name="pencil" size={15} color={colors.inkSecondary} />
    </Pressable>
  );
}

/**
 * Create or rename a category — the same fields as the standalone screen.
 *
 * Returns its chrome (title, footer, body) rather than rendering a `BottomSheet`
 * of its own. The parent owns the single sheet, so switching between the list
 * and an editor swaps content inside one native modal instead of dismissing one
 * and presenting another — which iOS animates as the sheet closing and
 * reopening.
 */
function useCategoryEditor({
  categoryId,
  onCancel,
  onDone,
  onDelete,
}: {
  /** Null when creating. */
  categoryId: string | null;
  onCancel: () => void;
  onDone: () => void;
  /** Absent while creating — there is nothing to delete yet. */
  onDelete?: () => void;
}): EditorChrome {
  const { colors, space } = useTheme();
  const state = useAppStore();
  const existing = categoryId ? state.categories.find((c) => c.id === categoryId) : undefined;

  const [name, setName] = React.useState(existing?.name ?? '');
  const [icon, setIcon] = React.useState<keyof typeof Ionicons.glyphMap>(
    (existing?.icon as keyof typeof Ionicons.glyphMap) ?? DEFAULT_CATEGORY_ICON,
  );
  const [iconTouched, setIconTouched] = React.useState(Boolean(existing));
  const [cardId, setCardId] = React.useState<string | null>(
    existing?.cardId ?? state.cards[0]?.id ?? null,
  );
  const [dueDay, setDueDay] = React.useState(existing?.dueDay ?? 1);

  /*
   * Re-seed whenever the edit target changes.
   *
   * This hook stays mounted for the sheet's whole life now that the parent owns
   * the single `BottomSheet`, so the `useState` initializers above run exactly
   * once. Without this, opening a second category would show the first one's
   * name — and saving would write it.
   *
   * Keyed on the id alone: re-running on the whole `existing` object would clear
   * the user's typing every time the store refreshed underneath them.
   */
  React.useEffect(() => {
    const target = categoryId
      ? state.categories.find((c) => c.id === categoryId)
      : undefined;
    setName(target?.name ?? '');
    setIcon((target?.icon as keyof typeof Ionicons.glyphMap) ?? DEFAULT_CATEGORY_ICON);
    setIconTouched(Boolean(target));
    setCardId(target?.cardId ?? state.cards[0]?.id ?? null);
    setDueDay(target?.dueDay ?? 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  function onNameChange(next: string) {
    setName(next);
    // Only suggest while creating: re-suggesting on an existing category would
    // silently replace an icon the user deliberately chose.
    if (!iconTouched) {
      const suggested = suggestCategoryIcon(next);
      if (suggested) setIcon(suggested);
    }
  }

  function save() {
    const trimmed = name.trim();
    if (!trimmed) return;

    if (existing) {
      state.updateCategory(existing.id, { name: trimmed, cardId, icon, dueDay });
    } else {
      state.addCategory({
        name: trimmed,
        cardId,
        icon,
        dueDay,
        sortOrder: state.categories.length,
      });
    }
    onDone();
  }

  return {
    title: existing ? 'Edit category' : 'New category',
    eyebrow: 'Manage plan',
    icon,
    footer: (
      <View style={{ gap: space.sm }}>
        <GradientButton
          label={existing ? 'Save changes' : 'Create category'}
          icon="checkmark"
          onPress={save}
          disabled={!name.trim()}
        />
        <Button label="Back" icon="arrow-back" variant="secondary" onPress={onCancel} />
      </View>
    ),
    body: (
      <>
      {/* No autoFocus: this field stays mounted for the sheet's whole life now,
          so it would fire once on the list and never again on a real edit. */}
      <NameWithIconField
        value={name}
        onChangeText={onNameChange}
        icon={icon}
        iconColor={colors.accent}
        placeholder="e.g. Home Expenses"
      />

      <IconPicker
        value={icon}
        onChange={(next) => {
          setIcon(next);
          setIconTouched(true);
        }}
        accent={colors.accent}
      />

      {state.cards.length > 0 ? (
        <AccountField
          label="Transfer money to"
          cards={state.cards}
          selectedId={cardId}
          onSelect={setCardId}
        />
      ) : (
        <Text variant="small" tone="muted">
          Add an account first to choose where this category's money goes.
        </Text>
      )}

      <DayPicker value={dueDay} onChange={setDueDay} />

      {/* Delete lives at the bottom of the editor rather than as a trash icon in
          the list: it is the most destructive action here, so it should take a
          deliberate trip into the thing being deleted, and a labelled button
          says what it does where a bare icon did not. */}
      {onDelete ? (
        <Button
          label="Delete this category"
          icon="trash-outline"
          variant="danger"
          onPress={onDelete}
        />
      ) : null}
      </>
    ),
  };
}

/** Create or edit one bill inside a category. See `useCategoryEditor`. */
function useLineEditor({
  lineId,
  categoryId,
  onCancel,
  onDone,
  onDelete,
}: {
  /** Null when creating. */
  lineId: string | null;
  categoryId: string;
  onCancel: () => void;
  /**
   * Called with the id of the line that was just written — the existing one on
   * an edit, the new one on a create. The picking caller uses it to make a bill
   * the user just built the pending selection, so creating the missing line and
   * choosing it is one gesture rather than two.
   */
  onDone: (savedLineId: string) => void;
  /** Absent while creating — there is nothing to delete yet. */
  onDelete?: () => void;
}): EditorChrome {
  const { colors, space } = useTheme();
  const state = useAppStore();
  const existing = lineId ? state.subcategories.find((s) => s.id === lineId) : undefined;
  const category = state.categories.find((c) => c.id === categoryId);

  // The same fields the plan list's "new bill in" sheet uses, so a bill created
  // here can be yearly, ongoing, or carry a saving plan — none of which the
  // earlier name-and-amount form could express.
  const draft = useBillDraft({
    existing,
    categoryDueDay: category?.dueDay,
    categoryCardId: category?.cardId,
    resetKey: lineId ?? `new:${categoryId}`,
  });

  function save() {
    if (!draft.canSave) return;
    const patch = draft.toPatch();

    if (existing) {
      state.updateSubcategory(existing.id, patch);
      onDone(existing.id);
    } else {
      const created = state.addSubcategory({ ...patch, categoryId });
      onDone(created.id);
    }
  }

  return {
    title: existing ? 'Edit bill' : 'New bill',
    eyebrow: category?.name ?? 'Manage plan',
    icon: 'pricetag-outline',
    iconColor: category?.color,
    footer: (
      <View style={{ gap: space.sm }}>
        <GradientButton
          label={existing ? 'Save changes' : 'Add bill'}
          icon="checkmark"
          onPress={save}
          disabled={!draft.canSave}
        />
        <Button label="Back" icon="arrow-back" variant="secondary" onPress={onCancel} />
      </View>
    ),
    body: (
      <>
        <BillFields draft={draft} cards={state.cards} category={category} />

        {existing?.loanId ? (
          <Text variant="caption" tone="muted">
            This bill is linked to a loan. Its schedule is managed from the Loans tab.
          </Text>
        ) : null}

        {onDelete ? (
          <Button
            label="Delete this bill"
            icon="trash-outline"
            variant="danger"
            onPress={onDelete}
          />
        ) : null}
      </>
    ),
  };
}
