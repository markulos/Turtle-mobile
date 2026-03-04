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
  const [uploading, setUploading] = useState(false);
  const [uploadStats, setUploadStats] = useState({ current: 0, total: 0, failed: 0 });
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
  const [albumCovers, setAlbumCovers] = useState({}); // Cover thumbnails for 2x2 grids
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
  
  // Filter state
  const [selectedAlbum, setSelectedAlbum] = useState('All');

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

  // 3. Filter items (Bypassed: Server natively filters the payload)
  const filteredItems = useMemo(() => {
    return currentItems || [];
  }, [currentItems]);
  
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
  // Fetch uploads from database
  const fetchUploads = useCallback(async (isRefresh = false) => {
    try {
      // For iOS Photos style: we want oldest first in array (top), newest last (bottom)
      // When loading more, we fetch the next batch of older items (lower offset)
      const currentOffset = isRefresh ? 0 : uploadOffset;
      
      // Append the selected tag to the query
      const tagParam = selectedAlbum !== 'All' ? `&tag=${encodeURIComponent(selectedAlbum)}` : '';
      const response = await api.get(`/media/gallery?limit=${LIMIT}&offset=${currentOffset}&order=asc${tagParam}`);
      
      if (response.success) {
        if (isRefresh) {
          // Replace with fresh data, oldest first
          setUploadItems(response.items || []);
          setUploadOffset(LIMIT);
        } else {
          // Prepend older items to the beginning of the array
          setUploadItems(prev => [...(response.items || []), ...prev]);
          setUploadOffset(currentOffset + LIMIT);
        }
        setHasMoreUploads(response.pagination?.hasMore || false);
      }
    } catch (error) {
      console.error('[MediaGallery] Fetch uploads error:', error);
      Alert.alert('Error', 'Failed to load uploads');
    }
  }, [api, uploadOffset, selectedAlbum]); // <--- CRITICAL FIX: Added selectedAlbum to dependencies

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

  // Handle load more (pagination - only for uploads)
  const handleLoadMore = useCallback(() => {
    if (currentHasMore && !loading && !refreshing && activeTab === 'uploads') {
      fetchUploads(false);
    }
  }, [currentHasMore, loading, refreshing, activeTab, fetchUploads]);

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
        mediaTypes: ImagePicker.MediaTypeOptions.All, // Better Expo standard syntax
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
        if (res.success) {
          if (res.albums) setGlobalAlbums(res.albums);
          if (res.covers) setAlbumCovers(res.covers);
        }
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
              data={filteredItems}
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
                        
                        if (res && res.success) {
                          const newTagsString = JSON.stringify(editingTags);
                          
                          // 1. Update the active item in the full-screen viewer instantly
                          setSelectedMedia(prev => ({ ...prev, tags: newTagsString }));
                          
                          // 2. Intelligently update the main background grid
                          const updateItemInList = (prevList) => {
                            // If we are currently filtering by a tag, and the user just removed that tag,
                            // gracefully remove the item from the current view.
                            if (selectedAlbum !== 'All' && !editingTags.includes(selectedAlbum)) {
                              return prevList.filter(item => item.id !== selectedMedia.id);
                            }
                            // Otherwise, just update the tags on the existing item
                            return prevList.map(item => 
                              item.id === selectedMedia.id ? { ...item, tags: newTagsString } : item
                            );
                          };
                          
                          setUploadItems(updateItemInList);
                          setServerItems(updateItemInList);
                          
                          // 3. Optimistically add any brand-new tags to the dropdown list instantly
                          setGlobalAlbums(prev => {
                            const combined = new Set([...prev, ...editingTags]);
                            return Array.from(combined).sort();
                          });

                          // 4. Close the modal
                          setEditTagsVisible(false);
                        } else {
                          Alert.alert('Error', 'Server rejected the tag update');
                        }
                      } catch(e) { 
                        Alert.alert('Error', `Failed to update tags: ${e.message}`); 
                      }
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
            
            {uploading ? (
              <View style={styles.progressContainer}>
                <Text style={[styles.progressText, { color: theme.colors.textPrimary }]}>
                  Uploading {uploadStats.current} of {uploadStats.total}...
                </Text>
                <View style={[styles.progressBarBackground, { backgroundColor: theme.colors.border }]}>
                  <View style={[
                    styles.progressBarFill, 
                    { 
                      backgroundColor: theme.colors.primary, 
                      width: `${(uploadStats.current / Math.max(1, uploadStats.total)) * 100}%` 
                    }
                  ]} />
                </View>
                {uploadStats.failed > 0 && (
                  <Text style={styles.progressErrorText}>{uploadStats.failed} failed</Text>
                )}
              </View>
            ) : (
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
            )}
          </View>
        </View>
      </Modal>

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
          <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>
            {selectedAlbum === 'All' ? 'Photo Vault' : `Album: ${selectedAlbum}`}
          </Text>
        </View>

        <View style={styles.headerRightAction}>
          {selectedAlbum !== 'All' && (
            <TouchableOpacity 
              style={styles.clearFilterButton}
              onPress={() => setSelectedAlbum('All')}
            >
              <Text style={{ color: theme.colors.primary, fontWeight: '600' }}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* 3-Way Tab Toggle */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'uploads' && { backgroundColor: '#fff' }]}
          onPress={() => setActiveTab('uploads')}
        >
          <Icon name="image-multiple" size={16} color={activeTab === 'uploads' ? '#000' : theme.colors.textSecondary} />
          <Text style={[styles.tabText, activeTab === 'uploads' && { color: '#000' }]}>Photos</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'albums' && { backgroundColor: theme.colors.primary }]}
          onPress={() => setActiveTab('albums')}
        >
          <Icon name="folder-multiple" size={16} color={activeTab === 'albums' ? '#fff' : theme.colors.textSecondary} />
          <Text style={[styles.tabText, activeTab === 'albums' && { color: '#fff' }]}>Albums</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'turtle-base' && { backgroundColor: theme.colors.surfaceElevated }]}
          onPress={() => { setActiveTab('turtle-base'); setSelectedAlbum('All'); }}
        >
          <Icon name="desktop-classic" size={16} color={theme.colors.textSecondary} />
          <Text style={styles.tabText}>PC</Text>
        </TouchableOpacity>
      </View>

      {/* Main Content Area */}
      {activeTab === 'albums' ? (
        <FlatList
          key="albums-grid"
          data={globalAlbums}
          keyExtractor={(item) => item}
          numColumns={2}
          contentContainerStyle={styles.albumsGridContent}
          columnWrapperStyle={styles.albumsColumnWrapper}
          renderItem={({ item }) => {
            const covers = albumCovers[item] || [];
            // Create an array of exactly 4 slots (fill missing with null)
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
                  colors={['transparent', 'rgba(0,0,0,0.1)']}
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
        /* Gallery Grid for Photos/PC tabs */
        loading && currentItems.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        ) : (
          <FlatList
            key="photos-grid"
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
        )
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
    // Header & Album Folder Styles
    headerRightAction: {
      width: 60,
      alignItems: 'flex-end',
      paddingRight: 8,
    },
    clearFilterButton: {
      backgroundColor: 'rgba(0,0,0,0.05)',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 12,
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
