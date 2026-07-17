import { useState, useEffect, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiAuthToken } from '../../../context/ServerContext';
import {
  toggleSubtaskComplete,
  addSubtask,
  deleteSubtask,
  updateSubtask,
  areAllSubtasksCompleted
} from '../utils/taskHelpers';

// ── Local-first cache (stale-while-revalidate) ──────────────────────────────
// Tasks are mirrored to AsyncStorage so a fresh launch paints the calendar from
// the last-known data instead of blocking on a /tasks round-trip. The server
// stays the source of truth: on mount we hydrate from cache for an instant
// paint, then revalidate in the background and reconcile. Mirrors the web app's
// useTaskData cache (which uses localStorage).
//
// The whole task list is cached (not just the visible month): it's small text,
// the calendar pager filters by date client-side across a ±60-month window, and
// caching the lot keeps every month instant — scrolling away from "now" never
// blanks out. The key is scoped to the auth token so a different user — or a
// logout (which clears the token) — never reads the previous session's tasks,
// keeping the cache aligned with the server's per-user data isolation.
const cacheKey = () => {
  const token = getApiAuthToken() || 'anon';
  // Short, stable, non-reversible suffix from the token (djb2-ish). Different
  // user/token → different key → no cross-user bleed; same token → cache hit.
  let h = 0;
  for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) | 0;
  return `turtle.taskCache.${h >>> 0}`;
};

const readTaskCache = async () => {
  try {
    const raw = await AsyncStorage.getItem(cacheKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      tasks: Array.isArray(parsed.tasks)
        ? parsed.tasks.map((t) => ({ ...t, subtasks: t.subtasks || [] }))
        : [],
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      allTags: Array.isArray(parsed.allTags) ? parsed.allTags : [],
      savedAt: parsed.savedAt,
    };
  } catch {
    return null; // corrupt/parse error → treat as cold start
  }
};

const writeTaskCache = async (cache) => {
  try {
    await AsyncStorage.setItem(cacheKey(), JSON.stringify({ ...cache, savedAt: Date.now() }));
  } catch {
    /* quota / storage error — cache is best-effort, never block the UI */
  }
};

export const useTaskData = (api, isConnected, onTaskCompleted) => {
  const [tasks, setTasks] = useState([]);
  // Always-current snapshot of `tasks` so the mutation handlers below read the
  // LATEST array even when an old handler instance is held by a memoized
  // TaskItem row — otherwise toggling a second task with a stale closure would
  // silently revert the first. Updated synchronously every render.
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  // Pending optimistic COMPLETION writes: id -> { sig, at }. A checkbox tick
  // sets the row optimistically and POSTs the whole array in the background; a
  // refetch (pull-to-refresh, reconnect revalidate) that RACES that in-flight
  // POST would otherwise return the pre-write list and clobber the ✓ back off.
  // We keep the local completion for any id whose write hasn't been confirmed
  // by the server yet, and drop the guard once the server payload matches (or
  // after a backstop TTL). Keyed on a small COMPLETION signature so a server
  // that adds/normalises other fields never blocks convergence.
  const pendingRef = useRef(new Map());
  const PENDING_TTL_MS = 15000; // backstop: never pin an optimistic value forever
  const completionSig = (t) => `${t.completed ? 1 : 0}|${t.completedAt || ''}|${t.dueDate || ''}|${Array.isArray(t.meta?.completedDates) ? t.meta.completedDates.join(',') : ''}`;
  const [projects, setProjects] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // True from mount until the FIRST /tasks fetch settles (success OR failure).
  // Combined with the cache-hydration flag below it powers `initializing` — the
  // signal the Upcoming agenda uses to show a skeleton on a genuine cold start
  // (nothing cached) instead of a misleading empty state or a blank pop-in.
  // Distinct from `loading` (which the screen no longer consumes): it flips
  // false the moment the first attempt returns, so the skeleton can never hang.
  const [hasAttemptedLoad, setHasAttemptedLoad] = useState(false);
  // True while a NON-cold (background) revalidation is in flight over content
  // that's already painted — drives a subtle "syncing" cue on the Upcoming
  // header when reopening/reconnecting, without ever blanking the list.
  const [syncing, setSyncing] = useState(false);

  // Track last refresh time for lazy loading (min interval between refreshes)
  const lastRefreshRef = useRef(0);
  const MIN_REFRESH_INTERVAL = 2000; // 2 seconds minimum between manual refreshes

  const loadData = useCallback(async (opts = {}) => {
    const { silent = false, force = false } = opts;
    if (!isConnected) return;
    
    // Lazy loading: prevent rapid successive refreshes unless forced. `silent`
    // means "don't show the spinner / don't blank on error" — it must NOT also
    // bypass the throttle (that let a silent lazyRefresh hit the network on
    // every call, e.g. once per calendar day-tap). Only an explicit `force`
    // (pull-to-refresh) skips the interval.
    const now = Date.now();
    if (!force && now - lastRefreshRef.current < MIN_REFRESH_INTERVAL) {
      return;
    }
    
    // Cold start = nothing on screen yet (no cache hydrated). Only then do we
    // block with a spinner; with cached tasks already painted, the revalidation
    // is silent so the calendar never flickers.
    const cold = tasksRef.current.length === 0;
    if (!silent && cold) setLoading(true);
    // Warm revalidation (content already on screen) → flag a quiet "syncing"
    // cue rather than a blocking spinner.
    if (!cold) setSyncing(true);
    try {
      const [tasksData, projectsData, tagsData] = await Promise.all([
        api.get('/tasks'),
        api.get('/projects'),
        api.get('/tags')
      ]);
      // Ensure subtasks array exists on each task
      // Guard against a non-array server payload — otherwise projects.forEach/.map
      // elsewhere throws "undefined is not a function" outside any try/catch.
      const serverTasks = Array.isArray(tasksData) ? tasksData.map(t => ({ ...t, subtasks: t.subtasks || [] })) : [];
      // Overlay any UNCONFIRMED optimistic completion so a refetch that raced an
      // in-flight save doesn't flip a just-ticked checkbox back off. Converged
      // (server caught up) or TTL-expired ids are dropped and take the server
      // value. Only the completion fields are overlaid; every other field stays
      // fresh from the server.
      let merged = serverTasks;
      if (pendingRef.current.size > 0) {
        const localById = new Map(tasksRef.current.map(t => [t.id, t]));
        const nowMs = Date.now();
        merged = serverTasks.map((st) => {
          const pend = pendingRef.current.get(st.id);
          if (!pend) return st;
          if (nowMs - pend.at > PENDING_TTL_MS || completionSig(st) === pend.sig) {
            pendingRef.current.delete(st.id); // server converged (or gave up) → trust it
            return st;
          }
          const local = localById.get(st.id);
          return local
            ? { ...st, completed: local.completed, completedAt: local.completedAt, completedTime: local.completedTime, dueDate: local.dueDate, meta: local.meta }
            : st;
        });
      }
      setTasks(merged);
      setProjects(Array.isArray(projectsData) ? projectsData : []);
      setAllTags(Array.isArray(tagsData) ? tagsData : []);
      lastRefreshRef.current = now;
    } catch (error) {
      // Offline / server down → keep the cached tasks on screen rather than
      // blanking the calendar; they reconcile on the next successful load. Only
      // alert on a true cold start where there's nothing to fall back to.
      console.error('Load data error:', error);
      if (!silent && cold) Alert.alert('Error', 'Failed to load data');
    } finally {
      if (!silent && cold) setLoading(false);
      setSyncing(false);
      // First attempt has settled — cold-start skeleton may retire even if the
      // fetch failed (we fall through to the empty/offline state, never a hang).
      setHasAttemptedLoad(true);
    }
  }, [api, isConnected]);
  
  // Pull-to-refresh handler
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData({ silent: true, force: true });
    setRefreshing(false);
  }, [loadData]);
  
  // Lazy refresh - only refreshes if enough time has passed
  const lazyRefresh = useCallback(async () => {
    await loadData({ silent: true });
  }, [loadData]);

  // Optimistic-first: paint the new state immediately so the UI feels instant,
  // then persist in the background. If the server rejects, roll back to the
  // exact pre-mutation snapshot and tell the user. Every task mutation (toggle,
  // recurring-advance, edit, subtask add/toggle/delete, delete task) funnels
  // through here, so this single change makes the whole task screen snappy.
  // Mirrors the photo-vault commitTags pattern.
  const saveTasks = async (newTasks) => {
    const prevTasks = tasksRef.current; // snapshot for rollback
    // Flag every row whose COMPLETION changed as a pending optimistic write, so
    // a refetch racing this POST can't undo the tick before the server stores
    // it (see loadData overlay). New ids (no prev) count too — a freshly
    // created + ticked task shouldn't flicker on the next revalidate.
    const prevById = new Map(prevTasks.map(t => [t.id, t]));
    const nowMs = Date.now();
    const flagged = [];
    for (const t of newTasks) {
      const p = prevById.get(t.id);
      if (!p || completionSig(t) !== completionSig(p)) {
        pendingRef.current.set(t.id, { sig: completionSig(t), at: nowMs });
        flagged.push(t.id);
      }
    }
    setTasks(newTasks);                 // 1. instant UI update
    try {
      await api.post('/tasks', newTasks); // 2. confirm with backend
      // Success: the server now holds these; leave the guard in place — the
      // next load sees matching sigs and drops it. (Don't clear here: an
      // in-flight GET issued BEFORE this resolved could still land stale.)
    } catch (error) {
      console.error('Save tasks error:', error);
      for (const id of flagged) pendingRef.current.delete(id); // write failed → stop pinning
      setTasks(prevTasks);             // 3. revert on failure
      Alert.alert('Error', 'Failed to save — that change was undone');
      throw error; // Re-throw so caller knows it failed
    }
  };

  // Subtask handlers
  const handleAddSubtask = async (taskId, title) => {
    try {
      const newTasks = tasksRef.current.map(t => {
        if (t.id !== taskId) return t;
        return {
          ...t,
          subtasks: addSubtask(t.subtasks, title)
        };
      });
      await saveTasks(newTasks);
    } catch (error) {
      console.error('Add subtask error:', error);
    }
  };

  const handleToggleSubtask = async (taskId, subtaskId) => {
    try {
      // Track a false→true parent completion so ticking the LAST subtask
      // celebrates just like ticking the task's own checkbox does.
      let justCompleted = false;
      const newTasks = tasksRef.current.map(t => {
        if (t.id !== taskId) return t;

        const updatedSubtasks = toggleSubtaskComplete(t.subtasks, subtaskId);
        const allDone = areAllSubtasksCompleted(updatedSubtasks);
        if (allDone && !t.completed) justCompleted = true;

        return {
          ...t,
          subtasks: updatedSubtasks,
          completed: allDone,
          completedAt: allDone ? Date.now() : null,
          completedTime: allDone ? new Date().toISOString() : null
        };
      });
      await saveTasks(newTasks);
      // After the save is confirmed (saveTasks reverts + re-throws on failure).
      if (justCompleted) onTaskCompleted?.();
    } catch (error) {
      console.error('Toggle subtask error:', error);
    }
  };

  const handleDeleteSubtask = async (taskId, subtaskId) => {
    try {
      const newTasks = tasksRef.current.map(t => {
        if (t.id !== taskId) return t;
        return {
          ...t,
          subtasks: deleteSubtask(t.subtasks, subtaskId)
        };
      });
      await saveTasks(newTasks);
    } catch (error) {
      console.error('Delete subtask error:', error);
    }
  };

  const handleUpdateSubtask = async (taskId, subtaskId, updates) => {
    try {
      const newTasks = tasksRef.current.map(t => {
        if (t.id !== taskId) return t;
        return {
          ...t,
          subtasks: updateSubtask(t.subtasks, subtaskId, updates)
        };
      });
      await saveTasks(newTasks);
    } catch (error) {
      console.error('Update subtask error:', error);
    }
  };

  const collectTags = async (tagsArray) => {
    const newTags = tagsArray.filter(tag => !allTags.includes(tag));
    if (newTags.length === 0) return;
    try {
      await api.post('/tags/collect', { tags: newTags });
      setAllTags([...allTags, ...newTags].sort());
    } catch (error) {
      console.error('Failed to collect tags', error);
    }
  };

  // Optimistic-first (like saveTasks): show the project immediately, persist in
  // the background, sync to the server's authoritative list on success, revert
  // on failure.
  const addProject = async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    const alreadyExists = projects.includes(trimmed);
    if (!alreadyExists) {
      setProjects(prev =>
        prev.includes(trimmed) ? prev : [...prev, trimmed].sort((a, b) => a.localeCompare(b)),
      );
    }
    try {
      const res = await api.post('/projects/add', { name: trimmed });
      if (res && Array.isArray(res.projects)) setProjects(res.projects); // server truth
      return true;
    } catch (error) {
      console.error('Add project error:', error);
      if (!alreadyExists) setProjects(prev => prev.filter(p => p !== trimmed)); // rollback
      Alert.alert('Error', 'Failed to add board');
      return false;
    }
  };

  const deleteTask = async (taskId) => {
    try {
      const newTasks = tasksRef.current.filter(t => t.id !== taskId);
      await saveTasks(newTasks);
      return true;
    } catch (error) {
      console.error('Delete task error:', error);
      Alert.alert('Error', 'Failed to delete task');
      return false;
    }
  };

  // Optimistic-first. Preserves existing semantics: when onDeleteTasks is set
  // (the project has tasks), those tasks are DELETED along with the project, not
  // just un-assigned. Snapshot both lists for rollback.
  const deleteProject = async (name, options = {}) => {
    const { onDeleteTasks } = options;
    const prevProjects = projects;
    const prevTasks = tasksRef.current;
    const newTasks = onDeleteTasks ? prevTasks.filter(t => t.project !== name) : prevTasks;

    // 1. Instant UI: drop the project (and its tasks, if any) now.
    setProjects(prev => prev.filter(p => p !== name));
    if (onDeleteTasks) setTasks(newTasks);

    try {
      // 2. Persist in the background — tasks first (so the deletes land), then
      //    remove the project itself.
      if (onDeleteTasks) await api.post('/tasks', newTasks);
      await api.delete(`/projects/${encodeURIComponent(name)}`);
      return true;
    } catch (error) {
      console.error('Delete project error:', error);
      setProjects(prevProjects);            // 3. revert both on failure
      if (onDeleteTasks) setTasks(prevTasks);
      Alert.alert('Error', 'Failed to delete board');
      return false;
    }
  };

  // Has the one-time cache hydration finished? We gate both the first network
  // revalidation and the write-back effect on this so we never (a) show a cold
  // spinner when a warm cache exists, nor (b) clobber the cache with the initial
  // empty state before it's read.
  const [cacheHydrated, setCacheHydrated] = useState(false);

  // 1. Hydrate from AsyncStorage once on mount → instant paint of last-known
  //    tasks. AsyncStorage is async (unlike the web's localStorage), so this
  //    happens in an effect rather than a useState initializer.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await readTaskCache();
      if (!cancelled && cached) {
        if (cached.tasks.length) setTasks(cached.tasks);
        if (cached.projects.length) setProjects(cached.projects);
        if (cached.allTags.length) setAllTags(cached.allTags);
      }
      if (!cancelled) setCacheHydrated(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // 2. Revalidate against the server once hydration is done — and again whenever
  //    the connection/api identity changes (so reconnecting reloads). With a
  //    warm cache `cold` is false inside loadData → this runs silently.
  useEffect(() => {
    if (!cacheHydrated) return;
    loadData();
  }, [cacheHydrated, loadData]);

  // 3. Keep the cache warm: persist after any state change (load, optimistic
  //    mutation, subtask edit, …). Skipped until hydration completes so the
  //    initial empty state never overwrites a good cache.
  useEffect(() => {
    if (!cacheHydrated) return;
    writeTaskCache({ tasks, projects, allTags });
  }, [tasks, projects, allTags, cacheHydrated]);

  // Genuine cold start: the cache has been read and came back empty, we're
  // online, nothing is painted yet, and the first fetch hasn't settled. ONLY
  // then does the Upcoming agenda show its skeleton — a warm cache (tasks
  // already on screen) or an offline start never triggers it, and it clears the
  // instant the first load attempt returns. Gating on `cacheHydrated` is what
  // prevents a skeleton flash in the brief window before the async cache read
  // resolves into a warm paint.
  const initializing = cacheHydrated && isConnected && tasks.length === 0 && !hasAttemptedLoad;

  return {
    tasks, setTasks, projects, setProjects, allTags, setAllTags, loading,
    loadData, saveTasks, collectTags, addProject, deleteProject, deleteTask,
    handleAddSubtask,
    handleToggleSubtask,
    handleDeleteSubtask,
    handleUpdateSubtask,
    refreshing,
    onRefresh,
    lazyRefresh,
    initializing,
    syncing,
  };
};