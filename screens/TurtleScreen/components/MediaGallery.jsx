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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useVideoPlayer, VideoView } from 'expo-video';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
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
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  
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
  
  // === ALBUM & TAG STATE ===
  const [globalAlbums, setGlobalAlbums] = useState(['Phone Uploads']);
  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const [pendingAssets, setPendingAssets] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  
  // Tag editor state
  const [editTagsVisible, setEditTagsVisible] = useState(false);
  const [editingTags, setEditingTags] = useState([]);
  
  // Scroll position for parallax effect
  const scrollX = useRef(new Animated.Value(0)).current;
  
  // Swipe-down to dismiss responder
  const swipeDownResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // Only claim the gesture if the user is swiping distinctly downwards
        return gestureState.dy > 20 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dy > 100 && gestureState.vy > 0.5) {
          closeViewer();
        }
      },
    })
  ).current;
  
  // === REFS ===
  // Grid ref for scroll-to-bottom (iOS Photos style)
  const gridRef = useRef(null);

  // === DERIVED DATA ===
  // Get current items based on active tab
  // Data is [oldest, ..., newest] - FlatList renders top-to-bottom, so newest appears at bottom
  const currentItems = activeTab === 'uploads' ? uploadItems : serverItems;
  const currentHasMore = activeTab === 'uploads' ? hasMoreUploads : hasMoreServer;
  
  // Calculate photo/video breakdown
  const videoCount = currentItems.filter(item => item.type === 'video').length;
  const photoCount = currentItems.length - videoCount;
  
  // Filter state
  const [selectedAlbum, setSelectedAlbum] = useState('All');
  const [isDropdownVisible, setIsDropdownVisible] = useState(false);

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
    const allUnique = new Set([...globalAlbums, ...loadedTags]);
    const sortedUnique = Array.from(allUnique).sort();
    return ['All', ...sortedUnique];
  }, [tagDictionary, globalAlbums]);

  // 3. Filter items instantly in O(1) time
  const filteredItems = useMemo(() => {
    return tagDictionary[selectedAlbum] || [];
  }, [tagDictionary, selectedAlbum]);

  // === API CALLS ===
  // Fetch uploads from database
  const fetchUploads = useCallback(async (isRefresh = false) => {
    try {
      // For iOS Photos style: we want oldest first in array (top), newest last (bottom)
      // When loading more, we fetch the next batch of older items (lower offset)
      const currentOffset = isRefresh ? 0 : uploadOffset;
      const response = await api.get(`/media/gallery?limit=${LIMIT}&offset=${currentOffset}&order=asc`);
      
      if (response.success) {
        if (isRefresh) {
          // Replace with fresh data, oldest first
          setUploadItems(response.items || []);
          setUploadOffset(LIMIT);
        } else {
          // Prepend older items to the beginning of the array
          // (older items have smaller offset in ascending order)
          setUploadItems(prev => [...(response.items || []), ...prev]);
          setUploadOffset(currentOffset + LIMIT);
        }
        setHasMoreUploads(response.pagination?.hasMore || false);
      }
    } catch (error) {
      console.error('[MediaGallery] Fetch uploads error:', error);
      Alert.alert('Error', 'Failed to load uploads');
    }
  }, [api, uploadOffset]);

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
    setLoading(true);
    if (activeTab === 'uploads') {
      await fetchUploads(isRefresh);
    } else {
      await fetchServerFiles(isRefresh);
    }
    setLoading(false);
    
    // Scroll to bottom after data loads (iOS Photos style - newest at bottom)
    setTimeout(() => {
      gridRef.current?.scrollToEnd({ animated: false });
    }, 100);
  }, [activeTab, fetchUploads, fetchServerFiles]);

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
        if (res.success && res.albums.length > 0) setGlobalAlbums(res.albums);
      } catch (e) { 
        console.log('[MediaGallery] Failed to fetch albums'); 
      }
    };
    fetchAlbums();
  }, [activeTab]);

  // Handle pull-to-refresh
  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadData(true).then(() => setRefreshing(false));
  }, [loadData]);

  // Handle load more (pagination - only for uploads)
  const handleLoadMore = useCallback(() => {
    if (currentHasMore && !loading && !refreshing && activeTab === 'uploads') {
      fetchUploads(false);
    }
  }, [currentHasMore, loading, refreshing, activeTab, fetchUploads]);

  // Open full-screen viewer with animation
  const openViewer = useCallback((item) => {
    // Set initial scroll position for parallax to prevent offset bug
    const index = currentItems.findIndex(i => i.id === item.id);
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
  }, [scaleAnim, opacityAnim, currentItems, scrollX]);

  // Close full-screen viewer
  const closeViewer = useCallback(() => {
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
  }, [scaleAnim, opacityAnim, infoOpacityAnim]);

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

  // Upload photos/videos
  // New handleUpload - just shows picker and modal
  const handleUpload = useCallback(async () => {
    try {
      // Request permissions
      const { status: pickerStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (pickerStatus !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to photos and videos to upload.');
        return;
      }

      // Open image picker - now accepts images AND videos
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        selectionLimit: 10,
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

  // Execute upload after modal confirmation
  // Execute upload after modal confirmation
  const executeUpload = useCallback(async () => {
    setUploadModalVisible(false);
    setUploading(true);
    
    try {
      const serverUrl = getBaseUrl();
      
      const { status: mediaStatus } = await MediaLibrary.requestPermissionsAsync();
      if (mediaStatus !== 'granted') {
        console.log('[MediaGallery] MediaLibrary permission not granted - upload only, no delete');
      }
      
      const assetsToUpload = [...pendingAssets];
      setPendingAssets([]);
    
    const uploadPromises = assetsToUpload.map(async (asset) => {
        const formData = new FormData();
        
        // Get full asset info including EXIF metadata
        let assetInfo = null;
        if (asset.assetId) {
          try {
            assetInfo = await MediaLibrary.getAssetInfoAsync(asset.assetId);
            console.log('[MediaGallery] Asset info retrieved');
          } catch (infoError) {
            console.log('[MediaGallery] Could not get asset info:', infoError.message);
          }
        }
        
        // Extract original creation date
        const originalDate = assetInfo?.creationTime || null;
        if (originalDate) {
          formData.append('originalDate', originalDate.toString());
        }
        
        // Extract and append rich metadata
        if (assetInfo) {
          // Dimensions
          if (assetInfo.width) formData.append('width', assetInfo.width.toString());
          if (assetInfo.height) formData.append('height', assetInfo.height.toString());
          
          // Location (GPS)
          if (assetInfo.location) {
            formData.append('location', JSON.stringify(assetInfo.location));
          }
          
          // EXIF camera metadata
          const exif = assetInfo.exif || {};
          if (exif.Model) formData.append('cameraModel', exif.Model);
          if (exif.LensModel) formData.append('lensModel', exif.LensModel);
          
          // Send tags array
          formData.append('tags', JSON.stringify(selectedTags.length > 0 ? selectedTags : ['Phone Uploads']));
        }
        
        const originalFilename = asset.fileName || asset.uri.split('/').pop() || 'file';
        const isVideo = asset.mediaType === 'video' || /\.(mp4|mov|avi|mkv|wmv|flv|webm|m4v|3gp)$/i.test(originalFilename);
        const isHeic = /\.heic$/i.test(originalFilename) || /\.heif$/i.test(originalFilename);
        
        let mediaUri = asset.uri;
        let mediaName = originalFilename;
        let mediaType = isVideo ? 'video/mp4' : 'image/jpeg';
        
        if (isVideo) {
          // Handle VIDEO upload
          console.log('[MediaGallery] Processing video:', originalFilename);
          
          // Generate thumbnail from video
          const { uri: thumbnailUri } = await VideoThumbnails.getThumbnailAsync(asset.uri, {
            time: 1000, // 1 second into the video
            quality: 0.8,
          });
          
          // Append video as 'media'
          formData.append('media', {
            uri: mediaUri,
            name: mediaName,
            type: mediaType,
          });
          
          // Append thumbnail as 'thumbnail'
          formData.append('thumbnail', {
            uri: thumbnailUri,
            name: 'thumbnail.jpg',
            type: 'image/jpeg',
          });
          
          // Append video duration (in seconds) for phone uploads
          if (asset.duration) {
            formData.append('duration', Math.round(asset.duration / 1000).toString());
          }
          
        } else {
          // Handle IMAGE upload (with HEIC conversion)
          if (isHeic) {
            console.log('[MediaGallery] Converting HEIC to JPEG:', originalFilename);
            const manipulated = await ImageManipulator.manipulateAsync(
              asset.uri,
              [],
              { 
                compress: 0.9, 
                format: ImageManipulator.SaveFormat.JPEG 
              }
            );
            mediaUri = manipulated.uri;
            mediaName = originalFilename.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg');
            console.log('[MediaGallery] Converted to:', mediaName);
          } else {
            // For non-HEIC files, detect type from extension
            const match = /\.(\w+)$/.exec(originalFilename);
            mediaType = match ? `image/${match[1]}` : 'image/jpeg';
          }
          
          // Append image as 'media' (no separate thumbnail for images)
          formData.append('media', {
            uri: mediaUri,
            name: mediaName,
            type: mediaType,
          });
        }
        
        const response = await fetch(`${serverUrl}/media/upload`, {
          method: 'POST',
          body: formData,
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });

        if (!response.ok) {
          throw new Error(`Upload failed: ${response.status}`);
        }

        const data = await response.json();
        
        // Return both server response and asset ID for deletion
        return {
          serverData: data,
          assetId: asset.assetId,
        };
      });

      const results = await Promise.all(uploadPromises);
      console.log('[MediaGallery] Upload results:', results.length, 'files uploaded');
      
      // Extract asset IDs for deletion
      const assetIds = results
        .map(r => r.assetId)
        .filter(id => id != null);
      
      // Attempt to delete local files after successful upload
      if (assetIds.length > 0 && mediaStatus === 'granted') {
        try {
          console.log('[MediaGallery] Deleting local assets:', assetIds.length);
          await MediaLibrary.deleteAssetsAsync(assetIds);
          console.log('[MediaGallery] Local assets deleted successfully');
        } catch (deleteError) {
          // User may have declined the OS deletion prompt
          console.log('[MediaGallery] User declined local deletion or deletion failed:', deleteError.message);
        }
      }
      
      // Refresh uploads gallery
      await fetchUploads(true);
      // Switch to uploads tab
      setActiveTab('uploads');
      
      // Refresh global albums after upload so dropdown updates instantly
      try {
        const res = await api.get('/media/albums');
        if (res.success) setGlobalAlbums(res.albums);
      } catch (e) {
        console.log('[MediaGallery] Could not refresh albums');
      }
      
      Alert.alert('Success', `${results.length} item(s) uploaded successfully!`);
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

  // Helper to construct full URL
  const getFullUrl = useCallback((path) => {
    const baseUrl = getBaseUrl().replace(/\/api$/, '');
    return `${baseUrl}${path}`;
  }, [getBaseUrl]);

  // Format seconds to MM:SS
  const formatDuration = (seconds) => {
    if (!seconds) return null;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Track failed images to show fallback
  const [failedImages, setFailedImages] = useState(new Set());
  
  // Clear old cache periodically to prevent memory issues
  useEffect(() => {
    const clearCache = () => {
      // Clear failed images set periodically
      setFailedImages(new Set());
    };
    
    const interval = setInterval(clearCache, 5 * 60 * 1000); // Every 5 minutes
    return () => clearInterval(interval);
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
  const renderItem = useCallback(({ item }) => (
    <GridItem 
      item={item} 
      activeTab={activeTab}
      openViewer={openViewer}
      handleDelete={handleDelete}
      getFullUrl={getFullUrl}
      getBaseUrl={getBaseUrl}
      styles={styles}
    />
  ), [activeTab, openViewer, handleDelete, getFullUrl, getBaseUrl, styles]);

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
  const ImageViewer = ({ fullResUrl, mediaId, parallaxStyle }) => {
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

  // Full-screen viewer with swipeable paging
  const renderFullScreenViewer = () => {
    if (!selectedMedia) return null;

    // Find initial index
    const initialIndex = currentItems.findIndex(item => item.id === selectedMedia.id);

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
          
          {/* Date info - at top of image */}
          <Animated.View 
            style={[
              styles.viewerInfoTop,
              { 
                opacity: Animated.multiply(opacityAnim, infoOpacityAnim),
                top: insets.top + 56,
              }
            ]}
          >
            <Text style={styles.viewerInfoDate} numberOfLines={1}>
              {selectedMedia.originalDate 
                ? new Date(selectedMedia.originalDate).toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'short', 
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })
                : new Date(selectedMedia.uploadDate).toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'short', 
                    day: 'numeric' 
                  })
              }
            </Text>
          </Animated.View>

          {/* Close & Tag buttons */}
          <Animated.View 
            style={[
              styles.viewerCloseButton, 
              { 
                top: insets.top + 16,
                opacity: opacityAnim,
                flexDirection: 'row',
                gap: 16,
              }
            ]}
          >
            <TouchableOpacity onPress={() => {
              try { setEditingTags(JSON.parse(selectedMedia.tags || '[]')); } catch(e){ setEditingTags([]); }
              setEditTagsVisible(true);
            }}>
              <Icon name="tag-multiple" size={26} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity 
              onPress={closeViewer}
              activeOpacity={0.6}
            >
              <Icon name="close" size={28} color="#fff" />
            </TouchableOpacity>
          </Animated.View>

          {/* Horizontal swipeable FlatList */}
          <View style={styles.viewerFlatListContainer}>
            <Animated.FlatList
              data={currentItems}
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

          {/* Resolution info - at bottom of image */}
          <Animated.View 
            style={[
              styles.viewerInfoBottom,
              { 
                opacity: Animated.multiply(opacityAnim, infoOpacityAnim),
                bottom: insets.bottom + 24,
              }
            ]}
          >
            {selectedMedia.width && selectedMedia.height && (
              <Text style={styles.viewerInfoResolution}>
                {selectedMedia.width} × {selectedMedia.height}
                {selectedMedia.type === 'video' && ' • Video'}
              </Text>
            )}
          </Animated.View>

          {/* Inline Tag Editor Overlay */}
          {editTagsVisible && (
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', zIndex: 100 }]}>
              <View style={[styles.uploadModalContent, { backgroundColor: theme.colors.surfaceElevated }]}>
                <Text style={[styles.uploadModalTitle, { color: theme.colors.textPrimary }]}>Edit Tags</Text>
                
                <Text style={[styles.uploadModalLabel, { color: theme.colors.textSecondary }]}>Selected Tags:</Text>
                <TextInput
                  style={[styles.albumInput, { color: theme.colors.textPrimary, borderColor: theme.colors.border }]}
                  value={editingTags.join(', ')}
                  onChangeText={(text) => setEditingTags(text.split(',').map(t => t.trim()).filter(Boolean))}
                  placeholder="Type tags separated by commas..."
                  placeholderTextColor={theme.colors.textMuted}
                />

                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickSelectScroll}>
                  {globalAlbums.map(album => (
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
                      <Text style={[styles.quickSelectText, editingTags.includes(album) && { color: '#fff' }]}>{album}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                
                <View style={styles.uploadModalButtons}>
                  <TouchableOpacity 
                    style={[styles.uploadModalButton, { backgroundColor: theme.colors.surface }]}
                    onPress={() => setEditTagsVisible(false)}
                  >
                    <Text style={{ color: theme.colors.textPrimary }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.uploadModalButton, { backgroundColor: theme.colors.primary }]}
                    onPress={async () => {
                      try {
                        const res = await api.put(`/media/${selectedMedia.id}/tags`, { tags: editingTags });
                        if (res.success) {
                          setUploadItems(prev => prev.map(i => i.id === selectedMedia.id ? { ...i, tags: JSON.stringify(editingTags) } : i));
                          setSelectedMedia(prev => ({ ...prev, tags: JSON.stringify(editingTags) }));
                          setEditTagsVisible(false);
                        }
                      } catch(e) { Alert.alert('Error', 'Failed to update tags'); }
                    }}
                  >
                    <Text style={{ color: '#fff', fontWeight: 'bold' }}>Save Tags</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </Pressable>
      </Modal>
    );
  };

  // === MEMOIZED STYLES ===
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Full-screen viewer modal */}
      {renderFullScreenViewer()}

      {/* Pre-Upload Album Selection Modal */}
      <Modal visible={uploadModalVisible} transparent={true} animationType="slide">
        <View style={styles.uploadModalOverlay}>
          <View style={[styles.uploadModalContent, { backgroundColor: theme.colors.surfaceElevated }]}>
            <Text style={[styles.uploadModalTitle, { color: theme.colors.textPrimary }]}>
              Upload {pendingAssets.length} Item{pendingAssets.length > 1 ? 's' : ''}
            </Text>
            
            <Text style={[styles.uploadModalLabel, { color: theme.colors.textSecondary }]}>Save to Album:</Text>
            <TextInput
              style={[styles.albumInput, { color: theme.colors.textPrimary, borderColor: theme.colors.border }]}
              value={selectedTags.join(', ')}
              onChangeText={(text) => setSelectedTags(text.split(',').map(t => t.trim()).filter(Boolean))}
              placeholder="Type album name..."
              placeholderTextColor={theme.colors.textMuted}
            />

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
                  }}
                >
                  <Text style={[styles.quickSelectText, selectedTags.includes(album) && { color: '#fff' }]}>{album}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            
            <View style={styles.uploadModalButtons}>
              <TouchableOpacity 
                style={[styles.uploadModalButton, { backgroundColor: theme.colors.surface }]}
                onPress={() => { setUploadModalVisible(false); setPendingAssets([]); }}
              >
                <Text style={{ color: theme.colors.textPrimary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.uploadModalButton, { backgroundColor: theme.colors.primary }]}
                onPress={executeUpload}
              >
                <Text style={{ color: '#fff', fontWeight: 'bold' }}>Upload Now</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Album Filter Dropdown */}
      <Modal
        visible={isDropdownVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsDropdownVisible(false)}
      >
        <TouchableOpacity 
          style={styles.dropdownOverlay} 
          activeOpacity={1} 
          onPress={() => setIsDropdownVisible(false)}
        >
          <View style={[styles.dropdownMenu, { backgroundColor: theme.colors.surfaceElevated }]}>
            <ScrollView bounces={false} style={{ maxHeight: height * 0.4 }}>
              {availableAlbums.map((album) => (
                <TouchableOpacity
                  key={album}
                  style={[
                    styles.dropdownItem,
                    selectedAlbum === album && { backgroundColor: 'rgba(0,0,0,0.05)' }
                  ]}
                  onPress={() => {
                    setSelectedAlbum(album);
                    setIsDropdownVisible(false);
                  }}
                >
                  <Text style={[
                    styles.dropdownItemText, 
                    { color: theme.colors.textPrimary },
                    selectedAlbum === album && { fontWeight: '700', color: theme.colors.primary }
                  ]}>
                    {album}
                  </Text>
                  {selectedAlbum === album && (
                    <Icon name="check" size={18} color={theme.colors.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Header */}
      <View style={styles.header}>
        {onClose ? (
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Icon name="arrow-left" size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.closeButton} />
        )}
        <TouchableOpacity 
          style={styles.headerTitleContainer} 
          onPress={() => setIsDropdownVisible(true)}
          activeOpacity={0.7}
        >
          <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>
            {selectedAlbum === 'All' ? 'Photo Vault' : selectedAlbum}
          </Text>
          <Icon name="chevron-down" size={20} color={theme.colors.textPrimary} style={{ marginLeft: 4 }} />
        </TouchableOpacity>
        <View style={styles.placeholder} />
      </View>

      {/* Tab Toggle */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[
            styles.tabButton,
            activeTab === 'uploads' && { backgroundColor: '#fff' }
          ]}
          onPress={() => setActiveTab('uploads')}
        >
          <Icon 
            name="cellphone" 
            size={16} 
            color={activeTab === 'uploads' ? '#000' : theme.colors.textSecondary} 
          />
          <Text style={[
            styles.tabText,
            activeTab === 'uploads' && { color: '#000' }
          ]}>
            Phone Uploads
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tabButton,
            activeTab === 'turtle-base' && { backgroundColor: theme.colors.primary }
          ]}
          onPress={() => setActiveTab('turtle-base')}
        >
          <Icon 
            name="desktop-classic" 
            size={16} 
            color={activeTab === 'turtle-base' ? '#fff' : theme.colors.textSecondary} 
          />
          <Text style={[
            styles.tabText,
            activeTab === 'turtle-base' && { color: '#fff' }
          ]}>
            Turtle Base
          </Text>
        </TouchableOpacity>
      </View>

      {/* Gallery Grid */}
      {loading && currentItems.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={gridRef}
          data={filteredItems}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          numColumns={3}
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={false}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={3}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={
            <View style={[styles.bottomContainer, { paddingBottom: insets.bottom + 16, paddingTop: 16 }]}>
              {/* Photo Count (Always visible at bottom) */}
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

              {/* Upload Button (Only for phone uploads tab) */}
              {activeTab === 'uploads' && (
                <TouchableOpacity
                  style={[styles.uploadButton, { backgroundColor: '#fff' }]}
                  onPress={handleUpload}
                  disabled={uploading}
                  activeOpacity={0.8}
                >
                  {uploading ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <>
                      <Icon name="cloud-upload" size={20} color="#000" />
                      <Text style={[styles.uploadButtonText, { color: '#000' }]}>Upload Photos</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}

    </SafeAreaView>
  );
}

// Memoized grid item component for performance
// === GRID ITEM COMPONENT (Memoized) ===
const GridItem = React.memo(({ item, openViewer, handleDelete, getFullUrl, getBaseUrl, activeTab, styles }) => {
  const isVideo = item.type === 'video';
  const [duration, setDuration] = useState(item.duration);
  const [hasFailed, setHasFailed] = useState(false);
  
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
    tabText: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.textSecondary,
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
    viewerInfoTop: {
      position: 'absolute',
      left: 24,
      right: 24,
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
      marginBottom: 24,
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
  });
