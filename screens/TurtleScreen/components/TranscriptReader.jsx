/**
 * TranscriptReader — one track's transcript, read in time with the music.
 *
 * Pushed over the music library (MusicVault wraps it in an EdgeSwipePage) for
 * the track whose "Transcribe" / "View transcript" was tapped. Four states,
 * decided by the track's job row in `services/transcriptionStore`:
 *
 *   none      — no job yet: a Transcribe key with the options it will send.
 *   running   — a stage label and a stepped bar (`describeJob`), polled on
 *               the Settings panel's own backoff curve (`nextPollDelay`).
 *   completed — the reader: turns with speaker and time, the words as
 *               inline spans, the live turn and the live word lit from the
 *               player's position; tap a line or a word to play from there.
 *   failed    — why, and Retry.
 *
 * ─── Where the truth lives ──────────────────────────────────────────────────
 *
 * The job row is the STORE's, not this component's: a job outlives the screen
 * (the pond takes minutes), Settings → Transcribe audio lists the same rows,
 * and the vault learns about jobs sent from another device by folding the
 * pond's list into that same store. So the reader subscribes and renders
 * whichever row speaks for its track (`recordingForMedia`), and every change
 * it makes — a submit, a poll, a cancel — is a store write. The transcript
 * itself is fetched on open and kept in a module Map by media id, so leaving
 * and coming back is free and the row on disk stays an id and a name.
 *
 * ─── Sync ───────────────────────────────────────────────────────────────────
 *
 * Position comes from `@rntp/player`'s `useProgress` at 0.25 s — finer than
 * the 0.5 s the player context polls at, because a word is shorter than
 * that. The arithmetic (lead, stickiness, the 35 % anchor) is
 * `utils/transcriptSync` and tested there. Only the two rows whose lit state
 * changes re-render on a tick: `TurnRow` is memoised on (active, activeWord).
 *
 * Auto-scroll keeps the live turn a third of the way down. A drag or a flick
 * by the reader pauses it — for `FOLLOW_PAUSE_MS` after the LAST touch, so a
 * long read-back is never yanked mid-sentence — and a "Now" pill brings it
 * back sooner. Programmatic scrolls do not fire onScrollBeginDrag, so they
 * cannot pause themselves.
 *
 * ─── Surface ────────────────────────────────────────────────────────────────
 *
 * White-on-black, whatever the app theme: the page is a dark sheet
 * (`SURFACE`), text is white at 100 % for the live turn, 70 % for the rest,
 * 45 % for labels and times; the live word is brighter and underlined; the
 * ONE accent (the user's music tint) marks the live speaker and the
 * underline; pills invert to white with black text. No `depth()` — a
 * white-on-black surface takes its depth from tone, like the photo viewer.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, FlatList, Pressable, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useProgress } from '@rntp/player';

import { useMusicPlayer } from '../../../context/MusicPlayerContext';
import { useServer } from '../../../context/ServerContext';
import { useTheme } from '../../../context/ThemeContext';
import { titleOf } from '../../../services/musicTrackMapper';
import {
  cancelOrDelete, friendlySubmitError, getJob, getResult, statusOfError,
  submitMediaTranscription,
} from '../../../services/transcriptions';
import {
  addLocalRecording, getRecordings, patchLocalRecording, removeLocalRecording,
  subscribeRecordings,
} from '../../../services/transcriptionStore';
import { impactHaptic, notifyHaptic, tapHaptic } from '../../../utils/haptics';
import { useTapOnly } from '../../../utils/pressBehavior';
import {
  FOLLOW_ANCHOR, activeTurnIndex, activeWordIndex, scrollTargetOffset, summaryLine,
  turnsFromResult, voicesIn,
} from '../../../utils/transcriptSync';
import {
  clampChoices, defaultChoices, formatDuration, optionsProblem, runtimeState,
  submitParameters, summariseChoices,
} from '../../../utils/transcriptionOptions';
import {
  describeJob, isRetryableStatus, isTerminal, nextPollDelay, UPLOADING,
} from '../../../utils/transcriptionProgress';
import { recordingForMedia } from '../../../utils/transcriptionRecordings';

// The dark sheet and its inks. Fixed, not themed: this is a white-on-black
// surface in both app themes (STYLE-RULES §1), like everything drawn over
// media.
const SURFACE = '#0B0B0D';
const INK = '#FFFFFF';
const ink = (alpha) => `rgba(255,255,255,${alpha})`;

/** How long after the reader's last touch the list starts following again. */
export const FOLLOW_PAUSE_MS = 3000;

/** The player's progress tick while the reader is open, in seconds. */
const PROGRESS_INTERVAL_S = 0.25;

/**
 * Fetched transcripts, by media id. A transcript is a few kilobytes and the
 * reader is opened and closed many times over one listen; re-fetching it
 * each time would be a spinner on every open. Keyed by MEDIA rather than
 * job so the vault's one identity finds it, validated by job id so a retry
 * that produced a new transcript is not served the old one.
 */
const resultCache = new Map();
const RESULT_CACHE_MAX = 12;

function rememberResult(mediaId, jobId, result) {
  resultCache.delete(mediaId);
  resultCache.set(mediaId, { jobId, result });
  // A Map iterates in insertion order, so the first key is the oldest.
  while (resultCache.size > RESULT_CACHE_MAX) resultCache.delete(resultCache.keys().next().value);
}

function cachedResult(mediaId, jobId) {
  const hit = resultCache.get(mediaId);
  return hit && hit.jobId === jobId ? hit.result : null;
}

/** Test seam. */
export function __clearResultCacheForTests() {
  resultCache.clear();
}

/** Clock for a turn: "1:04". `formatDuration` is blank at zero. */
const clock = (seconds) => formatDuration(seconds) || '0:00';

/** A local row key for a job this reader submits; the pond's id lands later. */
let keySeed = 0;
const newKey = (mediaId) => `media_${mediaId}_${Date.now().toString(36)}_${(keySeed += 1)}`;

/**
 * Poll one running job on the panel's curve until it settles.
 *
 * The same rules as TranscriptionPanel's poller, for one row: the backoff
 * resets when the stage moves, a 404 is "gone" and stops, any other 4xx that
 * is not retryable is "the pond will not report" and stops, everything else
 * asks again later. The row is read back from the store on every tick so a
 * cancel from anywhere (this reader, Settings) ends it. Foregrounding polls
 * at once — the answer only had to be current by the time someone looked.
 */
function useJobPoller(row, apiRef) {
  const key = row?.key || null;
  const id = row?.id || null;
  const live = !!key && !!id && row.status !== UPLOADING && !isTerminal(row.status);

  useEffect(() => {
    if (!live) return undefined;
    let cancelled = false;
    let timer = null;
    let consecutive = 0;
    let lastStatus = '';
    let failedAt = null;

    const stillLive = () => {
      const current = getRecordings().find((r) => r.key === key);
      return !!current && !isTerminal(current.status);
    };

    const tick = async () => {
      if (cancelled || !stillLive()) return;
      try {
        const response = await getJob(apiRef.current, id);
        if (cancelled) return;
        const job = response?.job || response;
        const status = String(job?.status || '');
        if (!status) throw new Error('empty job');
        if (status !== lastStatus) {
          if (lastStatus && !isTerminal(lastStatus)) failedAt = lastStatus;
          lastStatus = status;
          consecutive = 0;
        } else {
          consecutive += 1;
        }
        // Only what the server answered with: a bare 0 for a duration it has
        // not measured yet would erase the one the track already knew.
        const patch = {
          status,
          note: null,
          failedAt: isTerminal(status) ? failedAt : null,
          error: job?.error?.message || null,
        };
        if (Number(job?.durationSeconds) > 0) patch.durationSeconds = Number(job.durationSeconds);
        if (Number(job?.detectedSpeakers) > 0) patch.speakerCount = Number(job.detectedSpeakers);
        if (job?.language) patch.language = String(job.language);
        patchLocalRecording(key, patch);
        if (isTerminal(status)) {
          if (status === 'completed') notifyHaptic();
          return;
        }
      } catch (error) {
        if (cancelled) return;
        const code = statusOfError(error);
        if (code === 404) {
          patchLocalRecording(key, { status: 'failed', note: null, error: 'The pond no longer has this job' });
          return;
        }
        if (code >= 400 && code < 500 && !isRetryableStatus(code)) {
          patchLocalRecording(key, { status: 'failed', note: null, error: 'The pond would not report on this job' });
          return;
        }
        consecutive += 1;
      }
      timer = setTimeout(tick, nextPollDelay(consecutive, { background: AppState.currentState !== 'active' }));
    };

    timer = setTimeout(tick, nextPollDelay(0));
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || cancelled) return;
      consecutive = 0;
      clearTimeout(timer);
      tick();
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      sub.remove();
    };
  }, [live, key, id, apiRef]);
}

/**
 * One turn. Memoised on what can change under playback — whether it is the
 * live turn and which of its words is live — so a progress tick re-renders
 * two rows, not the list.
 *
 * A word is a nested Text with its own onPress: a touch that lands on a word
 * seeks to the word, one that lands on the label or the gutter seeks to the
 * turn. The row's press is `useTapOnly` (STYLE-RULES §3): inside a scrolling
 * list a swipe that begins on a line must neither light it nor seek.
 */
const TurnRow = memo(function TurnRow({ turn, active, activeWord, accent, onSeek }) {
  const tap = useTapOnly(() => onSeek(turn.start));
  return (
    <Pressable
      {...tap.props}
      accessibilityRole="button"
      accessibilityLabel={`${turn.speaker}, ${clock(turn.start)}: ${turn.text}`}
      style={({ pressed }) => [styles.turn, pressed && tap.settled && styles.turnPressed]}
    >
      <Text style={styles.turnHead} numberOfLines={1}>
        <Text style={[styles.turnSpeaker, active && { color: accent }]}>{turn.speaker}</Text>
        <Text style={styles.turnTime}>{`  ${clock(turn.start)}`}</Text>
      </Text>
      <Text style={[styles.turnText, active ? styles.turnTextActive : styles.turnTextIdle]}>
        {turn.words.length
          ? turn.words.map((word, index) => (
            <Text
              // Index + start: a transcript can legitimately say the same
              // word at the same second twice, and a key must not collapse them.
              key={`${index}-${word.start}`}
              onPress={() => onSeek(word.start)}
              style={active && index === activeWord ? [styles.wordActive, { textDecorationColor: accent }] : null}
            >
              {index > 0 ? ' ' : ''}{word.word}
            </Text>
          ))
          // An older pond sends no words: the line lights as a block.
          : turn.text}
      </Text>
    </Pressable>
  );
});

export default function TranscriptReader({
  track,
  onClose,
  capabilities,
  defaultSpeakerName = '',
  onSubmitted,
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { api } = useServer();
  const {
    activeTrack, isPlaying, ready, seekTo, playMedia, togglePlayback,
  } = useMusicPlayer();
  const { position } = useProgress(PROGRESS_INTERVAL_S);

  const accent = theme.colors.accent || theme.colors.accentInfo || theme.colors.primary;
  const mediaId = track?.id === undefined || track?.id === null ? null : String(track.id);
  const title = track ? titleOf(track) : '';
  // The player's position is the ACTIVE track's; this reader may be open for
  // another one, in which case nothing is lit and a tap plays this track.
  const synced = !!mediaId && String(activeTrack?.mediaId) === mediaId;

  const apiRef = useRef(api);
  apiRef.current = api;
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  // ── The job row ───────────────────────────────────────────────────────────
  const [recordings, setRecordings] = useState(() => getRecordings());
  useEffect(() => subscribeRecordings(setRecordings), []);
  const row = useMemo(() => recordingForMedia(recordings, mediaId), [recordings, mediaId]);
  const state = !row ? 'none'
    : row.status === 'completed' ? 'completed'
      : isTerminal(row.status) ? 'failed'
        : 'running';

  useJobPoller(row, apiRef);

  // ── The transcript ────────────────────────────────────────────────────────
  const jobId = row?.id || null;
  // Held WITH the ids it was loaded for, so a reader re-pointed at another
  // track (or at a retried job) never paints the old lines under the new
  // title for the frame before the effect below catches up.
  const [loaded, setLoaded] = useState(() => (
    jobId && mediaId ? { mediaId, jobId, data: cachedResult(mediaId, jobId) } : null
  ));
  const result = loaded && loaded.mediaId === mediaId && loaded.jobId === jobId ? loaded.data : null;
  const [resultError, setResultError] = useState(null);
  const [loadingResult, setLoadingResult] = useState(false);

  useEffect(() => {
    if (state !== 'completed' || !jobId || !mediaId) return undefined;
    const hit = cachedResult(mediaId, jobId);
    if (hit) {
      setLoaded({ mediaId, jobId, data: hit });
      setResultError(null);
      return undefined;
    }
    let cancelled = false;
    setLoadingResult(true);
    setResultError(null);
    (async () => {
      try {
        const fetched = await getResult(apiRef.current, jobId);
        if (cancelled) return;
        if (!turnsFromResult(fetched).length) throw new Error('empty');
        rememberResult(mediaId, jobId, fetched);
        setLoaded({ mediaId, jobId, data: fetched });
      } catch (error) {
        if (cancelled) return;
        // A completed job whose artifact has aged out is the expected version
        // of this, and it is not the same sentence as "something broke".
        setResultError(statusOfError(error) === 404
          ? 'The pond no longer keeps this transcript.'
          : 'Could not read that transcript.');
      } finally {
        if (!cancelled) setLoadingResult(false);
      }
    })();
    return () => { cancelled = true; };
  }, [state, jobId, mediaId]);

  const turns = useMemo(() => turnsFromResult(result), [result]);
  const activeTurn = synced ? activeTurnIndex(turns, position) : -1;
  const activeWord = activeTurn >= 0 ? activeWordIndex(turns[activeTurn].words, position) : -1;

  const summary = useMemo(() => {
    if (state !== 'completed') return '';
    const lastEnd = turns.length ? turns[turns.length - 1].end : 0;
    return summaryLine({
      speakers: voicesIn(result, turns) || row?.speakerCount,
      language: result?.language || row?.language,
      durationSeconds: Number(track?.duration) || row?.durationSeconds || lastEnd,
    });
  }, [state, result, turns, row, track]);

  // ── Following the music ───────────────────────────────────────────────────
  const listRef = useRef(null);
  const viewportH = useRef(0);
  const contentH = useRef(0);
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);
  const resumeTimer = useRef(null);
  const activeTurnRef = useRef(activeTurn);
  activeTurnRef.current = activeTurn;

  const scrollToTurn = useCallback((index, animated = true) => {
    if (index < 0) return;
    try {
      listRef.current?.scrollToIndex({ index, viewPosition: FOLLOW_ANCHOR, animated });
    } catch { /* mid-layout — the next tick lands it */ }
  }, []);

  const setFollow = useCallback((next) => {
    followingRef.current = next;
    setFollowing(next);
  }, []);

  // The countdown restarts on every touch, so following resumes only once the
  // reader has left the list alone for the whole pause.
  const armResume = useCallback(() => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => {
      resumeTimer.current = null;
      if (!mounted.current) return;
      setFollow(true);
      scrollToTurn(activeTurnRef.current);
    }, FOLLOW_PAUSE_MS);
  }, [setFollow, scrollToTurn]);

  const pauseFollowing = useCallback(() => {
    setFollow(false);
    armResume();
  }, [setFollow, armResume]);

  const resumeNow = useCallback(() => {
    tapHaptic();
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = null;
    setFollow(true);
    scrollToTurn(activeTurnRef.current);
  }, [setFollow, scrollToTurn]);

  useEffect(() => () => { if (resumeTimer.current) clearTimeout(resumeTimer.current); }, []);

  useEffect(() => {
    if (followingRef.current && activeTurn >= 0) scrollToTurn(activeTurn);
  }, [activeTurn, scrollToTurn]);

  // scrollToIndex only knows the rows the list has measured. For one it has
  // not, land near it by the average row height (the pure anchor arithmetic),
  // then ask again once that neighbourhood has rendered.
  const onScrollToIndexFailed = useCallback(({ index, averageItemLength }) => {
    const offset = scrollTargetOffset({
      itemOffset: index * (averageItemLength || 0),
      viewportHeight: viewportH.current,
      contentHeight: contentH.current,
    });
    listRef.current?.scrollToOffset({ offset, animated: false });
    setTimeout(() => {
      if (mounted.current && followingRef.current && activeTurnRef.current === index) scrollToTurn(index);
    }, 80);
  }, [scrollToTurn]);

  // ── Seeking ───────────────────────────────────────────────────────────────
  const seekToSecond = useCallback(async (seconds) => {
    tapHaptic();
    if (!ready || !mediaId) return;
    try {
      // Another track (or nothing) is loaded: start this one, then jump. Both
      // go through the provider so the queue and the transport stay agreed.
      if (!synced) await playMedia(mediaId);
      await seekTo(Math.max(0, Number(seconds) || 0));
    } catch { /* the provider reports its own errors */ }
  }, [ready, mediaId, synced, playMedia, seekTo]);

  const onPlayPause = useCallback(() => {
    tapHaptic();
    if (!ready || !mediaId) return;
    if (synced) togglePlayback();
    else playMedia(mediaId);
  }, [ready, mediaId, synced, togglePlayback, playMedia]);

  // ── Sending ───────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const choices = useMemo(() => {
    if (!capabilities) return null;
    const base = defaultChoices(capabilities, { primaryName: defaultSpeakerName });
    // A pond that transcribes but cannot separate speakers gets a one-voice
    // request rather than a refusal: this is a one-tap key on a track, not
    // an options form, and a dead end here would send people to Settings to
    // flip a switch the pond cannot honour anyway.
    if (runtimeState(capabilities) === 'no-diarization') base.diarize = false;
    return clampChoices(base, capabilities);
  }, [capabilities, defaultSpeakerName]);
  const runtime = capabilities ? runtimeState(capabilities) : null;
  const canSend = !!choices && runtime !== 'no-worker' && !busy;

  const submit = useCallback(async () => {
    if (!choices || !mediaId || busy) return;
    const problem = optionsProblem(choices, capabilities);
    if (problem) { Alert.alert('Transcribe', problem); return; }
    impactHaptic('medium');
    setBusy(true);
    // The row exists from the tap, so the running state shows at once and a
    // refusal has somewhere to say why. No id yet: the pond's answer adds it.
    const key = newKey(mediaId);
    addLocalRecording({
      key, mediaId, name: title, status: 'queued', note: 'Asking the pond',
      createdAt: Date.now(), durationSeconds: Number(track?.duration) || 0,
    });
    try {
      const accepted = await submitMediaTranscription(apiRef.current, {
        mediaId, options: submitParameters(choices, capabilities),
      });
      const id = String(accepted.id);
      // The pond deduped onto a job this phone already holds (merged from
      // its list, or sent from Settings): keep that row, drop the stand-in.
      const existing = getRecordings().find((r) => r.key !== key && r.id === id);
      if (existing) {
        removeLocalRecording(key);
        patchLocalRecording(existing.key, { status: accepted.status || existing.status, note: null });
      } else {
        patchLocalRecording(key, { id, status: accepted.status || 'queued', note: null });
      }
      onSubmitted?.(accepted);
    } catch (error) {
      patchLocalRecording(key, { status: 'failed', note: null, error: friendlySubmitError(error) });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [choices, capabilities, mediaId, busy, title, track, onSubmitted]);

  const cancel = useCallback(async () => {
    if (!row) return;
    tapHaptic();
    // Optimistic, like every mutation: the row is cancelled now and the
    // poller sees that on its next tick; the pond is told behind it.
    patchLocalRecording(row.key, { status: 'cancelled', note: null });
    if (row.id) {
      try { await cancelOrDelete(apiRef.current, row.id); } catch { /* already gone */ }
    }
  }, [row]);

  // ── Render ────────────────────────────────────────────────────────────────
  const renderTurn = useCallback(({ item, index }) => (
    <TurnRow
      turn={item}
      active={index === activeTurn}
      activeWord={index === activeTurn ? activeWord : -1}
      accent={accent}
      onSeek={seekToSecond}
    />
  ), [activeTurn, activeWord, accent, seekToSecond]);

  const keyExtractor = useCallback((item, index) => `${index}-${item.start}`, []);
  const bottomPad = Math.max(insets.bottom, 12) + 96;
  const view = row ? describeJob(row) : null;
  // Under the title: what the transcript is, and — when another track is the
  // one playing — how to make this one play.
  const hint = state === 'completed' && !synced ? 'tap a line to play' : '';
  const subtitle = summary
    ? `${summary}${hint ? ` · ${hint}` : ''}`
    : (hint ? 'Tap a line to play from there' : 'Transcript');

  let body;
  if (state === 'completed') {
    body = resultError ? (
      <View style={styles.centre}>
        <Icon name="text-box-remove-outline" size={40} color={ink(0.45)} />
        <Text style={styles.centreText}>{resultError}</Text>
        <TouchableOpacity
          style={[styles.pill, !canSend && styles.pillDisabled]}
          disabled={!canSend}
          onPress={submit}
          accessibilityRole="button"
          accessibilityLabel="Transcribe again"
        >
          <Text style={styles.pillText}>Transcribe again</Text>
        </TouchableOpacity>
      </View>
    ) : loadingResult || !turns.length ? (
      <View style={styles.centre}>
        <ActivityIndicator size="small" color={ink(0.7)} />
      </View>
    ) : (
      <>
        <FlatList
          ref={listRef}
          testID="transcript-list"
          data={turns}
          keyExtractor={keyExtractor}
          renderItem={renderTurn}
          extraData={`${activeTurn}:${activeWord}`}
          onScrollBeginDrag={pauseFollowing}
          onMomentumScrollBegin={pauseFollowing}
          onScrollEndDrag={armResume}
          onMomentumScrollEnd={armResume}
          onLayout={(e) => { viewportH.current = e.nativeEvent.layout.height; }}
          onContentSizeChange={(_, h) => { contentH.current = h; }}
          onScrollToIndexFailed={onScrollToIndexFailed}
          contentContainerStyle={{ paddingTop: 6, paddingBottom: bottomPad }}
          initialNumToRender={14}
          windowSize={9}
          scrollIndicatorInsets={{ right: 1 }}
          indicatorStyle="white"
        />
        {!following && activeTurn >= 0 && (
          <View style={[styles.nowAnchor, { bottom: Math.max(insets.bottom, 12) + 16 }]} pointerEvents="box-none">
            <TouchableOpacity
              style={styles.nowPill}
              onPress={resumeNow}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Jump to what is playing"
            >
              <Icon name="arrow-down" size={16} color="#000" />
              <Text style={styles.nowText}>Now</Text>
            </TouchableOpacity>
          </View>
        )}
      </>
    );
  } else if (state === 'running') {
    body = (
      <View style={styles.centre}>
        <ActivityIndicator size="small" color={ink(0.7)} />
        <Text style={styles.centreTitle}>{row.note || view.label}</Text>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${Math.max(3, Math.round(view.fraction * 100))}%`, backgroundColor: accent }]} />
        </View>
        <Text style={styles.centreText}>
          You can leave — it keeps going on the pond, and Settings → Transcribe audio lists it too.
        </Text>
        {view.canCancel && (
          <TouchableOpacity
            style={styles.outline}
            onPress={cancel}
            accessibilityRole="button"
            accessibilityLabel="Stop transcribing"
          >
            <Text style={styles.outlineText}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  } else if (state === 'failed') {
    body = (
      <View style={styles.centre}>
        <Icon name="alert-circle-outline" size={40} color={ink(0.45)} />
        <Text style={styles.centreTitle}>{row.status === 'cancelled' ? 'Cancelled' : 'Transcription failed'}</Text>
        {!!row.error && <Text style={styles.centreText}>{row.error}</Text>}
        <TouchableOpacity
          style={[styles.pill, !canSend && styles.pillDisabled]}
          disabled={!canSend}
          onPress={submit}
          accessibilityRole="button"
          accessibilityLabel="Retry transcription"
        >
          <Text style={styles.pillText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  } else {
    body = (
      <View style={styles.centre}>
        <Icon name="text-box-search-outline" size={40} color={ink(0.45)} />
        <Text style={styles.centreTitle}>No transcript yet</Text>
        <Text style={styles.centreText}>
          The pond writes one from this recording, and it reads back here in time with the music.
        </Text>
        {runtime === 'no-worker' ? (
          <Text style={styles.centreText}>This pond has no transcription worker installed.</Text>
        ) : !capabilities ? (
          <ActivityIndicator size="small" color={ink(0.7)} />
        ) : (
          <View style={styles.optionsRow}>
            <Icon name="tune-variant" size={14} color={ink(0.45)} />
            <Text style={styles.optionsText} numberOfLines={1}>{summariseChoices(choices, capabilities)}</Text>
          </View>
        )}
        <TouchableOpacity
          style={[styles.pill, !canSend && styles.pillDisabled]}
          disabled={!canSend}
          onPress={submit}
          accessibilityRole="button"
          accessibilityLabel={`Transcribe ${title}`}
        >
          {busy ? <ActivityIndicator size="small" color="#000" /> : <Icon name="text-to-speech" size={18} color="#000" />}
          <Text style={styles.pillText}>Transcribe</Text>
        </TouchableOpacity>
        <Text style={styles.footnote}>
          Options live in Settings → Transcribe audio. A recording made in Voice Memos and shared to Turtle lands in this vault ready to transcribe.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.page, { paddingTop: insets.top + 6 }]}>
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back to music"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          onPress={() => { tapHaptic(); onClose?.(); }}
          style={styles.headerKey}
        >
          <Icon name="chevron-left" size={28} color={INK} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
        </View>
        {!!mediaId && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={synced && isPlaying ? 'Pause' : 'Play'}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            onPress={onPlayPause}
            disabled={!ready}
            style={styles.headerKey}
          >
            <Icon name={synced && isPlaying ? 'pause-circle' : 'play-circle'} size={34} color={ready ? INK : ink(0.45)} />
          </TouchableOpacity>
        )}
      </View>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: SURFACE },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingBottom: 8 },
  headerKey: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontSize: 17, fontWeight: '600', color: INK },
  subtitle: { fontSize: 12.5, color: ink(0.7), marginTop: 1 },

  turn: { paddingHorizontal: 20, paddingVertical: 10, gap: 3 },
  turnPressed: { opacity: 0.6 },
  turnHead: { fontSize: 11.5 },
  turnSpeaker: { fontWeight: '700', letterSpacing: 0.4, color: ink(0.45) },
  turnTime: { color: ink(0.45), fontVariant: ['tabular-nums'] },
  // Big enough to read at arm's length while the phone sits on a table,
  // which is how a transcript gets read along to.
  turnText: { fontSize: 18, lineHeight: 27, fontWeight: '500' },
  turnTextActive: { color: INK },
  turnTextIdle: { color: ink(0.7) },
  wordActive: { color: INK, textDecorationLine: 'underline' },

  nowAnchor: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  nowPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 18,
    borderRadius: 20, backgroundColor: INK,
  },
  nowText: { fontSize: 14, fontWeight: '700', color: '#000' },

  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  centreTitle: { fontSize: 17, fontWeight: '600', color: INK, textAlign: 'center' },
  centreText: { fontSize: 14, lineHeight: 20, color: ink(0.7), textAlign: 'center' },
  optionsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  optionsText: { fontSize: 12.5, color: ink(0.45), flexShrink: 1 },
  footnote: { fontSize: 12, lineHeight: 17, color: ink(0.45), textAlign: 'center', marginTop: 4 },
  barTrack: { width: '70%', height: 6, borderRadius: 3, backgroundColor: ink(0.14), overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },

  pill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 48, paddingHorizontal: 28, borderRadius: 24, backgroundColor: INK,
    maxWidth: '100%', marginTop: 6,
  },
  pillDisabled: { opacity: 0.45 },
  pillText: { fontSize: 15, fontWeight: '700', color: '#000' },
  outline: {
    height: 44, paddingHorizontal: 24, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: ink(0.35),
  },
  outlineText: { fontSize: 14, fontWeight: '600', color: ink(0.7) },
});
