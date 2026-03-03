import React, { useState, useEffect, useCallback, useRef } from 'react';
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
const THUMBNAIL_SIZE = width / 3 - 1; // 3 columns with ~0.5px gap on each side

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
  
  // Tab state: 'uploads' or 'turtle-base'
  const [activeTab, setActiveTab] = useState('uploads');
  
  // Data state
  const [uploadItems, setUploadItems] = useState([]);
  const [serverItems, setServerItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  
  // Pagination state
  const [hasMoreUploads, setHasMoreUploads] = useState(true);
  const [hasMoreServer, setHasMoreServer] = useState(true);
  const [uploadOffset, setUploadOffset] = useState(0);
  const [serverOffset, setServerOffset] = useState(0);
  const LIMIT = 150;

  // Full-screen viewer state
  const [selectedMedia, setSelectedMedia] = useState(null);
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const [infoVisible, setInfoVisible] = useState(true);
  const infoOpacityAnim = useRef(new Animated.Value(1)).current;
  
  // Scroll position for parallax effect
  const scrollX = useRef(new Animated.Value(0)).current;
  
  // Grid ref for scroll-to-bottom (iOS Photos style)
  const gridRef = useRef(null);

  // Get current items based on active tab
  // Data is [oldest, ..., newest] - FlatList renders top-to-bottom, so newest appears at bottom
  const currentItems = activeTab === 'uploads' ? uploadItems : serverItems;
  const currentHasMore = activeTab === 'uploads' ? hasMoreUploads : hasMoreServer;

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
  }, [scaleAnim, opacityAnim]);

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
  const handleUpload = useCallback(async () => {
    try {
      // Request permissions
      const { status: pickerStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (pickerStatus !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to photos and videos to upload.');
        return;
      }

      const { status: mediaStatus } = await MediaLibrary.requestPermissionsAsync();
      if (mediaStatus !== 'granted') {
        console.log('[MediaGallery] MediaLibrary permission not granted - upload only, no delete');
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

      setUploading(true);
      const serverUrl = getBaseUrl();
      
      const uploadPromises = result.assets.map(async (asset) => {
        const formData = new FormData();
        
        // Get original creation date from asset info
        let originalDate = null;
        if (asset.assetId) {
          try {
            const assetInfo = await MediaLibrary.getAssetInfoAsync(asset.assetId);
            originalDate = assetInfo.creationTime || null;
            console.log('[MediaGallery] Asset creation time:', originalDate, new Date(originalDate).toISOString());
          } catch (infoError) {
            console.log('[MediaGallery] Could not get asset info:', infoError.message);
          }
        }
        
        // Add original date to form data
        if (originalDate) {
          formData.append('originalDate', originalDate.toString());
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
      
      Alert.alert('Success', `${results.length} item(s) uploaded successfully!`);
    } catch (error) {
      console.error('[MediaGallery] Upload error:', error);
      Alert.alert('Upload Failed', error.message || 'Failed to upload media');
    } finally {
      setUploading(false);
    }
  }, [getBaseUrl, fetchUploads]);

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

  // Render grid item with error handling
  const renderItem = useCallback(({ item }) => {
    const imageUrl = item.thumbnailUrl 
      ? getFullUrl(item.thumbnailUrl)
      : getFullUrl(item.url);
    
    const isVideo = item.type === 'video';
    const hasFailed = failedImages.has(item.id);
    
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
              color={theme.colors.textMuted} 
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
              console.log('[MediaGallery] Image failed to load:', item.id, item.filename);
              setFailedImages(prev => new Set([...prev, item.id]));
            }}
          />
        )}
        {isVideo && (
          <View style={styles.videoOverlay}>
            <Icon name="play-circle" size={32} color="#fff" />
            <Text style={styles.videoLabel}>VIDEO</Text>
          </View>
        )}
        {item.type === 'document' && (
          <View style={styles.documentOverlay}>
            <Icon name="file-document" size={32} color={theme.colors.textMuted} />
          </View>
        )}
      </TouchableOpacity>
    );
  }, [getFullUrl, handleDelete, openViewer, theme, failedImages]);

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
      setSelectedMedia(currentItems[index]);
    }
  }, [currentItems, selectedMedia]);

  // Render individual viewer item with pinch-to-zoom
  // Full-screen video player sub-component using new expo-video API
  const FullScreenVideoPlayer = useCallback(({ sourceUrl, isActive }) => {
    const player = useVideoPlayer(sourceUrl, player => {
      player.loop = true;
    });
    const [isPlaying, setIsPlaying] = useState(isActive);
    
    // Play/pause based on visibility
    useEffect(() => {
      if (isActive) {
        player.play();
        setIsPlaying(true);
      } else {
        player.pause();
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
    
    return (
      <Pressable onPress={togglePlay} style={styles.viewerVideoContainer}>
        <VideoView 
          style={styles.viewerVideo} 
          player={player} 
          contentFit="contain" 
          nativeControls={false}
        />
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
        (index - 1) * width,
        index * width,
        (index + 1) * width,
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
    length: width,
    offset: width * index,
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

          {/* Close button */}
          <Animated.View 
            style={[
              styles.viewerCloseButton, 
              { 
                top: insets.top + 16,
                opacity: opacityAnim,
              }
            ]}
          >
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
              snapToInterval={width}
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
        </Pressable>
      </Modal>
    );
  };

  const styles = createStyles(theme);

  return (
    <SafeAreaView style={styles.container}>
      {/* Full-screen viewer modal */}
      {renderFullScreenViewer()}

      {/* Header */}
      <View style={styles.header}>
        {onClose ? (
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Icon name="arrow-left" size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.closeButton} />
        )}
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary }]}>
          Photo Vault
        </Text>
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

      {/* Photo Count */}
      <View style={styles.countContainer}>
        <Text style={[styles.countText, { color: theme.colors.textSecondary }]}>
          {currentItems.length} {currentItems.length === 1 ? 'item' : 'items'}
          {activeTab === 'turtle-base' && ' from PC'}
        </Text>
      </View>

      {/* Gallery Grid */}
      {loading && currentItems.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={gridRef}
          data={currentItems}
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
          ListHeaderComponent={
            currentHasMore && currentItems.length > 0 ? (
              <ActivityIndicator 
                style={styles.loadMoreIndicator} 
                color={theme.colors.textMuted} 
              />
            ) : null
          }
          ListFooterComponent={
            activeTab === 'uploads' ? (
              <View style={[styles.bottomContainer, { paddingBottom: insets.bottom + 40 }]}>
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
              </View>
            ) : null
          }
        />
      )}

    </SafeAreaView>
  );
}

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
      paddingTop: 8,
      paddingBottom: 12,
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
    placeholder: {
      width: 40,
    },
    tabContainer: {
      flexDirection: 'row',
      paddingHorizontal: 16,
      paddingVertical: 12,
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
      paddingHorizontal: 16,
      paddingBottom: 8,
      backgroundColor: 'transparent',
    },
    countText: {
      fontSize: 14,
    },
    gridContent: {
      padding: 0.5,
      paddingBottom: Platform.OS === 'ios' ? 40 : 20, // Minimal space at bottom
    },
    thumbnailContainer: {
      width: THUMBNAIL_SIZE,
      height: THUMBNAIL_SIZE,
      margin: 0.5,
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
    videoOverlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.4)',
    },
    videoLabel: {
      color: '#fff',
      fontSize: 10,
      fontWeight: '700',
      marginTop: 4,
      letterSpacing: 1,
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
      paddingVertical: 8,
      paddingBottom: 12,
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
      width: width,
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
  });
