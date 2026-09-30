/**
 * ImageEditor — the viewer's pencil key. One tool for now: rotate a quarter
 * turn clockwise.
 *
 * Rendered as an IN-TREE absolute overlay, deliberately NOT a <Modal> — same
 * reason AlbumActionsSheet gives: the vault can itself sit inside one (the
 * chat's vault overlay), and on iOS a second sibling Modal over an open one
 * silently never appears.
 *
 * Chrome is fixed dark rather than themed, matching ViewerChrome. An editor
 * that sits on top of a photograph has to be neutral around it, and a light
 * theme's surface would wash out the very thing being edited.
 *
 * HOW THE PREVIEW WORKS, AND WHY THERE'S NO expo-image-manipulator HERE.
 * Rotating is a `transform`, so the preview is free and instant: no decode, no
 * re-encode, no temp file, nothing to clean up. The pond does the real work on
 * Save, with sharp, from the original bytes — which is both lossless (the angle
 * is stored as metadata, not baked into a re-compressed JPEG) and far cheaper
 * than shipping a 25 MB HEIC up and back down. So the phone never needs an
 * image-manipulation library for this, and "Rotate" stays instant even on a
 * photo whose full-resolution bytes have never been downloaded.
 *
 * The fit trick: for a quarter turn the frame's width/height are SWAPPED before
 * the rotation is applied, so the rotated result lands exactly inside the
 * measured stage instead of overflowing it. `contentFit="contain"` then letters
 * the photo into that swapped frame, which is what a person turning a photo
 * expects to see.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { impactHaptic, notifyHaptic, tapHaptic } from '../../../utils/haptics';
import { rotationOf, withRotation } from '../../../utils/mediaRotation';

/** Where the rotated frame's long edge goes — see the fit trick above. */
const isQuarterTurn = (deg) => deg % 180 !== 0;

/**
 * A sentence a person can act on, out of whatever the api client threw.
 *
 * ServerContext's apiPost rejects non-2xx with `API Error 400: {"success":
 * false,"message":"…"}` — the status and the raw JSON body glued into one
 * string. Shown as-is that's the worst kind of error message, so dig the
 * server's own `message`/`error` out of it when it's there.
 */
function humanError(e) {
  const raw = (e && e.message) || '';
  const brace = raw.indexOf('{');
  if (brace >= 0) {
    try {
      const body = JSON.parse(raw.slice(brace));
      if (body.message || body.error) return body.message || body.error;
    } catch { /* not JSON after all — fall through to the raw text */ }
  }
  return raw || 'Could not rotate this photo.';
}

export default function ImageEditor({
  visible,
  item,
  api,
  getFullUrl,
  colors,
  insets = { top: 0, bottom: 0 },
  bottomInset = 0,
  onClose,
  onSaved,
  onError,
}) {
  // Quarter turns the user has added IN THIS SESSION of the editor, 0–3. Kept
  // separate from the item's stored angle so Cancel is a no-op by construction
  // and Save can send a single relative delta.
  const [turns, setTurns] = useState(0);
  const [saving, setSaving] = useState(false);
  const [stage, setStage] = useState({ w: 0, h: 0 });

  const stored = rotationOf(item);
  const preview = (stored + turns * 90) % 360;
  const dirty = turns % 4 !== 0;

  // Reopening on a different photo (or the same one after a save) must not
  // inherit the last session's turns.
  useEffect(() => {
    if (visible) { setTurns(0); setSaving(false); }
  }, [visible, item?.id]);

  // The photo as it currently IS — the display tier at its stored angle, so
  // the editor opens showing exactly what the viewer was showing.
  const uri = useMemo(() => {
    if (!item?.id || typeof getFullUrl !== 'function') return null;
    return withRotation(getFullUrl(`/api/media/display/${item.id}`), stored);
  }, [item?.id, getFullUrl, stored]);

  const onStageLayout = useCallback((e) => {
    const { width, height } = e.nativeEvent.layout;
    setStage((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  }, []);

  const rotate = useCallback(() => {
    if (saving) return;
    impactHaptic();
    setTurns((t) => (t + 1) % 4);
  }, [saving]);

  const cancel = useCallback(() => {
    if (saving) return;
    tapHaptic();
    onClose?.();
  }, [saving, onClose]);

  const save = useCallback(async () => {
    if (saving) return;
    // Nothing moved — closing is the whole correct behaviour. Posting a 0°
    // rotate would still make the pond re-render every thumbnail tier.
    if (!dirty) { tapHaptic(); onClose?.(); return; }
    setSaving(true);
    try {
      const res = await api.post(`/media/${item.id}/rotate`, { degrees: (turns % 4) * 90 });
      if (!res?.success) throw new Error(res?.message || res?.error || 'Rotate failed');
      notifyHaptic();
      // Hand back the server's own view of the row. The angle, the swapped
      // width/height, the fresh thumbnail URLs and the now-null compressedUrl
      // all have to land together or the grid renders the new thumbnail in the
      // old aspect.
      onSaved?.({
        rotation: res.rotation,
        width: res.width,
        height: res.height,
        thumbnailUrl: res.thumbnailUrl,
        thumbnailLgUrl: res.thumbnailLgUrl,
        blurhash: res.blurhash,
        compressedUrl: res.compressedUrl ?? null,
      });
      onClose?.();
    } catch (e) {
      // Stay OPEN on failure, with the turns still applied, so the user can
      // retry without setting the rotation up again.
      setSaving(false);
      onError?.(humanError(e));
    }
  }, [saving, dirty, api, item?.id, turns, onSaved, onClose, onError]);

  if (!visible || !item) return null;

  // Swap the frame for a quarter turn so the rotated photo fits the stage.
  const frame = isQuarterTurn(turns * 90)
    ? { width: stage.h, height: stage.w }
    : { width: stage.w, height: stage.h };
  const tint = colors?.primary || '#3b82f6';

  return (
    <View style={styles.root} testID="image-editor">
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Text style={styles.title} numberOfLines={1}>Edit photo</Text>
      </View>

      <View style={styles.stage} onLayout={onStageLayout} testID="image-editor-stage">
        {stage.w > 0 && !!uri && (
          <Image
            source={{ uri }}
            style={[frame, { transform: [{ rotate: `${turns * 90}deg` }] }]}
            contentFit="contain"
            transition={0}
            cachePolicy="memory-disk"
            placeholder={item.blurhash ? { blurhash: item.blurhash } : null}
            testID="image-editor-preview"
          />
        )}
        {saving && (
          <View style={styles.savingVeil} pointerEvents="none">
            <ActivityIndicator size="large" color="#fff" />
          </View>
        )}
      </View>

      <View style={[styles.tools, { paddingBottom: bottomInset + 14 }]}>
        {/* The one tool. Laid out as a row so adding crop/straighten later is
            an extra child, not a re-layout. */}
        <View style={styles.toolRow}>
          <Pressable
            onPress={rotate}
            disabled={saving}
            style={({ pressed }) => [styles.tool, pressed && styles.pressed, saving && styles.disabled]}
            accessibilityRole="button"
            accessibilityLabel="Rotate 90 degrees clockwise"
            testID="image-editor-rotate"
          >
            <Icon name="rotate-right" size={26} color="#fff" />
            <Text style={styles.toolLabel}>Rotate</Text>
          </Pressable>
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={cancel}
            disabled={saving}
            style={({ pressed }) => [styles.action, pressed && styles.pressed, saving && styles.disabled]}
            accessibilityRole="button"
            testID="image-editor-cancel"
          >
            <Text style={styles.actionText}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={save}
            disabled={saving}
            style={({ pressed }) => [
              styles.action,
              styles.saveAction,
              { backgroundColor: dirty ? tint : 'rgba(255,255,255,0.14)' },
              pressed && styles.pressed,
              saving && styles.disabled,
            ]}
            accessibilityRole="button"
            testID="image-editor-save"
          >
            <Text style={[styles.actionText, styles.saveText]}>
              {saving ? 'Saving…' : 'Save'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    zIndex: 60,
  },
  header: {
    paddingHorizontal: 18,
    paddingBottom: 10,
  },
  title: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  savingVeil: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  tools: {
    paddingTop: 14,
    paddingHorizontal: 18,
    gap: 16,
  },
  toolRow: {
    flexDirection: 'row',
    // Wrap + shrink per the app-wide rule: a tool row must never lay out past
    // its own edge once there is more than one tool in it.
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
  },
  tool: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    flexShrink: 1,
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  toolLabel: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  action: {
    flex: 1,
    flexShrink: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  saveAction: {},
  actionText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  saveText: {
    color: '#fff',
  },
  pressed: {
    opacity: 0.6,
  },
  disabled: {
    opacity: 0.5,
  },
});
