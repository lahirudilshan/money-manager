import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useDeferredValue, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, Text as RNText, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader, Glyph, Label, Row, Surface, Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { formatMoney } from '~/shared/lib/money';
import { pathLabel } from '~/features/documents/logic/folders';
import { useDocPreview } from '~/features/documents/components/DocPreviewSheet';
import {
  availableScopes,
  countByScope,
  groupHits,
  searchAll,
  words,
  type ScopeInfo,
  type SearchHit,
  type SearchItem,
  type SearchScope,
} from '~/features/search/logic/globalSearch';
import { useSearchHistory } from '~/features/search/components/useSearchHistory';
import { useSearchIndex } from '~/features/search/components/useSearchIndex';

/** One kind's list; more is typing another word, not scrolling. */
const SCOPE_LIMIT = 100;

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * Search everything: the board, SMS history, and each add-on that is switched
 * on. Opened from the dashboard's search bar.
 *
 * "All" shows the best few as Top matches, then a section per kind, ordered by
 * how well that kind matched. A chip narrows to one kind and lists it in full.
 * Chips exist only for kinds this user has, so a disabled add-on never offers
 * a chip that can only say "no results".
 */
export default function SearchScreen() {
  const { colors, radius, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string; scope?: SearchScope }>();
  const { items, enabled, files, folders, reload, loading } = useSearchIndex();
  const input = useRef<TextInput>(null);
  const history = useSearchHistory();

  const [query, setQuery] = useState(params.q ?? '');
  const [scope, setScope] = useState<SearchScope | null>(params.scope ?? null);

  const scopes = useMemo(() => availableScopes(enabled), [enabled]);
  const scopeById = useMemo(() => new Map(scopes.map((s) => [s.id, s])), [scopes]);
  const itemByKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items]);
  /** Recently opened results that still exist (a deleted row just drops off). */
  const recentItems = useMemo(
    () => history.opened.map((key) => itemByKey.get(key)).filter((item): item is SearchItem => !!item),
    [history.opened, itemByKey],
  );
  // Typing stays responsive: ranking runs at lower priority than the keystroke.
  const deferredQuery = useDeferredValue(query);
  const allHits = useMemo(() => searchAll(items, deferredQuery), [items, deferredQuery]);
  const counts = useMemo(() => countByScope(allHits), [allHits]);
  const grouped = useMemo(() => groupHits(allHits, scopes), [allHits, scopes]);
  const scoped = useMemo(
    () => (scope ? allHits.filter((hit) => hit.item.scope === scope).slice(0, SCOPE_LIMIT) : []),
    [allHits, scope],
  );
  const terms = useMemo(() => words(deferredQuery), [deferredQuery]);

  const preview = useDocPreview({
    folderPathOf: (id) => pathLabel(folders, id),
    onChanged: reload,
    onTag: (tag) => {
      setQuery(tag);
      setScope('documents');
    },
  });

  const searching = terms.length > 0;
  const activeScope = scope ? scopeById.get(scope) : undefined;

  function open(item: SearchItem) {
    Keyboard.dismiss();
    if (searching) history.addQuery(query);
    history.addOpened(item.key);
    if (item.scope === 'documents') {
      const file = files.get(item.key.slice('documents:'.length));
      if (file) {
        preview.open(file);
        return;
      }
    }
    router.push(item.route as never);
  }

  function pickScope(id: SearchScope | null) {
    setScope(id);
    if (!searching) input.current?.focus();
  }

  const renderRows = (hits: SearchHit[]) => (
    <Surface padded={false} style={{ overflow: 'hidden' }}>
      {hits.map((hit, i) => (
        <ResultRow
          key={hit.item.key}
          item={hit.item}
          scope={scopeById.get(hit.item.scope)}
          terms={terms}
          first={i === 0}
          onPress={() => open(hit.item)}
        />
      ))}
    </Surface>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <AppHeader title="Search" onBack={() => router.back()} />

      {/* Pinned: the box and the chips stay put while results scroll under them. */}
      <View style={{ paddingTop: space.md, gap: space.md, backgroundColor: colors.canvas }}>
        <View style={{ paddingHorizontal: space.lg }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              paddingHorizontal: space.lg,
              borderRadius: radius.pill,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: searching ? colors.accent : colors.hairline,
            }}
          >
            <Ionicons name="search" size={18} color={searching ? colors.accent : colors.inkSecondary} />
            <TextInput
              ref={input}
              value={query}
              onChangeText={setQuery}
              autoFocus
              placeholder={activeScope ? `Search ${activeScope.label.toLowerCase()}` : 'Search anything'}
              placeholderTextColor={colors.inkFaint}
              returnKeyType="search"
              onSubmitEditing={() => searching && history.addQuery(query)}
              autoCorrect={false}
              autoCapitalize="none"
              accessibilityLabel="Search everything"
              style={{ flex: 1, paddingVertical: space.md, fontSize: 15, color: colors.ink }}
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={18} color={colors.inkMuted} />
              </Pressable>
            ) : null}
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md }}
          style={{ flexGrow: 0 }}
        >
          <ScopeChip label="All" count={searching ? allHits.length : undefined} selected={!scope} onPress={() => pickScope(null)} />
          {scopes.map((s) => (
            <ScopeChip
              key={s.id}
              label={s.label}
              icon={s.icon as IconName}
              count={searching ? counts.get(s.id) ?? 0 : undefined}
              selected={scope === s.id}
              onPress={() => pickScope(scope === s.id ? null : s.id)}
            />
          ))}
        </ScrollView>
        <View style={{ height: 1, backgroundColor: colors.hairline }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl + insets.bottom, gap: space.lg }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {!searching ? (
          history.queries.length === 0 && recentItems.length === 0 ? (
            <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.xxxl }}>
              <Ionicons name="search-outline" size={32} color={colors.inkMuted} />
              <Text variant="bodyStrong">
                {activeScope ? `Search ${activeScope.label.toLowerCase()}` : 'Search everything'}
              </Text>
              <Text variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
                Type a name, amount, note, tag, number plate or doctor. Your recent searches will show here.
              </Text>
            </View>
          ) : (
            <>
              {history.queries.length > 0 ? (
                <View style={{ gap: space.sm }}>
                  <Row justify="space-between" align="center">
                    <Label>RECENT SEARCHES</Label>
                    <Pressable onPress={history.clear} hitSlop={8} accessibilityRole="button">
                      <Text variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
                        Clear
                      </Text>
                    </Pressable>
                  </Row>
                  <Surface padded={false} style={{ overflow: 'hidden' }}>
                    {history.queries.map((q, i) => (
                      <Pressable
                        key={q}
                        onPress={() => setQuery(q)}
                        accessibilityRole="button"
                        accessibilityLabel={`Search ${q} again`}
                        style={({ pressed }) => ({
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: space.md,
                          paddingHorizontal: space.lg,
                          paddingVertical: space.md,
                          borderTopWidth: i === 0 ? 0 : 1,
                          borderTopColor: colors.hairline,
                          backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
                        })}
                      >
                        <Ionicons name="time-outline" size={18} color={colors.inkSecondary} />
                        <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>
                          {q}
                        </Text>
                        <Pressable
                          onPress={() => history.removeQuery(q)}
                          hitSlop={10}
                          accessibilityLabel={`Remove ${q} from history`}
                        >
                          <Ionicons name="close" size={16} color={colors.inkMuted} />
                        </Pressable>
                      </Pressable>
                    ))}
                  </Surface>
                </View>
              ) : null}

              {recentItems.length > 0 ? (
                <View style={{ gap: space.sm }}>
                  <Label>RECENTLY OPENED</Label>
                  <Surface padded={false} style={{ overflow: 'hidden' }}>
                    {recentItems.map((item, i) => (
                      <ResultRow
                        key={item.key}
                        item={item}
                        scope={scopeById.get(item.scope)}
                        terms={[]}
                        first={i === 0}
                        onPress={() => open(item)}
                      />
                    ))}
                  </Surface>
                </View>
              ) : null}
            </>
          )
        ) : loading && allHits.length === 0 ? (
          <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.xxxl }}>
            <ActivityIndicator color={colors.inkMuted} />
            <Text variant="caption" tone="secondary">
              Looking through everything…
            </Text>
          </View>
        ) : allHits.length === 0 || (scope && scoped.length === 0) ? (
          <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.xxxl }}>
            <Ionicons name="search-outline" size={32} color={colors.inkMuted} />
            <Text variant="bodyStrong">{`No results for “${query.trim()}”`}</Text>
            <Text variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
              {scope && allHits.length > 0
                ? `Nothing in ${activeScope?.label ?? 'this kind'}, but ${allHits.length} elsewhere.`
                : 'Try fewer words, or a different spelling.'}
            </Text>
            {scope && allHits.length > 0 ? (
              <Pressable onPress={() => setScope(null)} hitSlop={8} accessibilityRole="button">
                <Text variant="small" color={colors.accent} style={{ fontWeight: '700' }}>
                  Show all results
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : scope ? (
          <View style={{ gap: space.sm }}>
            <Label>{`${scoped.length} ${scoped.length === 1 ? 'RESULT' : 'RESULTS'} IN ${activeScope?.label.toUpperCase() ?? ''}`}</Label>
            {renderRows(scoped)}
          </View>
        ) : (
          <>
            <View style={{ gap: space.sm }}>
              <Label>TOP MATCHES</Label>
              {renderRows(grouped.top)}
            </View>
            {grouped.groups.map((group) => (
              <View key={group.scope.id} style={{ gap: space.sm }}>
                <Row justify="space-between" align="center">
                  <Row gap={6} align="center">
                    <Ionicons name={group.scope.icon as IconName} size={13} color={colors.inkMuted} />
                    <Label>{`${group.scope.label.toUpperCase()} · ${group.total}`}</Label>
                  </Row>
                  {group.total > group.hits.length ? (
                    <Pressable onPress={() => setScope(group.scope.id)} hitSlop={8} accessibilityRole="button">
                      <Text variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
                        {`See all ${group.total}`}
                      </Text>
                    </Pressable>
                  ) : null}
                </Row>
                {renderRows(group.hits)}
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {preview.element}
    </View>
  );
}

function ResultRow({
  item,
  scope,
  terms,
  first,
  onPress,
}: {
  item: SearchItem;
  scope: ScopeInfo | undefined;
  terms: string[];
  first: boolean;
  onPress: () => void;
}) {
  const { colors, radius, space, type } = useTheme();
  const kindLabel = item.kind ?? scope?.label;

  let figure: React.ReactNode = null;
  if (item.amountMinor != null && item.amountMinor !== 0) {
    // A refund is money back even on an outgoing line.
    const incoming = item.flow === 'in' ? item.amountMinor > 0 : item.flow === 'out' && item.amountMinor < 0;
    const value = item.flow ? (incoming ? Math.abs(item.amountMinor) : -Math.abs(item.amountMinor)) : item.amountMinor;
    figure = (
      <Text
        variant="figure"
        color={incoming ? colors.completed : colors.ink}
        style={{ fontVariant: ['tabular-nums'] }}
        numberOfLines={1}
      >
        {formatMoney(value, { signed: !!item.flow })}
      </Text>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${kindLabel ?? ''} ${item.title}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.hairline,
        backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
      })}
    >
      <Glyph icon={(item.icon ?? scope?.icon ?? 'search-outline') as IconName} color={scope?.color ?? colors.accent} size={40} />
      <View style={{ flex: 1, gap: 3 }}>
        <RNText numberOfLines={1} style={[type.bodyStrong, { color: colors.ink }]}>
          {highlight(item.title, terms).map((part, i) =>
            part.match ? (
              <RNText key={i} style={{ color: colors.accentInk, backgroundColor: colors.accentSoft }}>
                {part.text}
              </RNText>
            ) : (
              part.text
            ),
          )}
        </RNText>
        <Row gap={6} align="center">
          {kindLabel ? (
            <View
              style={{
                paddingHorizontal: 6,
                paddingVertical: 1,
                borderRadius: radius.pill,
                backgroundColor: colors.surfaceSunken,
              }}
            >
              <Text variant="caption" tone="secondary" style={{ fontSize: 11, fontWeight: '700' }}>
                {kindLabel}
              </Text>
            </View>
          ) : null}
          {item.subtitle ? (
            <Text variant="caption" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
              {item.subtitle}
            </Text>
          ) : null}
        </Row>
      </View>
      {figure}
      <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
    </Pressable>
  );
}

/** Split `text` into runs, marking the start of each word a search term prefixes. */
function highlight(text: string, terms: string[]): { text: string; match: boolean }[] {
  if (terms.length === 0) return [{ text, match: false }];
  const parts: { text: string; match: boolean }[] = [];
  const re = /[A-Za-z0-9À-ɏ]+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const word = m[0];
    const folded = word.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const term = terms.filter((t) => folded.startsWith(t)).sort((a, b) => b.length - a.length)[0];
    if (!term) continue;
    if (m.index > last) parts.push({ text: text.slice(last, m.index), match: false });
    parts.push({ text: word.slice(0, term.length), match: true });
    last = m.index + term.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts;
}

function ScopeChip({
  label,
  icon,
  count,
  selected,
  onPress,
}: {
  label: string;
  icon?: IconName;
  count?: number;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, radius, space } = useTheme();
  const ink = selected ? colors.inkInverse : colors.ink;
  const dim = count === 0 && !selected;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderRadius: radius.pill,
        backgroundColor: selected ? colors.accent : colors.surface,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.hairline,
        opacity: pressed ? 0.7 : dim ? 0.45 : 1,
      })}
    >
      {icon ? <Ionicons name={icon} size={14} color={ink} /> : null}
      <Text variant="small" color={ink} style={{ fontWeight: '600' }}>
        {label}
      </Text>
      {count !== undefined ? (
        <View
          style={{
            minWidth: 18,
            paddingHorizontal: 5,
            borderRadius: radius.pill,
            backgroundColor: selected ? 'rgba(255,255,255,0.22)' : colors.surfaceSunken,
            alignItems: 'center',
          }}
        >
          <Text variant="caption" color={selected ? colors.inkInverse : colors.inkSecondary} style={{ fontSize: 11, fontWeight: '700' }}>
            {count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
