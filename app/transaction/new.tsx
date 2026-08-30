import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { AccountField } from '~/features/accounts/components/AccountPicker';
import { CategoryGridPicker } from '~/features/budget/components/CategoryGridPicker';
import { DatePickerField } from '~/shared/components/DatePickerField';
import { HousePicker } from '~/features/budget/components/HousePicker';
import { ImageUploader } from '~/shared/components/ImageUploader';
import { ManagePlanSheet } from '~/features/budget/components/ManagePlanSheet';
import { StatusToggle } from '~/features/budget/components/StatusToggle';
import { AmountField } from '~/shared/components/forms';
import { BottomSheet, GradientButton, Label, Row, Segmented, Surface, Text } from '~/shared/components/ui';
import { useModalClose } from '~/shared/hooks/useModalClose';
import { formatAmountInput, formatMoney, parseAmount, toMajor } from '~/shared/lib/money';
import { defaultHouseId } from '~/features/budget/logic/houses';
import { resolveCardId, type SubcategoryStatus } from '~/features/budget/logic/planning';
import { MessagePasteField } from '~/features/sms/components/MessagePasteField';
import type { ParsedSms } from '~/features/sms/logic/smsParser';
import { isOngoing } from '../../src/db/schema';
import { resolveBrand } from '~/shared/data/banks';
import { selectCategoryViews, useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

/**
 * Log a transaction against a budget line — the dock's centre "+" action.
 *
 * The screen asks three things in the order you actually know them: how much,
 * what it was for, and the details.
 *
 * "What it was for" is a grid of category tiles, not a search box. Typing to
 * find a line summons the keyboard, hides half the screen, and asks the user to
 * recall a name they would rather just recognise. The grid shows the whole plan
 * at once: a category with one bill is selected outright in a single tap, and
 * one with several expands in place. No keyboard, one or two taps, and the
 * category comes along implicitly because a line already knows its parent.
 *
 * Everything below the destination is secondary — account, status, note, photo
 * — so it sits under a collapsed "More details" until asked for, keeping the
 * common case (amount + line + save) to a single screen with no scrolling.
 */
export default function NewTransactionScreen() {
  const { colors, space } = useTheme();
  const router = useRouter();
  const closeModal = useModalClose();
  const state = useAppStore();
  const views = useMemo(() => selectCategoryViews(state), [state]);

  const [amount, setAmount] = useState('');
  // Defaults to today; the chosen date decides which month this counts toward.
  const [date, setDate] = useState(() => new Date());
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  /** Which category a newly-created line goes into. Only used by "New line". */
  const [newLineCategoryId, setNewLineCategoryId] = useState<string | null>(
    views[0]?.category.id ?? null,
  );
  const [cardId, setCardId] = useState<string | null>(null);
  const [status, setStatus] = useState<SubcategoryStatus>('paid');
  /**
   * Which house this spend was for. Null means "use the default", which is
   * resolved below rather than stored, so changing line keeps the picker in
   * step with the newly-chosen line's own default.
   */
  const [houseId, setHouseId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);

  const [newSheetOpen, setNewSheetOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  /**
   * FILL THE FORM IN BY HAND, or PASTE THE BANK MESSAGE.
   *
   * Two routes to the same record, and they were previously two different
   * screens: this form, and "Paste a message" reachable only from a dashboard
   * tile. Someone standing at a till with the SMS already copied had to back
   * out of the form they had opened, find the other door, and start again —
   * and the pasted message then landed in a review queue rather than in the
   * entry they were part-way through making.
   *
   * As a mode switch, the message is read INTO this form: the parse fills the
   * amount, the date and the destination, and everything else on the screen —
   * the account, the note, the photo, the split — keeps working exactly as it
   * does for a typed entry. Paste becomes a faster way to fill the form, not a
   * separate feature with its own rules.
   */
  const [entryMode, setEntryMode] = useState<'manual' | 'paste'>('manual');
  const [messageText, setMessageText] = useState('');

  const creatingNew = subcategoryId === '__new__';

  /**
   * Fold a parsed message into the form's own fields.
   *
   * Deliberately only fills what the message actually SAYS, and only where the
   * user has not already typed something — a re-parse on every keystroke must
   * never overwrite a figure the user corrected by hand. The destination is
   * left alone entirely: the parser guesses a merchant, not a budget line, and
   * silently picking a category from a guess is how a transaction ends up
   * filed somewhere nobody chose.
   */
  const applyParsed = useCallback((result: ParsedSms | null) => {
    if (!result) return;

    setAmount((current) => (current ? current : formatAmountInput(toMajor(result.amountMinor).toFixed(2))));
    /*
     * `result.date` is ISO (YYYY-MM-DD) with no time. Built from its PARTS
     * rather than `new Date(iso)`, which parses a bare date as UTC midnight —
     * that lands on the previous day everywhere west of Greenwich, and the date
     * here decides which month the entry counts toward.
     */
    if (result.date) {
      const [year, month, day] = result.date.split('-').map(Number);
      if (year && month && day) setDate(new Date(year, month - 1, day));
    }
    // The merchant is the best available name for a line the user may go on to
    // create, so it seeds that field rather than being discarded.
    if (result.merchant) setNewName((current) => current || result.merchant!);
  }, []);

  /**
   * Every budget line a transaction can be logged against, flattened with its
   * category, so one list can stand in for the old category→line drill-down.
   *
   * Loan installments are deliberately excluded. A loan is not an ad-hoc expense
   * — it is a fixed schedule with its own screen, where paying an installment
   * also advances the loan's progress. Offering those lines here let the user
   * log a payment that moved the bill but not the debt, leaving the two
   * disagreeing. The Loans tab is the one place a loan payment is recorded.
   */
  const destinations = useMemo(
    () =>
      views.flatMap((view) =>
        view.rawSubcategories
          .filter((line) => !line.loanId)
          .map((line) => ({
            line,
            category: view.category,
          })),
      ),
    [views],
  );

  const selected = destinations.find((d) => d.line.id === subcategoryId) ?? null;

  /**
   * The category a save targets: the chosen line's own, or the explicit pick
   * when creating a new line.
   *
   * The "new line" pick is validated against the current categories rather than
   * trusted, and falls back to the first one — the stored id can go stale if the
   * category is archived while this sheet is open, and a dangling id would
   * otherwise pass `canSave` and fail at the insert.
   */
  const newLineCategory =
    views.find((view) => view.category.id === newLineCategoryId)?.category ??
    views[0]?.category ??
    null;
  const categoryId = creatingNew ? (newLineCategory?.id ?? null) : (selected?.category.id ?? null);

  // The account defaults to whatever the chosen line (or its category) funds
  // from, so the common case needs no tap; the picker only overrides it.
  const effectiveCardId =
    cardId ?? resolveCardId(selected?.line.cardId, selected?.category.cardId);

  // Only lines that opt in ask which property they were for — see core/houses.ts.
  const houseScoped = selected?.line.houseScoped ?? false;
  const effectiveHouseId =
    houseId ?? defaultHouseId(state.houses, selected?.line.houseId ?? null);

  function selectLine(id: string) {
    setSubcategoryId(id);
    setCardId(null);
    // Drop any manual house choice so the new line's own default applies.
    setHouseId(null);
    if (id !== '__new__') {
      const line = destinations.find((d) => d.line.id === id)?.line;
      // Prefill the plan so logging an as-expected bill is one tap.
      if (line && !amount) setAmount(String(line.plannedMinor / 100));
    }
  }

  const canSave =
    Boolean(categoryId) &&
    (creatingNew ? newName.trim().length > 0 : Boolean(subcategoryId));

  function handleSave() {
    if (!categoryId || !canSave) return;
    const parsed = parseAmount(amount) ?? 0;

    let targetId: string;
    if (creatingNew) {
      const created = state.addSubcategory({
        name: newName.trim(),
        categoryId,
        plannedMinor: parsed,
        cardId,
      });
      targetId = created.id;
    } else if (subcategoryId) {
      targetId = subcategoryId;
      if (cardId) state.updateSubcategory(targetId, { cardId });
    } else {
      return;
    }

    // An ongoing line holds many individual dated entries rather than one
    // status per month, so it takes a transaction row; everything else records
    // the month's status. Both carry the chosen date, which decides the period.
    const target = state.subcategories.find((s) => s.id === targetId);
    if (target && isOngoing(target.frequency)) {
      state.addTransaction({
        subcategoryId: targetId,
        name: (selected?.line.name ?? newName.trim()) || 'Transaction',
        amountMinor: parsed,
        date,
        note: note.trim() || null,
        imageUri,
        // Only recorded on a house-scoped line; elsewhere the question was
        // never asked and an attribution would be invented.
        houseId: houseScoped ? effectiveHouseId : null,
      });
    } else {
      state.logTransaction(targetId, {
        status,
        actualMinor: parsed > 0 ? parsed : null,
        note: note.trim() || null,
        imageUri,
        date,
        houseId: houseScoped ? effectiveHouseId : null,
      });
    }

    closeModal();
  }

  if (views.length === 0) {
    return (
      <BottomSheet
        visible
      asRoute
        onClose={closeModal}
        title="Add transaction"
        icon="swap-horizontal-outline"
        iconColor={colors.accent}
      >
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, paddingHorizontal: space.lg }}>
          <Ionicons name="albums-outline" size={48} color={colors.inkMuted} />
          <Text variant="heading">No categories yet</Text>
          <Text variant="small" tone="muted" style={{ textAlign: 'center', maxWidth: 260 }}>
            Create a category first, then log transactions against its lines.
          </Text>
          <GradientButton
            label="Create a category"
            icon="add"
            onPress={() => router.replace('/category/new')}
          />
        </View>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet
      visible
      asRoute
      onClose={closeModal}
      title="Add transaction"
      icon="swap-horizontal-outline"
      iconColor={colors.accent}
      scroll
      footer={
        <GradientButton
          label="Save transaction"
          icon="checkmark"
          onPress={handleSave}
          disabled={!canSave}
        />
      }
    >
      {/*
        How the entry gets filled in: by hand, or from the bank's own message.

        A switch rather than a separate screen. The paste route reads the
        message INTO these same fields, so everything below it — the
        destination grid, the account, the note, the photo — works identically
        whichever way the amount arrived, and the user never has to leave a
        half-filled form to go and find the other one.
      */}
      <Segmented
        options={[
          { key: 'manual', label: 'Fill in', icon: 'create-outline' },
          { key: 'paste', label: 'Paste message', icon: 'chatbox-ellipses-outline' },
        ]}
        selectedKey={entryMode}
        onSelect={(key) => setEntryMode(key === 'paste' ? 'paste' : 'manual')}
      />

      {/*
        The paste box sits ABOVE the amount, in reading order: the message is
        the source, and the fields below it are what was read out of it. Kept
        MOUNTED (hidden, not unmounted) when switching back to manual so the
        pasted text and its parse survive a toggle — retyping a message the user
        already pasted is the one thing a mode switch must not cost.
      */}
      <View style={{ display: entryMode === 'paste' ? 'flex' : 'none', gap: space.md }}>
        <MessagePasteField
          value={messageText}
          onChangeText={setMessageText}
          onParsed={applyParsed}
          // Only read the pasteboard once this mode is actually chosen — an
          // "allow paste?" banner on a form the user opened to type in would be
          // an interruption they did not ask for.
          autoFillFromClipboard={entryMode === 'paste'}
          autoFocus={false}
          label="BANK MESSAGE"
        />
        <Text variant="caption" tone="muted">
          The amount and date fill in below — pick what it was for, then save.
        </Text>
      </View>

        {/* 1 · Amount — the number in hand, front and centre. */}
      <View style={{ paddingVertical: space.sm }}>
        <AmountField label="Amount" value={amount} onChangeText={setAmount} currency={state.currency} />
      </View>

      {/* When it happened. Sits with the amount rather than under "More
          details" because it decides which month the entry counts toward —
          it is part of the record, not an optional extra. */}
      <DatePickerField label="Date" value={date} onChange={setDate} />

      {/* 2 · What it was for — a grid of categories that expand into their
          bills. Recognising a tile beats recalling a name, and it keeps the
          keyboard off screen entirely.

          The grid hides any category left with no selectable bills, so a Debt
          category holding only loan installments drops out on its own. */}
      <CategoryGridPicker
        categories={views.map((view) => ({
          id: view.category.id,
          name: view.category.name,
          color: view.category.color,
          icon: view.category.icon,
        }))}
        destinations={destinations.map(({ line, category }) => ({
          id: line.id,
          name: line.name,
          categoryId: category.id,
          plannedMinor: line.plannedMinor,
          icon: line.icon,
        }))}
        selectedId={subcategoryId}
        onSelect={selectLine}
        extraTile={{
          label: 'Manage',
          icon: 'options-outline',
          selected: false,
          onPress: () => setManageOpen(true),
        }}
      />

      {/* A summary of the pending new line, so the choice stays visible after
          the sheet closes and can be reopened to correct. */}
      {creatingNew && newName.trim() ? (
        <Pressable
          onPress={() => setNewSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`New line ${newName}. Tap to edit.`}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            padding: space.md,
            borderRadius: 12,
            borderWidth: 1.5,
            borderColor: colors.accent,
            backgroundColor: pressed ? colors.surfaceSunken : colors.accentSoft,
          })}
        >
          <Ionicons name="add-circle" size={20} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text variant="small" style={{ fontWeight: '700' }} numberOfLines={1}>
              {newName.trim()}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              New line in {newLineCategory?.name ?? 'a category'}
            </Text>
          </View>
          <Ionicons name="pencil" size={15} color={colors.accent} />
        </Pressable>
      ) : null}

      {/* The grid's trailing tile opens the plan editor: add, rename or delete
          categories and their bills without leaving the half-filled form. */}
      <ManagePlanSheet visible={manageOpen} onClose={() => setManageOpen(false)} />

      {/* Naming the line and choosing its home category, in a sheet rather
          than inline: it is a side quest off the main "log a transaction"
          flow, and inline fields pushed the real form down the screen. */}
      <NewLineSheet
        visible={newSheetOpen}
        categories={views.map((view) => view.category)}
        name={newName}
        categoryId={newLineCategory?.id ?? null}
        onClose={() => setNewSheetOpen(false)}
        onConfirm={(nextName, nextCategoryId) => {
          setNewName(nextName);
          setNewLineCategoryId(nextCategoryId);
          setSubcategoryId('__new__');
          setCardId(null);
          setNewSheetOpen(false);
        }}
      />

      {/* Planned-amount reminder, right under the choice it refers to. */}
      {selected ? (
        <Surface style={{ gap: space.xs }}>
          <Row justify="space-between">
            <Text variant="small" tone="secondary">
              Planned for this line
            </Text>
            <Text variant="figure">{formatMoney(selected.line.plannedMinor)}</Text>
          </Row>
        </Surface>
      ) : null}

      {/* Account it moved through — the shared picker, so "paid from" looks
          identical to "funded account" everywhere. */}
      <AccountField
        label="Paid from"
        cards={state.cards}
        selectedId={effectiveCardId}
        onSelect={setCardId}
      />

      <HousePicker
        houses={state.houses}
        houseScoped={houseScoped}
        selectedHouseId={effectiveHouseId}
        onSelect={setHouseId}
      />

      <StatusToggle value={status} onChange={setStatus} />

      <LabeledField label="NOTE (OPTIONAL)">
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="What was this for?"
          placeholderTextColor={colors.inkMuted}
          multiline
          style={[inputStyle(colors, space), { minHeight: 56, textAlignVertical: 'top' }]}
        />
      </LabeledField>

      <ImageUploader label="Photo (optional)" value={imageUri} onChange={setImageUri} />
    </BottomSheet>
  );
}


/** A labelled block — the shared skeleton for every field on the screen. */
function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Label>{label}</Label>
      {children}
    </View>
  );
}


function inputStyle(colors: ReturnType<typeof useTheme>['colors'], space: ReturnType<typeof useTheme>['space']) {
  return {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    borderRadius: 12,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
  } as const;
}

/**
 * Name a new budget line and choose which category it joins.
 *
 * A sheet rather than inline fields: creating a line is a detour off the main
 * "log a transaction" flow, and having its two fields always mounted pushed the
 * amount, date and grid down the screen for everyone who never used them.
 *
 * Local state is seeded from the props each time it opens, so a half-finished
 * edit is discarded on cancel rather than leaking into the parent.
 */
function NewLineSheet({
  visible,
  categories,
  name,
  categoryId,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  categories: { id: string; name: string; color: string; icon: string }[];
  name: string;
  categoryId: string | null;
  onClose: () => void;
  onConfirm: (name: string, categoryId: string) => void;
}) {
  const { colors, radius, space } = useTheme();

  const [draftName, setDraftName] = useState(name);
  const [draftCategoryId, setDraftCategoryId] = useState(categoryId ?? categories[0]?.id ?? null);

  // Re-seed on each open so the sheet always reflects the committed values.
  React.useEffect(() => {
    if (visible) {
      setDraftName(name);
      setDraftCategoryId(categoryId ?? categories[0]?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const canConfirm = draftName.trim().length > 0 && Boolean(draftCategoryId);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="New line"
      icon="add-circle-outline"
      iconColor={colors.accent}
      scroll
      footer={
        <GradientButton
          label="Add line"
          icon="checkmark"
          onPress={() => {
            if (draftCategoryId && canConfirm) onConfirm(draftName.trim(), draftCategoryId);
          }}
          disabled={!canConfirm}
        />
      }
    >
      <LabeledField label="WHAT IS IT?">
        <TextInput
          value={draftName}
          onChangeText={setDraftName}
          placeholder="e.g. Groceries"
          placeholderTextColor={colors.inkMuted}
          autoFocus
          style={inputStyle(colors, space)}
        />
      </LabeledField>

      <LabeledField label="ADD IT TO">
        <View style={{ gap: 6 }}>
          {categories.map((category) => {
            const chosen = category.id === draftCategoryId;
            return (
              <Pressable
                key={category.id}
                onPress={() => setDraftCategoryId(category.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: chosen }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.md,
                  paddingVertical: 11,
                  paddingHorizontal: space.md,
                  borderRadius: radius.md,
                  borderWidth: 1.5,
                  borderColor: chosen ? category.color : colors.hairline,
                  backgroundColor: chosen
                    ? `${category.color}14`
                    : pressed
                      ? colors.surfaceSunken
                      : colors.surface,
                })}
              >
                <Ionicons
                  name={(category.icon ?? 'albums-outline') as keyof typeof Ionicons.glyphMap}
                  size={17}
                  color={category.color}
                />
                <Text variant="small" style={{ flex: 1, fontWeight: chosen ? '700' : '600' }}>
                  {category.name}
                </Text>
                {chosen ? (
                  <Ionicons name="checkmark-circle" size={18} color={category.color} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </LabeledField>
    </BottomSheet>
  );
}
