import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  PanResponder,
  Dimensions,
  Easing,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../context/ThemeContext';

const { width } = Dimensions.get('window');
const CLOCK_SIZE = Math.min(width - 80, 280);
const CLOCK_RADIUS = CLOCK_SIZE / 2;
const CENTER = CLOCK_SIZE / 2;

export const TimePicker = ({ visible, onClose, onSelect, initialTime }) => {
  const { theme } = useTheme();
  const [mode, setMode] = useState('hours'); // 'hours' or 'minutes'
  const [hours, setHours] = useState(12);
  const [minutes, setMinutes] = useState(0);
  const [isPM, setIsPM] = useState(false);
  
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (initialTime) {
      const [h, m] = initialTime.split(':').map(Number);
      setIsPM(h >= 12);
      setHours(h === 0 ? 12 : h > 12 ? h - 12 : h);
      setMinutes(m);
    } else {
      const now = new Date();
      const h = now.getHours();
      setIsPM(h >= 12);
      setHours(h === 0 ? 12 : h > 12 ? h - 12 : h);
      setMinutes(now.getMinutes());
    }
  }, [initialTime, visible]);

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      fadeAnim.setValue(0);
      scaleAnim.setValue(0.8);
    }
  }, [visible]);

  const getAngleFromTouch = useCallback((x, y) => {
    const dx = x - CENTER;
    const dy = y - CENTER;
    let angle = Math.atan2(dy, dx) * (180 / Math.PI);
    angle = angle + 90;
    if (angle < 0) angle += 360;
    return angle;
  }, []);

  const handleClockPress = useCallback((event) => {
    const { locationX, locationY } = event.nativeEvent;
    const angle = getAngleFromTouch(locationX, locationY);
    
    if (mode === 'hours') {
      // Convert angle to hour (30 degrees per hour, offset by -15 to center on numbers)
      let hour = Math.round((angle - 15) / 30) % 12;
      if (hour <= 0) hour += 12;
      setHours(hour);
      // Auto-switch to minutes after selecting hour
      setTimeout(() => setMode('minutes'), 200);
    } else {
      // Convert angle to minute (6 degrees per minute)
      let minute = Math.round(angle / 6) % 60;
      if (minute < 0) minute += 60;
      setMinutes(minute);
    }
  }, [mode, getAngleFromTouch]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        handleClockPress(evt);
      },
      onPanResponderMove: (evt) => {
        handleClockPress(evt);
      },
    })
  ).current;

  const handleSave = () => {
    let finalHours = hours;
    if (isPM && hours !== 12) finalHours += 12;
    if (!isPM && hours === 12) finalHours = 0;
    const timeString = `${finalHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    onSelect(timeString);
    onClose();
  };

  const handleClear = () => {
    onSelect(null);
    onClose();
  };

  // Calculate hand rotation
  const handRotation = mode === 'hours' 
    ? ((hours % 12) * 30) - 90
    : (minutes * 6) - 90;

  // Generate clock numbers
  const clockNumbers = mode === 'hours'
    ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    : [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

  const formatDisplayTime = () => {
    const displayHours = hours.toString().padStart(2, '0');
    const displayMinutes = minutes.toString().padStart(2, '0');
    return `${displayHours}:${displayMinutes}`;
  };

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <Animated.View 
        style={[
          styles.container,
          { 
            backgroundColor: theme.colors.background,
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }]
          }
        ]}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.colors.textPrimary }]}>
            Set Time
          </Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Icon name="close" size={24} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Digital Display */}
        <View style={[styles.digitalDisplay, { backgroundColor: theme.colors.surfaceElevated }]}>
          <TouchableOpacity 
            onPress={() => setMode('hours')}
            style={[styles.timeUnit, mode === 'hours' && styles.timeUnitActive]}
          >
            <Text style={[
              styles.timeUnitText,
              { color: mode === 'hours' ? theme.colors.accentPrimary : theme.colors.textPrimary }
            ]}>
              {hours.toString().padStart(2, '0')}
            </Text>
          </TouchableOpacity>
          
          <Text style={[styles.colon, { color: theme.colors.textTertiary }]}>:</Text>
          
          <TouchableOpacity 
            onPress={() => setMode('minutes')}
            style={[styles.timeUnit, mode === 'minutes' && styles.timeUnitActive]}
          >
            <Text style={[
              styles.timeUnitText,
              { color: mode === 'minutes' ? theme.colors.accentPrimary : theme.colors.textPrimary }
            ]}>
              {minutes.toString().padStart(2, '0')}
            </Text>
          </TouchableOpacity>

          <View style={styles.ampmContainer}>
            <TouchableOpacity 
              onPress={() => setIsPM(false)}
              style={[
                styles.ampmBtn,
                !isPM && [styles.ampmBtnActive, { backgroundColor: `${theme.colors.accentPrimary}30` }]
              ]}
            >
              <Text style={[
                styles.ampmText,
                { color: !isPM ? theme.colors.accentPrimary : theme.colors.textTertiary }
              ]}>
                AM
              </Text>
            </TouchableOpacity>
            <TouchableOpacity 
              onPress={() => setIsPM(true)}
              style={[
                styles.ampmBtn,
                isPM && [styles.ampmBtnActive, { backgroundColor: `${theme.colors.accentPrimary}30` }]
              ]}
            >
              <Text style={[
                styles.ampmText,
                { color: isPM ? theme.colors.accentPrimary : theme.colors.textTertiary }
              ]}>
                PM
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Analog Clock */}
        <View 
          style={[styles.clockContainer, { backgroundColor: theme.colors.surface }]}
          {...panResponder.panHandlers}
        >
          {/* Clock Face */}
          <View style={[styles.clockFace, { backgroundColor: theme.colors.background }]}>
            {/* Center Dot */}
            <View style={[styles.centerDot, { backgroundColor: theme.colors.accentPrimary }]} />
            
            {/* Clock Hand */}
            <Animated.View 
              style={[
                styles.clockHand,
                { 
                  backgroundColor: theme.colors.accentPrimary,
                  transform: [
                    { rotate: `${handRotation}deg` },
                    { translateY: -CLOCK_RADIUS * 0.6 }
                  ]
                }
              ]}
            />
            
            {/* Hand Center Circle */}
            <View style={[styles.handCenter, { backgroundColor: theme.colors.accentPrimary }]}>
              <Text style={styles.handCenterText}>
                {mode === 'hours' ? hours : minutes.toString().padStart(2, '0')}
              </Text>
            </View>

            {/* Clock Numbers */}
            {clockNumbers.map((num, index) => {
              const angle = (index * 30 - 90) * (Math.PI / 180);
              const radius = CLOCK_RADIUS * 0.75;
              const x = CENTER + radius * Math.cos(angle);
              const y = CENTER + radius * Math.sin(angle);
              
              const isSelected = mode === 'hours' 
                ? hours === num 
                : minutes === num;

              return (
                <TouchableOpacity
                  key={num}
                  style={[
                    styles.clockNumber,
                    {
                      left: x - 20,
                      top: y - 20,
                      backgroundColor: isSelected ? theme.colors.accentPrimary : 'transparent',
                    }
                  ]}
                  onPress={() => {
                    if (mode === 'hours') {
                      setHours(num);
                      setTimeout(() => setMode('minutes'), 200);
                    } else {
                      setMinutes(num);
                    }
                  }}
                >
                  <Text style={[
                    styles.clockNumberText,
                    { 
                      color: isSelected ? '#fff' : theme.colors.textPrimary,
                      fontWeight: isSelected ? '700' : '400'
                    }
                  ]}>
                    {num}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Quick Select for Minutes */}
          {mode === 'minutes' && (
            <View style={styles.quickSelect}>
              {[0, 15, 30, 45].map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[
                    styles.quickSelectBtn,
                    { 
                      backgroundColor: minutes === m 
                        ? theme.colors.accentPrimary 
                        : theme.colors.surfaceElevated 
                    }
                  ]}
                  onPress={() => setMinutes(m)}
                >
                  <Text style={[
                    styles.quickSelectText,
                    { color: minutes === m ? '#fff' : theme.colors.textPrimary }
                  ]}>
                    :{m.toString().padStart(2, '0')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity 
            style={[styles.actionBtn, styles.clearBtn, { borderColor: theme.colors.border }]}
            onPress={handleClear}
          >
            <Text style={[styles.actionBtnText, { color: theme.colors.textSecondary }]}>
              Clear
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.actionBtn, styles.saveBtn, { backgroundColor: theme.colors.accentSuccess }]}
            onPress={handleSave}
          >
            <Icon name="check" size={20} color="#fff" />
            <Text style={[styles.actionBtnText, styles.saveBtnText]}>
              Set Time
            </Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  container: {
    width: '90%',
    maxWidth: 400,
    borderRadius: 24,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 4,
  },
  digitalDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 16,
    marginBottom: 20,
  },
  timeUnit: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  timeUnitActive: {
    backgroundColor: 'rgba(255, 140, 0, 0.2)',
  },
  timeUnitText: {
    fontSize: 36,
    fontWeight: '300',
    fontVariant: ['tabular-nums'],
  },
  colon: {
    fontSize: 36,
    fontWeight: '300',
    marginHorizontal: 4,
  },
  ampmContainer: {
    marginLeft: 12,
  },
  ampmBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginVertical: 2,
  },
  ampmBtnActive: {
    borderRadius: 6,
  },
  ampmText: {
    fontSize: 12,
    fontWeight: '600',
  },
  clockContainer: {
    alignItems: 'center',
    padding: 16,
    borderRadius: 20,
    marginBottom: 20,
  },
  clockFace: {
    width: CLOCK_SIZE,
    height: CLOCK_SIZE,
    borderRadius: CLOCK_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    position: 'absolute',
    zIndex: 10,
  },
  clockHand: {
    position: 'absolute',
    width: 4,
    height: CLOCK_RADIUS * 0.6,
    borderRadius: 2,
    top: CENTER,
    left: CENTER - 2,
    transformOrigin: 'bottom center',
  },
  handCenter: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5,
  },
  handCenterText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  clockNumber: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clockNumberText: {
    fontSize: 16,
  },
  quickSelect: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
  },
  quickSelectBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  quickSelectText: {
    fontSize: 14,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  clearBtn: {
    borderWidth: 1,
  },
  saveBtn: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  actionBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  saveBtnText: {
    color: '#fff',
  },
});
