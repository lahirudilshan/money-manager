import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, TextInput, View } from 'react-native';
import {
  BottomSheet,
  Button,
  Divider,
  GradientButton,
  Label,
  Row,
  Surface,
  Text,
} from '~/shared/components/ui';
import {
  connectedAccount,
  driveBlocker,
  folderMembers,
  inviteToFolder,
  isSignedIn,
  revokeMember,
  signIn,
  type FolderMember,
} from '~/features/backup/logic/googleDrive';
import { settingsRepo, SETTINGS_KEYS } from '../../src/db/repositories';
import { useModalClose } from '~/shared/hooks/useModalClose';
import { useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';
import type { SyncResult } from '~/features/sync/logic/syncDrive';

/**
 * Sharing the app with a second phone, by invitation.
 *
 * ## Why an invite rather than one shared login
 *
 * Both phones could simply sign into the same Google account, and that was the
 * first design. It means handing over a password, and there is no way to
 * un-share short of changing it. Inviting the other person's OWN account to the
 * Drive folder is better on every axis that matters here: nobody shares
 * credentials, Drive's own permissions become the access control, the invite is
 * visible in both accounts, and revoking is one tap.
 *
 * The invited phone signs into its own Google account and finds the folder
 * under "Shared with me" — see `findSharedFolderRequest`.
 */
/**
 * One step of the setup, numbered.
 *
 * The screen was four flat cards of equal weight, which hid the fact that this
 * is a SEQUENCE: connect, then invite, then sync. A number and a done-state
 * make the order explicit and show at a glance how far through it the user is —
 * and a step already satisfied stops competing for attention.
 */
function Step({
  index,
  title,
  hint,
  done,
  children,
}: {
  index: number;
  title: string;
  hint?: string;
  done?: boolean;
  children?: React.ReactNode;
}) {
  const { colors, space } = useTheme();

  return (
    <Surface style={{ padding: space.md, gap: space.md }}>
      <Row align="center" gap={space.md}>
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: done ? colors.completed : colors.surfaceSunken,
          }}
        >
          {done ? (
            <Ionicons name="checkmark" size={15} color="#fff" />
          ) : (
            <Text variant="caption" tone="muted" style={{ fontWeight: '800' }}>
              {index}
            </Text>
          )}
        </View>

        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">{title}</Text>
          {hint ? (
            <Text variant="caption" tone="muted">
              {hint}
            </Text>
          ) : null}
        </View>
      </Row>

      {children}
    </Surface>
  );
}

export default function SyncSettings() {
  const { colors, space, radius } = useTheme();
  const closeModal = useModalClose();

  const runDriveSync = useAppStore((s) => s.runDriveSync);

  const blocker = driveBlocker();
  const [signedIn, setSignedIn] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [members, setMembers] = useState<FolderMember[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(
    settingsRepo.get(SETTINGS_KEYS.lastSyncAt) ?? null,
  );

  const loadMembers = useCallback(async () => {
    setMembers(await folderMembers());
  }, []);

  useEffect(() => {
    void (async () => {
      const connected = await isSignedIn();
      setSignedIn(connected);
      if (!connected) return;
      setAccount(await connectedAccount());
      await loadMembers();
    })();
  }, [loadMembers]);

  async function connect() {
    setBusy(true);
    try {
      const outcome = await signIn();
      if (outcome.ok) {
        setSignedIn(true);
        setAccount(await connectedAccount());
        await loadMembers();
      } else if (outcome.error) {
        Alert.alert('Could not connect', outcome.error);
      }
    } finally {
      setBusy(false);
    }
  }

  async function invite() {
    setInviting(true);
    try {
      const outcome = await inviteToFolder(email);
      if (!outcome.ok) {
        Alert.alert('Could not invite', outcome.error ?? 'Try again.');
        return;
      }
      setEmail('');
      await loadMembers();
      Alert.alert(
        'Invitation sent',
        'They will get an email from Drive. Once they open this app and connect the same address, both phones stay in sync.',
      );
    } finally {
      setInviting(false);
    }
  }

  function confirmRevoke(member: FolderMember) {
    Alert.alert(
      `Remove ${member.email ?? 'this person'}?`,
      'Their phone stops syncing. Data already on it stays there — this only ends the sharing.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await revokeMember(member.id);
              await loadMembers();
            })();
          },
        },
      ],
    );
  }

  const sync = useCallback(async () => {
    setBusy(true);
    try {
      const outcome = await runDriveSync();
      setResult(outcome);
      if (outcome.ok) setLastSyncAt(settingsRepo.get(SETTINGS_KEYS.lastSyncAt) ?? null);
      if (outcome.signedOut) setSignedIn(false);
    } finally {
      setBusy(false);
    }
  }, [runDriveSync]);

  /** Everyone except the account signed in here — the people invited. */
  const invited = members.filter((member) => !member.owner);

  return (
    <BottomSheet
      visible
      asRoute
      scroll
      onClose={closeModal}
      title="Sync with another phone"
      icon="sync-outline"
      iconColor={colors.accent}
      footer={
        signedIn ? (
          <GradientButton
            label={busy ? 'Syncing…' : 'Sync now'}
            icon="sync"
            disabled={busy}
            onPress={() => void sync()}
          />
        ) : undefined
      }
    >
      {blocker !== 'none' ? (
        <Surface style={{ padding: space.md }}>
          <Text variant="body">
            {blocker === 'no-client-id'
              ? 'Google sign-in is not configured in this build.'
              : 'This build predates the sign-in modules. Rebuild the app to use sync.'}
          </Text>
        </Surface>
      ) : (
        <>
          {/*
            A one-line explanation before the steps.

            Without it the screen opens on "1 Connect your Google account",
            which answers HOW before the reader knows WHAT — and this feature
            shares every transaction they have, so it should say so first.
          */}
          <Text variant="small" tone="muted">
            Share this app with someone else&apos;s phone. You each keep your own Google account —
            they just get access to one folder in your Drive.
          </Text>

          <Step
            index={1}
            title={signedIn ? (account ?? 'Google Drive') : 'Connect your Google account'}
            hint={signedIn ? 'Connected' : 'The folder lives in your own Drive'}
            done={signedIn}
          >
            {!signedIn ? (
              <Button
                label={busy ? 'Connecting…' : 'Connect Google Drive'}
                icon="logo-google"
                disabled={busy}
                onPress={() => void connect()}
              />
            ) : null}
          </Step>

          <Step
            index={2}
            title="Invite the other phone"
            hint={
              invited.length > 0
                ? `Sharing with ${invited.length} ${invited.length === 1 ? 'person' : 'people'}`
                : 'Drive emails them an invitation'
            }
            done={invited.length > 0}
          >
            {signedIn ? (
              <>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.sm,
                    backgroundColor: colors.surfaceSunken,
                    borderRadius: radius.md,
                    paddingHorizontal: space.md,
                  }}
                >
                  <Ionicons name="mail-outline" size={16} color={colors.inkMuted} />
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    placeholder="their@email.com"
                    placeholderTextColor={colors.inkMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    style={{ flex: 1, paddingVertical: 11, fontSize: 15, color: colors.ink }}
                  />
                </View>

                <Button
                  label={inviting ? 'Inviting…' : 'Send invitation'}
                  icon="person-add-outline"
                  disabled={inviting || !email.includes('@')}
                  onPress={() => void invite()}
                />

                {/* Who has access, inside the step that granted it. */}
                {invited.length > 0 ? (
                  <View style={{ gap: space.xs }}>
                    <Divider />
                    {invited.map((member) => (
                      <Row key={member.id} align="center" gap={space.sm}>
                        <Ionicons name="person-circle" size={22} color={colors.accent} />
                        <View style={{ flex: 1 }}>
                          <Text variant="body" numberOfLines={1}>
                            {member.email ?? 'Invited account'}
                          </Text>
                          <Text variant="caption" tone="muted">
                            {member.role === 'writer' ? 'Can add and edit' : member.role}
                          </Text>
                        </View>
                        <Button
                          label="Remove"
                          variant="ghost"
                          size="sm"
                          onPress={() => confirmRevoke(member)}
                        />
                      </Row>
                    ))}
                  </View>
                ) : null}
              </>
            ) : (
              <Text variant="caption" tone="muted">
                Connect your account first.
              </Text>
            )}
          </Step>

          <Step
            index={3}
            title="Keep both phones in step"
            hint={
              lastSyncAt
                ? `Last synced ${new Date(lastSyncAt).toLocaleString()}`
                : 'Not synced yet'
            }
            done={Boolean(lastSyncAt)}
          >
            {busy ? (
              <Row align="center" gap={space.sm}>
                <ActivityIndicator size="small" />
                <Text variant="caption" tone="muted">
                  Merging with the other phone…
                </Text>
              </Row>
            ) : null}

            {/*
              Counts, not a bare "done" — "3 received" is checkable against what
              the other person just added, and proves the sync did something.
            */}
            {result && !busy ? (
              result.ok ? (
                <Row align="center" gap={space.sm}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.completed} />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong" color={colors.completed}>
                      {result.pulled === 0 && result.pushed === 0 ? 'Already up to date' : 'Synced'}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {result.pulled} received · {result.pushed} sent
                      {result.conflicts > 0 ? ` · ${result.conflicts} both had` : ''}
                    </Text>
                  </View>
                </Row>
              ) : (
                <Row align="center" gap={space.sm}>
                  <Ionicons name="alert-circle" size={18} color={colors.danger} />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong" color={colors.danger}>
                      Sync failed
                    </Text>
                    <Text variant="caption" tone="muted">
                      {result.error}
                    </Text>
                  </View>
                </Row>
              )
            ) : null}
          </Step>

          {/*
            What sharing means and how a clash resolves — both things to know
            BEFORE inviting, not to discover afterwards.
          */}
          <Row gap={space.sm} align="flex-start" style={{ paddingHorizontal: 2 }}>
            <Ionicons name="information-circle-outline" size={15} color={colors.inkMuted} />
            <Text variant="caption" tone="muted" style={{ flex: 1 }}>
              Anyone you invite sees every transaction, category, loan and tracker. Changes merge
              row by row, so you can both add things at once — if you both edit the same item, the
              most recent edit is kept.
            </Text>
          </Row>
        </>
      )}
    </BottomSheet>
  );
}
