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
import { useTheme } from '../../../context/ThemeContext';
import { useServer } from '../../../context/ServerContext';

const { width, height } = Dimensions.get('window');
const THUMBNAIL_SIZE = width / 3 - 0.5; // 3 columns with ultra-thin hairline gap
const GAP = 4;
const ITEM_WIDTH = width + GAP;

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
  const LIMIT = 150;

  // === VIEWER STATE ===
  const [selectedMedia, setSelectedMedia] = useState(null);
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const [infoVisible, setInfoVisible] = useState(true);
  const infoOpacityAnim = useRef(new Animated.Value(1)).current;
  const [zoomScale, setZoomScale] = useState(1); // Track zoom level for close prevention
  
  // === ALBUM & TAG STATE ===
  const [globalAlbums, setGlobalAlbums] = useState(['Phone Uploads']);
  const [albumCovers, setAlbumCovers] = useState({}); // Cover thumbnails for 2x2 grids
  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const [pendingAssets, setPendingAssets] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  
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
            bounciness: 8,
          }).start();
        }
      },
    })
  ).current;

  // === HEADER VISIBILITY STATE ===
  // Simple state-based header that always starts visible on tab change
  const [headerVisible, setHeaderVisible] = useState(true);
  const headerTranslateY = useRef(new Animated.Value(0)).current;
  const lastScrollY = useRef(0);
  
  // Animate header when visibility changes
  useEffect(() => {
    Animated.timing(headerTranslateY, {
      toValue: headerVisible ? 0 : -110,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [headerVisible]);
  
  // Always show header when switching tabs
  useEffect(() => {
    setHeaderVisible(true);
    lastScrollY.current = 0;
  }, [activeTab]);
  
  // Handle scroll to show/hide header
  const handleScroll = useCallback((event) => {
    const currentY = event.nativeEvent.contentOffset.y;
    const diff = currentY - lastScrollY.current;
    
    // Hide header when scrolling down past threshold, show when scrolling up
    if (diff > 10 && currentY > 50) {
      setHeaderVisible(false);
    } else if (diff < -10) {
      setHeaderVisible(true);
    }
    
    lastScrollY.current = currentY;
  }, []);

  // === DERIVED DATA ===
  // Get current items based on active tab
  const currentItems = activeTab === 'uploads' ? uploadItems : serverItems;
  const currentHasMore = activeTab === 'uploads' ? hasMoreUploads : hasMoreServer;
  
  // Filter state
  const [selectedAlbum, setSelectedAlbum] = useState('All');

  // Intercept global albums to forcefully pin "Favourites" to the beginning of the list
  const pinnedAlbums = useMemo(() => {
    const albums = [...globalAlbums];
    const favIndex = albums.indexOf('Favourites');
    
    if (favIndex > -1) {
      albums.splice(favIndex, 1);
      albums.unshift('Favourites');
    }
    return albums;
  }, [globalAlbums]);

  // Instagram-style edge swipe to go back from album filter
  const edgeSwipeResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only respond to horizontal swipes from left edge when album is filtered
        return selectedAlbum !== 'All' && 
               gestureState.moveX < 50 && // Left edge area
               Math.abs(gestureState.dx) > 20 && // Significant horizontal movement
               Math.abs(gestureState.dy) < 50; // Not too much vertical movement
      },
      onPanResponderRelease: (_, gestureState) => {
        // If swiped right more than 50px, go back
        if (gestureState.dx > 50) {
          setSelectedAlbum('All');
        }
      },
    })
  ).current;

  // === O(1) HASH MAP FILTERING ===
  // 1. Build the O(1) Dictionary ONCE when data loads
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

  // 4. Phantom Skeleton Padding for seamless infinite scroll
  const displayItems = useMemo(() => {
    const items = [...filteredItems];
    // If there is more data to fetch, pad with skeletons
    if (currentHasMore && !loading && items.length > 0) {
      for (let i = 0; i < 21; i++) {
        items.push({ id: `phantom_skel_${i}`, isSkeleton: true });
      }
    }
    return items;
  }, [filteredItems, currentHasMore, loading]);
  
  // Calculate photo/video breakdown based ONLY on what is currently visible in the filter
  const videoCount = filteredItems.filter(item => item.type === 'video').length;
  const photoCount = filteredItems.length - videoCount;

  // Trigger a full server fetch when the selected tag changes
  useEffect(() => {
    if (activeTab === 'uploads') {
      setUploadItems([]); // Clear grid to show loading state
      fetchUploads(true);
    }
  }, [selectedAlbum, activeTab, fetchUploads]);

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

  // Initial load
  useEffect(() => {
    loadData(true);
    
    // Auto-trigger upload if prop is set (for /photos upload command)
    if (autoUpload) {
      // Small delay to let the gallery render first
      const timer = setTimeout(() => {
        handleUpload();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [autoUpload]);

  // Reload when tab changes
  useEffect(() => {
    // Only reload if we don't have data for this tab
    if (activeTab === 'uploads' && uploadItems.length === 0) {
      loadData(true);
    } else if (activeTab === 'turtle-base' && serverItems.length === 0) {
      loadData(true);
    }
  }, [activeTab]);
  
  // Fetch global albums on mount
  useEffect(() => {
    const fetchAlbums = async () => {
      try {
        const res = await api.get('/media/albums');
        if (res.success) {
          if (res.albums) setGlobalAlbums(res.albums);
          if (res.covers) setAlbumCovers(res.covers);
        }
      } catch (e) { 
        console.log('[MediaGallery] Failed to fetch albums'); 
      }
    };
    fetchAlbums();
  }, [activeTab, api]);

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
      scaleAnim.setValue(0.8);
      opacityAnim.setValue(0);
      
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 200,
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
    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: 0.8,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setSelectedMedia(null);
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
        duration: 400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    }
  }, [infoVisible, infoOpacityAnim]);

  // Swipe-down to dismiss or show info responder (disabled when zoomed)
  const swipeDownResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // Disable swipe-to-dismiss when zoomed in
        if (zoomScale > 1.05) return false;
        // More permissive swipe detection
        return gestureState.dy > 10 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 0.5;
      },
      onPanResponderMove: (evt, gestureState) => {
        // Show info when pulling down (like iOS Photos)
        if (gestureState.dy > 20 && !infoVisible) {
          toggleInfoVisibility();
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        // Close viewer only if pulled far enough
        if (gestureState.dy > 120) {
          closeViewer();
        }
      },
    })
  ).current;

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
      setUploadModalVisible(true);
    } catch (error) {
      console.error('[MediaGallery] Upload error:', error);
      Alert.alert('Error', 'Failed to open image picker.');
    }
  }, []);

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
    setUploadModalVisible(true); 
  }, [localAssets, selectedLocalAssets]);

  // Execute upload after modal confirmation
  const executeUpload = useCallback(async () => {
    setUploadModalVisible(false); // Dismiss immediately for background processing
    setUploading(true);
    setUploadStats({ current: 0, total: pendingAssets.length, failed: 0, fileProgress: 0 });
    
    const serverUrl = getBaseUrl();
    
    try {
      const { status: mediaStatus } = await MediaLibrary.requestPermissionsAsync();
      if (mediaStatus !== 'granted') {
        console.log('[MediaGallery] MediaLibrary permission not granted - upload only, no delete');
      }
      
      const assetsToUpload = [...pendingAssets];
      setPendingAssets([]);
      
      const successfulAssetIds = [];
      let failureCount = 0;

      // Process STRICTLY sequentially to prevent iOS Memory (OOM) Crashes
      for (let i = 0; i < assetsToUpload.length; i++) {
        const asset = assetsToUpload[i];
        setUploadStats(prev => ({ ...prev, current: i + 1 }));
        
        // CRITICAL FIX: Declare tracking variables OUTSIDE the try block so 'finally' can access them
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
            if (assetInfo.location) formData.append('location', JSON.stringify(assetInfo.location));
            
            const exif = assetInfo.exif || {};
            if (exif.Model) formData.append('cameraModel', exif.Model);
            if (exif.LensModel) formData.append('lensModel', exif.LensModel);
            
            formData.append('tags', JSON.stringify(selectedTags.length > 0 ? selectedTags : ['Phone Uploads']));
          }
          
          const originalFilename = asset.fileName || asset.uri.split('/').pop() || 'file';
          const isVideo = asset.mediaType === 'video' || /\.(mp4|mov|avi|mkv|wmv|flv|webm|m4v|3gp)$/i.test(originalFilename);
          const isHeic = /\.heic$/i.test(originalFilename) || /\.heif$/i.test(originalFilename);
          
          // CRITICAL FIX: Smart Sync returns ph:// URIs. We MUST use localUri (file://) to prevent RCTHTTPRequestHandlerCls crashes.
          let safeLocalUri = assetInfo?.localUri || asset.uri; 
          
          let mediaUri = safeLocalUri;
          let mediaName = originalFilename;
          let mediaType = isVideo ? 'video/mp4' : 'image/jpeg';
          
          if (isVideo) {
            // Pass the safeLocalUri instead of asset.uri
            const { uri } = await VideoThumbnails.getThumbnailAsync(safeLocalUri, { time: 1000, quality: 0.8 });
            tempThumbnailUri = uri; // Save reference
            formData.append('media', { uri: mediaUri, name: mediaName, type: mediaType });
            formData.append('thumbnail', { uri: tempThumbnailUri, name: 'thumbnail.jpg', type: 'image/jpeg' });
            if (asset.duration) formData.append('duration', Math.round(asset.duration / 1000).toString());
          } else {
            if (isHeic) {
              // Pass the safeLocalUri instead of asset.uri
              const manipulated = await ImageManipulator.manipulateAsync(
                safeLocalUri, [], { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
              );
              tempManipulatedUri = manipulated.uri; // Save reference
              mediaUri = tempManipulatedUri;
              mediaName = originalFilename.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg');
            } else {
              const match = /\.(\w+)$/.exec(originalFilename);
              mediaType = match ? `image/${match[1]}` : 'image/jpeg';
            }
            formData.append('media', { uri: mediaUri, name: mediaName, type: mediaType });
          }
          
          // XHR Wrapper for granular byte-level progress tracking
          const uploadResponse = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${serverUrl}/media/upload`);
            
            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable) {
                const percentComplete = (event.loaded / event.total) * 100;
                // CRITICAL FIX: Use the functional updater to prevent stale closures
                setUploadStats(prevStats => ({ 
                  ...prevStats, 
                  fileProgress: percentComplete 
                }));
              }
            };

            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                try { resolve(JSON.parse(xhr.responseText)); } catch (e) { resolve({ success: true }); }
              } else {
                reject(new Error(`Upload failed with status: ${xhr.status}`));
              }
            };

            xhr.onerror = () => reject(new Error('Network request failed. Server offline or timeout.'));
            xhr.send(formData);
          });

          if (asset.assetId) successfulAssetIds.push(asset.assetId);

        } catch (error) {
          console.error(`[MediaGallery] Failed to upload asset ${i}:`, error.message);
          failureCount++;
        } finally {
          // Instantly destroy heavy temporary files to keep RAM/Disk flat
          if (tempThumbnailUri) FileSystem.deleteAsync(tempThumbnailUri, { idempotent: true }).catch(()=>{});
          if (tempManipulatedUri) FileSystem.deleteAsync(tempManipulatedUri, { idempotent: true }).catch(()=>{});
          
          setUploadStats(prev => ({ ...prev, fileProgress: 0, failed: failureCount }));
        }
      } // End of sequential loop
      
      if (successfulAssetIds.length > 0 && mediaStatus === 'granted') {
        try { await MediaLibrary.deleteAssetsAsync(successfulAssetIds); } catch (e) {}
      }
      
      await fetchUploads(true);
      setActiveTab('uploads');
      
      try {
        const res = await api.get('/media/albums');
        if (res.success) {
          if (res.albums) setGlobalAlbums(res.albums);
          if (res.covers) setAlbumCovers(res.covers);
        }
      } catch (e) {}
      
      if (failureCount > 0) {
        Alert.alert('Upload Complete', `Successfully uploaded ${successfulAssetIds.length} items.\nFailed: ${failureCount} items.`);
      } else {
        Alert.alert('Success', `All ${successfulAssetIds.length} items uploaded successfully!`);
      }
    } catch (error) {
      console.error('[MediaGallery] Upload error:', error);
      Alert.alert('Upload Failed', error.message || 'Failed to upload media');
    } finally {
      setUploading(false);
    }
  }, [pendingAssets, selectedTags, getBaseUrl, fetchUploads, api]);

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
        url: selectedMedia.url,
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
        size: selectedMedia.size, url: selectedMedia.url, thumbnailUrl: selectedMedia.thumbnailUrl,
        width: selectedMedia.width, height: selectedMedia.height, duration: selectedMedia.duration,
      };
      
      await api.put(`/media/${selectedMedia.id}/tags`, tagPayload);
      
    } catch(e) { 
      console.error('[MediaGallery] Favourites toggle failed:', e); 
    }
  }, [selectedMedia, api]);

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
          console.log('🧹 [Garbage Collection] Wiped GBs of temporary cache files.');
        } catch (e) {
          console.log('🧹 [Garbage Collection] Sweep failed:', e.message);
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
      return <ShimmerSkeleton styles={styles} theme={theme} />;
    }
    return (
      <GridItem 
        item={item} 
        activeTab={activeTab}
        openViewer={openViewer}
        handleDelete={handleDelete}
        getFullUrl={getFullUrl}
        getBaseUrl={getBaseUrl}
        styles={styles}
        theme={theme}
      />
    );
  }, [activeTab, openViewer, handleDelete, getFullUrl, getBaseUrl, styles, theme]);

  // Render empty state
  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
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
  const handleMomentumScrollEnd = useCallback((event) => {
    const slideSize = event.nativeEvent.layoutMeasurement.width;
    const index = Math.round(event.nativeEvent.contentOffset.x / slideSize);
    
    if (currentItems[index] && currentItems[index].id !== selectedMedia?.id) {
      // Queue the heavy re-render until AFTER the swipe animation is 100% complete
      InteractionManager.runAfterInteractions(() => {
        setSelectedMedia(currentItems[index]);
      });
    }
  }, [currentItems, selectedMedia]);

  // Render individual viewer item with pinch-to-zoom
  // Full-screen video player sub-component using new expo-video API
  const FullScreenVideoPlayer = useCallback(({ sourceUrl, isActive }) => {
    const player = useVideoPlayer(sourceUrl, player => {
      player.loop = true;
      player.muted = true;
    });
    const [isPlaying, setIsPlaying] = useState(isActive);
    const [isMuted, setIsMuted] = useState(true);
    
    // Play/pause based on visibility
    useEffect(() => {
      if (isActive) {
        player.play();
        setIsPlaying(true);
      } else {
        player.pause();
        player.currentTime = 0; // Reset video to beginning
        player.muted = true; // Reset to muted state for next time
        setIsMuted(true);
        setIsPlaying(false);
      }
    }, [isActive, player]);
    
    const togglePlay = () => {
      if (isPlaying) {
        player.pause();
      } else {
        player.play();
      }
      setIsPlaying(!isPlaying);
    };
    
    const toggleMute = () => {
      player.muted = !isMuted;
      setIsMuted(!isMuted);
    };
    
    return (
      <Pressable onPress={togglePlay} style={styles.viewerVideoContainer}>
        <VideoView 
          style={styles.viewerVideo} 
          player={player} 
          contentFit="contain" 
          nativeControls={false}
        />
        {/* Mute toggle button */}
        <TouchableOpacity 
          style={styles.muteButton}
          onPress={toggleMute}
          activeOpacity={0.7}
        >
          <Icon 
            name={isMuted ? 'volume-off' : 'volume-high'} 
            size={24} 
            color="#fff" 
          />
        </TouchableOpacity>
      </Pressable>
    );
  }, []);

  // Separate component for image viewer with double-tap and parallax (hooks at top level)
  const ImageViewer = ({ fullResUrl, mediaId, parallaxStyle, isActive, item }) => {
    const scrollRef = useRef(null);
    const lastTapRef = useRef(0);
    const isZoomedRef = useRef(false);
    
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
      <Animated.View style={[styles.viewerItemContainer, parallaxStyle]}>
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
            // Track zoom scale - available on iOS native ScrollView
            const scale = e.nativeEvent?.zoomScale || 1;
            setZoomScale(scale);
          }}
        >
          <Pressable onPress={handleDoubleTap}>
            <Image
              source={{ uri: fullResUrl }}
              style={styles.viewerImage}
              contentFit="contain"
              transition={0}
              cachePolicy="memory-disk"
              priority="high"
              onError={(error) => console.error('[MediaGallery] Full-res load error:', error)}
            />
          </Pressable>
        </ScrollView>
        

      </Animated.View>
    );
  };

  const renderViewerItem = useCallback(({ item, index }) => {
    const isVideo = item.type === 'video';
    const fullResPath = item.rawUrl || item.url || '';
    const fullResUrl = getFullUrl(fullResPath);
    const isActive = item.id === selectedMedia?.id;

    // Parallax effect: calculate offset based on scroll position
    // The adjacent images move at 15% of the scroll speed for depth effect
    const parallaxTranslate = scrollX.interpolate({
      inputRange: [
        (index - 1) * ITEM_WIDTH,
        index * ITEM_WIDTH,
        (index + 1) * ITEM_WIDTH,
      ],
      outputRange: [width * 0.15, 0, -width * 0.15],
      extrapolate: 'clamp',
    });

    const parallaxStyle = {
      transform: [{ translateX: parallaxTranslate }],
    };

    return (
      <View style={styles.viewerItemContainer}>
        {isVideo ? (
          // Video player using new expo-video API
          <Animated.View style={[styles.viewerVideoContainer, parallaxStyle]}>
            <FullScreenVideoPlayer 
              sourceUrl={fullResUrl} 
              isActive={isActive}
            />
          </Animated.View>
        ) : (
          // Image viewer with pinch-to-zoom, double-tap, and parallax
          <ImageViewer 
            fullResUrl={fullResUrl} 
            mediaId={item.id} 
            parallaxStyle={parallaxStyle}
            isActive={isActive}
            item={item}
          />
        )}
      </View>
    );
  }, [getFullUrl, FullScreenVideoPlayer, selectedMedia, scrollX]);

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
  const renderFullScreenViewer = () => {
    if (!selectedMedia) return null;

    // Find initial index
    // CRITICAL FIX: Find initial index in the filtered array
    const initialIndex = filteredItems.findIndex(item => item.id === selectedMedia.id);

    return (
      <Modal
        visible={selectedMedia !== null}
        transparent={true}
        animationType="fade"
        onRequestClose={closeViewer}
      >
        <Pressable 
          style={styles.viewerContainer}
          onPress={toggleInfoVisibility}
          {...swipeDownResponder.panHandlers}
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
              styles.viewerCloseButton, 
              { 
                top: insets.top + 16,
                opacity: zoomScale > 1.05 ? 0 : opacityAnim,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 20, // Clean spacing between action icons
              }
            ]}
            pointerEvents={zoomScale > 1.05 ? 'none' : 'auto'}
          >
            {/* Only show Edit button for Images, not Videos */}
            {selectedMedia?.type !== 'video' && (
              <TouchableOpacity 
                onPress={openImageEditor}
                hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
              >
                <Icon name="pencil" size={26} color="#fff" style={{ textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 }} />
              </TouchableOpacity>
            )}

            <TouchableOpacity 
              onPress={openTagEditor}
              hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
            >
              <Icon name="tag-multiple" size={26} color="#fff" style={{ textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 }} />
            </TouchableOpacity>
            
            <TouchableOpacity 
              onPress={closeViewer}
              activeOpacity={0.6}
              hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
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
            {/* Left Side: Date & Resolution */}
            <View style={{ flex: 1 }} pointerEvents="none">
              <Text style={[styles.viewerInfoDate, { textAlign: 'left', marginBottom: 4 }]} numberOfLines={1}>
                {selectedMedia.originalDate 
                  ? new Date(selectedMedia.originalDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : selectedMedia.uploadDate 
                    ? new Date(selectedMedia.uploadDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                    : ''
                }
              </Text>
              {selectedMedia.width && selectedMedia.height && (
                <Text style={[styles.viewerInfoResolution, { textAlign: 'left' }]}>
                  {selectedMedia.width} × {selectedMedia.height}
                  {selectedMedia.type === 'video' && ' • Video'}
                </Text>
              )}
            </View>
            
            {/* Right Side: Share & Favourites */}
            <View style={{ flexDirection: 'row', gap: 24, alignItems: 'center' }} pointerEvents="auto">
              <TouchableOpacity 
                onPress={handleShare}
                hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
                activeOpacity={0.6}
              >
                <Icon name="share-variant" size={28} color="#fff" style={{ textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 }} />
              </TouchableOpacity>

              <TouchableOpacity 
                onPress={toggleFavourite}
                hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
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

          {/* Horizontal swipeable FlatList */}
          <View style={styles.viewerFlatListContainer}>
            <Animated.FlatList
              data={displayItems}
              renderItem={renderViewerItem}
              keyExtractor={(item) => item.id}
              horizontal={true}
              pagingEnabled={true}
              showsHorizontalScrollIndicator={false}
              // Aggressive preloading for smooth swiping
              initialNumToRender={3}
              windowSize={5}
              maxToRenderPerBatch={5}
              // Keep adjacent items mounted for smooth parallax
              removeClippedSubviews={false}
              // Use getItemLayout for instant scroll positioning
              getItemLayout={getItemLayout}
              initialScrollIndex={initialIndex >= 0 ? initialIndex : 0}
              // Animated scroll for parallax
              onScroll={Animated.event(
                [{ nativeEvent: { contentOffset: { x: scrollX } } }],
                { useNativeDriver: true }
              )}
              scrollEventThrottle={16}
              onMomentumScrollEnd={handleMomentumScrollEnd}
              // Smooth deceleration for natural feel
              decelerationRate={0.9}
              // Disable snap for smooth parallax, re-enable with custom physics
              snapToInterval={ITEM_WIDTH}
              snapToAlignment="center"
            />
          </View>



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
                          // Catch any un-comma'd text left in the input before saving
                          let finalTags = [...editingTags];
                          if (tagInputValue.trim()) {
                            finalTags.push(tagInputValue.trim());
                            finalTags = Array.from(new Set(finalTags));
                          }

                          const tagPayload = {
                            tags: finalTags, filename: selectedMedia.filename, type: selectedMedia.type,
                            size: selectedMedia.size, url: selectedMedia.url, thumbnailUrl: selectedMedia.thumbnailUrl,
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

                            closeTagEditor(); // Use smooth close animation
                          } else {
                            Alert.alert('Error', 'Server rejected the tag update');
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
        </Pressable>
      </Modal>
    );
  };

  // === MEMOIZED STYLES ===
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.container}>
      {/* Full-screen viewer & Modals */}
      {renderFullScreenViewer()}
      {renderLocalSyncGallery()}

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
              >
                <Text style={{ color: theme.colors.textPrimary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.uploadModalButton, { backgroundColor: theme.colors.primary }]}
                onPress={executeUpload}
              >
                <Text style={{ color: theme.colors.background, fontWeight: 'bold' }}>Upload Now</Text>
              </TouchableOpacity>
            </View>
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

      {/* 1. Main Content Area (Rendered underneath floating header) */}
      <View style={StyleSheet.absoluteFill} {...edgeSwipeResponder.panHandlers}>
        {activeTab === 'albums' ? (
          <Animated.FlatList
            key="albums-grid"
            data={pinnedAlbums}
            keyExtractor={(item) => item}
            numColumns={2}
            // CRITICAL FIX: Push content safely below the floating header
            contentContainerStyle={[styles.albumsGridContent, { paddingTop: insets.top + 110 }]}
            columnWrapperStyle={styles.albumsColumnWrapper}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            renderItem={({ item }) => {
              const covers = albumCovers[item] || [];
              const gridItems = [...covers, null, null, null, null].slice(0, 4);

              return (
                <TouchableOpacity 
                  style={styles.albumFolderCard}
                  activeOpacity={0.9}
                  onPress={() => {
                    setSelectedAlbum(item);
                    setActiveTab('uploads');
                  }}
                >
                  <View style={styles.albumGridContainer}>
                    {gridItems.map((coverUrl, index) => (
                      <View key={index} style={styles.albumGridCell}>
                        {coverUrl ? (
                          <Image 
                            source={{ uri: getFullUrl(coverUrl) }} 
                            style={styles.albumGridImage} 
                            contentFit="cover" 
                            transition={200}
                          />
                        ) : (
                          <View style={styles.albumGridPlaceholder} />
                        )}
                      </View>
                    ))}
                  </View>
                  
                  <LinearGradient
                    colors={['transparent', 'rgba(0,0,0,0.85)']}
                    style={styles.albumGradient}
                  >
                    <Text style={styles.albumGridName} numberOfLines={1}>{item}</Text>
                    <Text style={styles.albumItemCount}>
                       {covers.length > 0 ? 'View Album' : 'Empty'}
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={() => (
              <View style={styles.emptyContainer}>
                <Text style={{ color: theme.colors.textSecondary }}>No albums created yet.</Text>
              </View>
            )}
          />
        ) : (
          loading && currentItems.length === 0 ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
          ) : (
            <Animated.FlatList
              key="photos-grid"
              ref={gridRef}
              data={displayItems}
              renderItem={renderItem}
              keyExtractor={(item) => item.id}
              numColumns={3}
              inverted={true} // NATIVE IOS PHOTOS BOTTOM-UP BEHAVIOR
              // Inverted Swaps Padding: Top protects the floating header, Bottom protects the notch
              contentContainerStyle={[styles.gridContent, { 
                paddingBottom: insets.top + 110, 
                paddingTop: insets.bottom + 16 
              }]}
              showsVerticalScrollIndicator={false}
              onScroll={handleScroll}
              scrollEventThrottle={16}
              onRefresh={handleRefresh}
              refreshing={refreshing}
              onEndReached={handleLoadMore}
              onEndReachedThreshold={3}
              ListEmptyComponent={renderEmpty}
              // Inverted: Header renders at the absolute VISUAL BOTTOM
              ListHeaderComponent={
                <View style={[styles.bottomContainer, { paddingBottom: 16 }]}>
                  <View style={styles.countContainer}>
                    <Text style={[styles.countText, { color: theme.colors.textSecondary }]}>
                      {photoCount > 0 && videoCount > 0 
                        ? `${photoCount} Photos, ${videoCount} Videos`
                        : photoCount > 0 
                          ? `${photoCount} ${photoCount === 1 ? 'Photo' : 'Photos'}`
                          : `${videoCount} ${videoCount === 1 ? 'Video' : 'Videos'}`
                      }
                      {activeTab === 'turtle-base' && ' from PC'}
                    </Text>
                  </View>

                  {activeTab === 'uploads' && (
                    <View style={{ alignItems: 'center', width: '100%' }}>
                      <View style={{ flexDirection: 'row', gap: 12, width: '100%' }}>
                        <TouchableOpacity
                          style={[styles.uploadButton, { flex: 1, backgroundColor: 'transparent' }]}
                          onPress={handleUpload}
                          disabled={uploading}
                          activeOpacity={0.8}
                        >
                          <Icon name="image-plus" size={20} color={theme.colors.textPrimary} />
                          <Text style={[styles.uploadButtonText, { color: theme.colors.textPrimary, fontSize: 14 }]}>Upload</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.uploadButton, { flex: 1, backgroundColor: 'transparent' }]}
                          onPress={openLocalSyncGallery}
                          disabled={uploading}
                          activeOpacity={0.8}
                        >
                          <Icon name="folder-sync" size={20} color={theme.colors.textPrimary} />
                          <Text style={[styles.uploadButtonText, { color: theme.colors.textPrimary, fontSize: 14 }]}>Smart Sync</Text>
                        </TouchableOpacity>
                      </View>
                      
                      {/* Status Text below the buttons */}
                      {uploading && (
                        <Text style={{ marginTop: 12, fontSize: 13, fontWeight: '600', color: theme.colors.primary }}>
                          Uploading {uploadStats.current === 0 ? 1 : uploadStats.current} of {uploadStats.total} • {uploadStats.fileProgress.toFixed(0)}% Complete
                        </Text>
                      )}
                    </View>
                  )}
                </View>
              }
              // Inverted: Footer renders at the absolute VISUAL TOP (where older photos load)
              ListFooterComponent={
                <View style={{ paddingTop: 16 }}>
                  {isPaginating && currentHasMore && (
                    <View style={styles.phantomSkeletonContainer}>
                      {[...Array(6)].map((_, i) => (
                        <ShimmerSkeleton key={`header-skel-${i}`} styles={styles} theme={theme} />
                      ))}
                    </View>
                  )}
                </View>
              }
            />
          )
        )}
      </View>

      {/* Notch Shield - Prevents photos from showing under the status bar when header hides */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: theme.colors.background, zIndex: 30 }} />

      {/* 2. Floating Animated Header */}
      <Animated.View
        style={[
          styles.floatingHeaderContainer, 
          { 
            paddingTop: insets.top,
            backgroundColor: theme.colors.background, // Solid theme color
            transform: [{ translateY: headerTranslateY }],
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.border,
            zIndex: 20,
          }
        ]}
      >
        {/* 1.5px Global Progress Bar (Theme-Aware Contrast) */}
        {uploading && (
          <View style={{ position: 'absolute', top: insets.top, left: 0, right: 0, height: 1.5, backgroundColor: 'transparent', zIndex: 25 }}>
            <View 
              style={{ 
                height: '100%', 
                width: `${uploadStats.fileProgress}%`, 
                backgroundColor: theme.dark ? '#FFFFFF' : '#000000' 
              }} 
            />
          </View>
        )}

        {/* Dynamic Header */}
        <View style={styles.header}>
          {onClose ? (
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Icon name="arrow-left" size={24} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          ) : (
            <View style={styles.closeButton} />
          )}
          
          <View style={styles.headerTitleContainer}>
            {selectedAlbum !== 'All' ? (
              <TouchableOpacity 
                style={styles.albumBackButton}
                onPress={() => setSelectedAlbum('All')}
                activeOpacity={0.7}
              >
                <Icon name="chevron-left" size={28} color={theme.colors.textPrimary} />
                <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]} numberOfLines={1}>
                  {selectedAlbum}
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>
                Photo Vault
              </Text>
            )}
          </View>

          <View style={styles.headerRightAction} />
        </View>

        {/* 3-Way Tab Toggle */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'uploads' && styles.tabButtonActive]}
            onPress={() => setActiveTab('uploads')}
          >
            <Icon name="image-multiple" size={16} color={activeTab === 'uploads' ? theme.colors.background : theme.colors.textSecondary} />
            <Text style={[styles.tabText, activeTab === 'uploads' && styles.tabTextActive]}>Photos</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'albums' && styles.tabButtonActive]}
            onPress={() => setActiveTab('albums')}
          >
            <Icon name="folder-multiple" size={16} color={activeTab === 'albums' ? theme.colors.background : theme.colors.textSecondary} />
            <Text style={[styles.tabText, activeTab === 'albums' && styles.tabTextActive]}>Albums</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'turtle-base' && styles.tabButtonActive]}
            onPress={() => { setActiveTab('turtle-base'); setSelectedAlbum('All'); }}
          >
            <Icon name="desktop-classic" size={16} color={activeTab === 'turtle-base' ? theme.colors.background : theme.colors.textSecondary} />
            <Text style={[styles.tabText, activeTab === 'turtle-base' && styles.tabTextActive]}>PC</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

    </View>
  );
}

// Memoized grid item component for performance
// === GRID ITEM COMPONENT (Memoized) ===
// === PREMIUM SHIMMER SKELETON COMPONENT ===
const ShimmerSkeleton = ({ styles, theme }) => {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        })
      ])
    ).start();
  }, [shimmerAnim]);

  const opacity = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7] // Pulses gracefully between 30% and 70% opacity
  });

  return (
    <Animated.View style={[styles.thumbnailContainer, styles.skeletonThumbnail, { opacity }]}>
      <LinearGradient
        colors={['transparent', 'rgba(255,255,255,0.1)', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
    </Animated.View>
  );
};

const GridItem = React.memo(({ item, openViewer, handleDelete, getFullUrl, getBaseUrl, activeTab, styles, theme }) => {
  // Early return for seamless Phantom Skeletons
  if (item.isSkeleton) {
    return <ShimmerSkeleton styles={styles} theme={theme} />;
  }
  
  const isVideo = item.type === 'video';
  const [duration, setDuration] = useState(item.duration);
  const [hasFailed, setHasFailed] = useState(false);
  const [localTags, setLocalTags] = useState(item.tags || []);
  
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
          console.log('[GridItem] Failed to fetch missing duration', err.message);
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
          console.log('[GridItem] Tag sync failed:', err.message);
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
      style={styles.thumbnailContainer}
      onPress={() => openViewer(item)}
      onLongPress={() => handleDelete(item.id)}
      activeOpacity={0.8}
    >
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
          style={styles.thumbnail}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
          placeholder={{ blurhash: 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH' }}
          placeholderContentFit="cover"
          onError={() => {
            console.log('[GridItem] Image failed to load:', item.id, item.filename);
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
    closeButton: {
      padding: 8,
      marginLeft: -8,
      width: 40,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '600',
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
      paddingHorizontal: 16,
      paddingTop: 0,
      paddingBottom: 8,
      gap: 12,
      backgroundColor: 'transparent',
    },
    tabButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 10,
      backgroundColor: theme.colors.surfaceElevated,
      gap: 6,
    },
    tabButtonActive: {
      backgroundColor: theme.colors.primary,
    },
    tabText: {
      fontSize: 13,
      fontWeight: '600',
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
  });
