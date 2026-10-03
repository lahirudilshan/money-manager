import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const HOLD_DURATION_MS = 5000;

export function ComingSoonGate({ onUnlock }: { onUnlock: () => void }) {
  const [progress, setProgress] = useState(0);
  const holdStartedAt = useRef<number | null>(null);
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdCompleted = useRef(false);

  useEffect(
    () => () => {
      if (holdTimer.current) clearInterval(holdTimer.current);
    },
    [],
  );

  function startHold() {
    if (holdTimer.current) clearInterval(holdTimer.current);
    holdCompleted.current = false;
    holdStartedAt.current = Date.now();
    setProgress(0);
    holdTimer.current = setInterval(() => {
      const elapsed = Date.now() - (holdStartedAt.current ?? Date.now());
      const nextProgress = Math.min(elapsed / HOLD_DURATION_MS, 1);
      setProgress(nextProgress);
      if (nextProgress >= 1) {
        if (holdTimer.current) clearInterval(holdTimer.current);
        holdTimer.current = null;
        holdStartedAt.current = null;
        holdCompleted.current = true;
        onUnlock();
      }
    }, 40);
  }

  function cancelHold() {
    if (holdCompleted.current) return;
    if (holdTimer.current) clearInterval(holdTimer.current);
    holdTimer.current = null;
    holdStartedAt.current = null;
    setProgress(0);
  }

  return (
    <View style={styles.overlay}>
      <LinearGradient
        colors={['#D8F36A', '#9FE3B9', '#73D5D0']}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.topLine}>
          <View style={styles.mark}>
            <View style={styles.markShort} />
            <View style={styles.markLong} />
            <View style={styles.markMedium} />
          </View>
          <Text style={styles.topLabel}>A NEW WAY TO FEEL IN CONTROL</Text>
        </View>

        <View style={styles.hero}>
          <View style={styles.artwork}>
            <View style={styles.artworkTop}>
              <View style={styles.artworkMark}>
                <Ionicons name="wallet-outline" size={26} color="#E9F59D" />
              </View>
              <View style={styles.artworkDiamond} />
            </View>
            <View style={styles.artworkRule} />
            <View style={styles.artworkBottom}>
              <View style={styles.artworkLineWide} />
              <View style={styles.artworkLineShort} />
              <View style={styles.artworkGlyph}>
                <Ionicons name="arrow-up" size={17} color="#13211C" />
              </View>
            </View>
          </View>
          <Text accessibilityRole="header" style={styles.brand}>supiriyak</Text>
          <Text style={styles.headline}>is coming soon.</Text>
          <Text style={styles.subtitle}>A fresh start for your money is nearly here.</Text>
        </View>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Hold for five seconds to continue"
            accessibilityHint="Releasing early cancels the hold."
            onPressIn={startHold}
            onPressOut={cancelHold}
            onTouchCancel={cancelHold}
            style={({ pressed }) => [styles.holdButton, pressed && styles.holdButtonPressed]}
          >
            <View style={styles.buttonCopy}>
              <Ionicons name="hand-left-outline" size={19} color="#F7F9E8" />
              <Text style={styles.buttonLabel}>
                {progress > 0
                  ? `Keep holding  ·  ${Math.min(progress * 5, 5).toFixed(1)}s`
                  : 'Hold to continue'}
              </Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
            </View>
          </Pressable>
          <Text style={styles.footerNote}>Opening access for this session</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  // `absoluteFillObject` does not exist on this RN version's StyleSheet type.
  overlay: { ...StyleSheet.absoluteFill, zIndex: 1000, elevation: 1000 },
  safeArea: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingTop: 12,
    paddingBottom: 16,
  },
  topLine: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  mark: { width: 24, height: 24, justifyContent: 'center', gap: 3 },
  markShort: { width: 11, height: 3, borderRadius: 2, backgroundColor: '#17251E' },
  markLong: { width: 22, height: 3, borderRadius: 2, backgroundColor: '#17251E' },
  markMedium: { width: 16, height: 3, borderRadius: 2, backgroundColor: '#17251E' },
  topLabel: { color: '#203229', fontSize: 10, fontWeight: '800', letterSpacing: 0 },
  hero: { alignItems: 'center', paddingVertical: 12 },
  artwork: {
    width: 164,
    height: 132,
    padding: 16,
    marginBottom: 34,
    borderRadius: 8,
    backgroundColor: '#15241E',
    transform: [{ rotate: '-5deg' }],
    shadowColor: '#1D5445',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  artworkTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  artworkMark: {
    width: 43,
    height: 43,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#34483C',
  },
  artworkDiamond: {
    width: 25,
    height: 25,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#73816A',
    transform: [{ rotate: '45deg' }],
  },
  artworkRule: { height: 1, marginTop: 12, backgroundColor: '#38473D' },
  artworkBottom: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  artworkLineWide: {
    width: 35,
    height: 5,
    marginBottom: 4,
    borderRadius: 3,
    backgroundColor: '#9EDAB1',
  },
  artworkLineShort: {
    width: 20,
    height: 5,
    marginBottom: 4,
    borderRadius: 3,
    backgroundColor: '#597D68',
  },
  artworkGlyph: {
    width: 29,
    height: 29,
    marginLeft: 'auto',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#D8F36A',
  },
  brand: {
    color: '#14231C',
    fontFamily: 'Georgia',
    fontSize: 46,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 54,
    textAlign: 'center',
  },
  headline: {
    marginTop: 3,
    color: '#14231C',
    fontFamily: 'Georgia',
    fontSize: 24,
    letterSpacing: 0,
    lineHeight: 32,
    textAlign: 'center',
  },
  subtitle: {
    maxWidth: 270,
    marginTop: 13,
    color: '#34483C',
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 0,
    lineHeight: 21,
    textAlign: 'center',
  },
  footer: { gap: 11 },
  holdButton: {
    minHeight: 66,
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingTop: 13,
    paddingBottom: 10,
    borderRadius: 8,
    backgroundColor: '#17251E',
  },
  holdButtonPressed: { backgroundColor: '#263B30' },
  buttonCopy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  buttonLabel: { color: '#F7F9E8', fontSize: 15, fontWeight: '700', letterSpacing: 0 },
  progressTrack: {
    height: 3,
    marginTop: 9,
    overflow: 'hidden',
    borderRadius: 2,
    backgroundColor: '#45584A',
  },
  progressFill: { height: '100%', borderRadius: 2, backgroundColor: '#D8F36A' },
  footerNote: { color: '#34483C', fontSize: 11, letterSpacing: 0, textAlign: 'center' },
});
