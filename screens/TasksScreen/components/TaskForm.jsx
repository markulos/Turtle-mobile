import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Platform,
  StyleSheet,
  Alert,
  ScrollView,
  Keyboard,
  Dimensions,
  KeyboardAvoidingView,
} from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  Extrapolation,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../context/ThemeContext';
import { FormField } from './FormField';
import { DatePickerModal } from './DatePickerModal';
import { WheelTimePicker } from './WheelTimePicker';
import { normalizeTags, parseTags, getPriorityColor } from '../utils/taskHelpers';
import {
  PRIORITIES,
  ITEM_TYPES,
  ITEM_TYPE_DEFAULT_COLOR,
  OCCASION_COLORS,
  REMINDER_OPTIONS,
} from '../utils/constants';

// Off-screen start/stop point for the sheet's slide-up present animation.
const SHEET_H = Dimensions.get('window').height || 900;
// Snap spring — tuned to match the calendar day-sheet's rise/settle feel.
const SHEET_SPRING = { damping: 22, stiffness: 220, mass: 0.9 };

// Per-type wording so the same modal reads naturally whether you're creating a
// task, an event, or a birthday.
const TYPE_COPY = {
  task: {
    label: 'Task',
    titleLabel: 'Title *',
    titlePlaceholder: 'What needs to be done?',
    dateLabel: 'Due Date',
  },
  event: {
    label: 'Event',
    titleLabel: 'Event title *',
    titlePlaceholder: "What's the occasion?",
    dateLabel: 'Date *',
  },
  birthday: {
    label: 'Birthday',
    titleLabel: 'Name *',
    titlePlaceholder: 'Whose birthday?',
    dateLabel: 'Birthday date *',
  },
};

const blankForm = (itemType = 'task') => ({
  title: '', description: '', priority: 'medium', completed: false,
  project: '', dueDate: '', time: '', tags: [], recurring: 'none',
  itemType,
  // Occasion extras (event/birthday). Flattened here for easy editing; packed
  // into a `meta` object on save.
  color: ITEM_TYPE_DEFAULT_COLOR[itemType] || null,
  guests: [],
  reminders: itemType === 'birthday' ? ['1-week', 'same-day'] : [],
  yearly: true,
});

export const TaskForm = ({
  visible,
  onClose,
  onSave,
  onDelete,
  initialData,
  // Type to pre-select when creating a NEW item (from the calendar "+" menu).
  // Ignored when editing — the existing item's own itemType wins.
  initialType = 'task',
  // Date (YYYY-MM-DD) to pre-fill as the due/occasion date when creating from a
  // tapped calendar day. Ignored when editing.
  initialDate = null,
  projects,
  allTags,
  onAddProject,
  onCollectTags,
}) => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const RECURRING_OPTIONS = [
    { value: 'none', label: 'No', icon: 'repeat-off' },
    { value: 'daily', label: 'Daily', icon: 'calendar-today' },
    { value: 'weekly', label: 'Weekly', icon: 'calendar-week' },
    { value: 'biweekly', label: 'Biweekly', icon: 'calendar-range' },
  ];

  const [formData, setFormData] = useState(blankForm('task'));
  const [tagInput, setTagInput] = useState('');
  const [guestInput, setGuestInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const titleInputRef = useRef(null);
  const descInputRef = useRef(null);
  const dueDateInputRef = useRef(null);
  // Single source of truth for the sheet's vertical position (Reanimated shared
  // value, driven on the UI thread exactly like the calendar day-sheet): 0 =
  // fully open, SHEET_H = off-screen at the bottom. The header drag writes to it
  // 1:1, and the present/dismiss animations spring/time it. The backdrop dim is
  // derived from it, so the dim fades in as the sheet rises and lightens as you
  // drag it down — no separate opacity value to keep in sync.
  const sheetY = useSharedValue(SHEET_H);
  const dragStartY = useSharedValue(SHEET_H);

  const isEditing = !!initialData?.id;
  const itemType = formData.itemType || 'task';
  const isTask = itemType === 'task';
  const isEvent = itemType === 'event';
  const isBirthday = itemType === 'birthday';
  const copy = TYPE_COPY[itemType] || TYPE_COPY.task;

  useEffect(() => {
    if (visible) {
      // Present: spring the sheet up from off-screen (dim fades in via the
      // sheetY-derived backdrop style).
      sheetY.value = SHEET_H;
      sheetY.value = withSpring(0, SHEET_SPRING);
      if (initialData) {
        // Check if task is an appointment (createdAt matches dueDate)
        const isAppointment = initialData.dueDate && initialData.createdAt && (() => {
          const [y, m, d] = initialData.dueDate.split('-').map(Number);
          const dueDateTime = new Date(y, m - 1, d).getTime();
          const createdDate = new Date(initialData.createdAt);
          const createdDateTime = new Date(
            createdDate.getFullYear(),
            createdDate.getMonth(),
            createdDate.getDate()
          ).getTime();
          return dueDateTime === createdDateTime;
        })();

        const type = initialData.itemType || 'task';
        const meta = (initialData.meta && typeof initialData.meta === 'object') ? initialData.meta : {};
        setFormData({
          ...blankForm(type),
          ...initialData,
          tags: normalizeTags(initialData.tags),
          isAppointment: !!isAppointment,
          recurring: initialData.recurring || 'none',
          itemType: type,
          color: meta.color || ITEM_TYPE_DEFAULT_COLOR[type] || null,
          guests: Array.isArray(meta.guests) ? meta.guests : [],
          reminders: Array.isArray(meta.reminders) ? meta.reminders : (type === 'birthday' ? ['1-week', 'same-day'] : []),
          yearly: meta.yearly !== false,
        });
      } else {
        setFormData({ ...blankForm(initialType || 'task'), dueDate: initialDate || '' });
      }
      setTagInput('');
      setGuestInput('');
      setShowSuggestions(false);
    }
  }, [visible, initialData, initialType, initialDate, sheetY]);

  // Stable JS callbacks the gesture/animation worklets invoke via runOnJS. They
  // read the latest ref on the JS thread, so the gesture never has to rebuild
  // (and the worklet never captures a stale function or a ref's .current).
  const runClose = useCallback(() => onCloseRef.current?.(), []);
  const runCycle = useCallback((dir) => cycleTypeRef.current?.(dir), []);

  // Dismiss: slide the sheet off-screen (the dim fades out with it via the
  // sheetY-derived backdrop), then fire onClose once it lands. Called from the
  // Cancel/Save/backdrop paths AND from the header drag-release.
  const handleClose = () => {
    Keyboard.dismiss();
    sheetY.value = withTiming(SHEET_H, { duration: 220 }, (finished) => {
      if (finished) runOnJS(runClose)();
    });
  };

  // Cycle the item kind by a swipe step (dir -1 prev, +1 next). Clamped to the
  // ends so the three types read like a little carousel.
  const cycleType = (dir) => {
    setFormData(prev => {
      const order = ITEM_TYPES.map(o => o.value);
      const idx = Math.max(0, order.indexOf(prev.itemType || 'task'));
      const next = Math.min(order.length - 1, Math.max(0, idx + dir));
      const type = order[next];
      if (type === prev.itemType) return prev;
      return {
        ...prev,
        itemType: type,
        color: prev.color || ITEM_TYPE_DEFAULT_COLOR[type] || null,
        reminders: prev.reminders.length ? prev.reminders : (type === 'birthday' ? ['1-week', 'same-day'] : prev.reminders),
      };
    });
  };

  // Keep the latest close/cycle callbacks in refs so the (once-created) gesture
  // worklet always invokes the current versions without being rebuilt.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const cycleTypeRef = useRef(cycleType);
  cycleTypeRef.current = cycleType;

  // ── Header pan — the SAME mechanism the calendar day-sheet uses ───────────
  // A react-native-gesture-handler Pan on the header drives BOTH gestures on
  // the UI thread (so the sheet tracks the finger 1:1, no JS-thread lag):
  //   • hold + slide DOWN  → dismiss (sheetY follows the finger; release past
  //     ~100px or a downward flick slides it the rest of the way and closes)
  //   • swipe LEFT/RIGHT   → switch Task ⇄ Event ⇄ Birthday
  // activeOffset means a plain tap never engages the pan, so the type buttons
  // underneath stay tappable; only a deliberate drag grabs the sheet.
  const headerPan = useMemo(() => Gesture.Pan()
    .activeOffsetX([-14, 14])
    .activeOffsetY([-8, 8])
    .onStart(() => {
      dragStartY.value = sheetY.value;
    })
    .onUpdate((e) => {
      // Only the vertical-dominant drag moves the sheet; a horizontal swipe
      // (type switch) leaves it parked.
      if (Math.abs(e.translationY) >= Math.abs(e.translationX)) {
        sheetY.value = Math.max(0, dragStartY.value + e.translationY);
      }
    })
    .onEnd((e) => {
      const horizontal = Math.abs(e.translationX) > Math.abs(e.translationY);
      if (horizontal && Math.abs(e.translationX) > 40) {
        sheetY.value = withSpring(0, SHEET_SPRING);
        runOnJS(runCycle)(e.translationX < 0 ? 1 : -1);
      } else if (e.translationY > 100 || e.velocityY > 0.6) {
        sheetY.value = withTiming(SHEET_H, { duration: 200 }, (finished) => {
          if (finished) runOnJS(runClose)();
        });
      } else {
        sheetY.value = withSpring(0, SHEET_SPRING);
      }
    }), [sheetY, dragStartY, runClose, runCycle]);

  // Sheet transform + backdrop dim, both derived from sheetY on the UI thread.
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sheetY.value, [0, SHEET_H], [1, 0], Extrapolation.CLAMP),
  }));

  const suggestions = useMemo(() => {
    if (!tagInput.trim() || !showSuggestions) return [];

    const input = tagInput.toLowerCase().trim();
    const currentTags = formData.tags.map(t => t.toLowerCase());

    return allTags.filter(tag =>
      !currentTags.includes(tag.toLowerCase()) &&
      tag.toLowerCase().includes(input)
    ).slice(0, 5);
  }, [tagInput, allTags, formData.tags, showSuggestions]);

  const handleSave = async () => {
    Keyboard.dismiss();

    const type = formData.itemType || 'task';
    const typeLabel = (TYPE_COPY[type] || TYPE_COPY.task).label;

    if (!formData.title.trim()) {
      Alert.alert('Error', `${typeLabel} ${type === 'birthday' ? 'name' : 'title'} is required`);
      return;
    }

    // Events and birthdays are calendar occasions — they must have a date.
    if ((type === 'event' || type === 'birthday') && !formData.dueDate) {
      Alert.alert('Pick a date', `Choose a date for this ${type}.`);
      return;
    }

    if (type === 'task' && formData.project && !projects.includes(formData.project)) {
      await onAddProject(formData.project);
    }

    let finalTask = {
      ...formData,
      id: initialData?.id || Date.now().toString(),
      createdAt: initialData?.createdAt || Date.now(),
      title: formData.title.trim(),
      itemType: type,
    };

    // If appointment mode is enabled (tasks only), set createdAt to match dueDate
    if (type === 'task' && formData.isAppointment && formData.dueDate) {
      const [y, m, d] = formData.dueDate.split('-').map(Number);
      const appointmentDate = new Date(y, m - 1, d);
      finalTask.createdAt = appointmentDate.getTime();
    }

    // Pack the type-specific extras into a single `meta` blob (the column the
    // server persists). Tasks carry an empty meta so they round-trip unchanged.
    if (type === 'event') {
      finalTask.meta = { color: formData.color || null, guests: formData.guests || [] };
      finalTask.recurring = 'none';
    } else if (type === 'birthday') {
      finalTask.meta = {
        color: formData.color || null,
        reminders: formData.reminders || [],
        yearly: formData.yearly !== false,
      };
      finalTask.recurring = 'none';
      finalTask.time = ''; // birthdays are all-day
    } else {
      finalTask.meta = {};
    }

    // Strip the UI-only flat fields — they now live inside meta (or are task-only).
    delete finalTask.isAppointment;
    delete finalTask.color;
    delete finalTask.guests;
    delete finalTask.reminders;
    delete finalTask.yearly;

    const confirmationDetails = [
      `${type === 'birthday' ? 'Name' : 'Title'}: ${finalTask.title}`,
      finalTask.time ? `Time: ${finalTask.time}` : null,
      finalTask.dueDate ? `Date: ${finalTask.dueDate}` : null,
      type === 'birthday' && finalTask.meta.yearly ? 'Repeats every year' : null,
      type === 'event' && finalTask.meta.guests?.length ? `Guests: ${finalTask.meta.guests.length}` : null,
      type === 'task' && finalTask.recurring && finalTask.recurring !== 'none' ? `Repeats: ${finalTask.recurring}` : null,
    ].filter(Boolean).join('\n');

    onSave(finalTask);

    Alert.alert(
      `${typeLabel} Saved`,
      confirmationDetails,
      [{ text: 'OK', onPress: handleClose }]
    );
  };

  const addTag = (tag) => {
    const tagToAdd = tag || tagInput.trim();
    if (!tagToAdd) return;

    const tagsToAdd = tagToAdd.split(',').map(t => t.trim()).filter(Boolean);

    const newTags = [];
    tagsToAdd.forEach(t => {
      if (!formData.tags.some(existing => existing.toLowerCase() === t.toLowerCase())) {
        newTags.push(t);
      }
    });

    if (newTags.length > 0) {
      setFormData(prev => ({
        ...prev,
        tags: [...prev.tags, ...newTags]
      }));

      if (onCollectTags) {
        onCollectTags(newTags);
      }
    }

    setTagInput('');
    setShowSuggestions(false);
  };

  const removeTag = (tag) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(t => t !== tag)
    }));
  };

  // ── Guests (events) ──────────────────────────────────────────────
  const addGuest = (raw) => {
    const value = (raw ?? guestInput).trim();
    if (!value) return;
    const parts = value.split(',').map(g => g.trim()).filter(Boolean);
    setFormData(prev => {
      const next = [...prev.guests];
      for (const g of parts) {
        if (!next.some(existing => existing.toLowerCase() === g.toLowerCase())) next.push(g);
      }
      return { ...prev, guests: next };
    });
    setGuestInput('');
  };

  const removeGuest = (guest) => {
    setFormData(prev => ({ ...prev, guests: prev.guests.filter(g => g !== guest) }));
  };

  // ── Reminders (birthdays) ────────────────────────────────────────
  const toggleReminder = (value) => {
    setFormData(prev => ({
      ...prev,
      reminders: prev.reminders.includes(value)
        ? prev.reminders.filter(r => r !== value)
        : [...prev.reminders, value],
    }));
  };

  const selectProject = () => {
    Keyboard.dismiss();
    Alert.alert(
      'Select Project',
      '',
      [
        ...projects.map(p => ({
          text: p,
          onPress: () => setFormData(prev => ({ ...prev, project: p }))
        })),
        { text: 'No Project', onPress: () => setFormData(prev => ({ ...prev, project: '' })) },
        { text: 'Cancel', style: 'cancel' }
      ]
    );
  };

  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Switch the item kind in-place, keeping the title/date the user already
  // typed. This is the "you can still change it to a task or event" affordance.
  const setItemType = (type) => {
    setFormData(prev => ({
      ...prev,
      itemType: type,
      // Give the new type a sensible default colour if none chosen yet.
      color: prev.color || ITEM_TYPE_DEFAULT_COLOR[type] || null,
      reminders: prev.reminders.length ? prev.reminders : (type === 'birthday' ? ['1-week', 'same-day'] : prev.reminders),
    }));
  };

  const selectSuggestion = (suggestion) => {
    addTag(suggestion);
  };

  const focusNext = (ref) => {
    ref?.current?.focus();
  };

  const styles = createStyles(theme, insets);

  const formatDateLabel = (dateStr) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
  };

  const formatTime12 = (t) => {
    const [h, m] = t.split(':').map(Number);
    const isPM = h >= 12;
    const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${displayH}:${m.toString().padStart(2, '0')} ${isPM ? 'PM' : 'AM'}`;
  };

  return (
    <Modal
      animationType="none"
      transparent
      visible={visible}
      onRequestClose={handleClose}
    >
      {/* A RN Modal renders OUTSIDE the app's root GestureHandlerRootView, so
          GestureDetector won't get touches unless we mount a root here too. */}
      <GestureHandlerRootView style={styles.overlay}>
        {/* Tap the dimmed area above the sheet to dismiss. The dim fades in as
            the sheet rises and lightens live as it's dragged down (both derived
            from sheetY). */}
        <TouchableWithoutFeedback onPress={handleClose}>
          <Reanimated.View style={[styles.backdrop, backdropStyle]} />
        </TouchableWithoutFeedback>

        {/* Single keyboard handler. The KeyboardAvoidingView lifts the WHOLE
            sheet (incl. the pinned Save/Cancel footer) on the OS keyboard curve
            — 'padding' on iOS, 'height' on Android. A plain ScrollView holds the
            fields; we deliberately do NOT also use KeyboardAwareScrollView,
            because stacking the two made them fight (double-shift/overshoot). */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.kav}
          pointerEvents="box-none"
        >
          <Reanimated.View style={[styles.content, sheetStyle]}>
            {/* Header — hold + slide DOWN to close, swipe LEFT/RIGHT to change
                type (same gesture-handler Pan the calendar day-sheet uses). It's
                the fixed top of the sheet, so the type switcher (and the action
                buttons pinned at the bottom) are always on screen. */}
            <GestureDetector gesture={headerPan}>
            <View style={styles.sheetHeader}>
              <View style={styles.grabHandle} pointerEvents="none" />
              <Text style={styles.title}>
                {isEditing ? `Edit ${copy.label}` : `New ${copy.label}`}
              </Text>

              {/* Type selector — tap a kind, or swipe across the header to move
                  between Task / Event / Birthday. */}
              <View style={styles.typeSelector}>
                {ITEM_TYPES.map(opt => {
                  const active = itemType === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[styles.typeBtn, active && { backgroundColor: opt.accent, borderColor: opt.accent }]}
                      onPress={() => setItemType(opt.value)}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel={`${opt.label} type`}
                    >
                      <Icon
                        name={opt.icon}
                        size={18}
                        color={active ? '#FFFFFF' : theme.colors.textTertiary}
                      />
                      <Text style={[styles.typeBtnText, active && styles.typeBtnTextActive]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Swipe affordance — a dot per type, the active one widened. */}
              <View style={styles.typeDots}>
                {ITEM_TYPES.map(opt => (
                  <View
                    key={opt.value}
                    style={[
                      styles.typeDot,
                      itemType === opt.value && { backgroundColor: opt.accent, width: 16 },
                    ]}
                  />
                ))}
              </View>
            </View>
            </GestureDetector>

            <ScrollView
              style={styles.fieldsScroll}
              contentContainerStyle={styles.fieldsContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              showsVerticalScrollIndicator={true}
            >
            {/* Project — tasks only. */}
            {isTask && (
              <FormField label="Project *">
                <View style={styles.projectRow}>
                  <TextInput
                    style={[styles.input, styles.projectInput]}
                    placeholder="Type new or select existing..."
                    placeholderTextColor={theme.colors.textPlaceholder}
                    value={formData.project}
                    onChangeText={text => updateField('project', text)}
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => focusNext(titleInputRef)}
                  />
                  <TouchableOpacity style={styles.projectBtn} onPress={selectProject}>
                    <Icon name="folder-open" size={20} color={theme.colors.textPrimary} />
                  </TouchableOpacity>
                </View>
                {formData.project && !projects.includes(formData.project) && (
                  <Text style={styles.hint}>Will create new project "{formData.project}"</Text>
                )}
              </FormField>
            )}

            <FormField label={copy.titleLabel}>
              <TextInput
                ref={titleInputRef}
                style={styles.input}
                placeholder={copy.titlePlaceholder}
                placeholderTextColor={theme.colors.textPlaceholder}
                value={formData.title}
                onChangeText={text => updateField('title', text)}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => focusNext(descInputRef)}
              />
            </FormField>

            {/* Tags — tasks only. */}
            {isTask && (
              <FormField label="Tags">
                <View style={styles.tagRow}>
                  <TextInput
                    style={[styles.input, styles.tagInput]}
                    placeholder="Type to see suggestions..."
                    placeholderTextColor={theme.colors.textPlaceholder}
                    value={tagInput}
                    onChangeText={(text) => {
                      setTagInput(text);
                      setShowSuggestions(text.length > 0);
                    }}
                    onSubmitEditing={() => addTag()}
                    onFocus={() => setShowSuggestions(tagInput.length > 0)}
                    blurOnSubmit={false}
                    returnKeyType="done"
                  />
                  <TouchableOpacity style={styles.addTagBtn} onPress={() => addTag()}>
                    <Icon name="plus" size={20} color={theme.colors.textPrimary} />
                  </TouchableOpacity>
                </View>

                {showSuggestions && suggestions.length > 0 && (
                  <View style={styles.suggestionsContainer}>
                    <ScrollView
                      keyboardShouldPersistTaps="handled"
                      nestedScrollEnabled
                    >
                      {suggestions.map((suggestion, index) => (
                        <TouchableOpacity
                          key={suggestion}
                          style={[
                            styles.suggestionItem,
                            index === suggestions.length - 1 && styles.suggestionLast
                          ]}
                          onPress={() => selectSuggestion(suggestion)}
                        >
                          <Icon name="tag" size={14} color={theme.colors.textPrimary} />
                          <Text style={styles.suggestionText}>{suggestion}</Text>
                          <Icon name="plus-circle" size={16} color={theme.colors.textPrimary} />
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}

                {showSuggestions && tagInput.length === 0 && allTags.length > 0 && (
                  <View style={styles.suggestionsContainer}>
                    <Text style={styles.suggestionsLabel}>All tags:</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      keyboardShouldPersistTaps="handled"
                      style={styles.allTagsRow}
                    >
                      {allTags
                        .filter(tag => !formData.tags.includes(tag))
                        .map(tag => (
                          <TouchableOpacity
                            key={tag}
                            style={styles.allTagChip}
                            onPress={() => selectSuggestion(tag)}
                          >
                            <Text style={styles.allTagText}>{tag}</Text>
                          </TouchableOpacity>
                        ))}
                    </ScrollView>
                  </View>
                )}

                {formData.tags.length > 0 && (
                  <View style={styles.tagsContainer}>
                    {formData.tags.map((tag, idx) => (
                      <View key={idx} style={styles.selectedTagChip}>
                        <Text style={styles.selectedTagText}>{tag}</Text>
                        <TouchableOpacity onPress={() => removeTag(tag)}>
                          <Icon name="close-circle" size={16} color={theme.colors.accentError} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
              </FormField>
            )}

            {/* Description — tasks + events (birthdays stay minimal). */}
            {!isBirthday && (
              <FormField label="Description">
                <TextInput
                  ref={descInputRef}
                  style={[styles.input, styles.descInput]}
                  placeholder={isEvent ? 'Event details, location, notes...' : 'Add details...'}
                  placeholderTextColor={theme.colors.textPlaceholder}
                  value={formData.description}
                  onChangeText={text => updateField('description', text)}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => focusNext(dueDateInputRef)}
                />
              </FormField>
            )}

            {/* Guests — events only. */}
            {isEvent && (
              <FormField label="Guests">
                <View style={styles.tagRow}>
                  <TextInput
                    style={[styles.input, styles.tagInput]}
                    placeholder="Add a guest by name..."
                    placeholderTextColor={theme.colors.textPlaceholder}
                    value={guestInput}
                    onChangeText={setGuestInput}
                    onSubmitEditing={() => addGuest()}
                    blurOnSubmit={false}
                    returnKeyType="done"
                  />
                  <TouchableOpacity style={styles.addTagBtn} onPress={() => addGuest()}>
                    <Icon name="account-plus" size={20} color={theme.colors.textPrimary} />
                  </TouchableOpacity>
                </View>
                {formData.guests.length > 0 && (
                  <View style={styles.tagsContainer}>
                    {formData.guests.map((guest, idx) => (
                      <View key={idx} style={styles.selectedTagChip}>
                        <Icon name="account" size={13} color={theme.colors.textSecondary} style={{ marginRight: 4 }} />
                        <Text style={styles.selectedTagText}>{guest}</Text>
                        <TouchableOpacity onPress={() => removeGuest(guest)}>
                          <Icon name="close-circle" size={16} color={theme.colors.accentError} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
              </FormField>
            )}

            {/* Date field. Tasks call it "Due Date" (optional); events/birthdays
                require it. */}
            <FormField label={copy.dateLabel}>
              <TouchableOpacity
                style={styles.datePickerButton}
                onPress={() => setShowDatePicker(true)}
              >
                <Icon name="calendar" size={20} color={theme.colors.textSecondary} />
                <Text style={[
                  styles.datePickerText,
                  !formData.dueDate && styles.datePickerPlaceholder
                ]}>
                  {formData.dueDate ? formatDateLabel(formData.dueDate) : 'Select a date...'}
                </Text>
                <Icon name="chevron-right" size={20} color={theme.colors.textTertiary} />
              </TouchableOpacity>

              {formData.dueDate && isTask && (
                <TouchableOpacity
                  style={styles.clearDateBtn}
                  onPress={() => updateField('dueDate', '')}
                >
                  <Text style={styles.clearDateText}>Clear date</Text>
                </TouchableOpacity>
              )}

              {/* Appointment option — tasks only, when a due date is set. */}
              {formData.dueDate && isTask && (
                <TouchableOpacity
                  style={styles.appointmentToggle}
                  onPress={() => updateField('isAppointment', !formData.isAppointment)}
                  activeOpacity={0.7}
                >
                  <View style={[
                    styles.checkbox,
                    formData.isAppointment && styles.checkboxChecked
                  ]}>
                    {formData.isAppointment && (
                      <Icon name="check" size={14} color="#fff" />
                    )}
                  </View>
                  <Text style={styles.appointmentText}>Single event (appointment)</Text>
                  <Icon
                    name="calendar-clock"
                    size={16}
                    color={formData.isAppointment ? theme.colors.accentSuccess : theme.colors.textTertiary}
                    style={styles.appointmentIcon}
                  />
                </TouchableOpacity>
              )}
            </FormField>

            {/* Time — tasks + events (birthdays are all-day). */}
            {!isBirthday && (
              <FormField label={isEvent ? 'Start time (optional)' : 'Time (optional)'}>
                <TouchableOpacity
                  style={styles.datePickerButton}
                  onPress={() => setShowTimePicker(true)}
                >
                  <Icon name="clock-outline" size={20} color={formData.time ? theme.colors.accentPrimary : theme.colors.textSecondary} />
                  <Text style={[
                    styles.datePickerText,
                    !formData.time && styles.datePickerPlaceholder
                  ]}>
                    {formData.time ? formatTime12(formData.time) : 'Set a time...'}
                  </Text>
                  <Icon name="chevron-right" size={20} color={theme.colors.textTertiary} />
                </TouchableOpacity>

                {formData.time && (
                  <TouchableOpacity
                    style={styles.clearDateBtn}
                    onPress={() => updateField('time', '')}
                  >
                    <Text style={styles.clearDateText}>Clear time</Text>
                  </TouchableOpacity>
                )}
              </FormField>
            )}

            {/* Colour — events + birthdays. */}
            {!isTask && (
              <FormField label="Colour">
                <View style={styles.colorRow}>
                  {OCCASION_COLORS.map(c => (
                    <TouchableOpacity
                      key={c}
                      style={[
                        styles.colorSwatch,
                        { backgroundColor: c },
                        formData.color === c && styles.colorSwatchActive,
                      ]}
                      onPress={() => updateField('color', c)}
                      accessibilityRole="button"
                      accessibilityLabel={`Colour ${c}`}
                    >
                      {formData.color === c && (
                        <Icon name="check" size={16} color="#FFFFFF" />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              </FormField>
            )}

            {/* Yearly toggle + reminders — birthdays only. */}
            {isBirthday && (
              <>
                <FormField label="Repeat">
                  <TouchableOpacity
                    style={styles.appointmentToggle}
                    onPress={() => updateField('yearly', !formData.yearly)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.checkbox, formData.yearly && styles.checkboxChecked]}>
                      {formData.yearly && <Icon name="check" size={14} color="#fff" />}
                    </View>
                    <Text style={styles.appointmentText}>Repeats every year</Text>
                    <Icon
                      name="calendar-refresh"
                      size={16}
                      color={formData.yearly ? theme.colors.accentSuccess : theme.colors.textTertiary}
                      style={styles.appointmentIcon}
                    />
                  </TouchableOpacity>
                </FormField>

                <FormField label="Reminders">
                  <View style={styles.reminderRow}>
                    {REMINDER_OPTIONS.map(opt => {
                      const active = formData.reminders.includes(opt.value);
                      return (
                        <TouchableOpacity
                          key={opt.value}
                          style={[styles.reminderChip, active && styles.reminderChipActive]}
                          onPress={() => toggleReminder(opt.value)}
                          activeOpacity={0.8}
                        >
                          <Icon
                            name={active ? 'bell-ring' : 'bell-outline'}
                            size={14}
                            color={active ? theme.colors.textPrimary : theme.colors.textTertiary}
                          />
                          <Text style={[styles.reminderText, active && styles.reminderTextActive]}>
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </FormField>
              </>
            )}

            {/* Time Picker Modal */}
            <WheelTimePicker
              visible={showTimePicker}
              onClose={() => setShowTimePicker(false)}
              onSelect={(time) => {
                updateField('time', time);
                setShowTimePicker(false);
              }}
              initialTime={formData.time}
            />

            {/* Date Picker Modal */}
            <DatePickerModal
              visible={showDatePicker}
              onClose={() => setShowDatePicker(false)}
              onSelect={(date) => {
                updateField('dueDate', date);
                setShowDatePicker(false);
              }}
              selectedDate={formData.dueDate}
              theme={theme}
            />

            {/* Priority — tasks only. */}
            {isTask && (
              <FormField label="Priority">
                <View style={styles.priorityRow}>
                  {PRIORITIES.map(p => (
                    <TouchableOpacity
                      key={p}
                      style={[
                        styles.priorityBtn,
                        formData.priority === p && {
                          backgroundColor: getPriorityColor(p, theme),
                          borderColor: getPriorityColor(p, theme)
                        }
                      ]}
                      onPress={() => updateField('priority', p)}
                    >
                      <Text style={[
                        styles.priorityText,
                        formData.priority === p && styles.priorityTextActive
                      ]}>
                        {p.charAt(0).toUpperCase() + p.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </FormField>
            )}

            {/* Repeat — tasks only (birthdays use the yearly toggle above). */}
            {isTask && (
              <FormField label="Repeat">
                <View style={styles.recurringRow}>
                  {RECURRING_OPTIONS.map(option => (
                    <TouchableOpacity
                      key={option.value}
                      style={[
                        styles.recurringBtn,
                        formData.recurring === option.value && styles.recurringBtnActive
                      ]}
                      onPress={() => updateField('recurring', option.value)}
                    >
                      <Icon
                        name={option.icon}
                        size={16}
                        color={formData.recurring === option.value ? theme.colors.textPrimary : theme.colors.textTertiary}
                      />
                      <Text style={[
                        styles.recurringText,
                        formData.recurring === option.value && styles.recurringTextActive
                      ]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </FormField>
            )}

            </ScrollView>

            {/* Footer — pinned below the scroll so Save/Cancel (and Delete when
                editing) are always reachable however tall the form gets. */}
            <View style={styles.footer}>
              <View style={styles.buttons}>
                <TouchableOpacity style={[styles.btn, styles.cancelBtn]} onPress={handleClose}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, styles.saveBtn]} onPress={handleSave}>
                  <Text style={styles.saveText}>Save {copy.label}</Text>
                </TouchableOpacity>
              </View>

              {/* Delete Button - only show when editing */}
              {isEditing && onDelete && (
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => {
                    Alert.alert(
                      `Delete ${copy.label}?`,
                      `Are you sure you want to delete "${formData.title}"?`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete',
                          style: 'destructive',
                          onPress: () => {
                            onDelete(initialData.id);
                            handleClose();
                          }
                        }
                      ]
                    );
                  }}
                >
                  <Icon name="trash-can" size={20} color={theme.colors.accentError} />
                  <Text style={styles.deleteText}>Delete {copy.label}</Text>
                </TouchableOpacity>
              )}
            </View>
          </Reanimated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
};

const createStyles = (theme, insets) => StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end'
  },
  // Full-screen dim + tap target behind the sheet — tapping it closes; its
  // opacity is driven by sheetY (fades in on rise, lightens on drag-down).
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  // Fills the overlay so the sheet's percentage maxHeight resolves against the
  // full screen; the sheet itself is bottom-anchored. `box-none` lets taps in
  // the empty space above the sheet fall through to the backdrop (close).
  kav: {
    flex: 1,
    width: '100%',
    justifyContent: 'flex-end',
  },
  // Bounded bottom sheet: capped at 92% of the screen so a tall form scrolls
  // internally (header + footer stay pinned) and a short one (e.g. a birthday)
  // hugs the bottom — either way nothing is ever clipped.
  content: {
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    paddingBottom: insets.bottom || (Platform.OS === 'ios' ? 16 : 12),
    maxHeight: '92%',
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    // Soft lift off the dimmed backdrop.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
    elevation: 18,
  },
  // Fixed header (drag-to-close + swipe-to-switch-type gesture surface).
  sheetHeader: {
    paddingTop: 10,
    paddingBottom: 6,
  },
  grabHandle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: theme.colors.borderStrong || theme.colors.border,
    marginBottom: 14,
  },
  fieldsScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  fieldsContent: {
    paddingTop: 6,
    paddingBottom: 12,
  },
  footer: {
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  // Swipe affordance dots under the type selector.
  typeDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  typeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.border,
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: 0.2,
    marginBottom: 14,
    color: theme.colors.textPrimary
  },
  // Type selector (Task / Event / Birthday)
  typeSelector: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  typeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  typeBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.textTertiary,
  },
  typeBtnTextActive: {
    color: '#FFFFFF',
  },
  input: {
    height: 40, // Match "add a new task" height
    borderWidth: 0,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: theme.typography.body,
    color: theme.colors.inputText,
    backgroundColor: theme.colors.inputBackground,
  },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  projectInput: {
    flex: 1,
    marginRight: 10
  },
  projectBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  hint: {
    fontSize: theme.typography.body,
    color: theme.colors.textSecondary,
    marginTop: 4,
    fontStyle: 'italic'
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  tagInput: {
    flex: 1,
    marginRight: 10
  },
  addTagBtn: {
    backgroundColor: theme.colors.surfaceElevated,
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center'
  },
  suggestionsContainer: {
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: 10,
    marginTop: 8,
    marginBottom: 10,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
    maxHeight: 150,
  },
  suggestionsLabel: {
    fontSize: theme.typography.body,
    color: theme.colors.textTertiary,
    padding: 8,
    paddingBottom: 4,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  suggestionLast: {
    borderBottomWidth: 0,
  },
  suggestionText: {
    flex: 1,
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
    marginLeft: 8,
  },
  allTagsRow: {
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  allTagChip: {
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    marginRight: 8,
  },
  allTagText: {
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10
  },
  selectedTagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 8,
  },
  selectedTagText: {
    color: theme.colors.textPrimary,
    marginRight: 6,
    fontSize: theme.typography.body
  },
  descInput: {
    height: 80,
    textAlignVertical: 'top',
    paddingTop: 10,
  },
  // Colour swatches (events / birthdays)
  colorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  colorSwatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorSwatchActive: {
    borderColor: theme.colors.textPrimary,
  },
  // Reminder chips (birthdays)
  reminderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  reminderChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  reminderChipActive: {
    backgroundColor: theme.colors.surfaceElevated,
    borderColor: theme.colors.accentPrimary || theme.colors.accentSuccess,
  },
  reminderText: {
    fontSize: 13,
    color: theme.colors.textTertiary,
    fontWeight: '500',
  },
  reminderTextActive: {
    color: theme.colors.textPrimary,
    fontWeight: '600',
  },
  priorityRow: {
    flexDirection: 'row',
    marginBottom: 16
  },
  priorityBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
    marginHorizontal: 5,
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
  },
  priorityText: {
    color: theme.colors.textTertiary,
    fontWeight: '600',
    fontSize: theme.typography.body,
  },
  priorityTextActive: {
    color: theme.colors.textPrimary
  },
  recurringRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  recurringBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    gap: 6,
  },
  recurringBtnActive: {
    backgroundColor: theme.colors.surfaceElevated,
    borderColor: theme.colors.accentPrimary,
  },
  recurringText: {
    fontSize: 13,
    color: theme.colors.textTertiary,
    fontWeight: '500',
  },
  recurringTextActive: {
    color: theme.colors.textPrimary,
    fontWeight: '600',
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 0,
    marginBottom: 0
  },
  btn: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 5
  },
  // Cancel — quiet, recedes against the filled Save CTA.
  cancelBtn: {
    backgroundColor: 'transparent',
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  cancelText: {
    color: theme.colors.textSecondary,
    fontWeight: '600',
    fontSize: theme.typography.body,
  },
  // Save — filled primary-ink CTA so the commit action is unmistakable.
  saveBtn: {
    backgroundColor: theme.colors.textPrimary,
  },
  saveText: {
    color: theme.colors.background,
    fontWeight: '700',
    fontSize: theme.typography.body,
  },
  bottomPadding: {
    height: 60,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 10,
    marginBottom: 0,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.accentError,
    backgroundColor: 'transparent',
    gap: 8,
  },
  deleteText: {
    color: theme.colors.accentError,
    fontWeight: '600',
    fontSize: theme.typography.body,
  },
  datePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: theme.colors.border,
  },
  datePickerText: {
    flex: 1,
    fontSize: theme.typography.body,
    color: theme.colors.textPrimary,
    marginLeft: 10,
  },
  datePickerPlaceholder: {
    color: theme.colors.textPlaceholder,
    fontStyle: 'italic',
  },
  clearDateBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  clearDateText: {
    fontSize: 12,
    color: theme.colors.accentError,
  },
  appointmentToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.surfaceHighlight,
    borderRadius: 8,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: theme.colors.textTertiary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  checkboxChecked: {
    backgroundColor: theme.colors.accentSuccess,
    borderColor: theme.colors.accentSuccess,
  },
  appointmentText: {
    flex: 1,
    fontSize: 14,
    color: theme.colors.textPrimary,
    fontWeight: '500',
  },
  appointmentIcon: {
    marginLeft: 8,
  },
});
