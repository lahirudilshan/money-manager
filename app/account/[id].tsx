import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ModalScreen, SheetHeader } from '../../src/components/forms';
import { Button, Divider, FundingBar, Label, Row, Surface, T } from '../../src/components/ui';
import { BankLogo } from '../../src/components/BankLogo';
import { formatMoney } from '../../src/core/money';
import { accountLabel, resolveBrand } from '../../src/data/banks';
import { selectCardViews, selectCategoryViews, useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Full-screen account detail — opened from the dashboard's "money to move" list
 * and the Accounts screen. Shows the account's identity, its balance and
 * commitment, its stored details (number, branch, code), and the categories
 * that draw from it. Cards route here too but show number/CVV/expiry instead.
 */
export default function AccountDetailScreen() {
  const { colors, radius, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useAppStore();

  const view = useMemo(
    () => selectCardViews(state).find((v) => v.card.id === id),
    [state, id],
  );
  const [revealed, setRevealed] = useState(false);

  if (!view) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, padding: space.lg, paddingTop: insets.top + space.xl }}>
        <SheetHeader title="Account" onClose={() => router.back()} />
        <T variant="small" tone="muted">
          This account no longer exists.
        </T>
      </View>
    );
  }

  const { card } = view;
  const label = accountLabel(card);
  const brand = resolveBrand({ bankId: card.bankId, bankName: card.bankName, name: card.name });
  const hasGoal = typeof card.targetMinor === 'number' && card.targetMinor > 0;
  const goalPct = hasGoal ? Math.min(100, (view.balanceMinor / card.targetMinor!) * 100) : 0;

  // Categories funded from this account, each with its bills and their
  // effective (actual-or-planned) amounts — so the detail shows *where the
  // money goes*, not just a list of names.
  const fundedCategories = useMemo(() => {
    return selectCategoryViews(state)
      .filter((cv) => cv.category.cardId === card.id)
      .map((cv) => ({
        id: cv.category.id,
        name: cv.category.name,
        color: cv.category.color,
        icon: cv.category.icon,
        totalMinor: cv.summary.totalMinor,
        lines: cv.subcategories.map((s) => ({
          id: s.id,
          name: s.name,
          amountMinor: s.actualMinor ?? s.plannedMinor,
          isActual: s.actualMinor != null,
        })),
      }));
  }, [state, card.id]);

  function confirmDelete() {
    Alert.alert(`Delete ${label.primary}?`, 'Categories pointing at it will need a new account.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          state.deleteCard(card.id);
          router.back();
        },
      },
    ]);
  }

  return (
    <ModalScreen title={card.isCard ? 'Card' : 'Account'} onClose={() => router.back()}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingBottom: insets.bottom + space.xl,
          gap: space.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Identity + balance — accented with the bank's brand colour. */}
        <Surface padded={false} style={{ overflow: 'hidden' }}>
          <View style={{ backgroundColor: `${brand.color}14`, padding: space.lg }}>
            <Row gap={space.md}>
              <BankLogo brand={brand} size={48} />
              <View style={{ flex: 1 }}>
                <T variant="heading" numberOfLines={1}>
                  {label.primary}
                </T>
                <T variant="caption" tone="muted">
                  {label.secondary ?? (card.isCard ? 'Card' : 'Account')}
                  {card.last4 ? ` · ••${card.last4}` : ''}
                </T>
              </View>
            </Row>
          </View>

          <View style={{ padding: space.lg, gap: space.md }}>
            <Row justify="space-between">
              <T variant="small" tone="secondary">
                Balance
              </T>
              <T variant="figureLarge" color={brand.color}>
                {formatMoney(view.balanceMinor)}
              </T>
            </Row>
            {view.committedMinor > 0 ? (
              <Row justify="space-between">
                <T variant="small" tone="secondary">
                  Still to pay from here
                </T>
                <T variant="figure" color={colors.pending}>
                  {formatMoney(view.committedMinor)}
                </T>
              </Row>
            ) : null}

            {hasGoal ? (
              <View style={{ gap: 4 }}>
                <FundingBar pct={goalPct} color={brand.color} height={6} />
                <Row justify="space-between">
                  <T variant="caption" tone="muted">
                    {Math.round(goalPct)}% of {formatMoney(card.targetMinor!, { compact: true })}
                  </T>
                </Row>
              </View>
            ) : null}
          </View>
        </Surface>

        {/* Stored details. */}
        <Surface padded={false}>
          {card.isCard ? (
            <>
              <DetailRow
                label="Card number"
                value={
                  card.cardNumber
                    ? revealed
                      ? card.cardNumber
                      : `•••• •••• •••• ${card.cardNumber.slice(-4)}`
                    : '—'
                }
                action={
                  card.cardNumber
                    ? { icon: revealed ? 'eye-off-outline' : 'eye-outline', onPress: () => setRevealed((v) => !v) }
                    : undefined
                }
              />
              <Divider style={{ marginHorizontal: space.lg }} />
              <DetailRow label="Expiry" value={card.expiry || '—'} />
              <Divider style={{ marginHorizontal: space.lg }} />
              <DetailRow label="CVV" value={card.cvv ? (revealed ? card.cvv : '•••') : '—'} />
            </>
          ) : (
            <>
              <DetailRow label="Account number" value={card.accountNumber || '—'} />
              <Divider style={{ marginHorizontal: space.lg }} />
              <DetailRow label="Bank" value={card.bankName ?? brand.name} />
              <Divider style={{ marginHorizontal: space.lg }} />
              <DetailRow label="Branch" value={card.branch || '—'} />
              <Divider style={{ marginHorizontal: space.lg }} />
              <DetailRow label="Bank code" value={card.bankCode || '—'} />
            </>
          )}
        </Surface>

        {/* What draws from this account — each category with its bills and the
            amount each will cost (actual when logged, else planned). */}
        {!card.isCard ? (
          <View style={{ gap: space.sm }}>
            <Label>FUNDS THESE</Label>
            {fundedCategories.length > 0 ? (
              fundedCategories.map((cat) => (
                <Surface key={cat.id} padded={false} style={{ overflow: 'hidden' }}>
                  <Row
                    justify="space-between"
                    style={{
                      paddingHorizontal: space.lg,
                      paddingVertical: space.md,
                      backgroundColor: `${cat.color}12`,
                    }}
                  >
                    <Row gap={space.sm}>
                      <Ionicons name={(cat.icon as never) ?? 'albums-outline'} size={16} color={cat.color} />
                      <T variant="bodyStrong">{cat.name}</T>
                    </Row>
                    <T variant="figure" color={cat.color}>
                      {formatMoney(cat.totalMinor, { compact: true })}
                    </T>
                  </Row>
                  {cat.lines.map((line, i) => (
                    <View key={line.id}>
                      {i === 0 ? null : <Divider style={{ marginHorizontal: space.lg }} />}
                      <Row
                        justify="space-between"
                        style={{ paddingHorizontal: space.lg, paddingVertical: space.sm }}
                      >
                        <T variant="small" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
                          {line.name}
                        </T>
                        <T variant="small" color={line.isActual ? colors.accent : colors.ink}>
                          {formatMoney(line.amountMinor, { compact: true })}
                          {line.isActual ? '' : ''}
                        </T>
                      </Row>
                    </View>
                  ))}
                </Surface>
              ))
            ) : (
              <Surface>
                <T variant="caption" tone="muted">
                  No categories draw from this account yet.
                </T>
              </Surface>
            )}
          </View>
        ) : null}

        <Button label="Delete" icon="trash-outline" variant="danger" onPress={confirmDelete} />
      </ScrollView>
    </ModalScreen>
  );
}

function DetailRow({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  action?: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void };
}) {
  const { colors, space } = useTheme();
  return (
    <Row justify="space-between" style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}>
      <T variant="small" tone="muted">
        {label}
      </T>
      <Row gap={space.sm}>
        <T variant="small" style={{ fontWeight: '600' }}>
          {value}
        </T>
        {action ? (
          <Pressable onPress={action.onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label}>
            <Ionicons name={action.icon} size={18} color={colors.accent} />
          </Pressable>
        ) : null}
      </Row>
    </Row>
  );
}
