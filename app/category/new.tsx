import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { AccountField } from '~/features/accounts/components/AccountPicker';
import { DayPicker } from '~/features/budget/components/DayPicker';
import { IconPicker, NameWithIconField } from '~/shared/components/forms';
import { DEFAULT_CATEGORY_ICON, suggestCategoryIcon } from '~/shared/data/categoryIcons';
import { BottomSheet, GradientButton, Text } from '~/shared/components/ui';
import { useModalClose } from '~/shared/hooks/useModalClose';
import { useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';


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

        {/*
          Always shown — the picker itself offers "Add an account".

          This used to fall back to a line of grey text saying to add an account
          first, which named the problem and gave no way to act on it. The
          picker now routes to the account editor, so the field IS the way
          forward rather than a message about one.
        */}
        <AccountField
          label="Transfer money to"
          cards={state.cards}
          selectedId={cardId}
          onSelect={setCardId}
        />

        <DayPicker value={dueDay} onChange={setDueDay} />
    </BottomSheet>
  );
}
