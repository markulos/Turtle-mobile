import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const { width } = Dimensions.get('window');
const DAY_WIDTH = (width - 80) / 7;

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export const DatePickerModal = ({ 
  visible, 
  onClose, 
  onSelect, 
  selectedDate,
  theme 
}) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const fadeAnim = useRef(new Animated.Value(0)).current;
  
  const styles = createStyles(theme);
  
  useEffect(() => {
    if (visible) {
      // Set current month to selected date's month or today
      if (selectedDate) {
        setCurrentMonth(new Date(selectedDate));
      } else {
        setCurrentMonth(new Date());
      }
      
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, selectedDate]);
  
  // Helper to create YYYY-MM-DD string in local timezone
  const toDateString = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  
  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay();
    
    const days = [];
    
    // Empty cells for days before month starts
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push({ type: 'empty', key: `empty-${i}` });
    }
    
    // Days of the month
    const today = new Date();
    // Reset time to midnight for accurate comparison
    today.setHours(0, 0, 0, 0);
    
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      // Create date string in local timezone (not UTC)
      const dateStr = toDateString(date);
      
      // Compare dates without time
      const dateNoTime = new Date(date);
      dateNoTime.setHours(0, 0, 0, 0);
      
      const isToday = today.getTime() === dateNoTime.getTime();
      const isSelected = selectedDate === dateStr;
      
      // Calculate relative days from today
      const diffTime = dateNoTime - today;
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
      let relativeLabel = '';
      if (diffDays === 0) relativeLabel = 'Today';
      else if (diffDays === 1) relativeLabel = 'Tomorrow';
      else if (diffDays === -1) relativeLabel = 'Yesterday';
      else if (diffDays > 1 && diffDays < 7) relativeLabel = `In ${diffDays} days`;
      else if (diffDays < -1 && diffDays > -7) relativeLabel = `${Math.abs(diffDays)} days ago`;
      
      days.push({
        type: 'day',
        day,
        date: dateStr,
        isToday,
        isSelected,
        relativeLabel,
        key: `day-${day}`
      });
    }
    
    return days;
  }, [currentMonth, selectedDate]);
  
  const goToPrevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };
  
  const goToNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };
  
  const goToToday = () => {
    const today = new Date();
    setCurrentMonth(today);
    onSelect(today.toISOString().split('T')[0]);
  };
  
  const handleDateSelect = (dateStr) => {
    onSelect(dateStr);
  };
  
  // Quick select buttons
  const quickSelects = [
    { label: 'Today', days: 0 },
    { label: 'Tomorrow', days: 1 },
    { label: '+3 Days', days: 3 },
    { label: '+1 Week', days: 7 },
    { label: '+2 Weeks', days: 14 },
    { label: '+1 Month', days: 30 },
  ];
  
  const handleQuickSelect = (days) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    onSelect(toDateString(date));
  };
  
  return (
    <Modal
      transparent
      visible={visible}
      onRequestClose={onClose}
      animationType="none"
    >
      <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
        <TouchableOpacity style={styles.backdrop} onPress={onClose} />
        
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={goToPrevMonth} style={styles.navButton}>
              <Icon name="chevron-left" size={28} color={theme.colors.textPrimary} />
            </TouchableOpacity>
            
            <View style={styles.monthYear}>
              <Text style={styles.monthText}>{MONTHS[currentMonth.getMonth()]}</Text>
              <Text style={styles.yearText}>{currentMonth.getFullYear()}</Text>
            </View>
            
            <TouchableOpacity onPress={goToNextMonth} style={styles.navButton}>
              <Icon name="chevron-right" size={28} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>
          
          {/* Today Button */}
          <TouchableOpacity style={styles.todayButton} onPress={goToToday}>
            <Icon name="calendar-today" size={16} color={theme.colors.accentSuccess} />
            <Text style={styles.todayText}>Today</Text>
          </TouchableOpacity>
          
          {/* Days Header */}
          <View style={styles.daysHeader}>
            {DAYS.map((day, idx) => (
              <View key={idx} style={styles.dayHeaderCell}>
                <Text style={styles.dayHeaderText}>{day}</Text>
              </View>
            ))}
          </View>
          
          {/* Calendar Grid */}
          <View style={styles.calendarGrid}>
            {calendarDays.map((item) => {
              if (item.type === 'empty') {
                return <View key={item.key} style={styles.emptyCell} />;
              }
              
              return (
                <TouchableOpacity
                  key={item.key}
                  style={[
                    styles.dayCell,
                    item.isToday && styles.todayCell,
                    item.isSelected && styles.selectedCell
                  ]}
                  onPress={() => handleDateSelect(item.date)}
                >
                  <Text style={[
                    styles.dayText,
                    item.isToday && styles.todayText,
                    item.isSelected && styles.selectedText
                  ]}>
                    {item.day}
                  </Text>
                  {item.relativeLabel && !item.isSelected && (
                    <Text style={styles.relativeLabel} numberOfLines={1}>
                      {item.relativeLabel}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
          
          {/* Quick Select Buttons */}
          <View style={styles.quickSelectContainer}>
            <Text style={styles.quickSelectTitle}>Quick Select</Text>
            <View style={styles.quickSelectButtons}>
              {quickSelects.map((qs) => (
                <TouchableOpacity
                  key={qs.label}
                  style={styles.quickSelectBtn}
                  onPress={() => handleQuickSelect(qs.days)}
                >
                  <Text style={styles.quickSelectText}>{qs.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          
          {/* Close Button */}
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Modal>
  );
};

const createStyles = (theme) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  container: {
    width: width - 40,
    backgroundColor: theme.colors.background,
    borderRadius: 16,
    padding: 20,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  navButton: {
    padding: 8,
  },
  monthYear: {
    alignItems: 'center',
  },
  monthText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.textPrimary,
  },
  yearText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
  },
  todayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    marginBottom: 12,
    backgroundColor: `${theme.colors.accentSuccess}15`,
    borderRadius: 8,
  },
  todayText: {
    fontSize: 14,
    color: theme.colors.accentSuccess,
    marginLeft: 6,
    fontWeight: '600',
  },
  daysHeader: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  dayHeaderCell: {
    width: DAY_WIDTH,
    alignItems: 'center',
  },
  dayHeaderText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  emptyCell: {
    width: DAY_WIDTH,
    height: DAY_WIDTH * 0.9,
  },
  dayCell: {
    width: DAY_WIDTH,
    height: DAY_WIDTH * 1.1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    marginBottom: 4,
  },
  todayCell: {
    backgroundColor: `${theme.colors.accentSuccess}20`,
    borderWidth: 1,
    borderColor: theme.colors.accentSuccess,
  },
  selectedCell: {
    backgroundColor: theme.colors.accentSuccess,
  },
  dayText: {
    fontSize: 14,
    color: theme.colors.textPrimary,
  },
  todayText: {
    fontWeight: 'bold',
    color: theme.colors.accentSuccess,
  },
  selectedText: {
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  relativeLabel: {
    fontSize: 8,
    color: theme.colors.textTertiary,
    marginTop: 2,
  },
  quickSelectContainer: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 0.5,
    borderTopColor: theme.colors.border,
  },
  quickSelectTitle: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginBottom: 8,
    fontWeight: '600',
  },
  quickSelectButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickSelectBtn: {
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  quickSelectText: {
    fontSize: 12,
    color: theme.colors.textPrimary,
  },
  closeButton: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  closeButtonText: {
    fontSize: 14,
    color: theme.colors.textPrimary,
    fontWeight: '600',
  },
});
