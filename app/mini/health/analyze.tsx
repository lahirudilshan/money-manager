import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, View } from 'react-native';
import { Screen } from '~/shared/components/Screen';
import { Button, Empty, GradientButton, Label, Row, Surface, Text } from '~/shared/components/ui';
import { useDriveGate } from '~/shared/components/DriveConnectSheet';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { attachmentGate } from '~/shared/lib/attachmentGate';
import { pickPdfFiles } from '~/shared/lib/attachmentPicker';
import { deletePersistedImage, persistPickedFile } from '~/shared/lib/imageStorage';
import { isPdfAttachment, localRef } from '~/shared/lib/imageRef';
import { resolveImageUri } from '~/shared/lib/imageCache';
import { healthDocumentRepo, healthVisitRepo } from '~/db/repositories';
import { useAppStore } from '~/store/useAppStore';
import Constants from 'expo-constants';
import { isAiAvailable } from '~/features/health/services/firebaseAi';
import { userGeminiKey } from '~/features/health/services/userGemini';
import {
  connectedAccount,
  isDriveAvailable,
  isSignedIn,
  signIn,
} from '~/features/backup/logic/googleDrive';
import { giveAiConsent, hasAiConsent, isAiEnabled } from '~/features/health/services/aiSettings';
import { analyseDocuments } from '~/features/health/services/analyseReports';
import {
  AnalyseLog,
  AnalyseProgressCard,
  type AnalyseLogLine,
  type AnalyseRunState,
} from '~/features/health/components/AnalyseProgressCard';
import { AiDisclaimer } from '~/features/health/components/LabUi';
import {
  analyseProgress,
  lockScreenDone,
  lockScreenFailed,
  lockScreenText,
} from '~/features/health/logic/analyseProgress';
import { startBackgroundJob } from '~/shared/lib/backgroundWork';
import { titleFromFileName } from '~/features/health/logic/labReports';
import { OwnGoogleAiCard } from '~/features/health/components/OwnGoogleAiCard';
import {
  beginAnalyseRun,
  dismissAnalyseRun,
  finishAnalyseRun,
  isAnalyseRunning,
  updateAnalyseRun,
  useActiveAnalyseRun,
} from '~/features/health/services/analyseRun';

/**
 * Upload lab reports and have them read by AI.
 *
 * Three states on one screen — set up, add files, reading — rather than three
 * screens, because each is short and the user should be able to see where they
 * are in the whole job: the set-up is a one-time step that disappears for good
 * once done.
 *
 * Files are saved as documents BEFORE the AI is called. If the network drops
 * or the free quota runs out, the reports are still kept and the same batch
 * can be read again with one tap.
 */

interface Staged {
  key: string;
  /** Local file, already copied into app storage. */
  uri: string;
  isPdf: boolean;
  /** The picked file's own name — the document's title until the AI names it. */
  name?: string | null;
  /** Set once saved as a health document. */
  documentId?: string;
}

export default function AnalyzeReports() {
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ person?: string; docs?: string; visit?: string }>();
  const people = useAppStore((s) => s.healthPeople);
  const drive = useDriveGate();

  const [personId, setPersonId] = useState<string | null>(params.person ?? null);
  const person = people.find((p) => p.id === personId) ?? people[0];
  /*
   * Opened from a person's page (every entry point passes them), so whose
   * reports these are is already decided — no picker. Only a bare link with
   * no valid person falls back to asking.
   */
  const personChosen = people.some((p) => p.id === params.person);

  const [ready, setReady] = useState<'checking' | 'off' | 'setup' | 'ready'>('checking');

  /*
   * Which visit these reports came out of, if any.
   *
   * One consultation often sends someone for several tests; linking the scan
   * to the visit keeps every report and the AI's verdict inside that visit on
   * the timeline. Offered from the person's recent visits, pre-set when the
   * scan was started from a visit's page.
   */
  const recentVisits = useMemo(() => {
    if (!person) return [];
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    return healthVisitRepo
      .byPerson(person.id)
      .filter((v) => v.visitedAt.getTime() >= cutoff)
      .slice(0, 5);
  }, [person]);
  const [visitId, setVisitId] = useState<string | null>(params.visit ?? null);
  const [staged, setStaged] = useState<Staged[]>([]);
  /*
   * The run lives in a shared store, not this screen: leave mid-reading and
   * the Health home, Documents and Labs carry on showing it (see analyseRun.ts).
   */
  const active = useActiveAnalyseRun();
  const progress = active && !active.outcome ? active.run : null;
  /** Whether the run on screen was started by this screen, or one left earlier. */
  const startedHere = useRef(false);
  const watching = useRef(false);
  if (progress && !startedHere.current) watching.current = true;
  // Came back to a run started earlier: take its ending as if it were ours.
  useEffect(() => {
    const outcome = active?.outcome;
    if (!outcome || !watching.current || startedHere.current) return;
    watching.current = false;
    dismissAnalyseRun();
    if (outcome.ok) router.replace(`/mini/health/analysis?id=${outcome.analysisId}`);
    else setError(outcome.error);
  }, [active?.outcome, router]);
  /** The last run's log, kept after it ends so a failure can be looked into. */
  const [lastLog, setLastLog] = useState<AnalyseLogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  /*
   * Leaving mid-analysis is allowed: the reading carries on and its results
   * are saved to the person's record as usual. Only the jump to the results
   * page is skipped, so the user is not pulled back to a screen they left.
   */
  const left = useRef(false);
  useEffect(
    () => () => {
      left.current = true;
    },
    [],
  );

  // On focus, so turning AI on in Settings and coming back opens the screen.
  useFocusEffect(
    useCallback(() => {
      setReady((current) =>
        current === 'ready' && isAiEnabled()
          ? current
          : !isAiEnabled()
            ? 'off'
            : hasAiConsent()
              ? 'ready'
              : 'setup',
      );
    }, []),
  );

  // Opened from saved documents: those are the batch.
  useEffect(() => {
    if (!params.docs || !person) return;
    const ids = params.docs.split(',');
    const docs = healthDocumentRepo.byPerson(person.id).filter((d) => ids.includes(d.id));
    setStaged(
      docs.map((doc) => {
        const uri = resolveImageUri(doc.imageUri) ?? '';
        return {
          key: doc.id,
          uri,
          isPdf: isPdfAttachment(uri || doc.imageUri),
          documentId: doc.id,
        };
      }),
    );
  }, [params.docs, person]);

  async function addPhotos(source: 'camera' | 'library') {
    await drive.ensureDriveChoice();
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    // Higher quality than a receipt: small print on a lab table must survive.
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsMultipleSelection: true,
            selectionLimit: 10,
            quality: 0.8,
          });
    if (result.canceled) return;

    const added: Staged[] = [];
    for (const asset of result.assets) {
      const uri = await persistPickedFile(asset.uri, 'jpg');
      added.push({ key: uri, uri, isPdf: false, name: asset.fileName });
    }
    setStaged((current) => [...current, ...added]);
    setError(null);
  }

  async function addPdfs() {
    await drive.ensureDriveChoice();
    const picked = await pickPdfFiles({ multiple: true });
    if (!picked.ok) {
      if (picked.error) Alert.alert('Could not open Files', picked.error);
      return;
    }
    const added: Staged[] = [];
    for (const file of picked.files) {
      const uri = await persistPickedFile(file.uri, 'pdf');
      added.push({ key: uri, uri, isPdf: true, name: file.name });
    }
    setStaged((current) => [...current, ...added]);
    setError(null);
  }

  function removeStaged(item: Staged) {
    // A file not yet saved as a document is only ours; one that is, is kept.
    if (!item.documentId) deletePersistedImage(item.uri);
    setStaged((current) => current.filter((s) => s.key !== item.key));
  }

  async function run() {
    if (!person || staged.length === 0 || isAnalyseRunning()) return;
    startedHere.current = true;
    setError(null);
    const startedAt = Date.now();
    const log: AnalyseLogLine[] = [];
    const addLog = (text: string) => log.push({ at: (Date.now() - startedAt) / 1000, text });
    addLog(`Starting with ${staged.length} ${staged.length === 1 ? 'file' : 'files'}`);
    beginAnalyseRun({
      personId: person.id,
      personName: person.name,
      documentIds: staged.flatMap((s) => (s.documentId ? [s.documentId] : [])),
      run: {
        stage: 'saving-files',
        done: 0,
        total: staged.length,
        pages: staged.length,
        startedAt,
        thinkingAt: null,
        log: [...log],
      },
    });

    // 1. Keep the files, whatever happens next.
    const saved = staged.map((item) => {
      if (item.documentId) return item;
      const doc = healthDocumentRepo.create({
        personId: person.id,
        visitId,
        // The file's own name until the read gives it a short, plain one.
        title: titleFromFileName(item.name),
        kind: 'report',
        imageUri: localRef(item.uri),
        documentDate: new Date(),
      });
      return { ...item, documentId: doc.id };
    });
    setStaged(saved);
    updateAnalyseRun(() => ({ documentIds: saved.map((s) => s.documentId as string) }));
    const fresh = saved.filter((item, i) => !staged[i]?.documentId).length;
    addLog(fresh > 0 ? `Saved ${fresh} to Prescriptions & reports` : 'Using reports already saved');

    // 2. Read them — and keep reading if the phone is locked or the user
    // switches apps: iOS keeps the app running and shows the progress on the
    // Lock Screen (see backgroundWork.ts). Ticked every second because iOS
    // ends a task whose progress stops moving, and Gemini's silent "looking"
    // stretch is otherwise long enough to look stalled.
    const live: {
      stage: AnalyseRunState['stage'];
      done?: number;
      total?: number;
      thinkingAt: number | null;
      explainAt: number | null;
      status: string | null;
    } = { stage: 'reading', thinkingAt: null, explainAt: null, status: null };
    const elapsed = () => (Date.now() - startedAt) / 1000;
    const lockText = () =>
      lockScreenText({
        personName: person.name,
        stage: live.stage,
        status: live.status,
        pages: staged.length,
        thinkingSeconds: live.thinkingAt ? (Date.now() - live.thinkingAt) / 1000 : 0,
        elapsedSeconds: elapsed(),
      });
    const job = startBackgroundJob({
      ...lockText(),
      onExpire: () => addLog('iOS stopped the background reading — open Dayly to finish'),
    });
    if (job.kept) addLog('Will keep reading if you lock the phone');
    const tick = () =>
      job.update({
        ...lockText(),
        fraction: analyseProgress({
          stage: live.stage,
          done: live.done,
          total: live.total,
          thinkingSeconds: live.thinkingAt ? (Date.now() - live.thinkingAt) / 1000 : 0,
          written: live.done,
          pages: staged.length,
          explainSeconds: live.explainAt ? (Date.now() - live.explainAt) / 1000 : 0,
          results: live.total,
        }),
      });
    const ticker = job.kept ? setInterval(tick, 1000) : null;

    /** The results page was opened as soon as the numbers were saved. */
    let openedEarly = false;
    const result = await analyseDocuments({
      person,
      documentIds: saved.map((s) => s.documentId as string),
      onRenamed: () => useAppStore.getState().refreshMiniAppData(),
      // The numbers are what the user waits for: show them now, and let the
      // explanation fill the same page in when it lands.
      onSaved: ({ analysisId }) => {
        updateAnalyseRun(() => ({ analysisId }));
        useAppStore.getState().refreshMiniAppData();
        if (left.current) return;
        openedEarly = true;
        router.replace(`/mini/health/analysis?id=${analysisId}`);
      },
      onProgress: (event) => {
        if (event.log) addLog(event.log);
        live.stage = event.step;
        live.done = event.done;
        live.total = event.total;
        if (event.status) live.status = event.status;
        if (event.step === 'thinking') live.thinkingAt ??= Date.now();
        if (event.step === 'explaining') live.explainAt ??= Date.now();
        updateAnalyseRun(({ run: current }) => ({
          run: {
            ...current,
            stage: event.step,
            done: event.done,
            total: event.total,
            thinkingAt:
              event.step === 'thinking' ? (current.thinkingAt ?? Date.now()) : current.thinkingAt,
            explainAt:
              event.step === 'explaining'
                ? (current.explainAt ?? Date.now())
                : (current.explainAt ?? null),
            log: [...log],
          },
        }));
      },
    }).catch((error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : 'Something went wrong while reading.',
    }));
    if (ticker) clearInterval(ticker);
    if (result.ok) {
      job.update({
        ...lockScreenDone({
          personName: person.name,
          results: result.results,
          flagged: result.flagged,
          elapsedSeconds: elapsed(),
        }),
        fraction: 1,
      });
    } else {
      addLog(`Stopped: ${result.error}`);
      job.update({ ...lockScreenFailed({ personName: person.name, error: result.error }), fraction: 1 });
    }
    // A moment for the last words to reach the Lock Screen before iOS closes the card.
    setTimeout(() => job.finish(result.ok), 1500);
    useAppStore.getState().refreshMiniAppData();
    setLastLog([...log]);
    finishAnalyseRun(
      result.ok
        ? { ok: true, analysisId: result.analysisId, results: result.results, flagged: result.flagged }
        : { ok: false, error: result.error },
    );
    // Still on this screen: the outcome is shown here, so the banners need not.
    // Already looking at the results: nothing left for the banners to say.
    if (!left.current || openedEarly) dismissAnalyseRun();
    /*
     * Upload AFTER the read, not before: the Drive file is named and filed by
     * the report's title, date and person (see attachmentPlacement), and those
     * are only known once the AI has read the paper. Uploading first filed
     * every report as "Lab report" under today's date.
     */
    attachmentGate().afterAttach();

    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (left.current) return;
    router.replace(`/mini/health/analysis?id=${result.analysisId}`);
  }

  if (!person) {
    return (
      <Screen title="Analyse lab reports" onBack={() => router.back()}>
        <Text variant="body" tone="secondary">
          Add a person in Health first.
        </Text>
      </Screen>
    );
  }

  if (ready === 'checking') {
    return (
      <Screen title="Analyse lab reports" onBack={() => router.back()}>
        <ActivityIndicator color={colors.accent} />
      </Screen>
    );
  }

  if (ready === 'off') {
    return (
      <Screen title="Analyse lab reports" onBack={() => router.back()}>
        <Empty
          icon="sparkles-outline"
          title="AI is turned off"
          message="You turned off AI features, so reports are not sent to AI. Your saved reports and results are still here. Turn AI on in Settings to read new reports."
          actionLabel="Open AI settings"
          onAction={() => router.push('/settings/ai')}
        />
      </Screen>
    );
  }

  if (ready === 'setup') {
    return <AiSetup onDone={() => setReady('ready')} onBack={() => router.back()} />;
  }

  const running = progress !== null;

  return (
    <Screen
      title="Analyse lab reports"
      onBack={() => router.back()}
      footer={
        running ? null : (
          <GradientButton
            label={
              staged.length === 0
                ? 'Add a report to start'
                : error
                  ? 'Try again'
                  : `Analyse ${staged.length} ${staged.length === 1 ? 'page' : 'pages'} with AI`
            }
            icon="sparkles"
            disabled={staged.length === 0}
            onPress={run}
          />
        )
      }
    >
      {drive.sheet}

      {people.length > 1 && !personChosen && !running ? (
        <View style={{ gap: space.sm }}>
          <Label>WHOSE REPORTS</Label>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: space.sm }}
          >
            {people.map((p) => {
              const selected = p.id === person.id;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setPersonId(p.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={{
                    paddingHorizontal: space.lg,
                    paddingVertical: space.sm,
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: selected ? colors.accent : colors.hairline,
                    backgroundColor: selected ? colors.accentSoft : colors.surface,
                  }}
                >
                  <Text
                    variant="small"
                    color={selected ? colors.accentInk : colors.ink}
                    style={{ fontWeight: '700' }}
                  >
                    {p.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {progress ? (
        <AnalyseProgressCard run={progress} personName={active?.personName ?? person.name} />
      ) : (
        <>
          {error ? (
            <View
              style={{
                flexDirection: 'row',
                gap: space.sm,
                padding: space.md,
                borderRadius: radius.md,
                backgroundColor: colors.dangerSoft,
              }}
            >
              <Ionicons
                name="alert-circle"
                size={18}
                color={colors.danger}
                style={{ marginTop: 1 }}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">Could not read the reports</Text>
                <Text variant="small">{error}</Text>
                <Text variant="caption" tone="secondary">
                  Your files are saved in Prescriptions & reports either way.
                </Text>
              </View>
            </View>
          ) : null}
          {error ? <AnalyseLog log={lastLog} /> : null}

          <View style={{ gap: space.sm }}>
            <Label>ADD REPORTS</Label>
            <Row style={{ gap: space.sm }}>
              <AddTile
                icon="camera"
                label="Take photo"
                color={colors.accent}
                onPress={() => addPhotos('camera')}
              />
              <AddTile
                icon="images"
                label="From photos"
                color={colors.completed}
                onPress={() => addPhotos('library')}
              />
              <AddTile
                icon="document-text"
                label="PDF files"
                color={colors.pending}
                onPress={addPdfs}
              />
            </Row>
            <Text variant="caption" tone="secondary">
              Add every page. Lay the paper flat in good light so small numbers are sharp.
            </Text>
          </View>

          {recentVisits.length > 0 ? (
            <View style={{ gap: space.sm }}>
              <Label>PART OF A DOCTOR VISIT?</Label>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: space.sm }}
              >
                {[{ id: null as string | null, label: 'No' }, ...recentVisits.map((v) => ({
                  id: v.id as string | null,
                  label: `${v.visitedAt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}${v.doctor ? ` · ${v.doctor}` : v.reason ? ` · ${v.reason}` : ''}`,
                }))].map((option) => {
                  const selected = visitId === option.id;
                  return (
                    <Pressable
                      key={option.id ?? 'none'}
                      onPress={() => setVisitId(option.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={{
                        paddingHorizontal: space.md,
                        paddingVertical: space.sm,
                        borderRadius: radius.pill,
                        borderWidth: 1,
                        borderColor: selected ? colors.accent : colors.hairline,
                        backgroundColor: selected ? colors.accentSoft : colors.surface,
                      }}
                    >
                      <Text
                        variant="small"
                        color={selected ? colors.accentInk : colors.ink}
                        style={{ fontWeight: selected ? '700' : '500' }}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          {staged.length > 0 ? (
            <View style={{ gap: space.sm }}>
              <Label>{`READY TO READ · ${staged.length}`}</Label>
              <Surface padded={false} style={{ overflow: 'hidden' }}>
                {staged.map((item, index) => (
                  <Row
                    key={item.key}
                    style={{
                      gap: space.md,
                      alignItems: 'center',
                      padding: space.md,
                      borderTopWidth: index === 0 ? 0 : 1,
                      borderTopColor: colors.hairline,
                    }}
                  >
                    {item.isPdf || !item.uri ? (
                      <View
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: radius.sm,
                          backgroundColor: colors.dangerSoft,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Ionicons name="document-text" size={22} color={colors.danger} />
                      </View>
                    ) : (
                      <Image
                        source={{ uri: item.uri }}
                        style={{ width: 44, height: 44, borderRadius: radius.sm }}
                      />
                    )}
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyStrong">{`Page ${index + 1}`}</Text>
                      <Text variant="caption" tone="secondary">
                        {item.isPdf ? 'PDF' : 'Photo'}
                        {item.documentId ? ' · saved' : ''}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => removeStaged(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove page ${index + 1}`}
                      hitSlop={10}
                    >
                      <Ionicons name="close-circle" size={22} color={colors.inkMuted} />
                    </Pressable>
                  </Row>
                ))}
              </Surface>
            </View>
          ) : null}

          {/* Their own Google allowance, so the shared daily limit stops mattering. */}
          <OwnGoogleAiCard onChange={() => setError(null)} />

          <AiDisclaimer />
        </>
      )}
    </Screen>
  );
}

function AddTile({
  icon,
  label,
  color,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
}) {
  const { colors, radius, space } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: 'center',
        gap: space.sm,
        paddingVertical: space.lg,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: colors.hairlineStrong,
        backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
      })}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: radius.md,
          backgroundColor: `${color}1A`,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text variant="caption" style={{ fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * One-time set-up: sign in with Google, and agree to where reports go.
 *
 * No key, no AI Studio — the app's own Firebase project talks to Gemini (see
 * services/firebaseAi.ts). The Google sign-in is the same one that backs files
 * up to Drive, so for most people it is already done and this screen is one
 * tap. The privacy note is not fine print: it is said in full before the first
 * medical report leaves the phone, and agreeing is the button.
 */
function AiSetup({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const { colors, radius, space } = useTheme();
  const [account, setAccount] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Without a Drive client in this build there is no Google sign-in to offer;
  // consent alone is then enough rather than a step nobody can complete.
  const googleAvailable = isDriveAvailable();
  // State, not a constant: setting up the user's own Google AI below makes AI
  // available on a build that has no allowance of Dayly's to offer.
  const [aiAvailable, setAiAvailable] = useState(isAiAvailable());

  useEffect(() => {
    void (async () => {
      await userGeminiKey();
      setAiAvailable(isAiAvailable());
      const yes = googleAvailable ? await isSignedIn() : true;
      setSignedIn(yes);
      if (yes && googleAvailable) setAccount(await connectedAccount());
    })();
  }, [googleAvailable]);

  async function signInWithGoogle() {
    setBusy(true);
    setError(null);
    const result = await signIn();
    setBusy(false);
    if (result.ok) {
      setSignedIn(true);
      setAccount(await connectedAccount());
      // Files attached before signing in can go up to Drive now.
      attachmentGate().afterAttach();
    } else if (result.error) {
      setError(result.error);
    }
  }

  function agree() {
    giveAiConsent();
    onDone();
  }

  const showFreePlanNote = !Constants.expoConfig?.extra?.firebase?.paidPlan;

  return (
    <Screen
      title="Analyse reports with AI"
      onBack={onBack}
      footer={
        signedIn ? (
          <GradientButton
            label="Agree and continue"
            icon="checkmark"
            disabled={!aiAvailable}
            onPress={agree}
          />
        ) : (
          <GradientButton
            label={busy ? 'Opening Google…' : 'Continue with Google'}
            icon="logo-google"
            disabled={busy || signedIn === null}
            onPress={signInWithGoogle}
          />
        )
      }
    >
      <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.md }}>
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: radius.xl,
            backgroundColor: colors.accentSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="sparkles" size={30} color={colors.accent} />
        </View>
        <Text variant="title" style={{ textAlign: 'center' }}>
          Understand your reports
        </Text>
        <Text variant="body" tone="secondary" style={{ textAlign: 'center' }}>
          AI reads every result and explains it in simple words — what is normal, what is high or
          low, and what it affects.
        </Text>
      </View>

      {!aiAvailable ? (
        <Row
          style={{
            gap: space.sm,
            padding: space.md,
            borderRadius: radius.md,
            backgroundColor: colors.dangerSoft,
            alignItems: 'flex-start',
          }}
        >
          <Ionicons name="alert-circle" size={18} color={colors.danger} style={{ marginTop: 1 }} />
          <Text variant="small" style={{ flex: 1 }}>
            AI reading is not available in this version of the app yet.
          </Text>
        </Row>
      ) : null}

      {googleAvailable ? (
        <Surface>
          <Row style={{ gap: space.md, alignItems: 'center' }}>
            <Ionicons
              name={signedIn ? 'checkmark-circle' : 'person-circle-outline'}
              size={26}
              color={signedIn ? colors.completed : colors.inkSecondary}
            />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">
                {signedIn ? 'Signed in with Google' : 'Sign in with Google'}
              </Text>
              <Text variant="caption" tone="secondary">
                {signedIn
                  ? (account ?? 'Your reports are also kept safe in your Drive.')
                  : 'The same sign-in keeps your reports safe in your Google Drive.'}
              </Text>
            </View>
          </Row>
        </Surface>
      ) : null}

      {error ? (
        <Row style={{ gap: space.sm, alignItems: 'flex-start' }}>
          <Ionicons name="alert-circle" size={16} color={colors.danger} style={{ marginTop: 2 }} />
          <Text variant="small" style={{ flex: 1 }}>
            {error}
          </Text>
        </Row>
      ) : null}

      {/* Offered here too: setting up their own allowance is a one-time choice. */}
      <OwnGoogleAiCard onChange={() => setAiAvailable(isAiAvailable())} />


      <View
        style={{
          gap: space.sm,
          padding: space.lg,
          borderRadius: radius.lg,
          backgroundColor: colors.surfaceSunken,
        }}
      >
        <Row style={{ gap: space.sm, alignItems: 'center' }}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.inkSecondary} />
          <Text variant="bodyStrong">Before you agree</Text>
        </Row>
        <Text variant="small" tone="secondary">
          • The reports you choose are sent to Google’s Gemini AI to be read. Nothing is sent unless
          you tap “Read with AI”.
        </Text>
        {showFreePlanNote ? (
          <Text variant="small" tone="secondary">
            • Google may use what is sent to improve its products. If that is not okay for medical
            reports, do not continue.
          </Text>
        ) : null}
        <Text variant="small" tone="secondary">
          • The results are saved on this phone, so looking them up later works offline and sends
          nothing.
        </Text>
      </View>

      <AiDisclaimer />
    </Screen>
  );
}
