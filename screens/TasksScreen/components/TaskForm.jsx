import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Platform,
  StyleSheet,
  Alert,
  ScrollView,
  Keyboard,
  KeyboardAvoidingView,
  Switch,
  LayoutAnimation,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../context/ThemeContext';
import { useServer } from '../../../context/ServerContext';
import { FormField } from './FormField';
import EdgeSwipePage from '../../TurtleScreen/components/EdgeSwipePage';
import { DatePickerModal } from './DatePickerModal';
import { WheelTimePicker } from './WheelTimePicker';
import { normalizeTags, getPriorityColor } from '../utils/taskHelpers';
import ParticipantPicker from './ParticipantPicker';
import { impactHaptic, notifyHaptic } from '../../../utils/haptics';
import {
  PRIORITIES,
  ITEM_TYPES,
  ITEM_TYPE_DEFAULT_COLOR,
  OCCASION_COLORS,
  REMINDER_OPTIONS,
} from '../utils/constants';

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

// Reminder lead-time presets (minutes before due). Multi-select; tasks + events.
const REMINDER_PRESETS = [
  { min: 0, label: 'At time' },
  { min: 15, label: '15 min' },
  { min: 60, label: '1 hour' },
  { min: 120, label: '2 hours' },
  { min: 1440, label: '1 day' },
];
const REMINDER_PRESET_MINS = new Set(REMINDER_PRESETS.map((p) => p.min));

// Human label for any lead (minutes before due) — used for CUSTOM reminder
// chips (times the user entered that aren't a preset). Whole days/hours read
// naturally; everything else stays in minutes. `min` is a lead already stored
// in the same units the notification pipeline consumes, so custom values need
// no conversion beyond this display formatting.
const formatLead = (min) => {
  if (min <= 0) return 'At time';
  if (min % 1440 === 0) { const d = min / 1440; return `${d} day${d === 1 ? '' : 's'} before`; }
  if (min % 60 === 0) { const h = min / 60; return `${h} hour${h === 1 ? '' : 's'} before`; }
  return `${min} min before`;
};

// End time is stored as a `duration` (minutes from `time`), matching the web
// app + the server's `duration` column. The form derives the wall-clock end
// from time + duration for display, and converts a picked end back into a
// duration on save. null/≤0 duration ⇒ "no end time", rendered as a pin.
const hhmmToMinutes = (t) => {
  if (!t || typeof t !== 'string') return -1;
  const [h, m] = t.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return -1;
  return h * 60 + m;
};
const addMinutesToHHMM = (t, mins) => {
  const base = hhmmToMinutes(t);
  if (base < 0) return '';
  // Clamp to 23:59 — the picker can't represent 24:00, and a same-day end is
  // all the calendar block needs.
  const total = Math.min(base + mins, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
const minutesBetween = (start, end) => {
  const s = hhmmToMinutes(start);
  const e = hhmmToMinutes(end);
  if (s < 0 || e < 0) return 0;
  return e - s;
};
const formatDurationShort = (mins) => {
  if (!Number.isFinite(mins) || mins <= 0) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
};

const blankForm = (itemType = 'task') => ({
  title: '', description: '', priority: 'medium', completed: false,
  project: '', dueDate: '', time: '', duration: null, tags: [], involvedUsers: [],
  // Optional link to an existing note ({ id, title }); packed into meta on save.
  linkedNote: null,
  // New tasks/events arm an "At time" reminder by default (lead 0) so a due
  // date alone notifies without remembering to tap a chip. The user can clear
  // it per item. Birthdays use their own meta.reminders defaults instead.
  taskReminders: { leads: (itemType === 'task' || itemType === 'event') ? [0] : [], sms: false, involved: false },
  recurring: 'none',
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
  // Board/project name to pre-fill on a NEW task (e.g. opened from a board's
  // conversation "+" — the task should land pre-associated with that board).
  // Ignored when editing or for non-task types (events/birthdays have no board).
  // Still shown/editable via the Board chip — this only seeds the initial value.
  initialProject = null,
  // True when this form is mounted somewhere that can only persist a plain
  // task (e.g. a board conversation composer, which saves via a task-only
  // endpoint that doesn't store item_type/meta — see BoardTimeline). Hides
  // the type selector + swipe-affordance dots, disables the header's
  // swipe-to-cycle-type gesture, and keeps itemType pinned to 'task' so an
  // Event/Birthday can never be silently saved as (and lose the data of) a
  // plain task.
  lockType = false,
  projects,
  allTags,
  onAddProject,
  onCollectTags,
  // Render as an in-tree EdgeSwipePage OVERLAY instead of its own native Modal.
  // Required when mounted inside another page/Modal (e.g. BoardTimeline, itself
  // an EdgeSwipePage overlay): iOS won't present a second sibling Modal over an
  // open one, so a nested form must live in the parent's tree. Top-level callers
  // (Tasks screen "+") leave this false → the Modal form.
  asOverlay = false,
}) => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { api } = useServer();
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
  // Note-linking: search an existing note to attach to the task. Notes are
  // fetched lazily the first time the search opens.
  const [notes, setNotes] = useState([]);
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [noteSearchOpen, setNoteSearchOpen] = useState(false);
  const [noteQuery, setNoteQuery] = useState('');
  const loadNotesOnce = useCallback(async () => {
    if (notesLoaded) return;
    try {
      const res = await api.get('/turtle/notes?limit=200');
      if (res?.success && Array.isArray(res.notes)) setNotes(res.notes);
    } catch (e) { /* offline / no notes — the picker just shows empty */ }
    setNotesLoaded(true);
  }, [api, notesLoaded]);
  // A note's display title = its first non-empty line, trimmed to a chip length.
  const noteTitleOf = (n) => {
    const s = (n?.content || '').trim();
    if (!s) return 'Untitled note';
    const first = (s.split('\n')[0] || '').trim() || 'Untitled note';
    return first.length > 60 ? `${first.slice(0, 60)}…` : first;
  };
  const noteResults = useMemo(() => {
    const q = noteQuery.trim().toLowerCase();
    const list = q
      ? notes.filter((n) => `${n.content || ''} ${n.description || ''}`.toLowerCase().includes(q))
      : notes;
    return list.slice(0, 8);
  }, [notes, noteQuery]);

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);
  // Progressive disclosure: a NEW item shows only the essentials (title,
  // board, date, time) until "More options" is tapped; EDITING opens expanded
  // so no existing value ever looks lost.
  const [showMore, setShowMore] = useState(false);
  // Inline board picker under the Board row (replaces the old Alert picker —
  // Android caps Alert at 3 buttons, silently dropping the rest).
  const [boardListOpen, setBoardListOpen] = useState(false);
  // Inline "name a new board" input under the board row (opened from the
  // board list's "New board…" chip).
  const [newBoardOpen, setNewBoardOpen] = useState(false);
  // Inline Low/Med/High picker under the essentials chip row (opened by the
  // Priority chip — replaces the old silent tap-to-cycle behaviour).
  const [priorityListOpen, setPriorityListOpen] = useState(false);
  // Custom reminder lead-time entry (tasks/events): the "+ Custom" row.
  const [customReminderOpen, setCustomReminderOpen] = useState(false);
  const [customReminderValue, setCustomReminderValue] = useState('');
  const [customReminderUnit, setCustomReminderUnit] = useState('min'); // 'min' | 'hour' | 'day'
  // True while a save is committing — blocks double-taps (see handleSave).
  const savingRef = useRef(false);

  // Calendar-partner user IDs (people I share my whole calendar with, via
  // /api/shares 'all-tasks' partnersOut). A NEW task pre-fills its "People
  // involved" set with these by default — in a couples/family pond the partner
  // is almost always involved, so it saves a tap. Fetched once on mount so
  // they're ready before the form is opened. Editing keeps the task's own
  // stored involvedUsers untouched (a partner removed on purpose stays removed).
  const [partnerIds, setPartnerIds] = useState([]);
  // Mirror of partnerIds read by the hydrate effect at open-time, so that
  // effect needn't depend on partnerIds (which would re-run it — re-springing
  // the sheet + clobbering edits — every time /shares resolves).
  const partnerIdsRef = useRef([]);
  // Set once the user edits the involved set on THIS open, so the partner
  // auto-seed never clobbers a deliberate change (incl. clearing it).
  const involvedTouched = useRef(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/shares')
      .then((r) => {
        if (cancelled) return;
        const ids = Array.isArray(r?.partnersOut)
          ? r.partnersOut.map((p) => p.withUserId).filter(Boolean)
          : [];
        partnerIdsRef.current = ids;
        setPartnerIds(ids);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api]);

  const toggleShowMore = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowMore(prev => !prev);
  };

  const titleInputRef = useRef(null);
  const descInputRef = useRef(null);
  const isEditing = !!initialData?.id;
  const itemType = formData.itemType || 'task';
  const isTask = itemType === 'task';
  const isEvent = itemType === 'event';
  const isBirthday = itemType === 'birthday';
  const copy = TYPE_COPY[itemType] || TYPE_COPY.task;
  // "At time" reminder (lead 0) — read by both the essentials' collapsed
  // quick toggle and to keep it visually in sync with the expanded preset.
  const remindAtTime = ((formData.taskReminders && formData.taskReminders.leads) || []).includes(0);

  useEffect(() => {
    if (visible) {
      // Fresh open — the involved set hasn't been hand-edited yet, so the
      // partner auto-seed is allowed to fill it.
      involvedTouched.current = false;
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
          involvedUsers: Array.isArray(initialData.involvedUsers) ? initialData.involvedUsers : [],
          taskReminders: (initialData.reminders && typeof initialData.reminders === 'object' && !Array.isArray(initialData.reminders))
            ? {
                leads: Array.isArray(initialData.reminders.leads) ? initialData.reminders.leads : [],
                sms: !!initialData.reminders.sms,
                involved: !!initialData.reminders.involved,
              }
            : { leads: [], sms: false, involved: false },
          isAppointment: !!isAppointment,
          recurring: initialData.recurring || 'none',
          itemType: type,
          color: meta.color || ITEM_TYPE_DEFAULT_COLOR[type] || null,
          guests: Array.isArray(meta.guests) ? meta.guests : [],
          reminders: Array.isArray(meta.reminders) ? meta.reminders : (type === 'birthday' ? ['1-week', 'same-day'] : []),
          yearly: meta.yearly !== false,
          linkedNote: (meta.linkedNote && meta.linkedNote.id) ? meta.linkedNote : null,
        });
      } else {
        // NEW task: pre-fill "People involved" with the partner accounts (if
        // already loaded — otherwise the guard effect below seeds them once the
        // /shares fetch lands, as long as the set is still untouched). Only for
        // TASKS — events/birthdays have no "people involved".
        const newType = initialType || 'task';
        setFormData({
          ...blankForm(newType),
          dueDate: initialDate || '',
          project: newType === 'task' ? (initialProject || '') : '',
          involvedUsers: newType === 'task' ? partnerIdsRef.current : [],
        });
      }
      setTagInput('');
      setGuestInput('');
      setShowSuggestions(false);
      setNoteSearchOpen(false);
      setNoteQuery('');
      setShowMore(!!initialData);
      setBoardListOpen(false);
      setNewBoardOpen(false);
      savingRef.current = false;
    }
  }, [visible, initialData, initialType, initialDate, initialProject]);

  // Cold-start seed: if the partner list resolves AFTER a fresh new-task form
  // is already open, fill the still-empty, untouched involved set with the
  // partners then. Guards (untouched + empty) keep it from ever overwriting a
  // choice the user has started making, or an edited task's own participants.
  useEffect(() => {
    if (!visible || initialData || involvedTouched.current || partnerIds.length === 0) return;
    setFormData(prev => (
      (prev.itemType === 'task' && Array.isArray(prev.involvedUsers) && prev.involvedUsers.length === 0)
        ? { ...prev, involvedUsers: partnerIds }
        : prev
    ));
  }, [visible, initialData, partnerIds]);

  const handleClose = () => {
    Keyboard.dismiss();
    onClose?.();
  };

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
    // Re-entrancy guard: without the old blocking "Saved" alert, a double-tap
    // (or a tap during the board-creation round-trip below) would run this
    // twice and create duplicate items. Reset on the next open.
    if (savingRef.current) return;
    savingRef.current = true;

    Keyboard.dismiss();

    const type = formData.itemType || 'task';
    const typeLabel = (TYPE_COPY[type] || TYPE_COPY.task).label;

    if (!formData.title.trim()) {
      Alert.alert('Error', `${typeLabel} ${type === 'birthday' ? 'name' : 'title'} is required`);
      savingRef.current = false;
      return;
    }

    // Events and birthdays are calendar occasions — they must have a date.
    if ((type === 'event' || type === 'birthday') && !formData.dueDate) {
      Alert.alert('Pick a date', `Choose a date for this ${type}.`);
      savingRef.current = false;
      return;
    }

    if (type === 'task' && formData.project && !projects.includes(formData.project)) {
      const ok = await onAddProject(formData.project);
      if (ok === false) {
        // Board creation failed (addProject already alerted + rolled back) —
        // keep the card open so nothing saves against a board that vanished.
        savingRef.current = false;
        return;
      }
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
      finalTask.duration = null;
    } else {
      // Plain task: strip the event/birthday flat fields from meta, but PRESERVE
      // per-occurrence completion (recurring tasks store ticked occurrence dates
      // in meta.completedDates) — editing a task must not wipe its ticks.
      const prevMeta = (initialData && initialData.meta && typeof initialData.meta === 'object') ? initialData.meta : {};
      finalTask.meta = Array.isArray(prevMeta.completedDates)
        ? { completedDates: prevMeta.completedDates }
        : {};
      // Carry the linked-note reference (if any) inside meta.
      if (formData.linkedNote && formData.linkedNote.id) finalTask.meta.linkedNote = formData.linkedNote;
    }

    // Strip the UI-only flat fields — they now live inside meta (or are task-only).
    delete finalTask.isAppointment;
    delete finalTask.color;
    delete finalTask.guests;
    delete finalTask.reminders;
    delete finalTask.yearly;
    delete finalTask.linkedNote; // now inside meta (tasks only)
    // Task/event reminder config → the tasks.reminders column (separate from
    // the birthday meta.reminders packed above). The delete above removed the
    // stale spread, so re-set it from taskReminders. Birthdays don't carry it.
    if (type === 'task' || type === 'event') finalTask.reminders = formData.taskReminders || { leads: [], sms: false, involved: false };
    delete finalTask.taskReminders;

    // Optimistic commit + instant dismissal — a success buzz replaces the old
    // blocking "Saved [OK]" alert, so a quick add is typed → saved → gone.
    onSave(finalTask);
    notifyHaptic('success');
    handleClose();
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

  // Toggle the inline board list under the Board row. An in-card list (not an
  // Alert): Android caps Alert.alert at 3 buttons and silently drops the rest,
  // which would make most boards — and "New board…" — unreachable.
  const selectProject = () => {
    Keyboard.dismiss();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setBoardListOpen(prev => !prev);
    setNewBoardOpen(false);
  };
  const pickBoard = (name) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setNewBoardOpen(false);
    setBoardListOpen(false);
    setFormData(prev => ({ ...prev, project: name }));
  };
  const openNewBoard = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setBoardListOpen(false);
    setFormData(prev => ({ ...prev, project: '' }));
    setNewBoardOpen(true);
  };

  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Toggle a reminder lead time (minutes before due) on/off in
  // taskReminders.leads. Shared by the essentials' collapsed "remind at due
  // time" quick toggle (lead 0) AND the expanded Reminders preset chips
  // below — same state, same setter, no parallel reminder state.
  const toggleReminderLead = (min) => {
    const cur = (formData.taskReminders && formData.taskReminders.leads) || [];
    const next = cur.includes(min)
      ? cur.filter((x) => x !== min)
      : [...cur, min].sort((a, b) => a - b);
    updateField('taskReminders', { ...(formData.taskReminders || {}), leads: next });
  };

  // Toggle the inline Low/Med/High priority selector under the essentials chip
  // row (mirrors the Board picker's in-card list — one obvious control instead
  // of a chip whose tap silently cycled the value with no on-screen hint).
  const togglePriorityList = () => {
    Keyboard.dismiss();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setPriorityListOpen(prev => !prev);
  };
  const pickPriority = (p) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setPriorityListOpen(false);
    updateField('priority', p);
  };

  // Add a custom reminder lead time (tasks/events). The picked value+unit is
  // converted to minutes-before-due — the exact unit the notification pipeline
  // already consumes — deduped, clamped to 4 weeks so a typo can't schedule a
  // reminder years out, then merged into the sorted leads list.
  const addCustomReminder = () => {
    const n = parseInt(customReminderValue, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    const factor = customReminderUnit === 'day' ? 1440 : customReminderUnit === 'hour' ? 60 : 1;
    const mins = Math.min(n * factor, 40320); // 40320 min = 4 weeks
    const cur = (formData.taskReminders && formData.taskReminders.leads) || [];
    if (!cur.includes(mins)) {
      updateField('taskReminders', { ...(formData.taskReminders || {}), leads: [...cur, mins].sort((a, b) => a - b) });
    }
    setCustomReminderValue('');
    setCustomReminderOpen(false);
  };

  // Switch the item kind in-place, keeping the title/date the user already
  // typed. This is the "you can still change it to a task or event" affordance.
  // The board UI (list / new-board input, tasks-only) folds shut so its
  // auto-focused input can't pop the keyboard from a type it doesn't exist on.
  const setItemType = (type) => {
    if (lockType) return; // locked callers (BoardTimeline) never change type
    if (type !== 'task') {
      setBoardListOpen(false);
      setNewBoardOpen(false);
    }
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

  // Keep the pinned Save CTA in lock-step with handleSave: occasions require
  // both their title/name and calendar date, while plain tasks may stay undated.
  const requiresDate = itemType === 'event' || itemType === 'birthday';
  const canSave = !!formData.title.trim() && (!requiresDate || !!formData.dueDate);

  return (
    <EdgeSwipePage visible={visible} onClose={handleClose} overlay={asOverlay} edgeZone={110}>
      {/* Instagram-style pushed PAGE: EdgeSwipePage slides this full-screen page
          in from the right and owns the left-edge back-swipe. GestureHandlerRootView
          is kept because a Modal renders outside the app's root, so any RNGH
          gesture inside the page needs a root to receive touches. */}
      <GestureHandlerRootView style={styles.page}>
        {/* KeyboardAvoidingView lifts the fields on the OS keyboard curve
            — 'padding' on iOS, 'height' on Android. A plain ScrollView holds the
            fields; we deliberately do NOT also use KeyboardAwareScrollView,
            because stacking the two made them fight (double-shift/overshoot). */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.kav}
        >
          <View style={styles.pageBody}>
            {/* Fixed header bar — matches the app's page header (Boards /
                Friends): a back chevron INLINE with the title on one row, a
                quiet helper subtitle, and a hairline divider. Left-edge swipe
                also goes back (EdgeSwipePage, wide edgeZone). Stays put while
                the fields scroll beneath it, so "where am I / how do I leave"
                is always answered — clarity for new users. */}
            <View style={styles.headerBar}>
              <TouchableOpacity
                onPress={handleClose}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={styles.headerBackBtn}
                accessibilityRole="button"
                accessibilityLabel="Back"
              >
                <Icon name="chevron-left" size={28} color={theme.colors.textPrimary} />
              </TouchableOpacity>
              <View style={styles.headerTitleCol}>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  {isEditing ? `Edit ${copy.label}` : `New ${copy.label}`}
                </Text>
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  {isEditing ? 'Update the details below' : 'Add the essentials — the rest is optional'}
                </Text>
              </View>
            </View>

            <ScrollView
              style={styles.fieldsScroll}
              contentContainerStyle={styles.fieldsContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              showsVerticalScrollIndicator={true}
              // iOS otherwise floats the vertical indicator on the WRONG side /
              // inset; pinning a 1px right inset forces it to the true right
              // edge. indicatorStyle keeps it visible on the black theme.
              scrollIndicatorInsets={{ right: 1 }}
              indicatorStyle={theme.mode === 'dark' ? 'white' : 'black'}
            >
            {/* Type selector — tap a kind to move between Task / Event /
                Birthday. Hidden entirely when lockType (e.g. the board
                composer): that caller only ever persists a plain task, so
                offering Event/Birthday here would silently lose the type +
                meta on save (see BoardTimeline). Sits at the top of the
                scrolling fields, just under the fixed header. */}
            {!lockType && (
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
            )}

            {/* ── Essentials — the fast path. Title first, then the two facts
                that place the item on the calendar (date/time) and, for tasks,
                a compact board picker that's happy to stay "Choose later".
                Everything else lives behind "More options" below. */}
            {/* Title is the hero field — the one thing every create/edit is
                really about. Large + bold + borderless, no "Title" label, so it
                reads as the headline of the sheet (iOS Reminders / Things
                pattern) and every secondary field below stays quiet by
                contrast. */}
            <TextInput
              ref={titleInputRef}
              style={styles.titleInput}
              placeholder={copy.titlePlaceholder}
              placeholderTextColor={theme.colors.textPlaceholder}
              value={formData.title}
              onChangeText={text => updateField('title', text)}
              returnKeyType="done"
            />

            {/* Essentials — one-tap chips for the most common fields. Date +
                Time always show (Time hidden for birthdays, which are
                all-day); Priority + Board are tasks-only. Each chip wires
                straight into TaskForm's existing handlers — no parallel
                state. */}
            <View style={styles.chipRow}>
              <Chip
                theme={theme} icon="calendar-blank-outline"
                label={formData.dueDate ? formatDateLabel(formData.dueDate) : (copy.dateLabel || 'Date')}
                active={!!formData.dueDate}
                onPress={() => setShowDatePicker(true)}
                onClear={(isTask && formData.dueDate) ? () => updateField('dueDate', '') : null}
              />
              {!isBirthday && (
                <Chip
                  theme={theme} icon="clock-outline"
                  label={formData.time ? formatTime12(formData.time) : 'Time'}
                  active={!!formData.time}
                  onPress={() => setShowTimePicker(true)}
                  // Clearing the start time drops the end time too — an end
                  // with no start has nothing to anchor to (same behaviour as
                  // the old standalone "Clear time" row).
                  onClear={formData.time ? () => setFormData(prev => ({ ...prev, time: '', duration: null })) : null}
                />
              )}
              {isTask && (
                <Chip
                  theme={theme} icon="flag-variant-outline"
                  label={formData.priority.charAt(0).toUpperCase() + formData.priority.slice(1)}
                  active tint={getPriorityColor(formData.priority, theme)}
                  onPress={togglePriorityList}
                />
              )}
              {isTask && (
                <Chip
                  theme={theme} icon="folder-outline"
                  label={formData.project || 'Board'}
                  active={!!formData.project}
                  onPress={selectProject}
                  onClear={formData.project ? () => updateField('project', '') : null}
                />
              )}
            </View>

            {/* Inline board list — toggled open/closed by the Board chip
                above (selectProject/boardListOpen). Unchanged from the old
                Board row: every board as a chip (scales past Android's
                3-button Alert cap), plus "choose later" + new-board input. */}
            {isTask && boardListOpen && (
              <View style={styles.boardList}>
                <TouchableOpacity
                  style={[styles.boardChip, !formData.project && styles.boardChipActive]}
                  onPress={() => pickBoard('')}
                >
                  <Text style={[styles.boardChipText, !formData.project && styles.boardChipTextActive]}>
                    No board — later
                  </Text>
                </TouchableOpacity>
                {projects.map(p => (
                  <TouchableOpacity
                    key={p}
                    style={[styles.boardChip, formData.project === p && styles.boardChipActive]}
                    onPress={() => pickBoard(p)}
                  >
                    <Text style={[styles.boardChipText, formData.project === p && styles.boardChipTextActive]}>
                      {p}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={styles.boardChip} onPress={openNewBoard}>
                  <Icon name="plus" size={13} color={theme.colors.accentInfo} />
                  <Text style={[styles.boardChipText, { color: theme.colors.accentInfo }]}>New board</Text>
                </TouchableOpacity>
              </View>
            )}
            {isTask && newBoardOpen && (
              <View style={[styles.projectRow, { marginTop: 8 }]}>
                <TextInput
                  style={[styles.input, styles.projectInput]}
                  placeholder="New board name..."
                  placeholderTextColor={theme.colors.textPlaceholder}
                  value={formData.project}
                  onChangeText={text => updateField('project', text)}
                  autoFocus
                  returnKeyType="done"
                />
                <TouchableOpacity
                  style={styles.projectBtn}
                  onPress={() => { setNewBoardOpen(false); Keyboard.dismiss(); }}
                  accessibilityLabel="Done naming board"
                >
                  <Icon name="check" size={20} color={theme.colors.textPrimary} />
                </TouchableOpacity>
              </View>
            )}
            {isTask && !!formData.project && !projects.includes(formData.project) && (
              <Text style={styles.hint}>Will create new board "{formData.project}"</Text>
            )}

            {/* Inline priority picker — opened by the Priority chip above. The
                single source of truth for priority now (the duplicate expanded
                Priority row was removed). */}
            {isTask && priorityListOpen && (
              <View style={[styles.priorityRow, { marginTop: 10, marginBottom: 0 }]}>
                {PRIORITIES.map(p => (
                  <TouchableOpacity
                    key={p}
                    style={[
                      styles.priorityBtn,
                      formData.priority === p && {
                        backgroundColor: getPriorityColor(p, theme),
                        borderColor: getPriorityColor(p, theme),
                      },
                    ]}
                    onPress={() => pickPriority(p)}
                  >
                    <Text style={[
                      styles.priorityText,
                      formData.priority === p && styles.priorityTextActive,
                    ]}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Remind-at-due-time — collapsed quick toggle (tasks/events;
                birthdays have their own all-day reminder block further down).
                Derived from taskReminders.leads (lead 0 = "at time") and
                toggled via toggleReminderLead — the SAME setter the expanded
                "At time" preset chip below uses, so collapsed + expanded stay
                in sync with no parallel reminder state. */}
            {!isBirthday && (
              <TouchableOpacity
                style={styles.qReminderRow}
                activeOpacity={0.7}
                onPress={() => toggleReminderLead(0)}
                accessibilityRole="button"
                accessibilityLabel={remindAtTime ? 'Reminder at due time on' : 'Reminder at due time off'}
              >
                <Icon
                  name={remindAtTime ? 'bell-ring-outline' : 'bell-off-outline'}
                  size={18}
                  color={remindAtTime ? theme.colors.accentInfo : theme.colors.textMuted}
                />
                <Text style={styles.qReminderText}>Remind me at the due time</Text>
                <View style={{ flex: 1 }} />
                <View style={[styles.switch, remindAtTime && styles.switchOn]}>
                  <View style={[styles.knob, remindAtTime && styles.knobOn]} />
                </View>
              </TouchableOpacity>
            )}

            {/* People involved — surfaced into the ESSENTIALS (above the fold)
                whenever the task already has people, so the partner accounts
                auto-added on a new task are VISIBLE on create, not hidden under
                "More options". Only while collapsed: once expanded, the full
                copy inside the fold takes over (this hides to avoid a dupe).
                Solo ponds (no partners → empty set) never see it here, so the
                quick-add card stays minimal. */}
            {isTask && !showMore && (formData.involvedUsers?.length > 0) && (
              <FormField label="People involved">
                <ParticipantPicker
                  selected={formData.involvedUsers || []}
                  onChange={(ids) => { involvedTouched.current = true; updateField('involvedUsers', ids); }}
                />
              </FormField>
            )}

            {/* ── More options — everything beyond the fast path, folded away
                so a quick add is three taps. Expanded by default when EDITING
                (nothing should look lost). */}
            <TouchableOpacity
              style={styles.moreToggle}
              onPress={toggleShowMore}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={showMore ? 'Hide extra options' : 'Show more options'}
            >
              <Text style={styles.moreToggleText}>{showMore ? 'Fewer options' : 'More options'}</Text>
              <Icon name={showMore ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.accentInfo} />
            </TouchableOpacity>

            {showMore && (<>

            {/* ── DETAILS — what the item is: description, linked note, tags,
                and (for events/birthdays) its calendar colour. */}
            <GroupHeader theme={theme} label="Details" />

            {/* Description — moved from the essentials fast path into the
                expanded block (a pure relocation; same field + handler). */}
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
                  textAlignVertical="top"
                />
              </FormField>
            )}

            {/* Linked note — search an existing note and attach it to the task.
                Shows a "Linked to note" chip once one is picked. Moved from
                the essentials fast path into the expanded block. */}
            {isTask && (
              <FormField label="Linked note">
                {formData.linkedNote ? (
                  <View style={styles.linkedNoteChip}>
                    <Icon name="link-variant" size={16} color={theme.colors.accentInfo} />
                    <Text style={styles.linkedNoteText} numberOfLines={1}>
                      Linked to note: {formData.linkedNote.title}
                    </Text>
                    <TouchableOpacity
                      onPress={() => updateField('linkedNote', null)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel="Unlink note"
                    >
                      <Icon name="close-circle" size={18} color={theme.colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                ) : !noteSearchOpen ? (
                  <TouchableOpacity
                    style={styles.linkNoteBtn}
                    onPress={() => { setNoteSearchOpen(true); loadNotesOnce(); }}
                    activeOpacity={0.7}
                  >
                    <Icon name="link-plus" size={18} color={theme.colors.accentInfo} />
                    <Text style={styles.linkNoteBtnText}>Link a note</Text>
                  </TouchableOpacity>
                ) : (
                  <View>
                    <View style={styles.tagRow}>
                      <TextInput
                        style={[styles.input, styles.tagInput]}
                        placeholder="Search notes..."
                        placeholderTextColor={theme.colors.textPlaceholder}
                        value={noteQuery}
                        onChangeText={setNoteQuery}
                        autoFocus
                        returnKeyType="search"
                      />
                      <TouchableOpacity
                        style={styles.addTagBtn}
                        onPress={() => { setNoteSearchOpen(false); setNoteQuery(''); }}
                        accessibilityLabel="Close note search"
                      >
                        <Icon name="close" size={20} color={theme.colors.textPrimary} />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.suggestionsContainer}>
                      <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                        {noteResults.length === 0 ? (
                          <Text style={styles.noteEmptyText}>
                            {notesLoaded ? 'No matching notes' : 'Loading notes…'}
                          </Text>
                        ) : noteResults.map((n) => (
                          <TouchableOpacity
                            key={n.id}
                            style={styles.suggestionItem}
                            onPress={() => {
                              updateField('linkedNote', { id: n.id, title: noteTitleOf(n) });
                              setNoteSearchOpen(false);
                              setNoteQuery('');
                              Keyboard.dismiss();
                            }}
                          >
                            <Icon
                              name={n.type === 'todo' ? 'checkbox-marked-circle-outline' : 'note-text-outline'}
                              size={14}
                              color={theme.colors.textPrimary}
                            />
                            <Text style={styles.suggestionText} numberOfLines={1}>{noteTitleOf(n)}</Text>
                            <Icon name="link-variant" size={16} color={theme.colors.accentInfo} />
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  </View>
                )}
              </FormField>
            )}

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

            {/* Colour — events + birthdays. Sits with the DETAILS group as an
                appearance choice. */}
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

            {/* ── WHEN — when it happens and how it repeats / reminds. */}
            <GroupHeader theme={theme} label="When" />

            {/* End time — appears only once a start time exists (an end is
                meaningless without one). Stored as `duration` (end − start in
                minutes); the calendar reads that to size the block. */}
            {!isBirthday && formData.time && (
              <FormField label="End time (optional)">
                <TouchableOpacity
                  style={styles.datePickerButton}
                  onPress={() => setShowEndTimePicker(true)}
                >
                  <Icon name="clock-check-outline" size={20} color={formData.duration > 0 ? theme.colors.accentInfo : theme.colors.textSecondary} />
                  <Text style={[
                    styles.datePickerText,
                    !(formData.duration > 0) && styles.datePickerPlaceholder
                  ]}>
                    {formData.duration > 0
                      ? `${formatTime12(addMinutesToHHMM(formData.time, formData.duration))}  ·  ${formatDurationShort(formData.duration)}`
                      : 'Set an end time...'}
                  </Text>
                  <Icon name="chevron-right" size={20} color={theme.colors.textTertiary} />
                </TouchableOpacity>

                {formData.duration > 0 && (
                  <TouchableOpacity
                    style={styles.clearDateBtn}
                    onPress={() => updateField('duration', null)}
                  >
                    <Text style={styles.clearDateText}>Clear end time</Text>
                  </TouchableOpacity>
                )}
              </FormField>
            )}

            {/* Repeat — tasks only (birthdays use the yearly toggle below). */}
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

            {/* Reminders — tasks + events. Lead times before due; push always,
                SMS opt-in, to the owner and (optionally) involved parties.
                Birthdays use their own all-day reminder block below. */}
            {(isTask || isEvent) && (
              <FormField label="Reminders">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {REMINDER_PRESETS.map((p) => {
                    const leads = (formData.taskReminders && formData.taskReminders.leads) || [];
                    const on = leads.includes(p.min);
                    return (
                      <TouchableOpacity
                        key={p.min}
                        onPress={() => toggleReminderLead(p.min)}
                        style={[styles.remPill, on && styles.remPillActive]}
                      >
                        <Text style={[styles.remPillText, on && styles.remPillTextActive]}>
                          {p.label === 'At time' ? 'At time' : `${p.label} before`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                  {/* Custom lead-time chips — any active lead that isn't a
                      preset. Always "on"; tapping removes it. */}
                  {((formData.taskReminders && formData.taskReminders.leads) || [])
                    .filter((m) => !REMINDER_PRESET_MINS.has(m))
                    .map((m) => (
                      <TouchableOpacity
                        key={`custom-${m}`}
                        onPress={() => {
                          const cur = (formData.taskReminders && formData.taskReminders.leads) || [];
                          updateField('taskReminders', { ...(formData.taskReminders || {}), leads: cur.filter((x) => x !== m) });
                        }}
                        style={[styles.remPill, styles.remPillActive]}
                      >
                        <Text style={[styles.remPillText, styles.remPillTextActive]}>{formatLead(m)}</Text>
                        <Icon name="close" size={13} color={theme.colors.accentInfo} />
                      </TouchableOpacity>
                    ))}
                  {/* + Custom — reveal the value + unit entry row. */}
                  <TouchableOpacity
                    onPress={() => setCustomReminderOpen((o) => !o)}
                    style={[styles.remPill, { borderStyle: 'dashed' }, customReminderOpen && styles.remPillActive]}
                  >
                    <Icon name="plus" size={14} color={customReminderOpen ? theme.colors.accentInfo : theme.colors.textSecondary} />
                    <Text style={[styles.remPillText, customReminderOpen && styles.remPillTextActive]}>Custom</Text>
                  </TouchableOpacity>
                </View>

                {/* Custom entry row: number + unit selector + Add. */}
                {customReminderOpen && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
                    <TextInput
                      value={customReminderValue}
                      onChangeText={(t) => setCustomReminderValue(t.replace(/[^0-9]/g, ''))}
                      keyboardType="number-pad"
                      placeholder="30"
                      placeholderTextColor={theme.colors.textPlaceholder}
                      returnKeyType="done"
                      onSubmitEditing={addCustomReminder}
                      style={{
                        width: 64, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8,
                        borderWidth: 1, borderColor: theme.colors.border,
                        backgroundColor: theme.colors.surfaceElevated,
                        color: theme.colors.textPrimary, fontSize: 14, textAlign: 'center',
                      }}
                    />
                    <View style={{ flexDirection: 'row', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.border }}>
                      {['min', 'hour', 'day'].map((u) => {
                        const active = customReminderUnit === u;
                        return (
                          <TouchableOpacity
                            key={u}
                            onPress={() => setCustomReminderUnit(u)}
                            style={{
                              paddingVertical: 8, paddingHorizontal: 12,
                              backgroundColor: active ? theme.colors.accentInfo + '22' : theme.colors.surfaceElevated,
                            }}
                          >
                            <Text style={{ fontSize: 13, color: active ? theme.colors.accentInfo : theme.colors.textSecondary }}>
                              {u === 'min' ? 'min' : u === 'hour' ? 'hr' : 'day'}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <TouchableOpacity
                      onPress={addCustomReminder}
                      disabled={!customReminderValue}
                      style={{
                        paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8,
                        backgroundColor: customReminderValue ? theme.colors.accentInfo : theme.colors.surfaceElevated,
                        opacity: customReminderValue ? 1 : 0.5,
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '700', color: customReminderValue ? '#fff' : theme.colors.textMuted }}>Add</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {((formData.taskReminders && formData.taskReminders.leads) || []).length > 0 && (
                  <View style={{ marginTop: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}>
                      <Text style={{ fontSize: 14, color: theme.colors.textPrimary, flex: 1, paddingRight: 12 }}>
                        Also text me (SMS)
                      </Text>
                      <Switch
                        value={!!(formData.taskReminders && formData.taskReminders.sms)}
                        onValueChange={(v) => updateField('taskReminders', { ...(formData.taskReminders || {}), sms: v })}
                        trackColor={{ false: theme.colors.surfaceElevated, true: theme.colors.accentInfo }}
                        thumbColor="#fff"
                      />
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}>
                      <Text style={{ fontSize: 14, color: theme.colors.textPrimary, flex: 1, paddingRight: 12 }}>
                        Also notify people involved
                      </Text>
                      <Switch
                        value={!!(formData.taskReminders && formData.taskReminders.involved)}
                        onValueChange={(v) => updateField('taskReminders', { ...(formData.taskReminders || {}), involved: v })}
                        trackColor={{ false: theme.colors.surfaceElevated, true: theme.colors.accentInfo }}
                        thumbColor="#fff"
                      />
                    </View>
                  </View>
                )}
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

            {/* Appointment option — tasks only, when a due date is set. */}
            {formData.dueDate && isTask && (
              <FormField label="Scheduling">
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
              </FormField>
            )}

            {/* ── PEOPLE — who's attached: assignees (tasks) or guests (events). */}
            {(isTask || isEvent) && <GroupHeader theme={theme} label="People" />}

            {/* People involved — Tasks only. They see the task (view-only) and
                get an assignment notification when newly added. */}
            {isTask && (
              <FormField label="People involved">
                <ParticipantPicker
                  selected={formData.involvedUsers || []}
                  onChange={(ids) => { involvedTouched.current = true; updateField('involvedUsers', ids); }}
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

            </>)}

            {/* Time Picker Modal — outside the More fold: the essentials' Time
                row opens it, so it must stay mounted while collapsed. */}
            <WheelTimePicker
              visible={showTimePicker}
              onClose={() => setShowTimePicker(false)}
              onSelect={(time) => {
                updateField('time', time);
                setShowTimePicker(false);
              }}
              initialTime={formData.time}
            />

            {/* End Time Picker — picks a wall-clock end; we store the gap as a
                duration. An end at/before the start snaps to a 15-minute floor
                so the block is never zero/negative. Picker "Clear" → no end. */}
            <WheelTimePicker
              visible={showEndTimePicker}
              onClose={() => setShowEndTimePicker(false)}
              onSelect={(end) => {
                setShowEndTimePicker(false);
                if (!end) { updateField('duration', null); return; }
                const mins = minutesBetween(formData.time, end);
                updateField('duration', mins > 0 ? mins : 15);
              }}
              initialTime={
                formData.duration > 0
                  ? addMinutesToHHMM(formData.time, formData.duration)
                  : addMinutesToHHMM(formData.time, 60)
              }
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

            {/* Secondary actions at the END of the scroll. The primary Save is
                now a pinned footer (below), always reachable — so only the quiet
                Cancel link and the destructive Delete (edit only) live here. */}
            <View style={styles.actionsBlock}>
              {/* Cancel — a quiet text link, not a second big button (the back
                  chevron already dismisses). Keeps Save the single bold action. */}
              <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>

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

            </ScrollView>

            {/* Pinned primary action — sits below the scroll and rides above the
                keyboard (inside the KeyboardAvoidingView), so Save is reachable
                from anywhere in the form without scrolling to the end. Dimmed
                until the title has content; handleSave still guards + alerts. */}
            <View style={styles.footer}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.saveBtn, !canSave && styles.saveBtnDisabled]}
                disabled={!canSave}
                activeOpacity={0.85}
                onPressIn={() => { if (canSave) impactHaptic('medium'); }}
                onPress={handleSave}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSave }}
                accessibilityLabel={`${isEditing ? 'Save' : 'Add'} ${copy.label}`}
              >
                <Text style={styles.saveText}>
                  {isEditing ? `Save ${copy.label}` : `Add ${copy.label}`}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </EdgeSwipePage>
  );
};

// Chip primitive — the one-tap control used by the Essentials chip row
// (date/time/priority/board). Resolves styles via TaskForm's own
// `createStyles` factory; insets isn't relevant to chip rendering, so it's
// called with an empty object.
function Chip({ theme, icon, label, active, tint, onPress, onClear }) {
  const c = theme.colors;
  const color = tint || (active ? (c.accentInfo || '#4ADE80') : c.textSecondary);
  const styles = createStyles(theme, {});
  return (
    <TouchableOpacity
      style={[styles.chip, active && { borderColor: color }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Icon name={icon} size={15} color={color} />
      <Text style={[styles.chipText, active && { color: c.textPrimary }]} numberOfLines={1}>{label}</Text>
      {onClear && (
        <TouchableOpacity onPress={onClear} hitSlop={8} style={styles.chipClear}>
          <Icon name="close" size={13} color={c.textMuted} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

// Section header inside "More options" — anchors the eye so the expanded fields
// read as three short groups (Details / When / People) instead of one long wall.
function GroupHeader({ theme, label }) {
  const styles = createStyles(theme, {});
  return <Text style={styles.groupHeader}>{label}</Text>;
}

const createStyles = (theme, insets) => StyleSheet.create({
  // KeyboardAvoidingView wrapper for the full-screen page.
  kav: {
    flex: 1,
    width: '100%',
  },
  // Full-page container (EdgeSwipePage paints the background; we own the insets).
  page: {
    flex: 1,
  },
  // No horizontal padding here: the ScrollView must span the full page width so
  // its vertical scroll indicator sits at the true right edge, and the fixed
  // header bar owns its own insets. The 18px field inset lives on
  // fieldsContent + the header bar.
  pageBody: {
    flex: 1,
  },
  // Fixed page header bar — mirrors the app's standard page header (Boards /
  // Friends): chevron inline with the title on one row + hairline divider. Owns
  // the top safe-area inset (pageBody no longer does).
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: (insets.top || 0) + 6,
    paddingBottom: 10,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  headerBackBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -4,
  },
  headerTitleCol: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 12,
    color: theme.colors.textTertiary,
    marginTop: 1,
  },
  fieldsScroll: {
    flex: 1,
  },
  fieldsContent: {
    paddingTop: 6,
    paddingHorizontal: 18,
    // Just breathing room above the pinned footer — the safe-area bottom inset
    // now lives on the footer, not here.
    paddingBottom: 24,
  },
  // Type selector (Task / Event / Birthday) — first item under the fixed header.
  typeSelector: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
    marginBottom: 14,
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
  // Hero title field — the headline of the create/edit page. Larger + bolder
  // than anything else so the task name is unmistakably the primary input, with
  // a hairline rule underneath so new users clearly read it as "type here".
  // Every secondary field sits quiet beneath it.
  titleInput: {
    borderWidth: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
    backgroundColor: 'transparent',
    paddingHorizontal: 2,
    paddingTop: 8,
    paddingBottom: 12,
    marginBottom: 14,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: 0.2,
    color: theme.colors.textPrimary,
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
    // Expandable: grows with content from a comfortable minimum up to a cap,
    // then scrolls internally (instead of a fixed 80px box).
    minHeight: 80,
    maxHeight: 220,
    textAlignVertical: 'top',
    paddingTop: 10,
  },
  // "Link a note" affordance (shown until a note is picked / search is open).
  linkNoteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: 'dashed',
    backgroundColor: theme.colors.surface,
  },
  linkNoteBtnText: {
    fontSize: theme.typography.body,
    fontWeight: '600',
    color: theme.colors.accentInfo,
  },
  // Chip shown once a note is linked.
  linkedNoteChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceElevated,
  },
  linkedNoteText: {
    flex: 1,
    fontSize: theme.typography.body,
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  noteEmptyText: {
    padding: 12,
    fontSize: theme.typography.small || 13,
    color: theme.colors.textTertiary,
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
    borderRadius: 10,
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
    borderRadius: 10,
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
  // "More options" fold toggle — quiet inline control between the essentials
  // and the expanded fields.
  moreToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    marginTop: 2,
  },
  moreToggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.accentInfo,
  },
  // Section header for the "More options" groups (Details / When / People) —
  // stronger + tracked, with a hairline rule under it to separate groups.
  groupHeader: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: theme.colors.textSecondary,
    marginTop: 24,
    marginBottom: 14,
    paddingBottom: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  // Shared "selectable pill" for the Reminders preset chips — matches the
  // Repeat/Priority pill system (was one-off inline styles per chip).
  remPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceElevated,
  },
  remPillActive: {
    borderColor: theme.colors.accentInfo,
    backgroundColor: theme.colors.accentInfo + '22',
  },
  remPillText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  remPillTextActive: {
    color: theme.colors.accentInfo,
  },
  // End-of-scroll actions: stacked full-width Save → Cancel → Delete. Part of
  // the scroll content (NOT pinned) — reach the bottom to commit, iOS-form style.
  actionsBlock: {
    marginTop: 18,
    gap: 10,
  },
  actionBtn: {
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Pinned footer holding the primary Save CTA. Hairline top divider + solid
  // page-bg fill so it reads as a fixed bar over the scrolling fields.
  footer: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: (insets.bottom || 12),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  saveBtnDisabled: {
    opacity: 0.4,
  },
  // Inline board picker under the Board row — every board as a chip.
  boardList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  boardChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceElevated,
  },
  boardChipActive: {
    borderColor: theme.colors.accentInfo,
    backgroundColor: theme.colors.accentInfo + '22',
  },
  boardChipText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  boardChipTextActive: {
    color: theme.colors.accentInfo,
    fontWeight: '600',
  },
  // --- Chip primitives for the Essentials chip row (date/time/priority/
  // board). `reminderRow`/`reminderText` already exist above with a
  // different meaning and are actively used, so the chip-row counterparts
  // are added here under a `q` prefix instead of clobbering them.
  // `boardList` also already exists above (reused as-is); only the
  // still-missing `boardItem`/`boardItemActive`/`boardItemText` trio is
  // added here.
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 18,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    maxWidth: 140,
  },
  chipClear: {
    marginLeft: 2,
  },
  qReminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 22,
    paddingVertical: 6,
  },
  qReminderText: {
    fontSize: 15,
    fontWeight: '500',
    color: theme.colors.textSecondary,
  },
  switch: {
    width: 44,
    height: 26,
    borderRadius: 13,
    padding: 3,
    backgroundColor: theme.colors.surfaceElevated,
    justifyContent: 'center',
  },
  switchOn: {
    backgroundColor: theme.colors.accentInfo || '#4ADE80',
  },
  knob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  knobOn: {
    alignSelf: 'flex-end',
  },
  // boardList is reused as-is (defined above); only the item-level styles
  // were missing.
  boardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  boardItemActive: {
    backgroundColor: theme.colors.surfaceElevated,
  },
  boardItemText: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    flex: 1,
  },
  // Cancel — a quiet centered text link under Save (no button chrome), so the
  // filled Save is the only button-weight action in the actions block.
  cancelBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
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
    borderRadius: 10,
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
    borderRadius: 10,
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
