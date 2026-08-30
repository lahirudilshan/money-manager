import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ColorPicker, IconPicker, NameWithIconField } from '~/shared/components/forms';
import { DEFAULT_CATEGORY_COLOR, suggestCategoryColor } from '~/shared/data/categoryColors';
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
  const [color, setColor] = useState(DEFAULT_CATEGORY_COLOR);
  /*
   * Both marks auto-suggest as the name is typed, and both stop the moment the
   * user picks one by hand — overriding a deliberate choice on the next
   * keystroke is the behaviour that makes an auto-suggestion feel hostile.
   * Tracked separately so choosing a colour does not freeze the icon.
   */
  const [colorTouched, setColorTouched] = useState(false);
  /** True while the shown colour came from the name, so the picker can say so. */
  const [colorSuggested, setColorSuggested] = useState(false);

  function onNameChange(next: string) {
    setName(next);
    if (!iconTouched) {
      const suggested = suggestCategoryIcon(next);
      if (suggested) setIcon(suggested);
    }
    if (!colorTouched) {
      const suggested = suggestCategoryColor(next);
      if (suggested) {
        setColor(suggested);
        setColorSuggested(true);
      }
    }
  }

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;

    state.addCategory({
      name: trimmed,
      icon,
      color,
      /*
       * No account and no due day.
       *
       * A category is a CONTAINER — every bill inside it names its own account
       * and its own day, and those are the ones that are actually paid. Asking
       * again at the container level created a default that silently disagreed
       * with its own contents: a "Utilities" category funded from HNB whose
       * three bills were all paid from BOC still read "HNB" on the board.
       *
       * The category now derives what it shows from its bills (see the bank
       * list on the category card), so there is nothing left to set here.
       *
       * A category has no cadence of its own either — only its bills do. New
       * bills default to monthly (the schema default) and each sets its own
       * "How often?" when added.
       */
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
      iconColor={color}
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
          iconColor={color}
          placeholder="e.g. Home Expenses"
          autoFocus
        />

        <IconPicker value={icon} onChange={(next) => { setIcon(next); setIconTouched(true); }} accent={color} />

        <ColorPicker
          value={color}
          suggested={colorSuggested}
          onChange={(next) => {
            setColor(next);
            setColorTouched(true);
            setColorSuggested(false);
          }}
        />
    </BottomSheet>
  );
}
