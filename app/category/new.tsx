import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { AccountField } from '../../src/components/AccountPicker';
import { DayPicker } from '../../src/components/DayPicker';
import { IconPicker, NameWithIconField } from '../../src/components/forms';
import { DEFAULT_CATEGORY_ICON, suggestCategoryIcon } from '../../src/data/categoryIcons';
import { BottomSheet, GradientButton, T } from '../../src/components/ui';
import { useModalClose } from '../../src/hooks/useModalClose';
import { useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';


export default function NewCategoryScreen() {
  const { colors, space } = useTheme();
  const closeModal = useModalClose();
  const state = useAppStore();

  const [name, setName] = useState('');
  const [icon, setIcon] = useState<keyof typeof Ionicons.glyphMap>(DEFAULT_CATEGORY_ICON);
  const [iconTouched, setIconTouched] = useState(false);
  const [cardId, setCardId] = useState<string | null>(state.cards[0]?.id ?? null);
  const [dueDay, setDueDay] = useState(1);

  function onNameChange(next: string) {
    setName(next);
    if (!iconTouched) {
      const suggested = suggestCategoryIcon(next);
      if (suggested) setIcon(suggested);
    }
  }

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;

    state.addCategory({
      name: trimmed,
      cardId,
      icon,
      dueDay,
      // A category has no cadence of its own — only its bills do. New bills
      // default to monthly (the schema default) and each sets its own "How
      // often?" when added.
      sortOrder: state.categories.length,
    });
    closeModal();
  }

  return (
    <BottomSheet
      visible
      asRoute
      onClose={closeModal}
      title="New category"
      icon={icon}
      iconColor={colors.accent}
      scroll
      footer={
        <GradientButton
          label="Create category"
          icon="checkmark"
          onPress={handleCreate}
          disabled={!name.trim()}
        />
      }
    >
        <NameWithIconField
          value={name}
          onChangeText={onNameChange}
          icon={icon}
          iconColor={colors.accent}
          placeholder="e.g. Home Expenses"
          autoFocus
        />

        <IconPicker value={icon} onChange={(next) => { setIcon(next); setIconTouched(true); }} accent={colors.accent} />

        {state.cards.length > 0 ? (
          <AccountField
            label="Transfer money to"
            cards={state.cards}
            selectedId={cardId}
            onSelect={setCardId}
          />
        ) : (
          <T variant="small" tone="muted">
            Add an account first to choose where this category's money goes.
          </T>
        )}

        <DayPicker value={dueDay} onChange={setDueDay} />
    </BottomSheet>
  );
}
