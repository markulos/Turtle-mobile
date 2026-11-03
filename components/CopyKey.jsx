/**
 * CopyKey — the one copy control, and the one "Copied" it says back.
 *
 * It began inside MarkdownText's fenced block. A chat bubble needs the same
 * key for the same reason, and the interesting part is not the clipboard call
 * — it is everything around it: the haptic, the fact that `copyText` can come
 * back 'none' (no clipboard AND the share sheet dismissed), the word that
 * flashes back, how long it stays, and not setting state on a component that
 * has since scrolled out of the list. A second hand-rolled copy of that would
 * drift on every one of those points, and the one it would get wrong is the
 * 'none' guard — the version that claims "Copied" when nothing was copied.
 *
 * `label` off gives the icon alone, for a key that has to sit beside a
 * timestamp rather than in a header strip of its own.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { tapHaptic } from '../utils/haptics';
import { copyText } from '../utils/copyText';

const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

export default function CopyKey({
  text,
  // Show the word next to the glyph. Off for a key with no room for it.
  label = true,
  size = 13,
  color,
  doneColor,
  accessibilityLabel = 'Copy',
  testID,
  style,
}) {
  // null → idle; otherwise the word to show back ('Copied' / 'Shared').
  const [done, setDone] = useState(null);
  const timer = useRef(null);
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onCopy = useCallback(async () => {
    tapHaptic();
    const result = await copyText(text);
    // 'none' means the clipboard was unavailable AND the share sheet was
    // dismissed — claiming "Copied" there would be a lie.
    if (result === 'none' || !alive.current) return;
    setDone(result === 'shared' ? 'Shared' : 'Copied');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (alive.current) setDone(null); }, 1600);
  }, [text]);

  const ink = done ? (doneColor || color) : color;

  return (
    <Pressable
      onPress={onCopy}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={done ? 'Copied' : accessibilityLabel}
      testID={testID}
      style={({ pressed }) => [styles.key, style, pressed && { opacity: 0.6 }]}
    >
      <Icon name={done ? 'check' : 'content-copy'} size={size} color={ink} />
      {label ? <Text style={[styles.text, { color: ink }]}>{done || 'Copy'}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  key: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  text: { fontSize: 11, fontWeight: '600' },
});
