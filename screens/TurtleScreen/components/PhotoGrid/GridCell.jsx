/**
 * GridCell — the photo grid's cells, moved out of MediaGallery verbatim
 * (step 1 of splitting the grid out for cold start; step 2 is the FlashList
 * + scroll plumbing). Three pieces:
 *   • GridItem        — one square: thumbnail, video preview, badges, the
 *                       tap that opens the viewer. React.memo; the parent's
 *                       renderItem decides when it re-renders.
 *   • GridVideoPreview — the muted looping preview for the one active video.
 *   • ShimmerSkeleton  — the loading placeholder rows.
 * Nothing here reads gallery state directly: everything arrives as props.
 */
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { rotatedUrl } from '../../../../utils/mediaRotation';

const { width, height } = Dimensions.get('window');

/** The grid plays a muted preview for the one video in view. */
export const GRID_VIDEO_PREVIEW = true;

export const formatDuration = (seconds) => {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};


// === PREMIUM SEAMLESS SWEEPING SHIMMER SKELETON ===
export const ShimmerSkeleton = React.memo(({ theme }) => {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  // Calculate dynamic size: Exact width divided by columns, no internal margins
  // Ensure numColumns matches what is used in your FlatList (defaulting to 3 here)
  const numColumns = 3; 
  const tileSize = width / numColumns; 

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(shimmerAnim, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [shimmerAnim]);

  // Translate beam width needs to match the tileSize for full sweep coverage
  const translateX = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-tileSize, tileSize]
  });

  // Frosted glass base and light beam colors based on theme
  const baseColor = theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)';
  const shineColor = theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)';

  return (
    <View style={{ 
      width: tileSize, 
      aspectRatio: 1, // Keep squares perfectly symmetrical
      backgroundColor: baseColor, 
      overflow: 'hidden',
      margin: 0, // RIGIDLY enforce zero margin for seamless tiling
      padding: 0, // Ensure no internal padding shifts the image
    }}>
      <Animated.View
        style={[
          StyleSheet.absoluteFillObject,
          { transform: [{ translateX }] }
        ]}
      >
        <LinearGradient
          colors={['transparent', shineColor, 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFillObject}
        />
      </Animated.View>
    </View>
  );
});

// Once-per-session guards for GridItem's self-healing fetches. Without these,
// EVERY mount/recycle of an untagged cell fired /media/tags/sync (and every
// duration-less video cell fired /media/duration) — scrolling a few thousand
// untagged items hammered the server with thousands of requests and kept the
// radio awake. One attempt per media id per app session is plenty for an
// opportunistic background heal.
const tagHealAttempted = new Set();
const durationHealAttempted = new Set();

// ── Grid video preview cell (Instagram-style) ────────────────────────
// Mounted ONLY for the single centermost video once scrolling settles (see
// GRID_VIDEO_PREVIEW + the viewability wiring in MediaGallery). Because it
// mounts on exactly one cell at a time, only ONE expo-video decoder is ever
// alive in the grid — muted, looping — so it stays cool. The static thumbnail
// underneath remains as an instant poster; this fades over it and is wrapped
// pointer-transparent so taps still open the viewer / toggle selection.
// Unmounts (releasing the decoder) the instant the active id moves or the
// user starts scrolling.
export const GridVideoPreview = ({ uri }) => {
  // Fade the video up over its poster thumbnail (matches the photo crossfade
  // aesthetic) so first-frame readiness never shows as a hard cut. Native
  // driver → free; only ever one of these is mounted at a time.
  const fade = useRef(new Animated.Value(0)).current;
  const player = useVideoPlayer(uri, (p) => {
    try {
      p.loop = true;
      p.muted = true;
      // Silent autoplay preview: never claim the audio session, or scrolling
      // the grid would stop the music player (expo-video's default 'auto'
      // mixing mode takes the session even for a muted player).
      p.audioMixingMode = 'mixWithOthers';
      p.play();
    } catch (_) {}
  });
  useEffect(() => {
    const anim = Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [fade]);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]} pointerEvents="none">
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        contentFit="cover"
        nativeControls={false}
      />
    </Animated.View>
  );
};

export const GridItem = React.memo(({ item, openViewer, handleDelete, getFullUrl, getBaseUrl, activeTab, styles, theme, isSelectMode, isSelected, onToggleSelect, gridIndex, onTouchDown, isActiveVideo, cellSize, registerCell }) => {
  // The cell's native view, for the viewer's open-from / fly-back-into-this-
  // tile animation. Registered while mounted so the viewer can measure the
  // cell of whichever photo it is closing on.
  const cellRef = useRef(null);
  useEffect(() => {
    if (!registerCell || item.isSkeleton || !item.id) return undefined;
    registerCell(item.id, cellRef);
    return () => registerCell(item.id, null);
  }, [registerCell, item.id, item.isSkeleton]);
  // UNIFIED CELL: a slot renders the SAME component before and after its data
  // arrives — no early-return into a separate skeleton component. The old
  // early return also sat ABOVE the hooks (conditional hooks!), which is the
  // only reason the lists needed getItemType pool-splitting; with one
  // unconditional shape, one recycle pool serves everything and a resolving
  // slot is just a re-render whose image fades in over the resting tile.
  const isSkeleton = !!item.isSkeleton;
  const isVideo = !isSkeleton && item.type === 'video';
  const [duration, setDuration] = useState(item.duration);
  const [hasFailed, setHasFailed] = useState(false);
  const [localTags, setLocalTags] = useState(item.tags || []);

  // ── State reset on FlashList recycle ─────────────────────────
  // FlashList recycles this component when a cell scrolls off-screen
  // and a new item takes its place. `useState(initial)` initializers
  // only run on the FIRST mount, so without this reset the recycled
  // cell carries the previous item's state (stale hasFailed /
  // duration / tags) into the new render. That's why the OLD
  // image stays visible at full opacity for a beat after scroll, then
  // crossfades to the new one — exactly the "supersede" symptom we
  // were chasing.
  //
  // Pattern: track the most recent item id in a ref; if it changes,
  // call all the relevant setters during render. React queues a
  // single re-render with the new initial values — no useEffect lag,
  // no flash of stale state.
  const prevItemIdRef = useRef(item.id);
  const prevTagsRef = useRef(item.tags);
  if (prevItemIdRef.current !== item.id) {
    prevItemIdRef.current = item.id;
    prevTagsRef.current = item.tags;
    setHasFailed(false);
    setDuration(item.duration);
    setLocalTags(item.tags || []);
  } else if (prevTagsRef.current !== item.tags) {
    // SAME cell, tags changed in place — e.g. a bulk-tag assignment updated THIS
    // item (same id, new tags JSON). Without re-syncing here, localTags stays at
    // the pre-assignment value, so the self-heal below still treats the item as
    // "untagged" and can overwrite the freshly-assigned tags with the file's
    // EXIF keywords (the "my tags don't stick / silently revert" bug).
    prevTagsRef.current = item.tags;
    setLocalTags(item.tags || []);
  }
  
  
  // Self-healing: Fetch missing duration independently without parent re-render
  useEffect(() => {
    let isMounted = true;
    
    // Trigger if it's a video, has no duration, has ANY valid identifier,
    // and hasn't already been asked about this session (recycled cells re-run
    // this effect constantly — the guard caps it at one request per id).
    if (isVideo && !duration && (item.filename || item.id) && !durationHealAttempted.has(item.id)) {
      durationHealAttempted.add(item.id);
      const fetchMissingInfo = async () => {
        try {
          // Send filename if it exists, otherwise rely on the ID
          const fileNameParam = item.filename ? `&filename=${encodeURIComponent(item.filename)}` : '';
          const idParam = item.id ? `&id=${item.id}` : '';
          
          const url = `${getBaseUrl()}/media/duration?tab=${activeTab}${fileNameParam}${idParam}`;
          
          const res = await fetch(url);
          const data = await res.json();
          if (data.success && data.duration && isMounted) {
            setDuration(data.duration);
          }
        } catch (err) {
          // Duration fetch failed silently
        }
      };
      fetchMissingInfo();
    }
    
    return () => { isMounted = false; };
  }, [isVideo, duration, item, activeTab, getBaseUrl]);

  // Self-Healing Tag Check - lazy background sync for missing tags
  useEffect(() => {
    let isMounted = true;
    
    // Only for uploads tab, with missing tags, and has filename
    const hasMissingTags = !localTags || (Array.isArray(localTags) && localTags.length === 0) || localTags === '[]';
    
    if (activeTab === 'uploads' && hasMissingTags && item.filename && !tagHealAttempted.has(item.id)) {
      const healTags = async () => {
        // Claim at fire time (not arm time) so a timer cancelled by recycle
        // doesn't burn the id's single attempt.
        if (tagHealAttempted.has(item.id)) return;
        if (tagHealAttempted.size > 5000) tagHealAttempted.clear(); // bound this process-lifetime guard set
        tagHealAttempted.add(item.id);
        try {
          const url = `${getBaseUrl()}/media/tags/sync?id=${item.id}&filename=${encodeURIComponent(item.filename)}`;
          const res = await fetch(url);
          const data = await res.json();
          
          if (data.success && data.tags?.length > 0 && isMounted) {
            setLocalTags(data.tags);
          }
        } catch (err) {
          // Silent fail - this is a lazy background check
          // Tag sync failed silently
        }
      };
      
      // Lazy delay - let grid settle before checking
      const timer = setTimeout(healTags, 1000);
      return () => { isMounted = false; clearTimeout(timer); };
    }
    
    return () => { isMounted = false; };
  }, [item.id, item.filename, localTags, activeTab, getBaseUrl]);
  
  // ONE thumbnail per cell (sm ≈ 200px WebP), loaded in place. We removed the
  // separate hi-res (lg) overlay tier: it mounted on an idle timer and, under
  // FlashList recycling, would fade an absolutely-positioned image over
  // whichever item the recycled cell currently held — a random, offset overlay
  // landing on the wrong index. At this grid's cell size (~⅓ screen width) the
  // 200px sm is already retina-dense, so lg cost bandwidth + glitches for no
  // visible gain. Falls back to the raw/local url when an item has no generated
  // thumbnail (local device assets).
  // `?r=<angle>` when the photo has been rotated: a rotate overwrites
  // `<id>.webp` IN PLACE and the thumbnail mount is served immutable for 30
  // days, so without the token the cell would keep painting the old bytes.
  // Unrotated photos get the URL untouched, so no existing cache entry moves.
  const smUrl = isSkeleton ? null : rotatedUrl(getFullUrl, item, item.thumbnailUrl || item.url);

  // Quiet static base — the resting tile IS the placeholder (Google Photos
  // style): no shimmer, no pulsing overlay, no extra animated views. Images
  // fade in over it; unresolved slots simply stay quiet.
  const cellBase = theme.mode === 'dark' ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.04)';

  return (
    <TouchableOpacity
      ref={cellRef}
      disabled={isSkeleton}
      // Stable hook for the batch-share E2E flow (.maestro/batch-share.yaml).
      testID={isSkeleton ? undefined : `gallery-cell-${gridIndex}`}
      style={[
        styles.thumbnailContainer,
        // Dynamic pinch-column size; falls back to the stylesheet's 3-col size.
        cellSize != null && { width: cellSize, height: cellSize },
        { backgroundColor: cellBase },
        isSelectMode && isSelected && { opacity: 0.8 },
      ]}
      onPress={(e) => {
        if (isSelectMode) { onToggleSelect(item.id, gridIndex); return; }
        // The viewer grows out of THIS tile: measure the cell's window rect
        // (a bounding box — the mirrored grid transform leaves it intact) and
        // hand over centre + size. Falls back to the bare tap point if the
        // measurement fails, which still anchors the pop here.
        const tap = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
        const node = cellRef.current;
        if (node && typeof node.measureInWindow === 'function') {
          node.measureInWindow((x, y, w, h) => {
            openViewer(item, w > 0 && h > 0 ? { x: x + w / 2, y: y + h / 2, width: w, height: h } : tap);
          });
        } else {
          openViewer(item, tap);
        }
      }}
      onPressIn={(e) => onTouchDown?.(gridIndex, e.nativeEvent.pageX, e.nativeEvent.pageY)}
      onLongPress={() => !isSelectMode && handleDelete(item.id)}
      activeOpacity={0.8}
    >
      {/* Selection Checkmark Overlay */}
      {isSelectMode && !isSkeleton && (
        <View style={{
          position: 'absolute', bottom: 6, right: 6, width: 22, height: 22, borderRadius: 11,
          backgroundColor: isSelected ? theme.colors.primary : 'rgba(0,0,0,0.3)',
          borderWidth: 1.5, borderColor: isSelected ? theme.colors.primary : '#fff',
          justifyContent: 'center', alignItems: 'center', zIndex: 10
        }}>
          {isSelected && <Icon name="check" size={14} color={theme.colors.background} />}
        </View>
      )}
      
      {hasFailed ? (
        // Fallback for failed images
        <View style={[styles.thumbnail, styles.failedThumbnail]}>
          <Icon 
            name={isVideo ? 'video-off' : 'image-off'} 
            size={32} 
            color="#888" 
          />
          <Text style={styles.failedText}>
            {isVideo ? 'Video' : 'Image'}
          </Text>
        </View>
      ) : !isSkeleton && (
        /* The single thumbnail. expo-image paints the blurhash placeholder
           instantly (zero network) and cross-fades to the loaded image over
           `transition` ms — blur-up, in place, over the quiet tile.
           recyclingKey makes a recycled cell drop the old texture so the
           fade is always placeholder→image, never stale→fresh. 120ms keeps
           the reveal uniform and snappy across a whole landing page. */
        <Image
          source={{ uri: smUrl }}
          style={styles.thumbnail}
          contentFit="cover"
          recyclingKey={item.id}
          transition={120}
          cachePolicy="memory-disk"
          placeholder={item.blurhash ? { blurhash: item.blurhash } : null}
          placeholderContentFit="cover"
          onError={() => setHasFailed(true)}
        />
      )}
      {/* Centermost video auto-plays a muted, looping preview over its poster
          thumbnail once the grid settles (one decoder at a time). */}
      {isActiveVideo && isVideo && !isSkeleton && !hasFailed && smUrl && (
        <GridVideoPreview uri={getFullUrl(item.rawUrl || item.url)} />
      )}
      {item.size && item.size > 100 * 1024 * 1024 && (
        <View style={styles.largeFileBadge}>
          <Icon name="alert-circle-outline" size={10} color="#fff" />
          <Text style={styles.largeFileText}>{(item.size / (1024 * 1024)).toFixed(0)}MB</Text>
        </View>
      )}
      {isVideo && (
        <View style={styles.durationBadge}>
          {duration ? (
            <Text style={styles.durationText}>{formatDuration(duration)}</Text>
          ) : (
            <Icon name="play" size={12} color="#fff" />
          )}
        </View>
      )}
      {item.type === 'document' && (
        <View style={styles.documentOverlay}>
          <Icon name="file-document" size={32} color="#888" />
        </View>
      )}
    </TouchableOpacity>
  );
});
