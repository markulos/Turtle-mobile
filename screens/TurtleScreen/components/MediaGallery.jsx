import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Animated,
  Pressable,
  ScrollView,
  Platform,
  Easing,
  PanResponder,
  InteractionManager,
  TextInput,
  Keyboard,
  InputAccessoryView,
  KeyboardAvoidingView,
  RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { FlashList } from '@shopify/flash-list';
import { useTheme } from '../../../context/ThemeContext';

// Create an animated version of FlashList to match our existing architecture
const AnimatedFlashList = Animated.createAnimatedComponent(FlashList);
import { useServer } from '../../../context/ServerContext';

// Constants for hitSlop to prevent re-renders
const HIT_SLOP_10 = { top: 10, bottom: 10, left: 10, right: 10 };
const HIT_SLOP_15 = { top: 15, bottom: 15, left: 15, right: 15 };
const HIT_SLOP_20 = { top: 20, bottom: 20, left: 20, right: 20 };

// Sophisticated breathing pulse skeleton for image loading
const ImageSkeleton = ({ style }) => {
  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  const { theme } = useTheme();

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.85,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulseAnim]);

  return (
    <Animated.View
      style={[
        style,
        {
          backgroundColor: 'transparent',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          opacity: pulseAnim,
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 1,
        },
      ]}
    />
  );
};

// Grid-level skeleton for initial loading state
const GridSkeleton = () => {
  const pulseAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.7,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulseAnim]);

  // Generate 9 skeleton items (3x3 grid)
  const skeletonItems = Array.from({ length: 9 }, (_, i) => i);

  return (
    <View style={{ flex: 1, paddingHorizontal: 0, paddingTop: 8 }}>
      <View style={styles.flexRowWrap}>
        {skeletonItems.map((index) => (
          <Animated.View
            key={index}
            style={{
              width: width / 3 - 0.5,
              height: width / 3 - 0.5,
              margin: 0.25,
              backgroundColor: '#E1E9EE',
              opacity: pulseAnim,
            }}
          />
        ))}
      </View>
    </View>
  );
};

import { useAuth } from '../../../context/AuthContext';

const { width, height } = Dimensions.get('window');
const THUMBNAIL_SIZE = width / 3 - 0.5; 
const GAP = 15; // 💎 WIDENED TO 15px FOR PREMIUM SEPARATION
const ITEM_WIDTH = width + GAP;

// Full-screen video player component (extracted from main component)
const FullScreenVideoPlayer = ({ sourceUrl, isActive, styles, insets }) => {
  const player = useVideoPlayer(sourceUrl, player => {
    player.loop = true;
    player.muted = true;
  });
  const [isPlaying, setIsPlaying] = useState(isActive);
  const [isMuted, setIsMuted] = useState(true);

  useEffect(() => {
    if (isActive) { player.play(); setIsPlaying(true); } 
    else { player.pause(); player.currentTime = 0; player.muted = true; setIsMuted(true); setIsPlaying(false); }
  }, [isActive, player]);

  const togglePlay = () => { isPlaying ? player.pause() : player.play(); setIsPlaying(!isPlaying); };
  const toggleMute = () => { player.muted = !isMuted; setIsMuted(!isMuted); };

  return (
    <Pressable onPress={togglePlay} style={styles.viewerVideoContainer}>
      <VideoView style={styles.viewerVideo} player={player} contentFit="contain" nativeControls={false} />
      <TouchableOpacity 
        style={[styles.muteButton, { top: insets.top + 16, left: 16, position: 'absolute' }]} 
        onPress={toggleMute} 
        activeOpacity={0.7}
      >
        <Icon name={isMuted ? 'volume-off' : 'volume-high'} size={24} color="#fff" />
      </TouchableOpacity>
    </Pressable>
  );
};

// Progressive image component with blurhash → compressed → RAW layers
const ProgressiveImage = ({ media, style, contentFit, onError, isActive, onRawLoad, getFullUrl, api }) => {
  const [shouldLoadRaw, setShouldLoadRaw] = useState(false);
  const [highResLoaded, setHighResLoaded] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // 1. STRICT SWIPE GUARD & 1-SECOND DELAY
  useEffect(() => {
    if (!isActive) {
      setShouldLoadRaw(false);
      setHighResLoaded(false);
      fadeAnim.setValue(0);
      return;
    }

    if (!media.compressedUrl && api) {
      api.post(`/media/${media.id}/compress`).catch(() => {});
    }

    const timer = setTimeout(() => {
      setShouldLoadRaw(true);
    }, 1000);
    
    return () => clearTimeout(timer);
  }, [isActive, media, fadeAnim, api]);

  // 2. SMOOTH CROSSFADE ON LOAD
  useEffect(() => {
    if (shouldLoadRaw && highResLoaded) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    }
    
    if (!isActive) {
      fadeAnim.setValue(0);
    }
  }, [shouldLoadRaw, highResLoaded, isActive, fadeAnim]);

  const compressedUri = media.compressedUrl 
    ? getFullUrl(media.compressedUrl)
    : getFullUrl(media.rawUrl || media.url);
  const rawUri = getFullUrl(media.rawUrl || media.url);

  return (
    <View style={[style, { backgroundColor: '#000', overflow: 'hidden' }]}>
      {/* LAYER 1: Fast compressed image (Base Layer - ALWAYS MOUNTED) */}
      <Image
        source={{ uri: compressedUri }}
        style={StyleSheet.absoluteFillObject}
        contentFit={contentFit}
        transition={0}
        cachePolicy="memory-disk"
        placeholder={media.blurhash ? { blurhash: media.blurhash } : null}
        placeholderContentFit="cover"
      />

      {/* LAYER 2: High-res RAW (Overlays compressed when ready) */}
      {shouldLoadRaw && isActive && (
        <Animated.View style={[StyleSheet.absoluteFillObject, { opacity: fadeAnim, zIndex: 2 }]} pointerEvents="none">
          <Image
            source={{ uri: rawUri }}
            style={StyleSheet.absoluteFillObject}
            contentFit={contentFit}
            transition={0}
            cachePolicy="disk"
            priority="high"
            onLoad={() => {
              setHighResLoaded(true);
              if (onRawLoad) onRawLoad();
            }}
            onError={onError}
          />
        </Animated.View>
      )}
    </View>
  );
};

// Image viewer component with pinch-to-zoom (extracted from main component)
const ImageViewer = ({ fullResUrl, mediaId, isActive, item, styles, getFullUrl, api }) => {
  const scrollRef = useRef(null);
  const lastTapRef = useRef(0);
  const isZoomedRef = useRef(false);

  // 1. Track HD State
  const [rawLoaded, setRawLoaded] = useState(false);

  // Reset HD state when user swipes away
  useEffect(() => {
    if (!isActive) setRawLoaded(false);
  }, [isActive]);
  
  // Reset zoom when mediaId changes (swipe to different image)
  useEffect(() => {
    if (scrollRef.current && isZoomedRef.current) {
      scrollRef.current.scrollResponderZoomTo({
        x: 0,
        y: 0,
        width: width,
        height: height,
        animated: false,
      });
      isZoomedRef.current = false;
    }
  }, [mediaId]);
  
  const handleDoubleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) { // 300ms double-tap window
      // Toggle zoom
      if (scrollRef.current) {
        if (!isZoomedRef.current) {
          // Zoom in to center
          scrollRef.current.scrollResponderZoomTo({
            x: width * 0.25,
            y: height * 0.25,
            width: width * 0.5,
            height: height * 0.5,
            animated: true,
          });
        } else {
          // Zoom out
          scrollRef.current.scrollResponderZoomTo({
            x: 0,
            y: 0,
            width: width,
            height: height,
            animated: true,
          });
        }
        isZoomedRef.current = !isZoomedRef.current;
      }
    }
    lastTapRef.current = now;
  }, []);
  
  return (
    <View style={{ flex: 1, width: width, justifyContent: 'center', alignItems: 'center' }}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.viewerScrollContent}
        maximumZoomScale={4}
        minimumZoomScale={1}
        bouncesZoom={true}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        pinchGestureEnabled={true}
        scrollEventThrottle={16}
        onScroll={(e) => {
          const scale = e.nativeEvent?.zoomScale || 1;
        }}
      >
        <Pressable onPress={handleDoubleTap}>
          <ProgressiveImage
            media={item}
            style={styles.viewerImage}
            contentFit="contain"
            isActive={isActive}
            onRawLoad={() => setRawLoaded(true)}
            onError={(error) => console.error('[MediaGallery] Full-res load error:', error)}
            getFullUrl={getFullUrl}
            api={api}
          />
        </Pressable>
      </ScrollView>
      
      {/* STATIC HD HUD */}
      {rawLoaded && isActive && (
        <View style={{
          position: 'absolute',
          bottom: 24,
          right: 24,
          backgroundColor: 'rgba(0,0,0,0.5)',
          paddingHorizontal: 6,
          paddingVertical: 3,
          borderRadius: 4,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: 'rgba(255,255,255,0.2)',
        }} pointerEvents="none">
          <Text style={{
            color: 'rgba(255,255,255,0.7)',
            fontSize: 9,
            fontWeight: '800',
            letterSpacing: 1,
          }}>HD</Text>
        </View>
      )}
    </View>
  );
};

/**
 * MediaGallery - Photo/Video vault gallery grid with Phone Uploads / Turtle Base toggle
 * 
 * Props:
 * - onClose: () => void - Called when user wants to close the gallery (optional for tab usage)
 * - autoUpload: boolean - If true, immediately opens image picker on mount (for /photos upload command)
 */
export default function MediaGallery({ onClose, autoUpload = false }) {
  const { theme } = useTheme();
  const { api, getBaseUrl } = useServer();
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  
  // === TAB & DATA STATE ===
  const [activeTab, setActiveTab] = useState('uploads');
  
  // Data state
  const [uploadItems, setUploadItems] = useState([]);
  const [serverItems, setServerItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isPaginating, setIsPaginating] = useState(false); // Prevents overlapping fetch calls
  const [uploading, setUploading] = useState(false);
  const [uploadStats, setUploadStats] = useState({ current: 0, total: 0, failed: 0, fileProgress: 0 });
  const [refreshing, setRefreshing] = useState(false);
  
  // === LOCAL SYNC GALLERY STATE ===
  const [localPickerVisible, setLocalPickerVisible] = useState(false);
  const [localAssets, setLocalAssets] = useState([]);
  const [selectedLocalAssets, setSelectedLocalAssets] = useState(new Set());
  const [localHasNextPage, setLocalHasNextPage] = useState(true);
  const [localEndCursor, setLocalEndCursor] = useState(null);
  const [isLoadingLocal, setIsLoadingLocal] = useState(false);
  
  // === PAGINATION STATE ===
  const [hasMoreUploads, setHasMoreUploads] = useState(true);
  const [hasMoreServer, setHasMoreServer] = useState(true);
  const [uploadOffset, setUploadOffset] = useState(0);
  const [serverOffset, setServerOffset] = useState(0);
  const [globalUploadsTotal, setGlobalUploadsTotal] = useState(0);
  const LIMIT = 60; // Micro-batching for zero-stutter appends

  // === VIEWER STATE ===
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [isClosing, setIsClosing] = useState(false); // Hardware-accelerated close state
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const [infoVisible, setInfoVisible] = useState(true);
  const infoOpacityAnim = useRef(new Animated.Value(1)).current;
  const [zoomScale, setZoomScale] = useState(1); // Track zoom level for close prevention
  
  // === DRAWER STATE & PHYSICS ===
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const drawerY = useRef(new Animated.Value(height)).current;

  const openMetadataDrawer = useCallback(() => {
    setIsDrawerOpen(true);
    Animated.spring(drawerY, { toValue: height * 0.45, useNativeDriver: true, tension: 65, friction: 10 }).start();
  }, [drawerY]);

  const closeMetadataDrawer = useCallback(() => {
    Animated.timing(drawerY, { toValue: height, duration: 250, easing: Easing.out(Easing.ease), useNativeDriver: true }).start(() => setIsDrawerOpen(false));
  }, [drawerY]);
  
  // === ALBUM & TAG STATE ===
  const [globalAlbums, setGlobalAlbums] = useState(['Phone Uploads']);
  const [albumCovers, setAlbumCovers] = useState({}); // Cover thumbnails for 2x2 grids
  const [albumSearchQuery, setAlbumSearchQuery] = useState(''); // Album search filter
  const [uploadsSearchQuery, setUploadsSearchQuery] = useState(''); // Uploads/All Photos search filter
  const [isUploadsSearchVisible, setIsUploadsSearchVisible] = useState(false);
  const uploadsSearchAnim = useRef(new Animated.Value(0)).current;
  
  // Animate unified search bar for both uploads and albums
  useEffect(() => {
    const isVisible = isUploadsSearchVisible || (activeTab === 'albums' && albumSearchQuery !== '');
    Animated.timing(uploadsSearchAnim, {
      toValue: isVisible ? 1 : 0,
      duration: 200,
      easing: Easing.bezier(0.4, 0.0, 0.2, 1),
      useNativeDriver: true,
    }).start();
  }, [isUploadsSearchVisible, activeTab, albumSearchQuery, uploadsSearchAnim]);
  
  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const [pendingAssets, setPendingAssets] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  
  // === BULK SELECTION STATE ===
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedGridItems, setSelectedGridItems] = useState(new Set());

  const toggleGridSelection = useCallback((id) => {
    setSelectedGridItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const [isBulkTagging, setIsBulkTagging] = useState(false);

  const executeBulkTagSave = useCallback(async () => {
    try {
      // 1. What tags are CURRENTLY sitting in the UI input box?
      let currentUiTags = [...editingTags];
      if (tagInputValue.trim()) {
        currentUiTags.push(tagInputValue.trim());
      }
      currentUiTags = Array.from(new Set(currentUiTags));

      // 2. What were the ORIGINAL common tags before the user started typing?
      let originalCommonTags = null;
      Array.from(selectedGridItems).forEach(id => {
        const item = uploadItems.find(i => i.id === id) || serverItems.find(i => i.id === id);
        if (item) {
          try {
            const itemTags = JSON.parse(item.tags || '[]');
            if (originalCommonTags === null) {
              originalCommonTags = [...itemTags];
            } else {
              originalCommonTags = originalCommonTags.filter(t => itemTags.includes(t));
            }
          } catch(e) {}
        }
      });
      originalCommonTags = originalCommonTags || [];

      // 3. Determine exact user intent
      // Tags they typed in that weren't there originally
      const explicitAdditions = currentUiTags.filter(t => !originalCommonTags.includes(t));
      // Original tags they clicked the 'X' on to delete
      const explicitRemovals = originalCommonTags.filter(t => !currentUiTags.includes(t));

      // 4. Process each item non-destructively
      const promises = Array.from(selectedGridItems).map(id => {
        const targetItem = uploadItems.find(i => i.id === id) || serverItems.find(i => i.id === id);
        if (!targetItem) return Promise.resolve(null);
        
        let targetTags = [];
        try { targetTags = JSON.parse(targetItem.tags || '[]'); } catch(e){}
        
        // ONLY add what's new. ONLY remove what was explicitly X'd out. Leave everything else alone.
        let safeTags = [...targetTags];
        
        // Add new
        explicitAdditions.forEach(t => { if (!safeTags.includes(t)) safeTags.push(t); });
        
        // Strip removed
        safeTags = safeTags.filter(t => !explicitRemovals.includes(t));
        
        return api.put(`/media/${id}/tags`, {
          tags: safeTags, 
          filename: targetItem.filename, 
          type: targetItem.type,
          size: targetItem.size, 
          url: targetItem.url || targetItem.rawUrl, 
          thumbnailUrl: targetItem.thumbnailUrl,
          width: targetItem.width, 
          height: targetItem.height, 
          duration: targetItem.duration,
        }).then(() => ({ id, safeTags })); 
      });
      
      const results = await Promise.all(promises);
      
      // 5. Update UI Safely
      const updatesMap = {};
      results.forEach(res => { if (res) updatesMap[res.id] = JSON.stringify(res.safeTags); });

      const updateList = (prevList) => prevList.map(item => 
        updatesMap[item.id] ? { ...item, tags: updatesMap[item.id] } : item
      );
      
      setUploadItems(updateList);
      setServerItems(updateList);
      
      // Only add to global albums if they actually typed something new
      if (explicitAdditions.length > 0) {
        setGlobalAlbums(prev => Array.from(new Set([...prev, ...explicitAdditions])).sort());
      }
      
      setIsSelectMode(false);
      setIsBulkTagging(false);
      setSelectedGridItems(new Set());
    } catch(e) { 
      Alert.alert('Error', `Failed to update tags: ${e.message}`); 
    }
  }, [editingTags, tagInputValue, selectedGridItems, uploadItems, serverItems, api]);

  const openBulkTagEditor = useCallback(() => {
    // 1. Calculate common tags across all selected items
    let commonTags = null;
    Array.from(selectedGridItems).forEach(id => {
      const item = uploadItems.find(i => i.id === id) || serverItems.find(i => i.id === id);
      if (item) {
        try {
          const itemTags = JSON.parse(item.tags || '[]');
          if (commonTags === null) {
            commonTags = [...itemTags];
          } else {
            // Keep only tags that exist in all selected items
            commonTags = commonTags.filter(t => itemTags.includes(t));
          }
        } catch(e) {}
      }
    });
    
    setEditingTags(commonTags || []);
    setTagInputValue('');
    setEditTagsVisible(true);
    Animated.timing(tagFadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [selectedGridItems, uploadItems, serverItems, tagFadeAnim]);
  
  // Upload progress tracking.
  //   `uploadPercentage` is the rounded integer shown in the "65%" label.
  //   `progressAnim` is an Animated.Value (0–100) that smoothly drives the bar's width.
  //   The refs are the source of truth, updated synchronously inside the XHR callbacks.
  //   Overall = ((completed_items + current_item_fraction) / total_items) * 100.
  const [uploadPercentage, setUploadPercentage] = useState(0);
  const [uploadingItemIndex, setUploadingItemIndex] = useState(0);
  const totalItemsRef = useRef(0);
  const completedItemsRef = useRef(0);
  const currentItemPctRef = useRef(0);
  const progressAnim = useRef(new Animated.Value(0)).current;

  const recomputeOverall = useCallback(({ snap = false } = {}) => {
    const total = totalItemsRef.current;
    if (!total) return;
    const overall = Math.min(
      100,
      ((completedItemsRef.current + currentItemPctRef.current / 100) / total) * 100
    );
    setUploadPercentage(Math.round(overall));
    if (snap) {
      progressAnim.setValue(overall);
    } else {
      Animated.timing(progressAnim, {
        toValue: overall,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false, // width is a layout prop; native driver can't drive it
      }).start();
    }
  }, [progressAnim]);

  const resetUploadProgress = useCallback(() => {
    totalItemsRef.current = 0;
    completedItemsRef.current = 0;
    currentItemPctRef.current = 0;
    setUploadPercentage(0);
    progressAnim.setValue(0);
  }, [progressAnim]);
  
  // Tag editor state
  // === TAG EDITOR STATE & ANIMATION ===
  const [editTagsVisible, setEditTagsVisible] = useState(false);
  const [editingTags, setEditingTags] = useState([]);
  const [tagInputValue, setTagInputValue] = useState('');
  const tagFadeAnim = useRef(new Animated.Value(0)).current;

  const openTagEditor = useCallback(() => {
    try { setEditingTags(JSON.parse(selectedMedia.tags || '[]')); } catch(e){ setEditingTags([]); }
    setTagInputValue('');
    setEditTagsVisible(true);
    Animated.timing(tagFadeAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [selectedMedia, tagFadeAnim]);

  const closeTagEditor = useCallback(() => {
    Animated.timing(tagFadeAnim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => {
      setEditTagsVisible(false);
    });
  }, [tagFadeAnim]);
  
  // Scroll position for parallax effect
  const scrollX = useRef(new Animated.Value(0)).current;
  
  // === REFS ===
  // Grid ref for scroll-to-bottom (iOS Photos style)
  const gridRef = useRef(null);

  // === UPLOAD MODAL DRAG PHYSICS ===
  const uploadModalY = useRef(new Animated.Value(0)).current;

  // Reset modal position when it opens - CRITICAL: stop any running animation first
  useEffect(() => {
    if (uploadModalVisible) {
      uploadModalY.stopAnimation();
      uploadModalY.setValue(0);
      // Also reset any animated value flattening issues
      uploadModalY.flattenOffset();
    }
  }, [uploadModalVisible, uploadModalY]);

  const dismissUploadModal = useCallback(() => {
    Keyboard.dismiss();
    uploadModalY.stopAnimation();
    Animated.timing(uploadModalY, {
      toValue: height, // Slide it off the bottom of the screen
      duration: 250,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start(() => {
      setUploadModalVisible(false);
      setPendingAssets([]);
    });
  }, [uploadModalY]);

  const uploadPanResponder = useRef(
    PanResponder.create({
      // Only capture the drag if it's a distinct vertical swipe down (protects horizontal chip scrolling)
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return gestureState.dy > 10 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) { // Only allow dragging downwards
          uploadModalY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 120 || gestureState.vy > 1.5) {
          // User dragged far enough or fast enough -> dismiss
          dismissUploadModal();
        } else {
          // Snap back to center
          Animated.spring(uploadModalY, {
            toValue: 0,
            useNativeDriver: true,
            friction: 8,
            tension: 40,
          }).start();
        }
      },
    })
  ).current;

  // === DERIVED DATA ===
  // Get current items based on active tab
  const currentItems = activeTab === 'uploads' ? uploadItems : serverItems;
  const currentHasMore = activeTab === 'uploads' ? hasMoreUploads : hasMoreServer;
  
  // Filter state
  const [selectedAlbum, setSelectedAlbum] = useState('All');

  // === O(1) HASH MAP FILTERING ===
  // 1. Build the O(1) Dictionary ONCE when data loads (MUST be before pinnedAlbums)
  const tagDictionary = useMemo(() => {
    const dict = { 'All': currentItems };
    currentItems.forEach(item => {
      try {
        const tags = JSON.parse(item.tags || '[]');
        // If the item has no valid tags, we optionally group it under a fallback or just leave it in 'All'
        if (Array.isArray(tags)) {
          tags.forEach(tag => {
            if (!dict[tag]) dict[tag] = [];
            dict[tag].push(item);
          });
        }
      } catch(e) {}
    });
    return dict;
  }, [currentItems]);

  // Intercept global albums to forcefully pin "Favourites" to the beginning of the list
  // Also filter by search query for albums tab
  // Intercept global albums and merge with locally discovered tags for instant UI updates
  const pinnedAlbums = useMemo(() => {
    // 1. Get locally discovered tags from the current grid view
    const localTags = Object.keys(tagDictionary).filter(k => k !== 'All' && k !== 'image' && k !== 'video');
    
    // 2. Merge backend albums and local tags into a strict unique Set
    const allUnique = new Set([...globalAlbums, ...localTags]);
    let albums = Array.from(allUnique);
    
    // 3. 🔍 LOOSE FUZZY SEARCH (Ignores dashes, underscores, and spaces)
    if (activeTab === 'albums' && albumSearchQuery.trim()) {
      const query = albumSearchQuery.toLowerCase().replace(/[-_\s]/g, '');
      albums = albums.filter(a => {
        const cleanAlbumName = a.toLowerCase().replace(/[-_\s]/g, '');
        return cleanAlbumName.includes(query);
      });
    }
    
    // 4. Force 'Favourites' to the front
    const favIndex = albums.indexOf('Favourites');
    if (favIndex > -1) {
      albums.splice(favIndex, 1);
      albums.unshift('Favourites');
    }
    
    return albums.sort((a, b) => {
       if (a === 'Favourites') return -1;
       if (b === 'Favourites') return 1;
       return a.localeCompare(b);
    });
  }, [globalAlbums, tagDictionary, albumSearchQuery, activeTab]);

  // === INSTAGRAM-STYLE EDGE SWIPE PHYSICS ===
  const albumSlideAnim = useRef(new Animated.Value(0)).current;

  const edgeSwipeResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only respond to horizontal right-swipes from strict left edge when inside an album
        return selectedAlbum !== 'All' && 
               gestureState.moveX < 40 && 
               Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && 
               gestureState.dx > 10;
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx > 0) albumSlideAnim.setValue(gestureState.dx);
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx > width * 0.3 || gestureState.vx > 1) {
          Animated.timing(albumSlideAnim, {
            toValue: width, 
            duration: 150, // 🚀 Reduced from 200ms
            easing: Easing.bezier(0.05, 0.7, 0.1, 1), // 💎 Google Snappy Curve
            useNativeDriver: true,
          }).start(() => {
            setSelectedAlbum('All');
            albumSlideAnim.setValue(0); 
          });
        } else {
          Animated.spring(albumSlideAnim, {
            toValue: 0,
            useNativeDriver: true,
            tension: 120, // 🚀 Doubled for instant snap-back
            friction: 12,
          }).start();
        }
      },
    })
  ).current;

  // 2. Derive dropdown list instantly from the dictionary + global DB
  const availableAlbums = useMemo(() => {
    const loadedTags = Object.keys(tagDictionary).filter(k => k !== 'All');
    const allUnique = new Set([...pinnedAlbums, ...loadedTags]);
    const sortedUnique = Array.from(allUnique).sort();
    return ['All', ...sortedUnique];
  }, [tagDictionary, pinnedAlbums]);

  // 3. Filter items (Bypassed: Server natively filters the payload)
  const filteredItems = useMemo(() => {
    return currentItems || [];
  }, [currentItems]);

  // 4. Phantom Skeleton Padding REMOVED for FlashList compatibility
  // We now pass the pure data arrays directly to FlashList to prevent fake-item rendering traps
  const displayItems = useMemo(() => {
    return filteredItems || [];
  }, [filteredItems]);

  // Independent lists for simultaneous rendering
  const uploadDisplayItems = useMemo(() => {
    if (loading && uploadItems.length === 0) {
      return Array.from({ length: 18 }).map((_, i) => ({ id: `skel-${i}`, isSkeleton: true }));
    }
    
    // Filter by tag search query
    let filtered = uploadItems || [];
    if (uploadsSearchQuery.trim()) {
      const query = uploadsSearchQuery.toLowerCase().replace(/[-_\s]/g, '');
      filtered = filtered.filter(item => {
        try {
          const tags = JSON.parse(item.tags || '[]');
          return tags.some(tag => 
            tag.toLowerCase().replace(/[-_\s]/g, '').includes(query)
          );
        } catch (e) {
          return false;
        }
      });
    }
    
    return filtered;
  }, [uploadItems, loading, uploadsSearchQuery]);

  const pcDisplayItems = useMemo(() => {
    if (loading && serverItems.length === 0) {
      return Array.from({ length: 18 }).map((_, i) => ({ id: `skel-${i}`, isSkeleton: true }));
    }
    return serverItems || [];
  }, [serverItems, loading]);
  
  const pcVideoCount = serverItems.filter(item => item.type === 'video').length;
  const pcPhotoCount = serverItems.length - pcVideoCount;
  
  // Calculate photo/video breakdown based ONLY on what is currently visible in the filter
  const videoCount = filteredItems.filter(item => item.type === 'video').length;
  const photoCount = filteredItems.length - videoCount;

  // Trigger a full server fetch when the selected album filter changes
  useEffect(() => {
    // 1. Immediately trigger the premium loading skeleton
    setLoading(true);
    // 2. Clear the old grid
    setUploadItems([]); 
    
    // 3. Fetch the new album and drop the loading flag when done
    fetchUploads(true).finally(() => {
      setLoading(false);
    });
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAlbum]);

  // === API CALLS ===
  // Fetch uploads from database with strict deduplication
  const fetchUploads = useCallback(async (isRefresh = false) => {
    // Prevent simultaneous pagination fetches
    if (!isRefresh && isPaginating) return;
    
    try {
      if (!isRefresh) setIsPaginating(true);
      
      const currentOffset = isRefresh ? 0 : uploadOffset;
      const tagParam = selectedAlbum !== 'All' ? `&tag=${encodeURIComponent(selectedAlbum)}` : '';
      const response = await api.get(`/media/gallery?limit=${LIMIT}&offset=${currentOffset}&order=desc${tagParam}`);
      
      if (response.success) {
        // Safely capture the true total count from the server response
        setGlobalUploadsTotal(response.pagination?.total || response.total || response.items?.length || 0);
        
        if (isRefresh) {
          // Pure refresh - just set the items
          setUploadItems(response.items || []);
          setUploadOffset(LIMIT);
        } else {
          // Pagination - merge and strictly deduplicate by ID to prevent jumping
          setUploadItems(prev => {
            const combined = [...(response.items || []), ...prev];
            // Use Map to ensure absolute uniqueness by ID
            const uniqueMap = new Map();
            combined.forEach(item => {
              if (item && item.id) uniqueMap.set(item.id, item);
            });
            
            // Convert back to array and maintain chronological sort (newest first for inverted list)
            return Array.from(uniqueMap.values()).sort((a, b) => 
              new Date(b.uploadDate) - new Date(a.uploadDate)
            );
          });
          setUploadOffset(currentOffset + LIMIT);
        }
        setHasMoreUploads(response.pagination?.hasMore || false);
      }
    } catch (error) {
      console.error('[MediaGallery] Fetch uploads error:', error);
    } finally {
      if (!isRefresh) setIsPaginating(false);
    }
  }, [api, uploadOffset, selectedAlbum, isPaginating]);

  // Fetch server files from turtle-base
  const fetchServerFiles = useCallback(async (isRefresh = false) => {
    try {
      const response = await api.get('/media/server-files?order=asc');
      
      if (response.success) {
        // Server files already sorted ascending (oldest first) from server
        setServerItems(response.items || []);
        setHasMoreServer(false);
      }
    } catch (error) {
      console.error('[MediaGallery] Fetch server files error:', error);
      Alert.alert('Error', 'Failed to load server files');
    }
  }, [api]);

  // Load data based on active tab
  const loadData = useCallback(async (isRefresh = false) => {
    if (isPaginating) return; // Prevent overlapping calls
    setLoading(true);
    if (activeTab === 'uploads') {
      await fetchUploads(isRefresh);
    } else {
      await fetchServerFiles(isRefresh);
    }
    setLoading(false);
  }, [activeTab, fetchUploads, fetchServerFiles, isPaginating]);

  // Initial load - Fetch EVERYTHING simultaneously to prepare the off-screen slider pages
  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchUploads(true),
      fetchAlbums(),
      fetchServerFiles(true)
    ]).finally(() => setLoading(false));
    
    if (autoUpload) {
      const timer = setTimeout(() => { handleUpload(); }, 500);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoUpload]); // <-- STRIPPED DEPS TO PREVENT RESET LOOPS
  
  // Fetch global albums
  const fetchAlbums = useCallback(async () => {
    try {
      const res = await api.get('/media/albums');
      if (res.success) {
        if (res.albums) setGlobalAlbums(res.albums);
        if (res.covers) setAlbumCovers(res.covers);
      }
    } catch (e) { 
      // Album fetch failed silently 
    }
  }, [api]);

  // Fetch albums on mount and when tab changes
  useEffect(() => {
    fetchAlbums();
  }, [activeTab, fetchAlbums]);

  // Handle pull-to-refresh
  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadData(true).then(() => setRefreshing(false));
  }, [loadData]);

  const handleLoadMore = useCallback(() => {
    if (currentHasMore && !loading && !refreshing && !isPaginating && activeTab === 'uploads') {
      fetchUploads(false);
    }
  }, [currentHasMore, loading, refreshing, isPaginating, activeTab, fetchUploads]);

  // Open full-screen viewer with animation and large file warning
  const openViewer = useCallback((item) => {
    const executeOpen = () => {
      // CRITICAL FIX: Use filteredItems to match grid context
      const index = filteredItems.findIndex(i => i.id === item.id);
      if (index !== -1) {
        scrollX.setValue(index * ITEM_WIDTH);
      }
      
      setSelectedMedia(item);
      // Reset and start animations
      scaleAnim.setValue(0.85);
      opacityAnim.setValue(0);
      
      Animated.parallel([
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 200, // 🚀 Faster pop
          easing: Easing.bezier(0.05, 0.7, 0.1, 1), // 💎 Instant pop, smooth settle
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 120, // 🚀 Near-instant background blackout
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]).start();
    };

    const LARGE_FILE_MB = 100; // 100MB threshold
    const sizeMB = item.size ? item.size / (1024 * 1024) : 0;

    if (sizeMB > LARGE_FILE_MB) {
      Alert.alert(
        'Large File Warning',
        `This file is ${sizeMB.toFixed(1)} MB. Loading it may take a moment or use significant memory. Proceed?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open', onPress: executeOpen }
        ]
      );
    } else {
      executeOpen();
    }
  }, [scaleAnim, opacityAnim, currentItems, scrollX]);

  // Close full-screen viewer (only if zoomed to 100%)
  const closeViewer = useCallback(() => {
    // Prevent closing if zoomed in
    if (zoomScale > 1.05) {
      // Animate back to zoom 1 first
      if (scrollRef.current) {
        scrollRef.current.scrollTo({ x: 0, y: 0, animated: true });
      }
      return;
    }
    
    // Signal to ProgressiveImage components to abort RAW downloads
    setIsClosing(true);
    
    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: 0.85,
        duration: 150, // 🚀 Rapid exit
        easing: Easing.bezier(0.3, 0.0, 0.8, 0.15), // 💎 Accelerating exit curve
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 100, // 🚀 Instant background reveal
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setSelectedMedia(null);
      setIsClosing(false);
      setInfoVisible(true);
      infoOpacityAnim.setValue(1);
    });
  }, [scaleAnim, opacityAnim, infoOpacityAnim, zoomScale]);

  // Toggle info visibility on tap - fade out smooth, fade in fast
  const toggleInfoVisibility = useCallback(() => {
    const newValue = !infoVisible;
    setInfoVisible(newValue);
    
    if (newValue) {
      // Fade in fast with bezier easing
      Animated.timing(infoOpacityAnim, {
        toValue: 1,
        duration: 200,
        easing: Easing.bezier(0.4, 0.0, 0.2, 1),
        useNativeDriver: true,
      }).start();
    } else {
      // Fade out smoothly
      Animated.timing(infoOpacityAnim, {
        toValue: 0,
        duration: 200,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
        useNativeDriver: true,
      }).start();
    }
  }, [infoVisible, infoOpacityAnim]);

  // Unified swipe responder for dismiss (down) and metadata drawer (up)
  const swipeResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        if (zoomScale > 1.05) return false;
        return Math.abs(gestureState.dy) > 10 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 0.5;
      },
      onPanResponderMove: (evt, gestureState) => {
        if (gestureState.dy > 20 && !infoVisible && !isDrawerOpen) toggleInfoVisibility();
        if (isDrawerOpen && gestureState.dy > 0) drawerY.setValue((height * 0.45) + gestureState.dy);
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (isDrawerOpen) {
          if (gestureState.dy > 50 || gestureState.vy > 1) closeMetadataDrawer();
          else openMetadataDrawer(); 
        } else {
          if (gestureState.dy > 120) closeViewer();
          else if (gestureState.dy < -50) openMetadataDrawer(); // Swipe up triggers drawer
        }
      },
    })
  ).current;

  // Rename album (updates all photos with the old tag)
  const renameAlbum = useCallback(async (oldName) => {
    if (oldName === 'All' || oldName === 'Favourites') {
      Alert.alert('Cannot Rename', 'System albums cannot be renamed.');
      return;
    }

    Alert.prompt(
      'Rename Album',
      `Rename "${oldName}" to:`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rename',
          onPress: async (newName) => {
            if (!newName || newName.trim() === '' || newName.trim() === oldName) return;
            
            const trimmedName = newName.trim();
            try {
              const res = await api.put('/media/album/rename', {
                oldTag: oldName,
                newTag: trimmedName
              });
              
              if (res.success) {
                // Update local state (pinnedAlbums is derived from globalAlbums)
                setGlobalAlbums(prev => prev.map(a => a === oldName ? trimmedName : a));
                // Refresh
                fetchAlbums();
                
                // If we're currently viewing this album, update the selection
                if (selectedAlbum === oldName) {
                  setSelectedAlbum(trimmedName);
                }
              }
            } catch (error) {
              console.error('[MediaGallery] Failed to rename album:', error);
              Alert.alert('Error', 'Failed to rename album');
            }
          }
        }
      ],
      'plain-text',
      oldName
    );
  }, [api, fetchAlbums, selectedAlbum, setGlobalAlbums]);

  // Delete album (removes tag from all photos)
  const deleteAlbum = useCallback(async (albumName) => {
    if (albumName === 'All' || albumName === 'Favourites') {
      Alert.alert('Cannot Delete', 'System albums cannot be deleted.');
      return;
    }
    
    Alert.alert(
      'Delete Album',
      `Delete "${albumName}"?\n\nPhotos will remain in "All" but this album tag will be removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await api.delete(`/media/album/${encodeURIComponent(albumName)}`);
              if (res.success) {
                setGlobalAlbums(prev => prev.filter(a => a !== albumName));
                fetchAlbums();
                
                // If we were viewing this album, switch to 'All'
                if (selectedAlbum === albumName) {
                  setSelectedAlbum('All');
                  setActiveTab('uploads');
                }
              }
            } catch (error) {
              console.error('[MediaGallery] Failed to delete album:', error);
              Alert.alert('Error', 'Failed to delete album');
            }
          }
        }
      ]
    );
  }, [api, fetchAlbums, selectedAlbum, setGlobalAlbums, setSelectedAlbum, setActiveTab]);

  // Album context menu (long-press) - declared after renameAlbum and deleteAlbum
  const showAlbumOptions = useCallback((albumName) => {
    if (albumName === 'All' || albumName === 'Favourites') {
      Alert.alert(albumName, 'System albums cannot be modified.');
      return;
    }

    Alert.alert(
      albumName,
      'Choose an action:',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Rename', onPress: () => renameAlbum(albumName) },
        { text: 'Delete', style: 'destructive', onPress: () => deleteAlbum(albumName) }
      ]
    );
  }, [renameAlbum, deleteAlbum]);

  // Placeholder for expo-image-manipulator UI integration
  const openImageEditor = useCallback(() => {
    if (!selectedMedia || selectedMedia.type === 'video') return;
    Alert.alert(
      "Edit Image",
      "Image Editor coming soon! This will trigger the crop/rotate UI.",
      [{ text: "OK", style: "cancel" }]
    );
  }, [selectedMedia]);

  // Upload photos/videos - Unlocked Selection Limit
  const handleUpload = useCallback(async () => {
    try {
      // Request permissions
      const { status: pickerStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (pickerStatus !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to photos and videos to upload.');
        return;
      }

      // Open image picker - unlocked limit for enterprise queue
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'], // Updated API - array of MediaType strings
        allowsMultipleSelection: true,
        selectionLimit: 0, // 0 = UNLIMITED SELECTION
        orderedSelection: true,
        quality: 0.8,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      // Show pre-upload modal with album selection
      setPendingAssets(result.assets);
      // Preset the current album as a tag if inside a specific album
      setSelectedTags(selectedAlbum !== 'All' ? [selectedAlbum] : []);
      setUploadModalVisible(true);
    } catch (error) {
      console.error('[MediaGallery] Upload error:', error);
      Alert.alert('Error', 'Failed to open image picker.');
    }
  }, [selectedAlbum]);

  // === SMART SYNC FUNCTIONS ===
  const fetchLocalMedia = useCallback(async (loadMore = false) => {
    if (isLoadingLocal || (!localHasNextPage && loadMore)) return;
    
    try {
      setIsLoadingLocal(true);
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Needed', 'We need access to your camera roll to sync photos.');
        return;
      }

      const options = {
        first: 90,
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
      };
      if (loadMore && localEndCursor) options.after = localEndCursor;

      const result = await MediaLibrary.getAssetsAsync(options);
      
      setLocalAssets(prev => loadMore ? [...prev, ...result.assets] : result.assets);
      setLocalHasNextPage(result.hasNextPage);
      setLocalEndCursor(result.endCursor);
    } catch (error) {
      console.error('Failed to load local media:', error);
    } finally {
      setIsLoadingLocal(false);
    }
  }, [localEndCursor, localHasNextPage, isLoadingLocal]);

  const openLocalSyncGallery = useCallback(() => {
    setLocalPickerVisible(true);
    if (localAssets.length === 0) fetchLocalMedia();
  }, [localAssets.length, fetchLocalMedia]);

  const toggleLocalAssetSelection = useCallback((assetId) => {
    setSelectedLocalAssets(prev => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }, []);

  const handleSelectAllLocal = useCallback(() => {
    if (selectedLocalAssets.size === localAssets.length) {
      setSelectedLocalAssets(new Set()); 
    } else {
      setSelectedLocalAssets(new Set(localAssets.map(a => a.id))); 
    }
  }, [localAssets, selectedLocalAssets.size]);

  // Maps MediaLibrary format to match ImagePicker format so executeUpload doesn't break
  const queueSelectedForUpload = useCallback(() => {
    const assetsToUpload = localAssets
      .filter(a => selectedLocalAssets.has(a.id))
      .map(a => ({
        ...a,
        assetId: a.id,
        uri: a.uri,
        fileName: a.filename,
        type: a.mediaType === 'photo' ? 'image' : 'video'
      }));
      
    setPendingAssets(assetsToUpload);
    setLocalPickerVisible(false);
    setSelectedLocalAssets(new Set());
    // Preset the current album as a tag if inside a specific album
    setSelectedTags(selectedAlbum !== 'All' ? [selectedAlbum] : []);
    setUploadModalVisible(true); 
  }, [localAssets, selectedLocalAssets, selectedAlbum]);

  // Execute upload after modal confirmation
  // Execute upload after modal confirmation
  const executeUpload = useCallback(async () => {
    if (pendingAssets.length === 0) return;

    setUploading(true);
    setUploadingItemIndex(1);
    resetUploadProgress();
    totalItemsRef.current = pendingAssets.length;
    recomputeOverall({ snap: true }); // start cleanly at 0%

    const serverUrl = getBaseUrl();
    const successfulAssetIds = [];
    let failureCount = 0;

    try {
      const { status: mediaStatus } = await MediaLibrary.requestPermissionsAsync();
      
      for (let i = 0; i < pendingAssets.length; i++) {
        setUploadingItemIndex(i + 1);
        const asset = pendingAssets[i];
        
        let tempThumbnailUri = null;
        let tempManipulatedUri = null;
        
        try {
          const formData = new FormData();
          let assetInfo = null;
          
          if (asset.assetId) {
            try { assetInfo = await MediaLibrary.getAssetInfoAsync(asset.assetId); } catch (e) {}
          }
          
          const originalDate = assetInfo?.creationTime || null;
          if (originalDate) formData.append('originalDate', originalDate.toString());
          
          if (assetInfo) {
            if (assetInfo.width) formData.append('width', assetInfo.width.toString());
            if (assetInfo.height) formData.append('height', assetInfo.height.toString());
            formData.append('tags', JSON.stringify(selectedTags.length > 0 ? selectedTags : ['Phone Uploads']));
          }
          
          const originalFilename = asset.fileName || asset.uri.split('/').pop() || 'file';
          const isVideo = asset.mediaType === 'video' || /\.(mp4|mov|avi|mkv|wmv|flv|webm|m4v|3gp)$/i.test(originalFilename);
          const isHeic = /\.heic$/i.test(originalFilename) || /\.heif$/i.test(originalFilename);
          
          let safeLocalUri = assetInfo?.localUri || asset.uri;
          let mediaUri = safeLocalUri;
          let mediaName = originalFilename;
          let mediaType = isVideo ? 'video/mp4' : 'image/jpeg';
          
          if (isVideo) {
            const { uri } = await VideoThumbnails.getThumbnailAsync(safeLocalUri, { time: 1000, quality: 0.8 });
            tempThumbnailUri = uri;
            formData.append('media', { uri: mediaUri, name: mediaName, type: mediaType });
            formData.append('thumbnail', { uri: tempThumbnailUri, name: 'thumbnail.jpg', type: 'image/jpeg' });
            if (asset.duration) formData.append('duration', Math.round(asset.duration / 1000).toString());
          } else {
            if (isHeic) {
              const manipulated = await ImageManipulator.manipulateAsync(
                safeLocalUri, [], { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
              );
              tempManipulatedUri = manipulated.uri;
              mediaUri = tempManipulatedUri;
              mediaName = originalFilename.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg');
            }
            formData.append('media', { uri: mediaUri, name: mediaName, type: mediaType });
          }
          
          // XHR with byte-level progress tracking.
          // RN's XHR is finicky about upload progress:
          //   * property assignment (xhr.upload.onprogress = ...) is unreliable on iOS — use addEventListener.
          //   * lengthComputable is often false for multipart file uploads, so don't gate on it; just check total.
          //   * Some platforms don't stream progress at all — we run a smooth fallback ramp in that case.
          await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            // Ensure we don't accidentally create an /api/api/ route.
            const uploadEndpoint = serverUrl.endsWith('/api')
              ? `${serverUrl}/media/upload`
              : `${serverUrl}/api/media/upload`;

            // open() before addEventListener for maximum RN/iOS compatibility.
            xhr.open('POST', uploadEndpoint);
            if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

            let gotRealProgress = false;
            let fallbackInterval = null;
            let itemPct = 0; // monotonic per-item byte progress, 0-100

            const advanceItem = (next) => {
              if (next <= itemPct) return;
              itemPct = next;
              currentItemPctRef.current = next;
              recomputeOverall();
            };
            const stopFallback = () => {
              if (fallbackInterval) {
                clearInterval(fallbackInterval);
                fallbackInterval = null;
              }
            };

            xhr.upload.addEventListener('progress', (event) => {
              const total = event.total || 0;
              if (total > 0) {
                gotRealProgress = true;
                stopFallback();
                // Cap at 99 so the bar doesn't visually "complete" before onload fires.
                advanceItem(Math.min(99, Math.round((event.loaded / total) * 100)));
              }
            });

            xhr.addEventListener('load', () => {
              stopFallback();
              advanceItem(100);
              if (xhr.status >= 200 && xhr.status < 300) {
                resolve(xhr.responseText);
              } else {
                reject(new Error(`Upload failed with status ${xhr.status}`));
              }
            });

            xhr.addEventListener('error', () => {
              stopFallback();
              reject(new Error('Network request failed'));
            });
            xhr.addEventListener('abort', () => {
              stopFallback();
              reject(new Error('Upload aborted'));
            });

            xhr.send(formData);

            // Fallback ramp: if no real progress event arrives within 400ms,
            // ease toward 92% so the bar still moves while bytes are in flight.
            setTimeout(() => {
              if (gotRealProgress) return;
              fallbackInterval = setInterval(() => {
                if (gotRealProgress) {
                  stopFallback();
                  return;
                }
                // Logarithmic-ish ramp: fast at first, slow near the cap.
                const step = Math.max(1, Math.round((92 - itemPct) / 12));
                advanceItem(Math.min(92, itemPct + step));
              }, 250);
            }, 400);
          });

          if (asset.assetId) successfulAssetIds.push(asset.assetId);

        } catch (error) {
          console.error(`[Upload] Failed asset ${i}:`, error.message);
          failureCount++;
        } finally {
          if (tempThumbnailUri) FileSystem.deleteAsync(tempThumbnailUri, { idempotent: true }).catch(()=>{});
          if (tempManipulatedUri) FileSystem.deleteAsync(tempManipulatedUri, { idempotent: true }).catch(()=>{});
          // Batch advances per-item regardless of success — user cares about "x of y done".
          completedItemsRef.current += 1;
          currentItemPctRef.current = 0;
          recomputeOverall();
        }
      }
      
      // Make sure the bar reaches a clean 100% (the loop's recompute may have landed
      // a hair under from rounding). Then hold so the user actually sees "100%" — the
      // pattern every polished upload UI uses.
      completedItemsRef.current = totalItemsRef.current;
      currentItemPctRef.current = 0;
      recomputeOverall();
      await new Promise((r) => setTimeout(r, 600));

      // Delete uploaded assets from camera roll if permission granted
      if (successfulAssetIds.length > 0 && mediaStatus === 'granted') {
        try { await MediaLibrary.deleteAssetsAsync(successfulAssetIds); } catch (e) {}
      }

      setPendingAssets([]);
      setUploadModalVisible(false);
      await fetchUploads(true);
      
      if (failureCount > 0) {
        Alert.alert('Upload Complete', `${successfulAssetIds.length} uploaded, ${failureCount} failed.`);
      } else {
        Alert.alert('Success', `All ${successfulAssetIds.length} items uploaded!`);
      }

    } catch (error) {
      console.error('[Upload] Error:', error);
      Alert.alert('Upload Failed', error.message);
    } finally {
      setUploading(false);
      resetUploadProgress();
    }
  }, [pendingAssets, selectedTags, token, getBaseUrl, fetchUploads, setUploadModalVisible, recomputeOverall, resetUploadProgress]);

  // Delete photo/video (only for uploads)
  const handleDelete = useCallback((id) => {
    if (activeTab !== 'uploads') return;
    
    Alert.alert(
      'Delete Media',
      'Are you sure you want to delete this item?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/media/${id}`);
              setUploadItems(prev => prev.filter(item => item.id !== id));
            } catch (error) {
              console.error('[MediaGallery] Delete error:', error);
              Alert.alert('Error', 'Failed to delete media');
            }
          },
        },
      ]
    );
  }, [api, activeTab]);

  // Optimistic UI tag save function
  const saveEditedTags = useCallback(async () => {
    try {
      // 1. Send the update to the server
      const tagPayload = {
        tags: editingTags,
        filename: selectedMedia.filename,
        type: selectedMedia.type,
        size: selectedMedia.size,
        url: selectedMedia.url || selectedMedia.rawUrl, // <-- ADDED FALLBACK
        thumbnailUrl: selectedMedia.thumbnailUrl,
        width: selectedMedia.width,
        height: selectedMedia.height,
        duration: selectedMedia.duration,
      };
      
      const res = await api.put(`/media/${selectedMedia.id}/tags`, tagPayload);
      
      if (res.success) {
        const newTagsString = JSON.stringify(editingTags);
        
        // 2. Surgically update the active item in the full-screen viewer
        setSelectedMedia(prev => ({ ...prev, tags: newTagsString }));
        
        // 3. Update the specific item in the main lists WITHOUT triggering a network fetch
        const updateItemInList = (prevList) => 
          prevList.map(item => item.id === selectedMedia.id ? { ...item, tags: newTagsString } : item);
        
        setUploadItems(updateItemInList);
        setServerItems(updateItemInList);
        
        // 4. Optimistically add any brand-new tags to the global dropdown list instantly
        setGlobalAlbums(prev => {
          const combined = new Set([...prev, ...editingTags]);
          return Array.from(combined).sort();
        });

        // 5. Close the modal gracefully
        setEditTagsVisible(false);
      } else {
        Alert.alert('Error', res.error || 'Server rejected the tag update');
      }
    } catch(e) { 
      Alert.alert('Error', `Failed to update tags: ${e.message}`); 
    }
  }, [api, editingTags, selectedMedia, setGlobalAlbums, setUploadItems, setServerItems, setSelectedMedia, setEditTagsVisible]);

  // Optimistic UI Toggle for Quick Favourites
  const toggleFavourite = useCallback(async () => {
    if (!selectedMedia) return;
    
    try {
      const currentTags = JSON.parse(selectedMedia.tags || '[]');
      const isFav = currentTags.includes('Favourites');
      
      // Toggle logic
      const newTags = isFav 
        ? currentTags.filter(t => t !== 'Favourites') 
        : [...currentTags, 'Favourites'];
        
      const newTagsString = JSON.stringify(newTags);

      // 1. Optimistically update the UI instantly
      setSelectedMedia(prev => ({ ...prev, tags: newTagsString }));
      
      const updateItemInList = (prevList) => 
        prevList.map(item => item.id === selectedMedia.id ? { ...item, tags: newTagsString } : item);
      
      setUploadItems(updateItemInList);
      setServerItems(updateItemInList);

      // 2. Add 'Favourites' to global dropdown immediately if it's the first time
      if (!isFav) {
        setGlobalAlbums(prev => Array.from(new Set([...prev, 'Favourites'])).sort());
      }

      // 3. Send payload to server in the background
      const tagPayload = {
        tags: newTags, filename: selectedMedia.filename, type: selectedMedia.type,
        size: selectedMedia.size, url: selectedMedia.url || selectedMedia.rawUrl, thumbnailUrl: selectedMedia.thumbnailUrl,
        width: selectedMedia.width, height: selectedMedia.height, duration: selectedMedia.duration,
      };
      
      await api.put(`/media/${selectedMedia.id}/tags`, tagPayload);
      
      // 4. Refresh gallery to reflect changes (especially important when viewing Favourites album)
      // Small delay to let the server process the update
      setTimeout(() => {
        fetchUploads(true);
      }, 300);
      
    } catch(e) { 
      console.error('[MediaGallery] Favourites toggle failed:', e); 
    }
  }, [selectedMedia, api, fetchUploads]);

  // Helper to construct full URL
  const getFullUrl = useCallback((path) => {
    const baseUrl = getBaseUrl().replace(/\/api$/, '');
    return `${baseUrl}${path}`;
  }, [getBaseUrl]);

  // Download and trigger native OS Share Sheet
  const handleShare = useCallback(async () => {
    if (!selectedMedia) return;
    try {
      const url = getFullUrl(selectedMedia.url || selectedMedia.rawUrl);
      const filename = selectedMedia.filename || `shared_media_${Date.now()}.jpg`;
      const localUri = `${FileSystem.cacheDirectory}${filename}`;
      
      const { uri } = await FileSystem.downloadAsync(url, localUri);
      
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { 
          UTI: selectedMedia.type === 'video' ? 'public.movie' : 'public.image',
          mimeType: selectedMedia.type === 'video' ? 'video/mp4' : 'image/jpeg'
        });
      } else {
        Alert.alert('Error', 'Sharing is not available on this device');
      }
    } catch (error) {
      console.error('[MediaGallery] Share error:', error);
      Alert.alert('Error', 'Could not share this item.');
    }
  }, [selectedMedia, getFullUrl]);

  // Format seconds to MM:SS
  const formatDuration = (seconds) => {
    if (!seconds) return null;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Track failed images to show fallback
  const [failedImages, setFailedImages] = useState(new Set());
  
  // === AGGRESSIVE GARBAGE COLLECTION ===
  // Clear RAM cache periodically and wipe Disk cache on unmount to prevent GBs of bloat
  useEffect(() => {
    const clearRamCache = () => setFailedImages(new Set());
    const interval = setInterval(clearRamCache, 5 * 60 * 1000); 

    return () => {
      clearInterval(interval);
      // Sweep massive hidden temporary files when leaving the gallery
      const wipeGhostFiles = async () => {
        try {
          const cacheDir = FileSystem.cacheDirectory;
          const pickerCache = `${cacheDir}ImagePicker`;
          const manipCache = `${cacheDir}ImageManipulator`;
          const thumbCache = `${cacheDir}VideoThumbnails`;
          
          if ((await FileSystem.getInfoAsync(pickerCache)).exists) await FileSystem.deleteAsync(pickerCache, { idempotent: true });
          if ((await FileSystem.getInfoAsync(manipCache)).exists) await FileSystem.deleteAsync(manipCache, { idempotent: true });
          if ((await FileSystem.getInfoAsync(thumbCache)).exists) await FileSystem.deleteAsync(thumbCache, { idempotent: true });
          
          // Clear expo-image RAM cache
          Image.clearMemoryCache();
          // Cache cleanup completed
        } catch (e) {
          // Cache cleanup failed silently
        }
      };
      wipeGhostFiles();
    };
  }, []);

  // Preload images for smoother scrolling
  const preloadThumbnails = useCallback((items) => {
    items.forEach(item => {
      if (item.thumbnailUrl) {
        const url = getFullUrl(item.thumbnailUrl);
        Image.prefetch(url).catch(() => {
          // Silently fail prefetch errors
        });
      }
    });
  }, [getFullUrl]);

  // Preload when items change
  useEffect(() => {
    if (currentItems.length > 0) {
      // Prefetch first 30 thumbnails
      preloadThumbnails(currentItems.slice(0, 150));
    }
  }, [currentItems, preloadThumbnails]);

  // Render grid item using memoized component
  // === RENDERERS ===
  const renderItem = useCallback(({ item }) => {
    // Phantom skeleton placeholder for seamless infinite scroll
    if (item.isSkeleton) {
      return (
        <View style={{ transform: [{ scaleY: -1 }] }}>
          <ShimmerSkeleton styles={styles} theme={theme} />
        </View>
      );
    }
    return (
      <View style={{ transform: [{ scaleY: -1 }] }}>
        <GridItem 
          item={item} 
          activeTab={activeTab}
          openViewer={openViewer}
          handleDelete={handleDelete}
          getFullUrl={getFullUrl}
          getBaseUrl={getBaseUrl}
          styles={styles}
          theme={theme}
          isSelectMode={isSelectMode}
          isSelected={selectedGridItems.has(item.id)}
          onToggleSelect={() => toggleGridSelection(item.id)}
        />
      </View>
    );
  }, [activeTab, openViewer, handleDelete, getFullUrl, getBaseUrl, styles, theme, isSelectMode, selectedGridItems, toggleGridSelection]);

  // Render empty state
  // Render empty state (Inverted grids need scaleY: -1 to render right-side up)
  const renderEmpty = () => (
    <View style={[styles.emptyContainer, { transform: [{ scaleY: -1 }] }]}>
      <Icon name="image-off" size={64} color={theme.colors.textMuted} />
      <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
        No {activeTab === 'uploads' ? 'uploads' : 'files'} yet
      </Text>
      {activeTab === 'uploads' && (
        <Text style={[styles.emptySubtext, { color: theme.colors.textMuted }]}>
          Tap "Upload Photos" to add photos and videos
        </Text>
      )}
      {activeTab === 'turtle-base' && (
        <Text style={[styles.emptySubtext, { color: theme.colors.textMuted }]}>
          Add files to ./storage/turtle-base on the server
        </Text>
      )}
    </View>
  );

  // Handle scroll end - update selectedMedia when swipe completes (better performance)
  // Handle scroll end - mathematically bulletproof index calculation using ITEM_WIDTH
  // Handle scroll end - Update instantly without artificial InteractionManager lag
  const handleMomentumScrollEnd = useCallback((event) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / ITEM_WIDTH);
    const newlySelectedItem = displayItems[index];
    
    if (newlySelectedItem && !newlySelectedItem.isSkeleton && newlySelectedItem.id !== selectedMedia?.id) {
      // 🚀 SNAP INSTANTLY: Removed runAfterInteractions wrap
      setSelectedMedia(newlySelectedItem);
    }
  }, [displayItems, selectedMedia]);

  // Render individual viewer item with pinch-to-zoom

  const renderViewerItem = useCallback(({ item, index }) => {
    const isVideo = item.type === 'video';
    const fullResUrl = getFullUrl(item.rawUrl || item.url || '');
    const isActive = item.id === selectedMedia?.id;

    // 💎 SUBTLE IOS 17 PARALLAX (15% Shift) 💎
    // Image moves slightly slower than the scroll, creating a subtle window effect.
    const parallaxTranslate = scrollX.interpolate({
      inputRange: [
        (index - 1) * ITEM_WIDTH,
        index * ITEM_WIDTH,
        (index + 1) * ITEM_WIDTH,
      ],
      outputRange: [width * 0.15, 0, -width * 0.15], 
      extrapolate: 'clamp',
    });

    return (
      // 1. THE OUTER BOUNDARY: Provides the screen width + 15px gap
      <View style={styles.viewerItemContainer}>
        
        {/* 2. 🛑 THE CLIPPING MASK 🛑 
            Strictly bounds the visible area to exactly the screen width. 
            This physically prevents the image from bleeding into the void gap. */}
        <View style={{ width: width, height: '100%', overflow: 'hidden' }}>
          
          {/* 3. THE PARALLAX LAYER: Translates safely inside the mask */}
          <Animated.View style={[{ width: width, height: '100%' }, { transform: [{ translateX: parallaxTranslate }] }]}>
            {isVideo ? (
              <FullScreenVideoPlayer sourceUrl={fullResUrl} isActive={isActive} styles={styles} insets={insets} />
            ) : (
              <ImageViewer 
                fullResUrl={fullResUrl} 
                mediaId={item.id} 
                isActive={isActive}
                item={item}
                styles={styles}
                getFullUrl={getFullUrl}
                api={api}
              />
            )}
          </Animated.View>

        </View>
      </View>
    );
  }, [getFullUrl, selectedMedia, scrollX, styles, insets]);

  // Get layout for initialScrollIndex
  const getItemLayout = useCallback((data, index) => ({
    length: ITEM_WIDTH,
    offset: ITEM_WIDTH * index,
    index,
  }), []);

  // === SMART SYNC GALLERY RENDERER ===
  const renderLocalSyncGallery = () => (
    <Modal visible={localPickerVisible} animationType="slide" onRequestClose={() => setLocalPickerVisible(false)}>
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.header, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border, paddingTop: insets.top, paddingBottom: 12 }]}>
          <TouchableOpacity onPress={() => setLocalPickerVisible(false)} style={styles.closeButton}>
            <Icon name="chevron-left" size={28} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>
              {selectedLocalAssets.size} Selected
            </Text>
          </View>
          <TouchableOpacity onPress={handleSelectAllLocal}>
            <Text style={{ color: theme.colors.primary, fontSize: 16, fontWeight: '600' }}>
              {selectedLocalAssets.size === localAssets.length && localAssets.length > 0 ? 'Deselect All' : 'Select All'}
            </Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={localAssets}
          keyExtractor={(item) => item.id}
          numColumns={3}
          onEndReached={() => fetchLocalMedia(true)}
          onEndReachedThreshold={0.5}
          renderItem={({ item }) => {
            const isSelected = selectedLocalAssets.has(item.id);
            return (
              <TouchableOpacity 
                style={[styles.thumbnailContainer, { position: 'relative' }]}
                onPress={() => toggleLocalAssetSelection(item.id)}
                activeOpacity={0.8}
              >
                <Image source={{ uri: item.uri }} style={styles.thumbnail} contentFit="cover" cachePolicy="none" />
                {isSelected && (
                  <View style={{
                    position: 'absolute', bottom: 4, right: 4, width: 24, height: 24, borderRadius: 12,
                    backgroundColor: '#000',
                    justifyContent: 'center', alignItems: 'center'
                  }}>
                    <Icon name="check" size={16} color="#fff" />
                  </View>
                )}
                {item.mediaType === 'video' && (
                  <View style={{ position: 'absolute', top: 4, left: 4 }}>
                    <Icon name="video" size={16} color={theme.colors.background} style={{ textShadowColor: '#000', textShadowRadius: 4 }} />
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
        />

        <View style={[styles.bottomContainer, { paddingBottom: insets.bottom + 16, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }]}>
          <TouchableOpacity
            style={[styles.uploadButton, { backgroundColor: selectedLocalAssets.size > 0 ? theme.colors.primary : theme.colors.surface }]}
            disabled={selectedLocalAssets.size === 0}
            onPress={queueSelectedForUpload}
          >
            <Icon name="cloud-upload" size={20} color={selectedLocalAssets.size > 0 ? theme.colors.background : theme.colors.textMuted} />
            <Text style={[styles.uploadButtonText, { color: selectedLocalAssets.size > 0 ? theme.colors.background : theme.colors.textMuted }]}>
              Sync {selectedLocalAssets.size} Items to Server
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );

  // Full-screen viewer with swipeable paging
  // Full-screen viewer with swipeable paging
  const renderFullScreenViewer = () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [displayMeta, setDisplayMeta] = useState(selectedMedia);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const metaFadeAnim = useRef(new Animated.Value(1)).current;

    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      if (selectedMedia && selectedMedia.id !== displayMeta?.id) {
        // Fast fade out -> Swap data -> Smooth Bezier fade in
        Animated.timing(metaFadeAnim, { toValue: 0, duration: 100, useNativeDriver: true }).start(() => {
          setDisplayMeta(selectedMedia);
          Animated.timing(metaFadeAnim, { 
            toValue: 1, duration: 300, easing: Easing.bezier(0.4, 0.0, 0.2, 1), useNativeDriver: true 
          }).start();
        });
      } else if (!selectedMedia) {
        setDisplayMeta(null);
      }
    }, [selectedMedia, displayMeta?.id, metaFadeAnim]);

    if (!selectedMedia) return null;
    
    // Fallback while crossfading
    const activeMeta = displayMeta || selectedMedia;

    // Find initial index
    // CRITICAL FIX: Find initial index in the filtered array
    const initialIndex = filteredItems.findIndex(item => item.id === selectedMedia.id);

    // Render metadata drawer for swipe-up gesture
    const renderMetadataDrawer = () => {
      if (!selectedMedia) return null;
      const activeTags = [];
      try {
        const parsed = JSON.parse(selectedMedia.tags || '[]');
        if (Array.isArray(parsed)) parsed.forEach(t => activeTags.push(t));
      } catch(e) {}

      const sizeMB = selectedMedia.size ? (selectedMedia.size / (1024 * 1024)).toFixed(2) : 'Unknown';

      return (
        <Animated.View style={[styles.metadataDrawer, { transform: [{ translateY: drawerY }] }]}>
          <View style={styles.drawerHandle} />
          <Text style={[styles.drawerTitle, { color: theme.colors.textPrimary }]}>File Information</Text>
          <ScrollView style={{ flex: 1, width: '100%' }} showsVerticalScrollIndicator={false}>
            
            <View style={styles.infoRow}>
              <Icon name="file-outline" size={20} color={theme.colors.textSecondary} />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Filename</Text>
                <Text style={{ color: theme.colors.textPrimary, fontSize: 14, fontWeight: '500' }}>{selectedMedia.filename}</Text>
              </View>
            </View>

            <View style={styles.infoRow}>
              <Icon name="harddisk" size={20} color={theme.colors.textSecondary} />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Size & Resolution</Text>
                <Text style={{ color: theme.colors.textPrimary, fontSize: 14, fontWeight: '500' }}>
                  {sizeMB} MB {selectedMedia.width && `• ${selectedMedia.width}x${selectedMedia.height}`}
                </Text>
              </View>
            </View>

            <Text style={[styles.drawerTitle, { color: theme.colors.textPrimary, marginTop: 24, fontSize: 15 }]}>Tags & Albums</Text>
            <View style={styles.chipInputContainer}>
              {activeTags.length > 0 ? activeTags.map((tag, i) => (
                <View key={i} style={[styles.chip, { backgroundColor: theme.colors.primary }]}>
                  <Text style={styles.chipText}>{tag}</Text>
                </View>
              )) : <Text style={{ color: theme.colors.textMuted }}>No tags assigned</Text>}
            </View>

          </ScrollView>
        </Animated.View>
      );
    };

    return (
      <Modal
        visible={selectedMedia !== null}
        transparent={true}
        animationType="none"
        onRequestClose={closeViewer}
      >
        <Pressable 
          style={styles.viewerContainer}
          onPress={toggleInfoVisibility}
          {...swipeResponder.panHandlers}
        >
          {/* Black background */}
          <Animated.View 
            style={[
              styles.viewerBackground,
              { opacity: opacityAnim }
            ]} 
          />
          
          {/* Date/Resolution overlays moved inside ViewerItem for proper positioning */}

          {/* Top Right Actions: Edit, Tags, Close */}
          <Animated.View 
            style={[
              styles.premiumBezel,
              styles.viewerCloseButton, 
              { 
                top: insets.top + 16,
                opacity: zoomScale > 1.05 ? 0 : opacityAnim,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 20, // Clean spacing between action icons
                borderRadius: 30,
                paddingHorizontal: 16,
                paddingVertical: 8,
              }
            ]}
            pointerEvents={zoomScale > 1.05 ? 'none' : 'auto'}
          >
            {/* Only show Edit button for Images, not Videos */}
            {selectedMedia?.type !== 'video' && (
              <TouchableOpacity 
                onPress={openImageEditor}
                hitSlop={HIT_SLOP_15}
              >
                <Icon name="pencil" size={26} color="#fff" style={{ textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 }} />
              </TouchableOpacity>
            )}

            <TouchableOpacity 
              onPress={openTagEditor}
              hitSlop={HIT_SLOP_15}
            >
              <Icon name="tag-multiple" size={26} color="#fff" style={{ textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 }} />
            </TouchableOpacity>
            
            <TouchableOpacity 
              onPress={closeViewer}
              activeOpacity={0.6}
              hitSlop={HIT_SLOP_15}
            >
              <Icon name="close" size={28} color="#fff" style={{ textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 }} />
            </TouchableOpacity>
          </Animated.View>

          {/* Global Bottom Action Bar (Immune to FlatList Swipes & Pointer Traps) */}
          <Animated.View 
            style={[
              { 
                position: 'absolute', 
                left: 24, 
                right: 24, 
                bottom: insets.bottom + 24, 
                flexDirection: 'row', 
                justifyContent: 'space-between', 
                alignItems: 'flex-end',
                opacity: zoomScale > 1.05 ? 0 : infoOpacityAnim, // Fades out smoothly on single tap
                zIndex: 10,
              }
            ]}
            pointerEvents={zoomScale > 1.05 || !infoVisible ? 'none' : 'box-none'} // Disable when zoomed or hidden
          >
            {/* Left Side: Date & Resolution (Animated Crossfade) */}
            <Animated.View style={{ flex: 1, opacity: metaFadeAnim }} pointerEvents="none">
              <Text style={[styles.viewerInfoDate, { textAlign: 'left', marginBottom: 4 }]} numberOfLines={1}>
                {activeMeta.originalDate 
                  ? new Date(activeMeta.originalDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : activeMeta.uploadDate 
                    ? new Date(activeMeta.uploadDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                    : ''
                }
              </Text>
              {activeMeta.width && activeMeta.height && (
                <Text style={[styles.viewerInfoResolution, { textAlign: 'left' }]}>
                  {activeMeta.width} × {activeMeta.height}
                  {activeMeta.type === 'video' && ' • Video'}
                </Text>
              )}
            </Animated.View>
            
            {/* Right Side: Share & Favourites inside a Premium Pill */}
            <View style={[styles.premiumBezel, { flexDirection: 'row', gap: 20, alignItems: 'center', borderRadius: 30, paddingHorizontal: 20, paddingVertical: 10 }]} pointerEvents="auto">
              <TouchableOpacity 
                onPress={handleShare}
                hitSlop={HIT_SLOP_20}
                activeOpacity={0.6}
              >
                <Icon name="share-variant" size={28} color="#fff" style={{ textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 }} />
              </TouchableOpacity>

              <TouchableOpacity 
                onPress={toggleFavourite}
                hitSlop={HIT_SLOP_20}
                activeOpacity={0.6}
              >
                <Icon 
                  name={selectedMedia?.tags?.includes('Favourites') ? "heart" : "heart-outline"} 
                  size={30} 
                  color={selectedMedia?.tags?.includes('Favourites') ? "#ef4444" : "#ffffff"} 
                  style={{ textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 }}
                />
              </TouchableOpacity>
            </View>
          </Animated.View>

          {/* Horizontal swipeable FlatList wrapped in GPU-bound Animated.View */}
          <Animated.View 
            style={[
              styles.viewerFlatListContainer,
              { transform: [{ scale: scaleAnim }], opacity: opacityAnim }
            ]}
          >
            <Animated.FlatList
              data={displayItems}
              renderItem={renderViewerItem}
              keyExtractor={(item) => item.id}
              horizontal={true}
              showsHorizontalScrollIndicator={false}
              
              // --- 🛑 STRICT 1-ITEM SWIPE PHYSICS 🛑 ---
              pagingEnabled={false} // CRITICAL: Turn off native paging because we have a 4px gap
              snapToInterval={ITEM_WIDTH} // Snap exactly to our custom width + gap
              snapToAlignment="center"
              disableIntervalMomentum={true} // MAGIC BULLET: Prevents momentum from skipping past the next adjacent item
              decelerationRate="fast" // Snaps instantly instead of drifting slowly
              // ----------------------------------------
              
              initialNumToRender={3}
              windowSize={5}
              maxToRenderPerBatch={5}
              removeClippedSubviews={false}
              getItemLayout={getItemLayout}
              initialScrollIndex={initialIndex >= 0 ? initialIndex : 0}
              onScroll={Animated.event(
                [{ nativeEvent: { contentOffset: { x: scrollX } } }],
                { useNativeDriver: true }
              )}
              scrollEventThrottle={16}
              onMomentumScrollEnd={handleMomentumScrollEnd}
              snapToAlignment="center"
            />
          </Animated.View>



          {/* Inline Tag Editor Overlay (Animated & Chip UI) */}
          {editTagsVisible && (
            <Animated.View style={[StyleSheet.absoluteFillObject, { zIndex: 100, opacity: tagFadeAnim }]}>
              {/* Background Dismiss Handler - closes modal and dismisses keyboard */}
              <Pressable 
                style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.7)' }]}
                onPress={() => {
                  Keyboard.dismiss();
                  closeTagEditor();
                }}
              >
                {/* Scrollable Modal Container - adjusts for keyboard */}
                <ScrollView 
                  contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center' }}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                >
                  {/* Inner Modal Container - intercepts touches so background doesn't trigger */}
                  <Pressable 
                    style={[styles.uploadModalContent, { backgroundColor: theme.colors.surfaceElevated, width: width * 0.9, maxHeight: height * 0.8 }]}
                    onPress={(e) => {
                      e.stopPropagation();
                      Keyboard.dismiss();
                    }}
                  >
                    {/* Modal Header */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <Text style={[styles.uploadModalTitle, { color: theme.colors.textPrimary, marginBottom: 0 }]}>Edit Tags</Text>
                      <TouchableOpacity onPress={closeTagEditor} style={{ padding: 4 }}>
                        <Icon name="close" size={24} color={theme.colors.textSecondary} />
                      </TouchableOpacity>
                    </View>
                    
                    <Text style={[styles.uploadModalLabel, { color: theme.colors.textSecondary }]}>Assigned Tags:</Text>
                  
                    {/* Dynamic Chip Input Box */}
                    <View style={[styles.chipInputContainer, { borderColor: theme.colors.border }]}>
                    {editingTags.map((tag, index) => (
                      <View key={index} style={[styles.chip, { backgroundColor: theme.colors.primary }]}>
                        <Text style={styles.chipText}>{tag}</Text>
                        <TouchableOpacity onPress={() => setEditingTags(editingTags.filter((_, i) => i !== index))}>
                          <Icon name="close-circle" size={16} color={theme.colors.background} />
                        </TouchableOpacity>
                      </View>
                    ))}
                    <TextInput
                      style={[styles.chipTextInput, { color: theme.colors.textPrimary }]}
                      value={tagInputValue}
                      onChangeText={(text) => {
                        // Auto-box when a comma is typed
                        if (text.includes(',')) {
                          const newTags = text.split(',').map(t => t.trim()).filter(Boolean);
                          if (newTags.length > 0) {
                            setEditingTags(prev => Array.from(new Set([...prev, ...newTags])));
                          }
                          setTagInputValue('');
                        } else {
                          setTagInputValue(text);
                        }
                      }}
                      onKeyPress={({ nativeEvent }) => {
                        // Backspace deletes the last chip if input is empty
                        if (nativeEvent.key === 'Backspace' && tagInputValue === '' && editingTags.length > 0) {
                          setEditingTags(prev => prev.slice(0, -1));
                        }
                      }}
                      onSubmitEditing={() => {
                        // Submit with return key adds the tag
                        if (tagInputValue.trim()) {
                          setEditingTags(prev => Array.from(new Set([...prev, tagInputValue.trim()])));
                          setTagInputValue('');
                        }
                        Keyboard.dismiss();
                      }}
                      placeholder={editingTags.length === 0 ? "Type tags, comma or return to add..." : ""}
                      placeholderTextColor={theme.colors.textMuted}
                      autoCapitalize="words"
                      returnKeyType="done"
                      blurOnSubmit={true}
                    />
                  </View>

                  {/* Autocomplete suggestions - show matching tags with active ones pinned to front */}
                  {tagInputValue.length > 0 && (
                    <View style={styles.tagAutocompleteContainer}>
                      <Text style={[styles.tagAutocompleteLabel, { color: theme.colors.textMuted }]}>
                        Matching tags:
                      </Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tagAutocompleteScroll}>
                        {pinnedAlbums
                          .filter(album => album.toLowerCase().includes(tagInputValue.toLowerCase()))
                          .sort((a, b) => {
                            // Pin active tags to the front
                            const aActive = editingTags.includes(a);
                            const bActive = editingTags.includes(b);
                            if (aActive && !bActive) return -1;
                            if (!aActive && bActive) return 1;
                            return a.localeCompare(b);
                          })
                          .map(album => (
                            <TouchableOpacity 
                              key={album} 
                              style={[
                                styles.tagAutocompleteChip,
                                editingTags.includes(album) && { backgroundColor: theme.colors.primary }
                              ]}
                              onPress={() => {
                                if (!editingTags.includes(album)) {
                                  setEditingTags([...editingTags, album]);
                                }
                                setTagInputValue('');
                              }}
                            >
                              <Text style={[
                                styles.tagAutocompleteChipText,
                                editingTags.includes(album) && { color: theme.colors.background }
                              ]}>
                                {album}
                              </Text>
                            </TouchableOpacity>
                          ))}
                      </ScrollView>
                    </View>
                  )}

                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickSelectScroll}>
                    {pinnedAlbums.map(album => (
                      <TouchableOpacity 
                        key={album} 
                        style={[styles.quickSelectChip, editingTags.includes(album) && { backgroundColor: theme.colors.primary }]}
                        onPress={() => {
                          if (editingTags.includes(album)) {
                            setEditingTags(editingTags.filter(t => t !== album));
                          } else {
                            setEditingTags([...editingTags, album]);
                          }
                        }}
                      >
                        <Text style={[styles.quickSelectText, editingTags.includes(album) && { color: theme.colors.background }]}>{album}</Text>
                      </TouchableOpacity>
                    ))}
                </ScrollView>
                
                  <View style={styles.uploadModalButtons}>
                    <TouchableOpacity 
                      style={[styles.uploadModalButton, { backgroundColor: theme.colors.surface }]}
                      onPress={closeTagEditor}
                    >
                      <Text style={{ color: theme.colors.textPrimary }}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.uploadModalButton, { backgroundColor: theme.colors.primary }]}
                      onPress={async () => {
                        try {
                          let finalTags = [...editingTags];
                          if (tagInputValue.trim()) {
                            finalTags.push(tagInputValue.trim());
                          }
                          finalTags = Array.from(new Set(finalTags));

                          if (isSelectMode) {
                            // === BULK TAGGING LOGIC (Smart Diffing) ===
                            await executeBulkTagSave();
                            closeTagEditor();
                            
                          } else {
                            // === SINGLE TAGGING LOGIC ===
                            const tagPayload = {
                              tags: finalTags, filename: selectedMedia.filename, type: selectedMedia.type,
                              size: selectedMedia.size, url: selectedMedia.url || selectedMedia.rawUrl, thumbnailUrl: selectedMedia.thumbnailUrl,
                              width: selectedMedia.width, height: selectedMedia.height, duration: selectedMedia.duration,
                            };
                            
                            const res = await api.put(`/media/${selectedMedia.id}/tags`, tagPayload);
                            
                            if (res && res.success) {
                              const newTagsString = JSON.stringify(finalTags);
                              setSelectedMedia(prev => ({ ...prev, tags: newTagsString }));
                              
                              const updateItemInList = (prevList) => {
                                if (selectedAlbum !== 'All' && !finalTags.includes(selectedAlbum)) {
                                  return prevList.filter(item => item.id !== selectedMedia.id);
                                }
                                return prevList.map(item => item.id === selectedMedia.id ? { ...item, tags: newTagsString } : item);
                              };
                              
                              setUploadItems(updateItemInList);
                              setServerItems(updateItemInList);
                              setGlobalAlbums(prev => Array.from(new Set([...prev, ...finalTags])).sort());
                              closeTagEditor();
                            } else {
                              Alert.alert('Error', 'Server rejected the tag update');
                            }
                          }
                        } catch(e) { Alert.alert('Error', `Failed to update tags: ${e.message}`); }
                      }}
                    >
                      <Text style={{ color: theme.colors.background, fontWeight: 'bold' }}>Save</Text>
                    </TouchableOpacity>
                  </View>
                </Pressable>
                </ScrollView>
              </Pressable>
            </Animated.View>
          )}

          {/* iOS-style Metadata Drawer */}
          {renderMetadataDrawer()}
        </Pressable>
      </Modal>
    );
  };

  // === NATIVE 1:1 SWIPE PAGINATION & BEZIER INDICATOR ===
  const tabWidth = (width - 32) / 3;
  const pagesScrollRef = useRef(null);
  const pageScrollX = useRef(new Animated.Value(0)).current;
  const TABS = useMemo(() => ['uploads', 'albums', 'turtle-base'], []);

  // The background pill perfectly tracks the ScrollView 1:1
  const tabIndicatorX = pageScrollX.interpolate({
    inputRange: [0, width, width * 2],
    outputRange: [0, tabWidth, tabWidth * 2],
    extrapolate: 'clamp'
  });

  // IMPERATIVE TAB PRESS: We tell the ScrollView to move. 
  // Because tabIndicatorX is bound to pageScrollX, the indicator will slide automatically!
  const handleTabPress = useCallback((tab) => {
    const index = TABS.indexOf(tab);
    if (index >= 0 && pagesScrollRef.current) {
      pagesScrollRef.current.scrollTo({ x: index * width, animated: true });
    }
    
    // Tap active "Photos" tab to smoothly scroll to most recent (offset 0)
    if (tab === 'uploads' && activeTab === 'uploads' && gridRef.current) {
      gridRef.current.scrollToOffset({ offset: 0, animated: true });
    }

    setActiveTab(tab);
    // Reset back to root Photo Vault when leaving the main Photos tab
    if (tab === 'turtle-base' || tab === 'albums') setSelectedAlbum('All');
  }, [TABS, width, activeTab]);

  // SWIPE END: The ScrollView tells React it finished moving.
  const handlePageSwipeEnd = useCallback((event) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / width);
    const newTab = TABS[index];
    if (newTab && newTab !== activeTab) {
      setActiveTab(newTab);
      // Reset back to root Photo Vault when leaving the main Photos tab
      if (newTab === 'turtle-base' || newTab === 'albums') setSelectedAlbum('All');
    }
  }, [activeTab, width, TABS]);

  // === MEMOIZED STYLES ===
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.container}>
      {/* Full-screen viewer & Modals */}
      {renderFullScreenViewer()}
      {renderLocalSyncGallery()}

      {/* Expanding Inline Bulk Console */}
      {isSelectMode && (
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'position' : undefined}
          style={{ position: 'absolute', bottom: insets.bottom + 24, left: 16, right: 16, zIndex: 50 }}
          pointerEvents="box-none"
        >
          {!isBulkTagging ? (
            <Animated.View style={[styles.premiumBezel, {
              alignSelf: 'center', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 30, gap: 8
            }]}>
              <TouchableOpacity 
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: selectedGridItems.size === 0 ? 0.5 : 1 }}
                disabled={selectedGridItems.size === 0}
                onPress={async () => {
                  // Share multiple selected items
                  const items = Array.from(selectedGridItems).map(id => 
                    uploadItems.find(i => i.id === id) || serverItems.find(i => i.id === id)
                  ).filter(Boolean);
                  
                  if (items.length === 0) return;
                  
                  try {
                    const urls = items.map(item => getFullUrl(item.rawUrl || item.url));
                    
                    if (urls.length === 1) {
                      // Single item share
                      await Sharing.shareAsync(urls[0], { dialogTitle: 'Share photo' });
                    } else {
                      // Multiple items - open share sheet for first one for now
                      // Note: expo-sharing doesn't support multiple URLs natively
                      Alert.alert(
                        'Share Multiple',
                        `${items.length} items selected. Share the first one?`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { 
                            text: 'Share First', 
                            onPress: async () => {
                              await Sharing.shareAsync(urls[0], { dialogTitle: 'Share photo' });
                            }
                          }
                        ]
                      );
                    }
                  } catch (error) {
                    console.error('[MediaGallery] Bulk share error:', error);
                    Alert.alert('Error', 'Could not share selected items');
                  }
                }}
              >
                <Icon name="share-variant" size={20} color={theme.colors.primary} />
                <Text style={{ color: theme.colors.textPrimary, fontWeight: 'bold', fontSize: 15 }}>
                  Share
                </Text>
              </TouchableOpacity>
              
              <View style={{ width: 1, height: 20, backgroundColor: theme.colors.border, marginHorizontal: 8 }} />
              
              <TouchableOpacity 
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: selectedGridItems.size === 0 ? 0.5 : 1 }}
                disabled={selectedGridItems.size === 0}
                onPress={() => {
                  // Calculate exact tag intersection across selected items
                  let commonTags = null;
                  Array.from(selectedGridItems).forEach(id => {
                    const item = uploadItems.find(i => i.id === id) || serverItems.find(i => i.id === id);
                    if (item) {
                      try {
                        const itemTags = JSON.parse(item.tags || '[]');
                        if (commonTags === null) commonTags = [...itemTags];
                        else commonTags = commonTags.filter(t => itemTags.includes(t));
                      } catch(e) {}
                    }
                  });
                  setEditingTags(commonTags || []);
                  setTagInputValue('');
                  setIsBulkTagging(true);
                }}
              >
                <Icon name="tag-multiple" size={20} color={theme.colors.primary} />
                <Text style={{ color: theme.colors.textPrimary, fontWeight: 'bold', fontSize: 15 }}>
                  Tag
                </Text>
              </TouchableOpacity>
              
              <View style={{ width: 1, height: 20, backgroundColor: theme.colors.border, marginHorizontal: 8 }} />
              
              <TouchableOpacity 
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: selectedGridItems.size === 0 ? 0.5 : 1 }}
                disabled={selectedGridItems.size === 0}
                onPress={() => {
                  Alert.alert(
                    'Delete Selected',
                    `Delete ${selectedGridItems.size} selected items?`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { 
                        text: 'Delete', 
                        style: 'destructive',
                        onPress: async () => {
                          const ids = Array.from(selectedGridItems);
                          for (const id of ids) {
                            try { await api.delete(`/media/${id}`); } catch (e) {}
                          }
                          setUploadItems(prev => prev.filter(item => !selectedGridItems.has(item.id)));
                          setServerItems(prev => prev.filter(item => !selectedGridItems.has(item.id)));
                          setIsSelectMode(false);
                          setSelectedGridItems(new Set());
                        }
                      }
                    ]
                  );
                }}
              >
                <Icon name="trash-can-outline" size={20} color="#DC2626" />
                <Text style={{ color: '#DC2626', fontWeight: 'bold', fontSize: 15 }}>
                  Delete
                </Text>
              </TouchableOpacity>
            </Animated.View>
          ) : (
            <Animated.View style={[styles.premiumBezel, {
              borderRadius: 20, padding: 16, width: '100%',
              backgroundColor: theme.mode === 'dark' ? 'rgba(30, 30, 32, 0.95)' : 'rgba(252, 252, 255, 0.98)'
            }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <TouchableOpacity onPress={() => setIsBulkTagging(false)}>
                  <Icon name="close" size={24} color={theme.colors.textSecondary} />
                </TouchableOpacity>
                <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Tagging {selectedGridItems.size} Items</Text>
                <TouchableOpacity onPress={executeBulkTagSave}>
                  <Text style={{ color: theme.colors.primary, fontWeight: 'bold', fontSize: 16 }}>Save</Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.chipInputContainer, { borderColor: theme.colors.border, minHeight: 44, marginBottom: 8 }]}>
                {editingTags.map((tag, index) => (
                  <View key={index} style={[styles.chip, { backgroundColor: theme.colors.primary, paddingVertical: 4 }]}>
                    <Text style={styles.chipText}>{tag}</Text>
                    <TouchableOpacity onPress={() => setEditingTags(editingTags.filter((_, i) => i !== index))}>
                      <Icon name="close-circle" size={16} color={theme.colors.background} />
                    </TouchableOpacity>
                  </View>
                ))}
                <TextInput
                  style={[styles.chipTextInput, { color: theme.colors.textPrimary, paddingVertical: 0, margin: 0, height: 28 }]}
                  value={tagInputValue}
                  onChangeText={(text) => {
                    if (text.includes(',')) {
                      const newTags = text.split(',').map(t => t.trim()).filter(Boolean);
                      if (newTags.length > 0) setEditingTags(prev => Array.from(new Set([...prev, ...newTags])));
                      setTagInputValue('');
                    } else { setTagInputValue(text); }
                  }}
                  onKeyPress={({ nativeEvent }) => {
                    if (nativeEvent.key === 'Backspace' && tagInputValue === '' && editingTags.length > 0) {
                      setEditingTags(prev => prev.slice(0, -1));
                    }
                  }}
                  onSubmitEditing={() => {
                    if (tagInputValue.trim()) {
                      setEditingTags(prev => Array.from(new Set([...prev, tagInputValue.trim()])));
                      setTagInputValue('');
                    }
                  }}
                  placeholder={editingTags.length === 0 ? "Type tag..." : ""}
                  placeholderTextColor={theme.colors.textMuted}
                  returnKeyType="done"
                  autoCapitalize="words"
                />
              </View>

              {tagInputValue.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollHorizontal}>
                  {globalAlbums.filter(a => a.toLowerCase().includes(tagInputValue.toLowerCase())).map(album => (
                    <TouchableOpacity 
                      key={album} style={[styles.quickSelectChip, { borderWidth: 1, borderColor: theme.colors.border }]}
                      onPress={() => {
                        if (!editingTags.includes(album)) setEditingTags([...editingTags, album]);
                        setTagInputValue('');
                      }}
                    >
                      <Text style={{ color: theme.colors.textPrimary }}>{album}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollHorizontal}>
                  {pinnedAlbums.map(album => (
                    <TouchableOpacity 
                      key={album} style={[styles.quickSelectChip, editingTags.includes(album) && { backgroundColor: theme.colors.primary }]}
                      onPress={() => {
                        if (editingTags.includes(album)) setEditingTags(editingTags.filter(t => t !== album));
                        else setEditingTags([...editingTags, album]);
                      }}
                    >
                      <Text style={[styles.quickSelectText, editingTags.includes(album) && { color: theme.colors.background }]}>{album}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </Animated.View>
          )}
        </KeyboardAvoidingView>
      )}

      {/* Pre-Upload Album Selection Modal (Draggable Bottom-Sheet Style) */}
      <Modal 
        visible={uploadModalVisible} 
        transparent={true} 
        animationType="none"
        onShow={() => {
          // Ensure modal is reset when shown
          uploadModalY.stopAnimation();
          uploadModalY.setValue(0);
        }}
      >
        <View style={styles.uploadModalOverlay}>
          {/* Background dimmer - tap to dismiss */}
          <Pressable 
            style={StyleSheet.absoluteFill} 
            onPress={dismissUploadModal}
          />
          <Animated.View 
            style={[
              styles.uploadModalContent, 
              { 
                backgroundColor: theme.colors.surfaceElevated,
                transform: [{ translateY: uploadModalY }] 
              }
            ]}
            {...uploadPanResponder.panHandlers}
          >
            <View style={{ width: 40, height: 5, backgroundColor: theme.colors.border, borderRadius: 3, alignSelf: 'center', marginBottom: 16 }} />

            <Text style={[styles.uploadModalTitle, { color: theme.colors.textPrimary, marginTop: 0 }]}>
              Upload {pendingAssets.length} Item{pendingAssets.length > 1 ? 's' : ''}
            </Text>
            
            <Text style={[styles.uploadModalLabel, { color: theme.colors.textSecondary }]}>Save to Album:</Text>
            
            <View style={[styles.chipInputContainer, { borderColor: theme.colors.border }]}>
              {selectedTags.map((tag, index) => (
                <View key={index} style={[styles.chip, { backgroundColor: theme.colors.primary }]}>
                  <Text style={styles.chipText}>{tag}</Text>
                  <TouchableOpacity onPress={() => setSelectedTags(selectedTags.filter((_, i) => i !== index))}>
                    <Icon name="close-circle" size={16} color={theme.colors.background} />
                  </TouchableOpacity>
                </View>
              ))}
              <TextInput
                style={[styles.chipTextInput, { color: theme.colors.textPrimary }]}
                value={tagInputValue}
                onChangeText={(text) => {
                  if (text.includes(',')) {
                    const newTags = text.split(',').map(t => t.trim()).filter(Boolean);
                    if (newTags.length > 0) {
                      setSelectedTags(prev => Array.from(new Set([...prev, ...newTags])));
                    }
                    setTagInputValue('');
                  } else {
                    setTagInputValue(text);
                  }
                }}
                onKeyPress={({ nativeEvent }) => {
                  if (nativeEvent.key === 'Backspace' && tagInputValue === '' && selectedTags.length > 0) {
                    setSelectedTags(prev => prev.slice(0, -1));
                  }
                }}
                placeholder={selectedTags.length === 0 ? "Type tags, comma to add..." : ""}
                placeholderTextColor={theme.colors.textMuted}
                autoCapitalize="words"
                blurOnSubmit={true}
                onSubmitEditing={() => Keyboard.dismiss()}
                inputAccessoryViewID="uploadTagInputAccessory"
              />
            </View>

            {tagInputValue.length > 0 && (
              <View style={styles.tagAutocompleteContainer}>
                <Text style={[styles.tagAutocompleteLabel, { color: theme.colors.textMuted }]}>
                  Matching tags:
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tagAutocompleteScroll}>
                  {globalAlbums
                    .filter(album => album.toLowerCase().includes(tagInputValue.toLowerCase()))
                    .sort((a, b) => {
                      const aActive = selectedTags.includes(a);
                      const bActive = selectedTags.includes(b);
                      if (aActive && !bActive) return -1;
                      if (!aActive && bActive) return 1;
                      return a.localeCompare(b);
                    })
                    .map(album => (
                      <TouchableOpacity 
                        key={album} 
                        style={[
                          styles.tagAutocompleteChip,
                          selectedTags.includes(album) && { backgroundColor: theme.colors.primary }
                        ]}
                        onPress={() => {
                          if (!selectedTags.includes(album)) {
                            setSelectedTags([...selectedTags, album]);
                          }
                          setTagInputValue('');
                          Keyboard.dismiss();
                        }}
                      >
                        <Text style={[
                          styles.tagAutocompleteChipText,
                          selectedTags.includes(album) && { color: theme.colors.background }
                        ]}>
                          {album}
                        </Text>
                      </TouchableOpacity>
                    ))}
                </ScrollView>
              </View>
            )}

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickSelectScroll}>
              {globalAlbums.map(album => (
                <TouchableOpacity 
                  key={album} 
                  style={[styles.quickSelectChip, selectedTags.includes(album) && { backgroundColor: theme.colors.primary }]}
                  onPress={() => {
                    if (selectedTags.includes(album)) {
                      setSelectedTags(selectedTags.filter(t => t !== album));
                    } else {
                      setSelectedTags([...selectedTags, album]);
                    }
                    Keyboard.dismiss();
                  }}
                >
                  <Text style={[styles.quickSelectText, selectedTags.includes(album) && { color: theme.colors.background }]}>{album}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            
            <View style={styles.uploadModalButtons}>
              <TouchableOpacity 
                style={[styles.uploadModalButton, { backgroundColor: theme.colors.surface }]}
                onPress={dismissUploadModal}
                disabled={uploading}
              >
                <Text style={{ color: theme.colors.textPrimary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.uploadModalButton, { backgroundColor: theme.colors.primary, opacity: uploading ? 0.6 : 1 }]}
                onPress={executeUpload}
                disabled={uploading}
              >
                <Text style={{ color: theme.colors.background, fontWeight: 'bold' }}>
                  {uploading ? 'Uploading...' : 'Upload Now'}
                </Text>
              </TouchableOpacity>
            </View>

            {uploading && (
              <View style={{ marginTop: 16, alignItems: 'center', width: '100%' }}>
                {uploadPercentage < 100 ? (
                  <ActivityIndicator size="large" color={theme.colors.primary} />
                ) : (
                  <View style={{ height: 36, justifyContent: 'center' }}>
                    <Text style={{ color: theme.colors.primary, fontSize: 28, fontWeight: '700' }}>✓</Text>
                  </View>
                )}
                <Text style={{ color: theme.colors.textPrimary, marginTop: 12, fontWeight: 'bold' }}>
                  {uploadPercentage < 100
                    ? `Uploading Item ${Math.min(uploadingItemIndex, pendingAssets.length)} of ${pendingAssets.length}`
                    : 'Upload Complete'}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, marginTop: 4 }}>
                  {uploadPercentage}% Complete
                </Text>

                {/* Visual Progress Bar — animated width driven by progressAnim. */}
                <View style={{ width: '100%', height: 6, backgroundColor: theme.colors.border, borderRadius: 3, marginTop: 8, overflow: 'hidden' }}>
                  <Animated.View
                    style={{
                      height: '100%',
                      backgroundColor: theme.colors.primary,
                      borderRadius: 3,
                      width: progressAnim.interpolate({
                        inputRange: [0, 100],
                        outputRange: ['0%', '100%'],
                        extrapolate: 'clamp',
                      }),
                    }}
                  />
                </View>
              </View>
            )}
          </Animated.View>
        </View>
      </Modal>

      {/* Keyboard Dismiss Button (iOS only) */}
      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID="uploadTagInputAccessory">
          <View style={[styles.keyboardAccessoryContainer, { backgroundColor: theme.colors.surfaceElevated }]}>
            <TouchableOpacity onPress={() => Keyboard.dismiss()} style={styles.keyboardAccessoryButton}>
              <Text style={[styles.keyboardAccessoryText, { color: theme.colors.primary }]}>Done</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      )}

      {/* 1. Main Content Area - Native Swipeable Pages */}
      <View style={StyleSheet.absoluteFill}>
        <Animated.ScrollView
          ref={pagesScrollRef}
          horizontal
          pagingEnabled
          bounces={false}
          showsHorizontalScrollIndicator={false}
          scrollEnabled={selectedAlbum === 'All'} // Apple UX: Lock page swiping when viewing a specific album!
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: pageScrollX } } }],
            { useNativeDriver: true }
          )}
          scrollEventThrottle={16}
          onMomentumScrollEnd={handlePageSwipeEnd}
          style={{ flex: 1, flexDirection: 'row' }}
        >
          
          {/* PAGE 1: UPLOADS */}
          <Animated.View 
            style={{ width, height: '100%', transform: [{ translateX: albumSlideAnim }] }}
            {...edgeSwipeResponder.panHandlers}
          >
            <AnimatedFlashList
              ref={gridRef}
              data={uploadDisplayItems}
              renderItem={(props) => renderItem({...props, activeTab: 'uploads'})}
              keyExtractor={(item) => item.id}
              numColumns={3}
              // --- DOUBLE-FLIP WORKAROUND ---
              style={{ flex: 1, transform: [{ scaleY: -1 }] }} 
              // ------------------------------
              contentContainerStyle={[styles.gridContent, { paddingBottom: insets.top + 90, paddingTop: insets.bottom + 16 }]}
              showsVerticalScrollIndicator={false}
              onRefresh={handleRefresh}
              refreshing={refreshing}
              onEndReached={handleLoadMore}
              onEndReachedThreshold={2.5}
              estimatedItemSize={width / 3} 
              ListEmptyComponent={(!loading && !isPaginating && !refreshing) ? renderEmpty : null}
              ListHeaderComponent={
                <View style={{ transform: [{ scaleY: -1 }] }}>
                  <View style={[styles.bottomContainer, { paddingBottom: 16 }]}>
                  <View style={styles.countContainer}>
                    <Text style={[styles.countText, { color: theme.colors.textSecondary }]}>
                      {activeTab === 'uploads' && globalUploadsTotal > 0 
                        ? `${globalUploadsTotal.toLocaleString()} Items` 
                        : photoCount > 0 && videoCount > 0 
                          ? `${photoCount} Photos, ${videoCount} Videos` 
                          : photoCount > 0 ? `${photoCount} ${photoCount === 1 ? 'Photo' : 'Photos'}` 
                          : `${videoCount} ${videoCount === 1 ? 'Video' : 'Videos'}`
                      }
                    </Text>
                  </View>
                  <View style={{ alignItems: 'center', width: '100%', marginTop: 8 }}>
                    <View style={{ flexDirection: 'row', gap: 12, width: '100%' }}>
                      <TouchableOpacity style={[styles.actionButton, { flex: 1, backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' }]} onPress={handleUpload} disabled={uploading} activeOpacity={0.7}>
                        <View style={[styles.actionButtonIcon, { backgroundColor: theme.colors.primary + '20' }]}><Icon name="image-plus" size={18} color={theme.colors.primary} /></View>
                        <Text style={[styles.actionButtonText, { color: theme.colors.textPrimary }]}>Upload</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionButton, { flex: 1, backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' }]} onPress={openLocalSyncGallery} disabled={uploading} activeOpacity={0.7}>
                        <View style={[styles.actionButtonIcon, { backgroundColor: theme.colors.primary + '20' }]}><Icon name="folder-sync" size={18} color={theme.colors.primary} /></View>
                        <Text style={[styles.actionButtonText, { color: theme.colors.textPrimary }]}>Smart Sync</Text>
                      </TouchableOpacity>
                    </View>
                    {uploading && <Text style={{ marginTop: 12, fontSize: 13, fontWeight: '600', color: theme.colors.primary }}>Uploading {uploadStats.current === 0 ? 1 : uploadStats.current} of {uploadStats.total} • {uploadStats.fileProgress.toFixed(0)}% Complete</Text>}
                  </View>
                </View>
                </View>
              }
              ListFooterComponent={
                <View style={{ transform: [{ scaleY: -1 }] }}>
                  <View style={{ paddingTop: 16 }}>
                    {isPaginating && hasMoreUploads && (
                      <View style={styles.phantomSkeletonContainer}>
                        {[...Array(6)].map((_, i) => <ShimmerSkeleton key={`header-skel-${i}`} styles={styles} theme={theme} />)}
                      </View>
                    )}
                  </View>
                </View>
              }
            />
          </Animated.View>

          {/* PAGE 2: ALBUMS */}
          <View style={{ width, height: '100%' }}>
            <Animated.FlatList
              data={pinnedAlbums}
              keyExtractor={(item) => item}
              numColumns={2}
              contentContainerStyle={[styles.albumsGridContent, { paddingTop: insets.top + 90 }]}
              columnWrapperStyle={styles.albumsColumnWrapper}
              ListEmptyComponent={() => <View style={styles.emptyContainer}><Text style={{ color: theme.colors.textSecondary }}>No albums created yet.</Text></View>}
              
              // 🔄 PULL TO REFRESH ADDED HERE
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={handleRefresh}
                  tintColor={theme.colors.primary}
                  colors={[theme.colors.primary]}
                  progressViewOffset={insets.top + 90}
                />
              }

              renderItem={({ item }) => {
                const covers = albumCovers[item] || [];
                const gridItems = [...covers, null, null, null, null].slice(0, 4);
                return (
                  <TouchableOpacity 
                    style={styles.albumFolderCard} 
                    activeOpacity={0.9} 
                    onPress={() => { setSelectedAlbum(item); handleTabPress('uploads'); }} 
                    onLongPress={() => showAlbumOptions(item)} 
                    delayLongPress={500}
                  >
                    <View style={styles.albumGridContainer}>
                      {gridItems.map((coverUrl, index) => (
                        <View key={index} style={styles.albumGridCell}>
                          {coverUrl ? <Image source={{ uri: getFullUrl(coverUrl) }} style={styles.albumGridImage} contentFit="cover" transition={200} /> : <View style={styles.albumGridPlaceholder} />}
                        </View>
                      ))}
                    </View>
                    <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={styles.albumGradient}>
                      <Text style={styles.albumGridName} numberOfLines={1}>{item}</Text>
                      <Text style={styles.albumItemCount}>{covers.length > 0 ? 'View Album' : 'Empty'}</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                );
              }}
            />
          </View>

          {/* PAGE 3: PC / TURTLE-BASE */}
          <View style={{ width, height: '100%' }}>
            <AnimatedFlashList
              data={pcDisplayItems}
              renderItem={(props) => renderItem({...props, activeTab: 'turtle-base'})}
              keyExtractor={(item) => item.id}
              numColumns={3}
              // --- DOUBLE-FLIP WORKAROUND ---
              style={{ flex: 1, transform: [{ scaleY: -1 }] }}
              // ------------------------------
              contentContainerStyle={[styles.gridContent, { paddingBottom: insets.top + 90, paddingTop: insets.bottom + 16 }]}
              showsVerticalScrollIndicator={false}
              estimatedItemSize={width / 3} 
              ListEmptyComponent={(!loading && !isPaginating && !refreshing) ? renderEmpty : null}
              ListHeaderComponent={
                  <View style={{ transform: [{ scaleY: -1 }] }}>
                    <View style={[styles.bottomContainer, { paddingBottom: 16 }]}>
                      <View style={styles.countContainer}>
                        <Text style={[styles.countText, { color: theme.colors.textSecondary }]}>
                          {pcPhotoCount > 0 && pcVideoCount > 0 ? `${pcPhotoCount} Photos, ${pcVideoCount} Videos from PC` : pcPhotoCount > 0 ? `${pcPhotoCount} ${pcPhotoCount === 1 ? 'Photo' : 'Photos'} from PC` : `${pcVideoCount} ${pcVideoCount === 1 ? 'Video' : 'Videos'} from PC`}
                        </Text>
                      </View>
                    </View>
                  </View>
                }
              />
          </View>

        </Animated.ScrollView>
      </View>

      {/* Notch Shield */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: theme.colors.background, zIndex: 30 }} />

      {/* 2. Compact Static Header */}
      <View
        style={[
          styles.floatingHeaderContainer, 
          { 
            paddingTop: insets.top,
            backgroundColor: theme.colors.background,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.border,
            zIndex: 20,
          }
        ]}
      >
        {/* Progress Bar */}
        {uploading && (
          <View style={{ position: 'absolute', top: insets.top, left: 0, right: 0, height: 1.5, backgroundColor: 'transparent', zIndex: 25 }}>
            <View style={{ height: '100%', width: `${uploadStats.fileProgress}%`, backgroundColor: theme.mode === 'dark' ? '#FFFFFF' : '#000000' }} />
          </View>
        )}

        {/* Top Row: Title & Actions (Compact) */}
        <View style={[styles.header, { height: 44, paddingHorizontal: 16 }]}>
          <View style={styles.headerLeft}>
            {onClose ? (
              <TouchableOpacity onPress={onClose} style={styles.iconButton}>
                <Icon name="arrow-left" size={24} color={theme.colors.textPrimary} />
              </TouchableOpacity>
            ) : selectedAlbum !== 'All' ? (
              <TouchableOpacity onPress={() => setSelectedAlbum('All')} style={styles.iconButton}>
                <Icon name="chevron-left" size={28} color={theme.colors.textPrimary} style={{ marginLeft: -4 }} />
              </TouchableOpacity>
            ) : <View style={styles.iconButtonPlaceholder} />}
          </View>
          
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]} numberOfLines={1}>
              {selectedAlbum !== 'All' ? selectedAlbum : 'Photo Vault'}
            </Text>
          </View>

          <View style={[styles.headerRight, { justifyContent: 'center' }]}>
            {/* Uploads Action: Search & Select Buttons */}
            <Animated.View style={{ 
              position: 'absolute', right: 0, 
              flexDirection: 'row', alignItems: 'center', gap: 16,
              opacity: pageScrollX.interpolate({ inputRange: [0, width], outputRange: [1, 0], extrapolate: 'clamp' }),
              pointerEvents: activeTab === 'uploads' ? 'auto' : 'none'
            }}>
              <TouchableOpacity 
                onPress={() => setIsUploadsSearchVisible(!isUploadsSearchVisible)}
                hitSlop={HIT_SLOP_10}
              >
                <Icon name="magnify" size={24} color={isUploadsSearchVisible || uploadsSearchQuery ? theme.colors.primary : theme.colors.textPrimary} />
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={() => {
                  if (isSelectMode) { setIsSelectMode(false); setIsBulkTagging(false); setSelectedGridItems(new Set()); } 
                  else { setIsSelectMode(true); }
                }}
                hitSlop={HIT_SLOP_10}
              >
                <Text style={{ color: theme.colors.primary, fontWeight: '600', fontSize: 15, letterSpacing: -0.3 }}>
                  {isSelectMode ? 'Cancel' : 'Select'}
                </Text>
              </TouchableOpacity>
            </Animated.View>

            {/* Albums Action: Magnify Icon */}
            <Animated.View style={{ 
              position: 'absolute', right: 0, 
              opacity: pageScrollX.interpolate({ inputRange: [0, width, width * 2], outputRange: [0, 1, 0], extrapolate: 'clamp' }),
              pointerEvents: activeTab === 'albums' ? 'auto' : 'none' 
            }}>
              <TouchableOpacity onPress={() => {
                if (albumSearchQuery) {
                  setAlbumSearchQuery('');
                } else {
                  setAlbumSearchQuery(' ');
                }
              }} hitSlop={HIT_SLOP_10}>
                <Icon name="magnify" size={24} color={albumSearchQuery ? theme.colors.primary : theme.colors.textPrimary} />
              </TouchableOpacity>
            </Animated.View>
          </View>
        </View>

        {/* Unified Search Bar - switches function based on active tab */}
        <Animated.View style={{
          height: (isUploadsSearchVisible || (activeTab === 'albums' && albumSearchQuery !== '')) ? 'auto' : 0,
          opacity: uploadsSearchAnim,
          overflow: 'hidden',
          marginHorizontal: 16,
          marginBottom: (isUploadsSearchVisible || (activeTab === 'albums' && albumSearchQuery !== '')) ? 8 : 0,
          transform: [{
            translateY: uploadsSearchAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [-20, 0]
            })
          }]
        }}>
          <View style={[styles.searchContainer, { 
            backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
            borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, flexDirection: 'row', alignItems: 'center' 
          }]}>
            <Icon name="magnify" size={18} color={theme.colors.textMuted} />
            <TextInput
              style={{ flex: 1, marginLeft: 6, color: theme.colors.textPrimary, fontSize: 15, padding: 0 }}
              value={activeTab === 'albums' ? albumSearchQuery : uploadsSearchQuery}
              onChangeText={activeTab === 'albums' ? setAlbumSearchQuery : setUploadsSearchQuery}
              placeholder={activeTab === 'albums' ? "Search albums..." : "Search by tag..."}
              placeholderTextColor={theme.colors.textMuted}
              autoFocus={isUploadsSearchVisible || (activeTab === 'albums' && albumSearchQuery !== '')}
            />
            <TouchableOpacity onPress={() => { 
              if (activeTab === 'albums') {
                setAlbumSearchQuery(''); 
              } else {
                setUploadsSearchQuery(''); 
                setIsUploadsSearchVisible(false);
              }
            }}>
              <Icon name="close-circle" size={18} color={theme.colors.textMuted} />
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* Bottom Row: Bezier Segmented Control */}
        <View style={{ marginHorizontal: 16, marginBottom: 8, height: 32, backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)', borderRadius: 8, flexDirection: 'row', position: 'relative' }}>
          {/* Animated Slider Background */}
          <Animated.View style={{
            position: 'absolute', top: 2, bottom: 2, left: 2, width: tabWidth - 4,
            backgroundColor: theme.mode === 'dark' ? '#333' : '#FFF',
            borderRadius: 6,
            shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2,
            transform: [{ translateX: tabIndicatorX }]
          }} />

          {TABS.map((tab, index) => {
            // Calculate exact opacity based on 1:1 scroll physics
            const inputRange = [(index - 1) * width, index * width, (index + 1) * width];
            const activeOp = pageScrollX.interpolate({ inputRange, outputRange: [0, 1, 0], extrapolate: 'clamp' });
            const inactiveOp = pageScrollX.interpolate({ inputRange, outputRange: [1, 0, 1], extrapolate: 'clamp' });
            
            const label = tab === 'uploads' ? 'Photos' : tab === 'albums' ? 'Albums' : 'PC';

            return (
              <TouchableOpacity
                key={tab}
                style={{ flex: 1, justifyContent: 'center', alignItems: 'center', zIndex: 1 }}
                onPress={() => handleTabPress(tab)}
              >
                {/* Active Bold Text */}
                <Animated.Text style={{ 
                  position: 'absolute', fontSize: 13, fontWeight: '600', 
                  color: theme.colors.textPrimary, opacity: activeOp 
                }}>
                  {label}
                </Animated.Text>
                
                {/* Inactive Regular Text */}
                <Animated.Text style={{ 
                  fontSize: 13, fontWeight: '500', 
                  color: theme.colors.textSecondary, opacity: inactiveOp 
                }}>
                  {label}
                </Animated.Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

    </View>
  );
}

// Memoized grid item component for performance
// === GRID ITEM COMPONENT (Memoized) ===
// === PREMIUM SEAMLESS SWEEPING SHIMMER SKELETON ===
const ShimmerSkeleton = React.memo(({ theme }) => {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  // Calculate dynamic size: Exact width divided by columns, no internal margins
  // Ensure numColumns matches what is used in your FlatList (defaulting to 3 here)
  const numColumns = 3; 
  const tileSize = width / numColumns; 

  useEffect(() => {
    Animated.loop(
      Animated.timing(shimmerAnim, {
        toValue: 1,
        duration: 1200, 
        useNativeDriver: true, 
      })
    ).start();
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

const GridItem = React.memo(({ item, openViewer, handleDelete, getFullUrl, getBaseUrl, activeTab, styles, theme, isSelectMode, isSelected, onToggleSelect }) => {
  // Early return for seamless Phantom Skeletons
  if (item.isSkeleton) {
    return <ShimmerSkeleton styles={styles} theme={theme} />;
  }
  
  const isVideo = item.type === 'video';
  const [duration, setDuration] = useState(item.duration);
  const [hasFailed, setHasFailed] = useState(false);
  const [localTags, setLocalTags] = useState(item.tags || []);
  const [isLoaded, setIsLoaded] = useState(false);
  
  // Format seconds to MM:SS
  const formatDuration = (seconds) => {
    if (!seconds) return null;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };
  
  // Self-healing: Fetch missing duration independently without parent re-render
  useEffect(() => {
    let isMounted = true;
    
    // Trigger if it's a video, has no duration, and has ANY valid identifier
    if (isVideo && !duration && (item.filename || item.id)) {
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
    
    if (activeTab === 'uploads' && hasMissingTags && item.filename) {
      const healTags = async () => {
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
  
  const imageUrl = item.thumbnailUrl 
    ? getFullUrl(item.thumbnailUrl)
    : getFullUrl(item.url);
  
  return (
    <TouchableOpacity
      style={[styles.thumbnailContainer, isSelectMode && isSelected && { opacity: 0.8 }]}
      onPress={() => isSelectMode ? onToggleSelect() : openViewer(item)}
      onLongPress={() => !isSelectMode && handleDelete(item.id)}
      activeOpacity={0.8}
    >
      {/* Selection Checkmark Overlay */}
      {isSelectMode && (
        <View style={{
          position: 'absolute', bottom: 6, right: 6, width: 22, height: 22, borderRadius: 11,
          backgroundColor: isSelected ? theme.colors.primary : 'rgba(0,0,0,0.3)',
          borderWidth: 1.5, borderColor: isSelected ? theme.colors.primary : '#fff',
          justifyContent: 'center', alignItems: 'center', zIndex: 10
        }}>
          {isSelected && <Icon name="check" size={14} color={theme.colors.background} />}
        </View>
      )}
      
      {/* Sophisticated pulse skeleton while image loads */}
      {!isLoaded && !hasFailed && <ImageSkeleton style={styles.thumbnail} />}
      
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
      ) : (
        <Image
          source={{ uri: imageUrl }}
          style={[styles.thumbnail, { opacity: isLoaded ? 1 : 0 }]}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
          placeholder={item.blurhash ? { blurhash: item.blurhash } : null}
          placeholderContentFit="cover"
          onLoad={() => setIsLoaded(true)}
          onError={() => {
            // Image load failed silently
            setHasFailed(true);
          }}
        />
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

const createStyles = (theme) =>
  StyleSheet.create({
    premiumBezel: {
      backgroundColor: 'rgba(30, 30, 32, 0.85)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255, 255, 255, 0.15)',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 5,
    },
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 0,
      paddingBottom: 8,
      borderBottomWidth: 0,
      backgroundColor: 'transparent',
    },
    headerLeft: {
      width: 70,
      alignItems: 'flex-start',
      justifyContent: 'center',
    },
    headerCenter: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerRight: {
      width: 70, // Equal width to headerLeft for true centering
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    iconButton: {
      width: 36,
      height: 36,
      borderRadius: 10,
      justifyContent: 'center',
      alignItems: 'center',
    },
    iconButtonPlaceholder: {
      width: 36,
      height: 36,
    },
    pillButton: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 12,
    },
    closeButton: {
      padding: 8,
      marginLeft: -8,
      width: 40,
    },
    headerTitle: {
      fontSize: 17,
      fontWeight: '700',
      letterSpacing: -0.3,
    },
    headerTitleContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    albumBackButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-start',
      paddingLeft: 4,
    },
    dropdownOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.3)',
      justifyContent: 'flex-start',
      alignItems: 'center',
      paddingTop: Platform.OS === 'ios' ? 90 : 70, // Position below header
    },
    dropdownMenu: {
      width: width * 0.6,
      borderRadius: 12,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 12,
      elevation: 8,
    },
    dropdownItem: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: 'rgba(0,0,0,0.05)',
    },
    dropdownItemText: {
      fontSize: 16,
      fontWeight: '500',
    },
    placeholder: {
      width: 40,
    },
    tabContainer: {
      flexDirection: 'row',
      paddingHorizontal: 4,
      paddingVertical: 4,
      gap: 4,
      backgroundColor: 'transparent',
    },
    tabButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: 10,
      gap: 6,
    },
    tabButtonActive: {
      // Active styles applied inline for theme-aware shadows
    },
    tabText: {
      fontSize: 13,
      fontWeight: '500',
      color: theme.colors.textSecondary,
    },
    tabTextActive: {
      color: theme.colors.background,
    },
    floatingHeaderContainer: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      paddingBottom: 8,
    },
    countContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 16,
      backgroundColor: 'transparent',
    },
    countText: {
      fontSize: 13,
      fontWeight: '500',
      textAlign: 'center',
      letterSpacing: 0.5,
    },
    gridContent: {
      padding: 0,
      paddingBottom: 0,
    },
    thumbnailContainer: {
      width: THUMBNAIL_SIZE,
      height: THUMBNAIL_SIZE,
      margin: 0.25,
      borderRadius: 0,
      overflow: 'hidden',
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 0,
    },
    skeletonThumbnail: {
      backgroundColor: 'rgba(150, 150, 150, 0.15)', // Smooth light gray placeholder
    },
    thumbnail: {
      width: '100%',
      height: '100%',
    },
    failedThumbnail: {
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.colors.surfaceElevated,
    },
    failedText: {
      fontSize: 10,
      color: theme.colors.textMuted,
      marginTop: 4,
    },
    durationBadge: {
      position: 'absolute',
      bottom: 4,
      right: 4,
      backgroundColor: 'rgba(0,0,0,0.7)',
      paddingHorizontal: 5,
      paddingVertical: 2,
      borderRadius: 4,
      justifyContent: 'center',
      alignItems: 'center',
    },
    durationText: {
      color: '#fff',
      fontSize: 10,
      fontWeight: '600',
      letterSpacing: 0.5,
    },
    documentOverlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.colors.surfaceElevated,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 100,
    },
    emptyText: {
      fontSize: 18,
      fontWeight: '600',
      marginTop: 16,
    },
    emptySubtext: {
      fontSize: 14,
      marginTop: 8,
      textAlign: 'center',
      paddingHorizontal: 32,
    },
    loadMoreIndicator: {
      marginVertical: 16,
    },
    bottomContainer: {
      paddingHorizontal: 16,
      paddingVertical: 0,
      paddingBottom: 0,
      backgroundColor: 'transparent',
      borderTopWidth: 0,
    },
    phantomSkeletonContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingHorizontal: 0,
      marginBottom: 16,
    },
    phantomSkeleton: {
      width: THUMBNAIL_SIZE,
      height: THUMBNAIL_SIZE,
      margin: 0.5,
      borderRadius: 0,
      opacity: 0.5,
    },
    uploadButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
      borderRadius: 12,
      gap: 8,
    },
    uploadButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
    // New Action Button Styles (Premium)
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-start',
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 14,
      gap: 12,
    },
    actionButtonIcon: {
      width: 36,
      height: 36,
      borderRadius: 10,
      justifyContent: 'center',
      alignItems: 'center',
    },
    actionButtonText: {
      fontSize: 15,
      fontWeight: '600',
    },
    searchContainer: {
      // Search container styles applied inline
    },
    // Full-screen viewer styles
    viewerContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    viewerBackground: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: '#000',
    },
    viewerCloseButton: {
      position: 'absolute',
      right: 16,
      zIndex: 10,
    },

    viewerFlatListContainer: {
      width: width,
      height: height * 0.85,
    },
    viewerItemContainer: {
      width: width + GAP,
      height: height * 0.85,
      justifyContent: 'center',
      alignItems: 'center',
    },
    viewerScrollContent: {
      width: width,
      height: height * 0.85,
      justifyContent: 'center',
      alignItems: 'center',
    },
    viewerImage: {
      width: width,
      height: height * 0.85,
    },
    viewerVideo: {
      width: width,
      height: height * 0.85,
    },
    viewerVideoContainer: {
      width: width,
      height: height * 0.85,
      justifyContent: 'center',
      alignItems: 'center',
    },
    viewerInfoOverlay: {
      ...StyleSheet.absoluteFillObject,
      pointerEvents: 'none',
    },
    viewerInfoTop: {
      position: 'absolute',
      left: 24,
      right: 24,
      top: 56, // Positioned from top for centering
      alignItems: 'center',
    },
    viewerInfoDate: {
      color: 'rgba(255,255,255,0.5)',
      fontSize: 14,
      fontWeight: '300',
      textAlign: 'center',
      letterSpacing: 0.5,
    },
    viewerInfoBottom: {
      position: 'absolute',
      left: 24,
      right: 24,
      bottom: 24, // Positioned from bottom for centering
      alignItems: 'center',
    },
    viewerInfoResolution: {
      color: 'rgba(255,255,255,0.8)',
      fontSize: 12,
      fontWeight: '300',
      textAlign: 'center',
      letterSpacing: 0.5,
    },
    muteButton: {
      position: 'absolute',
      bottom: 20,
      right: 20,
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    // Upload modal styles
    uploadModalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    uploadModalContent: {
      width: width * 0.85,
      padding: 24,
      borderRadius: 16,
      elevation: 5,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
    },
    uploadModalTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      marginBottom: 16,
      textAlign: 'center',
    },
    uploadModalLabel: {
      fontSize: 14,
      marginBottom: 8,
    },
    albumInput: {
      borderWidth: 1,
      borderRadius: 8,
      padding: 12,
      fontSize: 16,
      marginBottom: 12,
    },
    quickSelectScroll: {
      flexGrow: 0,
      marginBottom: 16,
    },
    tagAutocompleteContainer: {
      marginBottom: 16,
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
    },
    tagAutocompleteLabel: {
      fontSize: 11,
      fontWeight: '500',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 8,
    },
    tagAutocompleteScroll: {
      flexGrow: 0,
      maxHeight: 44,
    },
    tagAutocompleteChip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 16,
      backgroundColor: theme.colors.surfaceElevated,
      marginRight: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    tagAutocompleteChipText: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.colors.textPrimary,
    },
    quickSelectChip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
      backgroundColor: 'rgba(0,0,0,0.05)',
      marginRight: 8,
    },
    quickSelectText: {
      fontSize: 13,
      color: theme.colors.textPrimary,
    },
    uploadModalButtons: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
    },
    uploadModalButton: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: 'center',
    },
    // Keyboard Accessory Styles (iOS)
    keyboardAccessoryContainer: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: 'rgba(0,0,0,0.1)',
    },
    keyboardAccessoryButton: {
      paddingHorizontal: 12,
      paddingVertical: 4,
    },
    keyboardAccessoryText: {
      fontSize: 16,
      fontWeight: '600',
    },
    // Progress Bar Styles
    progressContainer: {
      marginTop: 10,
      alignItems: 'center',
    },
    progressText: {
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 8,
    },
    progressBarBackground: {
      height: 8,
      width: '100%',
      borderRadius: 4,
      overflow: 'hidden',
    },
    progressBarFill: {
      height: '100%',
      borderRadius: 4,
    },
    progressErrorText: {
      color: '#DC2626',
      fontSize: 12,
      marginTop: 8,
    },
    // Chip Input Styles for Tag Editor
    chipInputContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      borderWidth: 1,
      borderRadius: 10,
      padding: 8,
      minHeight: 52,
      marginBottom: 16,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 16,
      marginRight: 6,
      marginBottom: 6,
      gap: 4,
    },
    chipText: {
      color: theme.colors.background,
      fontSize: 13,
      fontWeight: '600',
    },
    chipTextInput: {
      flex: 1,
      minWidth: 100,
      fontSize: 15,
      paddingVertical: 6,
      marginBottom: 6,
    },
    tagAutocompleteContainer: {
      marginBottom: 12,
    },
    tagAutocompleteLabel: {
      fontSize: 11,
      fontWeight: '500',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 6,
    },
    tagAutocompleteScroll: {
      flexGrow: 0,
      maxHeight: 44,
    },
    tagAutocompleteChip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 16,
      backgroundColor: theme.colors.surfaceElevated,
      marginRight: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    tagAutocompleteChipText: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.colors.textPrimary,
    },
    // Header & Album Folder Styles
    headerRightAction: {
      width: 70,
      alignItems: 'flex-end',
      justifyContent: 'center',
      paddingRight: 12,
    },
    clearFilterButton: {
      paddingHorizontal: 12,
      paddingVertical: 3,
      borderRadius: 16,
      borderWidth: 1,
      width: 70,
      borderColor: theme.colors.primary,
    },
    albumsGridContent: {
      padding: 16,
      paddingBottom: 40,
    },
    albumsColumnWrapper: {
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    albumFolderCard: {
      width: (width - 48) / 2, // 2 columns with 16 padding on edges and middle
      aspectRatio: 1, // Perfect square
      borderRadius: 12,
      overflow: 'hidden',
      backgroundColor: theme.colors.surfaceElevated,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 3,
    },
    albumGridContainer: {
      width: '100%',
      height: '100%',
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      alignContent: 'space-between',
      padding: 1, // Outer border
      backgroundColor: theme.colors.surfaceElevated,
    },
    albumGridCell: {
      width: '49%', // Leaves roughly a 2px gap in the middle
      height: '49%',
      borderRadius: 4,
      overflow: 'hidden',
    },
    albumGridImage: {
      width: '100%',
      height: '100%',
    },
    albumGridPlaceholder: {
      width: '100%',
      height: '100%',
      backgroundColor: 'rgba(150, 150, 150, 0.15)', // Light grey square
    },
    albumGradient: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: '50%',
      justifyContent: 'flex-end',
      padding: 12,
    },
    albumGridName: {
      color: '#fff',
      fontSize: 16,
      fontWeight: 'bold',
      textShadowColor: 'rgba(0,0,0,0.4)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 2,
    },
    albumItemCount: {
      color: 'rgba(255,255,255,0.8)',
      fontSize: 11,
      marginTop: 1,
    },
    // Large file warning badge
    largeFileBadge: {
      position: 'absolute',
      top: 4,
      left: 4,
      backgroundColor: 'rgba(220, 38, 38, 0.85)', // Red warning background
      paddingHorizontal: 4,
      paddingVertical: 2,
      borderRadius: 4,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
    },
    largeFileText: {
      color: '#fff',
      fontSize: 9,
      fontWeight: 'bold',
      letterSpacing: 0.5,
    },
    // Reusable layout patterns (extracted from inline JSX)
    pageContainer: {
      width: width,
      height: '100%',
    },
    flexRowWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    scrollHorizontal: {
      flexGrow: 0,
      maxHeight: 40,
    },
    absoluteOverlay: {
      ...StyleSheet.absoluteFillObject,
    },
    centeredContent: {
      alignItems: 'center',
      width: '100%',
    },
    // Metadata Drawer Styles
    metadataDrawer: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: height * 0.55,
      backgroundColor: theme.mode === 'dark' ? 'rgba(30, 30, 32, 0.95)' : 'rgba(252, 252, 255, 0.98)',
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 34,
      zIndex: 100,
    },
    drawerHandle: {
      width: 40,
      height: 5,
      borderRadius: 3,
      backgroundColor: theme.colors.border,
      alignSelf: 'center',
      marginBottom: 16,
    },
    drawerTitle: {
      fontSize: 18,
      fontWeight: '700',
      marginBottom: 16,
    },
    infoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
  });
