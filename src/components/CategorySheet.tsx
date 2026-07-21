import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView } from 'react-native';
import { Field, PillSelect, SheetHeader } from './forms';
import { Button, Row, T } from './ui';
import { parseAmount } from '../core/money';
import type { SubcategoryFrequency } from '../db/schema';
import { useAppStore } from '../store/useAppStore';
import { useTheme } from '../theme/ThemeProvider';

const FREQUENCIES = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'one_time', label: 'One-time' },
  { key: 'yearly', label: 'Yearly' },
];

type Frequency = SubcategoryFrequency;

interface DraftRow {
  name: string;
  nameTouched: boolean;
  amount: string;
  frequency: Frequency;
}

function emptyRow(): DraftRow {
  return { name: '', nameTouched: false, amount: '', frequency: 'monthly' };
}

/**
 * One sheet, one save: creates a top-level category plus any number of
 * subcategory budget lines under it, in a single write, no navigation
 * round-trip. The first row's name previews the category name (as a
 * placeholder, not a real value) so the common 1:1 case is type-once-tap-once.
 */
export function CategorySheet({
  visible,
  defaultCardId,
  onClose,
}: {
  visible: boolean;
  defaultCardId: string | null;
  onClose: () => void;
}) {
  const { colors, space } = useTheme();
  const addCategory = useAppStore((s) => s.addCategory);
  const addSubcategory = useAppStore((s) => s.addSubcategory);

  const [categoryName, setCategoryName] = useState('');
  const [rows, setRows] = useState<DraftRow[]>([emptyRow()]);
  const opened = useRef(false);

  useEffect(() => {
    if (visible && !opened.current) {
      opened.current = true;
    } else if (!visible) {
      opened.current = false;
    }
  }, [visible]);

  function reset() {
    setCategoryName('');
    setRows([emptyRow()]);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function updateRow(index: number, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function handleCreate() {
    const trimmedCategory = categoryName.trim();
    if (!trimmedCategory) return;

    const category = addCategory({ name: trimmedCategory, cardId: defaultCardId });

    rows.forEach((row, index) => {
      // The first row's placeholder mirrors the category name but is never
      // auto-committed — an untouched, empty first row with a real category
      // name still becomes one subcategory of that same name, matching the
      // common 1:1 case in the fewest taps.
      const name = row.name.trim() || (index === 0 ? trimmedCategory : '');
      if (!name) return;
      addSubcategory({
        name,
        categoryId: category.id,
        plannedMinor: parseAmount(row.amount) ?? 0,
        frequency: row.frequency,
      });
    });

    reset();
    onClose();
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.canvas }}
        contentContainerStyle={{ padding: space.lg, gap: space.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <SheetHeader title="New category" onClose={handleClose} />

        <Field
          label="Category name"
          value={categoryName}
          onChangeText={setCategoryName}
          placeholder="e.g. Housing"
          autoFocus
        />

        <T variant="label" tone="muted">
          SUBCATEGORIES
        </T>

        {rows.map((row, index) => (
          <React.Fragment key={index}>
            <Row gap={space.sm}>
              <Field
                label="Name"
                value={row.name}
                onChangeText={(text) => updateRow(index, { name: text, nameTouched: true })}
                placeholder={index === 0 ? categoryName.trim() || 'e.g. Rent' : 'e.g. Electricity'}
                style={{ flex: 2 }}
              />
              <Field
                label="Planned amount"
                value={row.amount}
                onChangeText={(text) => updateRow(index, { amount: text })}
                placeholder="0"
                keyboardType="numeric"
                style={{ flex: 1 }}
              />
            </Row>
            <PillSelect
              options={FREQUENCIES}
              selectedKey={row.frequency}
              onSelect={(key) => updateRow(index, { frequency: key as Frequency })}
            />
          </React.Fragment>
        ))}

        <Pressable onPress={addRow} accessibilityRole="button" hitSlop={8}>
          <T variant="caption" tone="accent">
            + Add another subcategory
          </T>
        </Pressable>

        <Button label="Create" onPress={handleCreate} disabled={!categoryName.trim()} />
      </ScrollView>
    </Modal>
  );
}
