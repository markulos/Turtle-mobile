/**
 * The files a note carries, inside the note.
 *
 * A saved note holds only ids, so this fetches them (GET /media/by-ids) and
 * renders what comes back. It is the mobile half of the web app's
 * NoteAttachments — same endpoint, same image/chip split, same "a note outlives
 * its files" tolerance — with one deliberate difference at the end: tapping an
 * image opens the in-note viewer rather than handing off to the media vault.
 *
 * Behaviours worth keeping:
 *  - An id whose media was deleted simply does not come back, and the strip
 *    renders the rest, saying how many are gone.
 *  - It fetches once per id SET, not per array identity: the note object is
 *    rebuilt on every list refresh, and re-fetching on each of those would put
 *    the strip in a permanent spinner.
 *  - It never opens the vault. The viewer takes URLs, so nothing here depends
 *    on the gallery being loaded, or on the photo being in it at all.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useServer } from '../../context/ServerContext';
import { depth } from '../../utils/surfaceDepth';
import { tapHaptic } from '../../utils/haptics';
import {
  DEFAULT_RATIO,
  MAX_IMAGE_H,
  fileCountLabel,
  missingLabel,
  splitAttachments,
  stripThumbUrl,
  viewerImages,
} from './attachments';

/**
 * One inline image.
 *
 * Height is computed, not declared: RN has no `height: auto` for a remote
 * image, so the frame stays the width of the page and takes its height from the
 * picture's own aspect ratio (learned on load), capped at MAX_IMAGE_H. That is
 * what the web strip's `width:100%; height:auto; max-height:340px` does, spelled
 * out. `contain` means the cap letterboxes a very tall image rather than
 * cropping its subject out.
 */
function AttachmentImage({ item, uri, index, onPress, onRemove, styles, theme }) {
  const [ratio, setRatio] = useState(DEFAULT_RATIO);
  const [width, setWidth] = useState(0);

  const onLoad = useCallback((e) => {
    const src = e?.source;
    if (src?.width > 0 && src?.height > 0) setRatio(src.width / src.height);
  }, []);

  const height = width > 0 ? Math.min(width / ratio, MAX_IMAGE_H) : MAX_IMAGE_H;

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={[styles.imageFrame, { height }]}>
      <TouchableOpacity
        activeOpacity={0.85}
        onPressIn={() => tapHaptic()}
        onPress={() => onPress(index)}
        style={StyleSheet.absoluteFill}
        accessibilityRole="imagebutton"
        accessibilityLabel={item.name ? `Open ${item.name}` : 'Open attached image'}
      >
        <ExpoImage
          testID={`note-attachment-${item.id}`}
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          transition={120}
          cachePolicy="memory-disk"
          onLoad={onLoad}
          accessible={false}
        />
      </TouchableOpacity>
      {onRemove && (
        <TouchableOpacity
          onPress={() => onRemove(item)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.removeBtn}
          accessibilityRole="button"
          accessibilityLabel={item.name ? `Remove ${item.name}` : 'Remove attachment'}
        >
          <Icon name="close" size={14} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
}

/**
 * `onRemove(item)` is optional: with it the strip is the note's EDITOR (each
 * attachment gets an ✕), without it the strip is read-only. The composer is
 * the only surface that can change a note, so it is the only one that passes it.
 */
export default function NoteAttachments({ mediaIds, theme, isDark, onOpenImage, onRemove }) {
  const { api, getBaseUrl, getMediaBaseUrl } = useServer();
  const [items, setItems] = useState(null);
  const [failed, setFailed] = useState(false);
  const styles = useMemo(() => attachmentStyles(theme, isDark), [theme, isDark]);

  // Join the ids so the effect re-runs when the SET changes, not when the array
  // identity does.
  const ids = Array.isArray(mediaIds) ? mediaIds.filter(Boolean) : [];
  const key = ids.join(',');

  // Media BYTES go to the probed HTTP/2 origin when there is one (same choice
  // the gallery makes, so a thumbnail already in expo-image's cache is a hit
  // here too); the JSON goes through `api`, which uses the http origin. Stored
  // paths are /api-relative, so strip the base's own /api suffix.
  const origin = (getMediaBaseUrl ? getMediaBaseUrl() : getBaseUrl()).replace(/\/api$/, '');

  // Rows resolved so far, by id. The id set CHANGES while the composer is open
  // — every file added appends one — and without this the whole strip would
  // drop to "Loading…" each time, blinking the pictures you already had off
  // the screen to re-fetch them.
  const cacheRef = useRef(new Map());

  useEffect(() => {
    if (!key) { setItems([]); return undefined; }
    let alive = true;
    const wanted = key.split(',');
    const known = wanted.map((id) => cacheRef.current.get(id)).filter(Boolean);
    setItems(known.length > 0 ? known : null);
    setFailed(false);
    api.get(`/media/by-ids?ids=${encodeURIComponent(key)}`)
      .then((r) => {
        if (!alive) return;
        const list = Array.isArray(r?.items) ? r.items : [];
        for (const m of list) cacheRef.current.set(String(m.id), m);
        setItems(list);
      })
      .catch(() => {
        if (!alive) return;
        // Keep what we already had rather than emptying the strip over one
        // failed refresh — only a strip with nothing in it is worth a message.
        if (known.length > 0) { setItems(known); return; }
        setItems([]);
        setFailed(true);
      });
    return () => { alive = false; };
  }, [key, api]);

  const { images, others } = useMemo(() => splitAttachments(items), [items]);
  // Built once per result set so the viewer gets a stable list — it pages
  // across the whole note, and the index the strip reports indexes this.
  const openable = useMemo(() => viewerImages(origin, images), [origin, images]);

  const open = useCallback((index) => {
    onOpenImage?.(openable, index);
  }, [onOpenImage, openable]);

  // An ordinary note is not given an empty section to explain.
  if (!key) return null;

  const note = missingLabel({ asked: ids.length, got: (items || []).length, failed });

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{fileCountLabel(ids.length)}</Text>

      {items === null ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={theme.colors.textTertiary} />
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      ) : (
        <>
          {/* An IMAGE attached to a note is part of the note — a screenshot
              pasted into a bug report IS the report. So images render at
              reading size here, not as chips you have to leave the note to
              see. The large thumbnail is what's shown: the original can be tens
              of megabytes, and this is a page you scroll past. Tapping one
              opens the full-size viewer. */}
          {images.length > 0 && (
            <View style={styles.imageStack}>
              {images.map((m, i) => (
                <AttachmentImage
                  key={m.id}
                  item={m}
                  index={i}
                  uri={stripThumbUrl(origin, m)}
                  onPress={open}
                  onRemove={onRemove}
                  styles={styles}
                  theme={theme}
                />
              ))}
            </View>
          )}

          {/* Everything that isn't a viewable image — documents, video, an
              image whose thumbnail never generated. A filename is the useful
              thing about those, and mobile has no hover title to hide it in,
              so the chip carries it. Not tappable: opening a document is the
              vault's job, and a chip that does nothing when pressed is kinder
              than one that bounces you out of the note. */}
          {others.length > 0 && (
            <View style={styles.chipRow}>
              {others.map((m) => {
                const thumb = stripThumbUrl(origin, m);
                return (
                  <View key={m.id} style={styles.chip}>
                    {thumb ? (
                      <ExpoImage
                        source={{ uri: thumb }}
                        style={styles.chipThumb}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                      />
                    ) : (
                      <View style={styles.chipThumb}>
                        <Icon name="file-document-outline" size={16} color={theme.colors.textTertiary} />
                      </View>
                    )}
                    <Text style={styles.chipLabel} numberOfLines={1}>
                      {m.name || m.id}
                    </Text>
                    {onRemove && (
                      <TouchableOpacity
                        onPress={() => onRemove(m)}
                        hitSlop={{ top: 10, bottom: 10, left: 6, right: 10 }}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${m.name || m.id}`}
                      >
                        <Icon name="close" size={14} color={theme.colors.textMuted} />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {note ? <Text style={styles.note}>{note}</Text> : null}
        </>
      )}
    </View>
  );
}

const attachmentStyles = (theme, isDark) => StyleSheet.create({
  section: { gap: 7, marginBottom: 14 },
  heading: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: theme.colors.textTertiary,
  },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  loadingText: { fontSize: 12, color: theme.colors.textTertiary },
  imageStack: { gap: 8 },
  imageFrame: {
    width: '100%',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceElevated,
    ...depth(theme, 'control'),
  },
  // Sits ON the picture, so it carries its own contrast rather than the
  // theme's — a surface-coloured button vanishes against a bright photo.
  removeBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  // Wraps, and each chip may shrink — a long filename must never run past the
  // page's edge (global styling rule: nothing oversets its container).
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexShrink: 1,
    maxWidth: '100%',
    paddingRight: 10,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceElevated,
  },
  chipThumb: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
  },
  chipLabel: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '500',
    color: theme.colors.textSecondary,
  },
  note: { fontSize: 11.5, color: theme.colors.textTertiary },
});
