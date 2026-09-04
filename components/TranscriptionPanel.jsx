/**
 * TranscriptionPanel — "Transcribe audio" in Settings → Connection.
 *
 * The pond grew a WhisperX transcription service (server `docs/WHISPERX.md`):
 * POST an audio or video file, it comes back as a diarized, timestamped
 * transcript. Until this panel the only client was curl. This is the phone's
 * half of the contract in `docs/WHISPERX-FRONTEND-PLAN.md`, phases 1 and 2:
 * pick something, send it with capability-driven options, watch it, read it.
 *
 * ─── Everything here is INLINE, never a <Modal> ─────────────────────────────
 *
 * Settings is itself presented inside a pageSheet Modal (TurtleScreen renders
 * it that way). On iOS a second Modal opened over an open one silently never
 * appears — the same trap TrackActionsSheet documents. So the source chooser
 * and the transcript both expand in place inside this card. That is also why
 * the transcript is a bounded, scrollable block rather than a full-screen
 * reader: a reader would have to be a Modal.
 *
 * ─── What is persisted, and why so little ───────────────────────────────────
 *
 * A job outlives this screen — the GPU takes minutes and Settings will be shut
 * long before. `services/transcriptionStore` keeps the job id and a display
 * name on disk and nothing else: no bearer token (the plan forbids it), no
 * source bytes, no transcript. Coming back re-attaches by polling those ids.
 *
 * ─── Where the audio comes from ─────────────────────────────────────────────
 *
 * Two sources, because those are the two this app can actually reach today:
 * the pond's own audio library, and a video from the phone's camera roll (the
 * route accepts video and takes the audio track out of it). Picking an
 * arbitrary file out of the Files app needs `expo-document-picker`, which is a
 * native module and therefore a dev-client rebuild — deliberately not added
 * here, since a missing native module is a crash at the tap, not a warning.
 *
 * Pond audio is downloaded to the cache and re-uploaded rather than
 * transcribed in place: the route only accepts a multipart upload, and the
 * phone cannot ask the server to read its own vault. For a voice recording
 * over the LAN that is a couple of seconds and it is shown honestly as its own
 * step ("Fetching from the pond") rather than hidden inside the progress bar.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, Share, StyleSheet, Switch, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';

import { useTheme } from '../context/ThemeContext';
import { getApiAuthToken, useServer } from '../context/ServerContext';
import { resolveMediaUrl, titleOf } from '../services/musicTrackMapper';
import {
  cancelOrDelete, getCapabilities, getJob, getResult, statusOfError,
  submitTranscription,
} from '../services/transcriptions';
import {
  addLocalRecording, loadRecordings, patchLocalRecording, removeLocalRecording,
  subscribeRecordings,
} from '../services/transcriptionStore';
import { tapHaptic, notifyHaptic } from '../utils/haptics';
import {
  describeJob, isRetryableStatus, isTerminal, nextPollDelay, UPLOADING,
} from '../utils/transcriptionProgress';
import {
  clampChoices, defaultChoices, fileProblem, formatBytes, formatDuration,
  modelNote, optionsProblem, readCapabilities, runtimeState, submitParameters,
  summariseChoices,
} from '../utils/transcriptionOptions';
import { pollableRecordings, summariseRecordings } from '../utils/transcriptionRecordings';

const BAR_H = 6;

/** A local row key. Unique per send; never leaves the phone. */
let keySeed = 0;
const newKey = () => `local_${Date.now().toString(36)}_${(keySeed += 1)}`;

/** Clock for a transcript turn: "1:04". */
const at = (seconds) => formatDuration(seconds) || '0:00';

/**
 * One recording in the list.
 *
 * Deliberately flat rather than a card-in-a-card: this list can be forty rows
 * long and forty nested surfaces is a texture, not a list.
 */
function RecordingRow({
  recording, expanded, transcript, transcriptError, loadingTranscript,
  onPress, onCancel, onDelete, onCopy, onShare, styles, colors,
}) {
  const view = describeJob(recording);
  const tone = view.tone === 'bad' ? (colors.accentError || '#F87171')
    : view.tone === 'done' ? (colors.accentSuccess || '#34D399')
      : view.tone === 'muted' ? colors.textTertiary
        : (colors.accent || colors.accentInfo);
  const meta = [
    recording.status === 'completed' && recording.speakerCount
      ? `${recording.speakerCount} ${recording.speakerCount === 1 ? 'voice' : 'voices'}` : '',
    recording.language ? String(recording.language).toUpperCase() : '',
    formatDuration(recording.durationSeconds),
    recording.sizeBytes ? formatBytes(recording.sizeBytes) : '',
  ].filter(Boolean).join(' · ');

  return (
    <View style={styles.recording}>
      <TouchableOpacity
        style={styles.recordingHead}
        activeOpacity={0.7}
        // Only a finished job has anything to open. Everything else is a row
        // that reports on itself and would open onto nothing.
        disabled={recording.status !== 'completed'}
        onPress={() => { tapHaptic(); onPress(); }}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${recording.name}, ${view.label}`}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.recordingName} numberOfLines={1}>{recording.name}</Text>
          <Text style={[styles.recordingMeta, { color: tone }]} numberOfLines={2}>
            {view.label}
            {recording.note ? ` · ${recording.note}` : ''}
            {recording.error ? ` · ${recording.error}` : ''}
            {meta ? ` · ${meta}` : ''}
          </Text>
        </View>

        {recording.status === 'completed' && (
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textTertiary} />
        )}
        {view.canCancel && (
          <TouchableOpacity
            onPress={() => { tapHaptic(); onCancel(); }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={`Stop transcribing ${recording.name}`}
          >
            <Icon name="close-circle-outline" size={20} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
        {view.canDelete && (
          <TouchableOpacity
            onPress={() => { tapHaptic(); onDelete(); }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${recording.name}`}
          >
            <Icon name="trash-can-outline" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>

      {/* A bar only while there is something to be part-way through. A finished
          job's full bar says nothing its label did not already say. */}
      {!isTerminal(recording.status) && (
        <View style={[styles.barTrack, { backgroundColor: colors.surfaceHighlight || colors.border }]}>
          <View style={[
            styles.barFill,
            { width: `${Math.max(2, Math.round(view.fraction * 100))}%`, backgroundColor: tone },
          ]}
          />
        </View>
      )}

      {expanded && (
        <View style={styles.transcript}>
          {loadingTranscript && <ActivityIndicator size="small" color={colors.textSecondary} />}
          {!!transcriptError && <Text style={styles.dim}>{transcriptError}</Text>}
          {!!transcript && (
            <>
              {transcript.turns.map((turn, index) => (
                <View key={`${turn.start}-${index}`} style={styles.turn}>
                  <Text style={styles.turnHead} numberOfLines={1}>
                    {/* Speaker, then time range, then text — the order screen
                        readers are asked to announce them in. */}
                    <Text style={styles.turnSpeaker}>{turn.speaker}</Text>
                    <Text style={styles.turnTime}>{`  ${at(turn.start)}–${at(turn.end)}`}</Text>
                  </Text>
                  {/* Transcript text is untrusted and is rendered as text only —
                      never as anything the renderer would interpret. */}
                  <Text style={styles.turnText}>{turn.text}</Text>
                </View>
              ))}
              <View style={styles.transcriptActions}>
                <TouchableOpacity onPress={onCopy} style={styles.smallButton} accessibilityRole="button">
                  <Icon name="content-copy" size={14} color={colors.textSecondary} />
                  <Text style={styles.smallButtonText}>Copy</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={onShare} style={styles.smallButton} accessibilityRole="button">
                  <Icon name="export-variant" size={14} color={colors.textSecondary} />
                  <Text style={styles.smallButtonText}>Share</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

export default function TranscriptionPanel({ active = true, defaultSpeakerName = '' }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { api, isConnected, getBaseUrl, getMediaBaseUrl } = useServer();

  const [capabilities, setCapabilities] = useState(null);
  // null while unknown, 'absent' for a pond that predates transcription (the
  // card removes itself), 'error' for anything else.
  const [capStatus, setCapStatus] = useState(null);
  // null until the pond has said what its own defaults are. Seeding this from
  // the build's fallbacks and correcting it a moment later would silently pin
  // whatever model THIS build was written against, which is exactly what
  // `submitParameters` exists to avoid.
  const [choices, setChoices] = useState(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [pondAudio, setPondAudio] = useState(null);
  const [pondAudioLoading, setPondAudioLoading] = useState(false);
  const [recordings, setRecordings] = useState([]);
  const [expandedKey, setExpandedKey] = useState(null);
  const [transcript, setTranscript] = useState(null);
  const [transcriptError, setTranscriptError] = useState(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [busy, setBusy] = useState(false);

  // Live upload cancellers, and the per-job poll timers. Refs because both are
  // imperative machinery whose identity must survive a re-render.
  const uploads = useRef(new Map());
  const pollers = useRef(new Map());
  const apiRef = useRef(api);
  apiRef.current = api;
  const backgrounded = useRef(false);
  const mounted = useRef(true);

  useEffect(() => subscribeRecordings(setRecordings), []);
  useEffect(() => { loadRecordings(); }, []);
  useEffect(() => () => {
    mounted.current = false;
    for (const timer of pollers.current.values()) clearTimeout(timer.timer);
    pollers.current.clear();
  }, []);

  // The pond's answer drives every control below, so it is fetched once the
  // panel is on screen rather than on expand — an option picker rendered from
  // this build's guesses and corrected a moment later would be worse than a
  // brief spinner.
  useEffect(() => {
    if (!active || !isConnected) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const raw = await getCapabilities(api);
        if (cancelled) return;
        const caps = readCapabilities(raw);
        setCapabilities(caps);
        setCapStatus(null);
        setChoices((current) => (current
          ? clampChoices(current, caps)
          : defaultChoices(caps, { primaryName: defaultSpeakerName })));
      } catch (error) {
        if (cancelled) return;
        const status = statusOfError(error);
        setCapStatus(status === 404 ? 'absent' : 'error');
      }
    })();
    return () => { cancelled = true; };
  }, [active, isConnected, api, defaultSpeakerName]);

  // ── Polling ───────────────────────────────────────────────────────────────

  const stopPoller = useCallback((key) => {
    const state = pollers.current.get(key);
    if (state?.timer) clearTimeout(state.timer);
    pollers.current.delete(key);
  }, []);

  const schedule = useCallback((key, delayMs) => {
    const state = pollers.current.get(key);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => { state.run(); }, delayMs);
  }, []);

  const pollOnce = useCallback(async (key, id) => {
    const state = pollers.current.get(key);
    if (!state || !mounted.current) return;
    try {
      const response = await getJob(apiRef.current, id);
      const job = response?.job || response;
      const status = String(job?.status || '');
      if (!status) throw new Error('empty job');
      // The backoff resets whenever the stage actually moves; a job sitting in
      // one stage is what the curve is for.
      if (status !== state.lastStatus) {
        // Remember the last stage that was still running, so a failure can show
        // WHERE it stopped — the server reports `stage === status` and forgets.
        if (!isTerminal(state.lastStatus) && state.lastStatus) state.failedAt = state.lastStatus;
        state.lastStatus = status;
        state.consecutive = 0;
      } else {
        state.consecutive += 1;
      }
      // Only fields the server actually answered with. Writing a bare 0 for a
      // duration the job has not reported yet would erase the one the picker
      // already knew, and the row would lose information as it progressed.
      const patch = {
        status,
        note: null,
        failedAt: isTerminal(status) ? state.failedAt : null,
        error: job?.error?.message || null,
      };
      if (Number(job?.durationSeconds) > 0) patch.durationSeconds = Number(job.durationSeconds);
      if (Number(job?.detectedSpeakers) > 0) patch.speakerCount = Number(job.detectedSpeakers);
      if (job?.language) patch.language = String(job.language);
      patchLocalRecording(key, patch);
      if (isTerminal(status)) {
        stopPoller(key);
        if (status === 'completed') notifyHaptic();
        return;
      }
    } catch (error) {
      const code = statusOfError(error);
      if (code === 404) {
        // Gone is gone. Polling a deleted job forever is how a row becomes a
        // permanent spinner.
        patchLocalRecording(key, { status: 'failed', note: null, error: 'The pond no longer has this job' });
        stopPoller(key);
        return;
      }
      if (code >= 400 && code < 500 && !isRetryableStatus(code)) {
        patchLocalRecording(key, { status: 'failed', note: null, error: 'The pond would not report on this job' });
        stopPoller(key);
        return;
      }
      // A retryable answer, a 5xx, or no answer at all (the phone left the
      // network). All three mean "ask again later", on the same curve.
      state.consecutive += 1;
    }
    schedule(key, nextPollDelay(state.consecutive, { background: backgrounded.current }));
  }, [schedule, stopPoller]);

  const startPoller = useCallback((key, id, { immediate = true } = {}) => {
    if (pollers.current.has(key)) return;
    const state = {
      timer: null, consecutive: 0, lastStatus: '', failedAt: null,
      run: () => pollOnce(key, id),
    };
    pollers.current.set(key, state);
    if (immediate) state.run();
    else schedule(key, nextPollDelay(0, { background: backgrounded.current }));
  }, [pollOnce, schedule]);

  // Re-attach to everything unfinished: rows restored from disk on a cold
  // start, and rows this session accepted.
  useEffect(() => {
    for (const row of pollableRecordings(recordings)) startPoller(row.key, row.id);
    // A row that finished (or was deleted) drops its timer.
    const live = new Set(pollableRecordings(recordings).map((r) => r.key));
    for (const key of [...pollers.current.keys()]) if (!live.has(key)) stopPoller(key);
  }, [recordings, startPoller, stopPoller]);

  // Foreground/background. Backgrounded, the curve is far lazier; coming back
  // polls immediately, which is the plan's acceptance test for resume.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const wasBackground = backgrounded.current;
      backgrounded.current = next !== 'active';
      if (wasBackground && next === 'active') {
        for (const state of pollers.current.values()) {
          state.consecutive = 0;
          if (state.timer) clearTimeout(state.timer);
          state.run();
        }
      }
    });
    return () => sub.remove();
  }, []);

  // ── Sending ───────────────────────────────────────────────────────────────

  /**
   * Send one local file.
   *
   * The row is created BEFORE the upload starts and removed if the upload is
   * cancelled — so "it adds to the recordings" is true from the first byte, and
   * a cancelled send leaves nothing behind.
   */
  const send = useCallback(async ({ fileUri, mimeType, name, sizeBytes = 0, durationSeconds = 0, prepare }) => {
    // Refused here rather than by the route: the 503 for this arrives AFTER the
    // whole file has gone up the wire, which is a long wait to be told the
    // pond was never going to do it.
    if (choices.diarize && runtimeState(capabilities) === 'no-diarization') {
      Alert.alert('Transcribe', 'This pond cannot separate speakers. Turn off “Separate speakers” in the options to send it anyway.');
      return;
    }
    const problem = optionsProblem(choices, capabilities) || fileProblem({ sizeBytes }, capabilities);
    if (problem) { Alert.alert('Transcribe', problem); return; }

    const key = newKey();
    const controller = new AbortController();
    uploads.current.set(key, controller);
    addLocalRecording({
      key, name, status: UPLOADING, uploadPercent: 0, sizeBytes, durationSeconds,
      createdAt: Date.now(), note: prepare ? 'Fetching from the pond' : null,
    });
    setBusy(true);

    let localUri = fileUri;
    let temporary = null;
    try {
      if (prepare) {
        temporary = await prepare(controller.signal);
        localUri = temporary;
        patchLocalRecording(key, { note: null });
      }
      const accepted = await submitTranscription({
        baseUrl: getBaseUrl().replace(/\/api$/, ''),
        token: getApiAuthToken(),
        fileUri: localUri,
        mimeType,
        name,
        options: submitParameters(choices, capabilities),
        onProgress: (percent) => patchLocalRecording(key, { uploadPercent: percent }),
        signal: controller.signal,
      });
      patchLocalRecording(key, {
        id: accepted.id, status: accepted.status || 'queued', uploadPercent: 100, note: null,
      });
      startPoller(key, accepted.id, { immediate: false });
    } catch (error) {
      const message = String(error?.message || error);
      if (controller.signal.aborted || /cancelled/i.test(message)) {
        // The acceptance test that matters: a cancelled upload leaves no
        // running state — not a failed row, nothing.
        removeLocalRecording(key);
      } else {
        patchLocalRecording(key, {
          status: 'failed', note: null, uploadPercent: 0, error: friendlyUploadError(error),
        });
      }
    } finally {
      uploads.current.delete(key);
      if (temporary) FileSystem.deleteAsync(temporary, { idempotent: true }).catch(() => {});
      if (mounted.current) setBusy(false);
    }
  }, [choices, capabilities, getBaseUrl, startPoller]);

  const sendVideoFromLibrary = useCallback(async () => {
    setSourceOpen(false);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        // The original file, not an export: PHPicker re-encodes on the way out
        // otherwise, which for a long recording is a silent multi-minute wait
        // (the same trap MediaGallery documents).
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode?.Current ?? 'current',
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      await send({
        fileUri: asset.uri,
        mimeType: asset.mimeType || 'video/mp4',
        name: asset.fileName || 'Video recording',
        sizeBytes: asset.fileSize || 0,
        durationSeconds: asset.duration ? asset.duration / 1000 : 0,
      });
    } catch (error) {
      Alert.alert('Transcribe', error?.message || 'Could not read that video.');
    }
  }, [send]);

  const loadPondAudio = useCallback(async () => {
    setPondAudioLoading(true);
    try {
      const response = await api.get('/media/gallery?kind=audio&limit=200&order=desc&sortBy=upload');
      setPondAudio(Array.isArray(response?.items) ? response.items : []);
    } catch {
      setPondAudio([]);
    } finally {
      setPondAudioLoading(false);
    }
  }, [api]);

  const sendPondAudio = useCallback(async (item) => {
    setSourceOpen(false);
    const base = (getMediaBaseUrl ? getMediaBaseUrl() : getBaseUrl()).replace(/\/api$/, '');
    const url = resolveMediaUrl(item.rawUrl || item.url, base);
    if (!url) { Alert.alert('Transcribe', 'That track has no file to send.'); return; }
    const safeName = String(item.filename || `audio_${item.id}.mp3`).replace(/[^\w.\-]/g, '_');
    await send({
      mimeType: item.mimeType || 'audio/mpeg',
      name: titleOf(item),
      sizeBytes: Number(item.size) || 0,
      durationSeconds: Number(item.duration) || 0,
      // The pond holds the bytes; the route only takes an upload. So: pull a
      // copy into the cache first, and let the row say that is what it is doing.
      prepare: async () => {
        const target = `${FileSystem.cacheDirectory}transcribe_${item.id}_${safeName}`;
        const { uri } = await FileSystem.downloadAsync(url, target);
        return uri;
      },
    });
  }, [send, getBaseUrl, getMediaBaseUrl]);

  // ── Row actions ───────────────────────────────────────────────────────────

  const cancelRecording = useCallback(async (row) => {
    const controller = uploads.current.get(row.key);
    if (controller) { controller.abort(); return; }
    stopPoller(row.key);
    patchLocalRecording(row.key, { status: 'cancelled' });
    if (row.id) {
      try { await cancelOrDelete(apiRef.current, row.id); } catch { /* the row is already gone locally */ }
    }
  }, [stopPoller]);

  const deleteRecording = useCallback(async (row) => {
    if (expandedKey === row.key) { setExpandedKey(null); setTranscript(null); }
    removeLocalRecording(row.key);
    if (row.id) {
      // Deleting on the pond too: the artifact is the only copy and leaving it
      // behind with no client that knows its id is litter with a retention
      // clock on it.
      try { await cancelOrDelete(apiRef.current, row.id); } catch { /* already gone */ }
    }
  }, [expandedKey]);

  const openTranscript = useCallback(async (row) => {
    if (expandedKey === row.key) { setExpandedKey(null); return; }
    setExpandedKey(row.key);
    setTranscript(null);
    setTranscriptError(null);
    setLoadingTranscript(true);
    try {
      const result = await getResult(apiRef.current, row.id);
      const turns = Array.isArray(result?.turns) ? result.turns : [];
      if (!turns.length) throw new Error('empty');
      setTranscript({ turns, text: String(result?.transcript || '') });
    } catch (error) {
      // A completed job whose artifact has expired is the expected version of
      // this, and it is not the same sentence as "something broke".
      setTranscriptError(statusOfError(error) === 404
        ? 'The pond no longer keeps this transcript.'
        : 'Could not read that transcript.');
    } finally {
      setLoadingTranscript(false);
    }
  }, [expandedKey]);

  const styles = useMemo(() => makeStyles(theme), [theme]);
  const tint = c.accent || c.accentInfo;
  const summary = summariseRecordings(recordings);
  const asking = !capabilities && !capStatus;
  const runtime = capabilities ? runtimeState(capabilities) : null;
  // 'no-diarization' still lets everything render: the fix for it is a switch
  // inside the options block, and hiding the block would leave the notice above
  // pointing at a control that isn't there.
  const sendable = !!capabilities && !!choices && runtime !== 'no-worker';

  // A pond that has never heard of transcription is not a broken pond, and an
  // error row for it would be a permanent complaint about a feature nobody
  // asked for. Same reasoning as the perf panel's 'absent'.
  if (capStatus === 'absent' || !isConnected) return null;

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <View style={styles.iconContainer}>
          <Icon name="text-to-speech" size={20} color={tint} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>Transcribe audio</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {summary ? summary.text : 'Send a recording to the pond for a transcript'}
          </Text>
        </View>
      </View>

      {asking && (
        <View style={{ paddingTop: 16 }}>
          <ActivityIndicator size="small" color={c.textSecondary} />
        </View>
      )}

      {runtime === 'no-worker' && (
        <Text style={styles.dim}>
          This pond has no transcription worker installed, so there is nothing to
          send audio to yet.
        </Text>
      )}
      {runtime === 'no-diarization' && choices?.diarize && (
        <Text style={styles.dim}>
          This pond can transcribe but cannot separate speakers. Turn off
          “Separate speakers” below to send anyway.
        </Text>
      )}

      {/* ── Add ── */}
      {sendable && (
        <>
          <TouchableOpacity
            style={[styles.primaryButton, { borderColor: tint }]}
            activeOpacity={0.8}
            disabled={busy}
            onPress={() => {
              tapHaptic();
              setSourceOpen((v) => !v);
              if (!pondAudio && !pondAudioLoading) loadPondAudio();
            }}
            accessibilityRole="button"
            accessibilityState={{ expanded: sourceOpen }}
            accessibilityLabel="Choose an audio to transcribe"
          >
            <Icon name={sourceOpen ? 'close' : 'plus'} size={16} color={tint} />
            <Text style={[styles.primaryButtonText, { color: tint }]}>
              {sourceOpen ? 'Cancel' : 'Send an audio'}
            </Text>
          </TouchableOpacity>

          {sourceOpen && (
            <View style={styles.sourceBlock}>
              <TouchableOpacity style={styles.sourceRow} onPress={sendVideoFromLibrary} accessibilityRole="button">
                <Icon name="video-outline" size={18} color={c.textSecondary} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.sourceTitle}>A video from this phone</Text>
                  <Text style={styles.sourceSub}>Only its audio is transcribed</Text>
                </View>
                <Icon name="chevron-right" size={20} color={c.textTertiary} />
              </TouchableOpacity>

              <Text style={styles.sectionLabel}>From this pond</Text>
              {pondAudioLoading && <ActivityIndicator size="small" color={c.textSecondary} />}
              {pondAudio?.length === 0 && !pondAudioLoading && (
                <Text style={styles.dim}>There is no audio in this pond’s vault yet.</Text>
              )}
              {(pondAudio || []).slice(0, 60).map((item) => (
                <TouchableOpacity
                  key={String(item.id)}
                  style={styles.sourceRow}
                  onPress={() => sendPondAudio(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Transcribe ${titleOf(item)}`}
                >
                  <Icon name="waveform" size={18} color={c.textSecondary} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.sourceTitle} numberOfLines={1}>{titleOf(item)}</Text>
                    <Text style={styles.sourceSub} numberOfLines={1}>
                      {[formatDuration(item.duration), formatBytes(item.size)].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={20} color={c.textTertiary} />
                </TouchableOpacity>
              ))}
              {(pondAudio?.length || 0) > 60 && (
                <Text style={styles.footnote}>
                  Showing the 60 most recent of {pondAudio.length}.
                </Text>
              )}
            </View>
          )}

          {/* ── Options ── */}
          <TouchableOpacity
            style={styles.optionsRow}
            onPress={() => { tapHaptic(); setOptionsOpen((v) => !v); }}
            accessibilityRole="button"
            accessibilityState={{ expanded: optionsOpen }}
            accessibilityLabel="Transcription options"
          >
            <Icon name="tune-variant" size={16} color={c.textTertiary} />
            <Text style={styles.optionsSummary} numberOfLines={1}>
              {summariseChoices(choices, capabilities)}
            </Text>
            <Icon name={optionsOpen ? 'chevron-up' : 'chevron-down'} size={20} color={c.textTertiary} />
          </TouchableOpacity>

          {optionsOpen && (
            <View style={styles.optionsBlock}>
              <Text style={styles.sectionLabel}>Model</Text>
              <View style={styles.chipRow}>
                {(capabilities?.models || []).map((model) => {
                  const selected = model === choices.model;
                  return (
                    <TouchableOpacity
                      key={model}
                      onPress={() => { tapHaptic(); setChoices((v) => ({ ...v, model })); }}
                      style={[styles.chip, selected && { backgroundColor: c.surfaceHighlight || c.border, borderColor: tint }]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${model}${modelNote(model) ? `, ${modelNote(model)}` : ''}`}
                    >
                      <Text style={[styles.chipText, selected && { color: c.textPrimary }]}>{model}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.footnote}>
                {modelNote(choices.model)
                  ? `${choices.model} is ${modelNote(choices.model)}. Bigger models are more accurate and take longer on the pond’s GPU.`
                  : 'Bigger models are more accurate and take longer on the pond’s GPU.'}
              </Text>

              <View style={styles.switchRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.optionTitle}>Separate speakers</Text>
                  <Text style={styles.optionSub}>Label who said what, instead of one block of text</Text>
                </View>
                <Switch
                  value={choices.diarize}
                  onValueChange={(value) => { tapHaptic(); setChoices((v) => ({ ...v, diarize: value })); }}
                  trackColor={{ false: c.border, true: tint }}
                />
              </View>

              {choices.diarize && (
                <>
                  <Text style={styles.sectionLabel}>How many speakers</Text>
                  <View style={styles.stepperRow}>
                    <Stepper
                      label="At least"
                      value={choices.minSpeakers}
                      onChange={(value) => setChoices((v) => clampChoices({ ...v, minSpeakers: value }, capabilities, 'minSpeakers'))}
                      styles={styles}
                      colors={c}
                    />
                    <Stepper
                      label="At most"
                      value={choices.maxSpeakers}
                      onChange={(value) => setChoices((v) => clampChoices({ ...v, maxSpeakers: value }, capabilities, 'maxSpeakers'))}
                      styles={styles}
                      colors={c}
                    />
                  </View>

                  <Text style={styles.sectionLabel}>Main speaker’s name</Text>
                  <TextInput
                    style={styles.input}
                    value={choices.primaryName}
                    onChangeText={(value) => setChoices((v) => ({ ...v, primaryName: value }))}
                    placeholder="Primary"
                    placeholderTextColor={c.textTertiary}
                    maxLength={64}
                    accessibilityLabel="Name for the main speaker"
                  />
                  <Text style={styles.footnote}>
                    Whoever talks most is labelled with this; everyone else
                    becomes Person 2, Person 3, and so on.
                  </Text>
                </>
              )}

              <Text style={styles.sectionLabel}>Language</Text>
              <TextInput
                style={styles.input}
                value={choices.language}
                onChangeText={(value) => setChoices((v) => ({ ...v, language: value }))}
                placeholder="Detect automatically"
                placeholderTextColor={c.textTertiary}
                autoCapitalize="none"
                maxLength={3}
                accessibilityLabel="Language code, or empty to detect it automatically"
              />
              <Text style={styles.footnote}>
                A two- or three-letter code like en or fra. Leave it empty and
                the pond works it out from the audio.
              </Text>
            </View>
          )}
        </>
      )}

      {/* ── The recordings ── */}
      {recordings.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Recordings</Text>
          {recordings.map((row) => (
            <RecordingRow
              key={row.key}
              recording={row}
              expanded={expandedKey === row.key}
              transcript={expandedKey === row.key ? transcript : null}
              transcriptError={expandedKey === row.key ? transcriptError : null}
              loadingTranscript={expandedKey === row.key && loadingTranscript}
              onPress={() => openTranscript(row)}
              onCancel={() => cancelRecording(row)}
              onDelete={() => deleteRecording(row)}
              onCopy={async () => {
                if (!transcript?.text) return;
                await Clipboard.setStringAsync(transcript.text);
                notifyHaptic();
              }}
              onShare={() => {
                if (!transcript?.text) return;
                Share.share({ message: transcript.text, title: row.name }).catch(() => {});
              }}
              styles={styles}
              colors={c}
            />
          ))}
        </>
      )}

      {sendable && recordings.length === 0 && !sourceOpen && (
        <Text style={styles.footnote}>
          Nothing sent yet. Transcripts stay on the pond and are kept for about
          a month.
        </Text>
      )}

      {capStatus === 'error' && (
        <Text style={styles.dim}>Couldn’t ask the pond what it can transcribe.</Text>
      )}
    </View>
  );
}

/** A −/+ pair. Two of these are clearer than a range slider for a 1..10 span. */
function Stepper({ label, value, onChange, styles, colors }) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.optionSub}>{label}</Text>
      <View style={styles.stepperControls}>
        <TouchableOpacity
          onPress={() => { tapHaptic(); onChange(value - 1); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`${label}: one fewer`}
        >
          <Icon name="minus-circle-outline" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.stepperValue}>{value}</Text>
        <TouchableOpacity
          onPress={() => { tapHaptic(); onChange(value + 1); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`${label}: one more`}
        >
          <Icon name="plus-circle-outline" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

/**
 * The server's sanitized rejection, in the words of someone who just pressed a
 * button. The uploader wraps the body in "HTTP 415: {json}", which is a
 * diagnostic, not a sentence.
 */
function friendlyUploadError(error) {
  const status = statusOfError(error);
  const known = {
    413: 'That file is bigger than this pond accepts',
    415: 'The pond cannot read that file, or it has no audio in it',
    422: 'That recording is longer than this pond allows',
    429: 'Too many transcriptions on the go — try again shortly',
    503: 'The pond’s transcription worker is busy or offline',
  };
  return known[status] || 'The pond would not accept that recording';
}

const makeStyles = (theme) => {
  const c = theme.colors;
  return StyleSheet.create({
    // Matches SidecarStatusCard exactly — stacked Settings cards must line up
    // edge to edge, and a card with its own inset reads as a mistake.
    section: {
      backgroundColor: c.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
      borderWidth: 0.5,
      borderColor: c.border,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center' },
    iconContainer: {
      width: 36, height: 36, borderRadius: 8,
      backgroundColor: c.surfaceElevated,
      justifyContent: 'center', alignItems: 'center', marginRight: 12,
    },
    title: { fontSize: 17, fontWeight: '700', color: c.textPrimary },
    subtitle: { fontSize: 12.5, color: c.textTertiary, marginTop: 2 },

    primaryButton: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      marginTop: 16, paddingVertical: 11, borderRadius: 10, borderWidth: 1,
    },
    primaryButtonText: { fontSize: 14, fontWeight: '700' },

    sourceBlock: { marginTop: 8 },
    sourceRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
    },
    sourceTitle: { fontSize: 14, color: c.textPrimary, fontWeight: '600' },
    sourceSub: { fontSize: 11.5, color: c.textTertiary, marginTop: 1 },

    optionsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
    optionsSummary: { flex: 1, minWidth: 0, fontSize: 12.5, color: c.textSecondary },
    optionsBlock: { paddingBottom: 4 },
    optionTitle: { fontSize: 14, color: c.textPrimary, fontWeight: '600' },
    optionSub: { fontSize: 11.5, color: c.textTertiary, marginTop: 1 },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },

    sectionLabel: {
      fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: c.textTertiary,
      textTransform: 'uppercase', marginTop: 18, marginBottom: 8,
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
    },
    chipText: { fontSize: 12, fontWeight: '600', color: c.textTertiary },

    stepperRow: { flexDirection: 'row', gap: 12 },
    stepper: {
      flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10,
      backgroundColor: c.surfaceElevated,
    },
    stepperControls: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginTop: 6,
    },
    stepperValue: {
      fontSize: 17, fontWeight: '700', color: c.textPrimary,
      fontVariant: ['tabular-nums'],
    },

    input: {
      backgroundColor: c.surfaceElevated, borderRadius: 10,
      paddingHorizontal: 12, paddingVertical: 10,
      color: c.textPrimary, fontSize: 14,
      borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
    },

    recording: {
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
      gap: 7,
    },
    recordingHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    recordingName: { fontSize: 14, fontWeight: '600', color: c.textPrimary },
    recordingMeta: { fontSize: 11.5, marginTop: 2 },
    barTrack: { height: BAR_H, borderRadius: BAR_H / 2, overflow: 'hidden' },
    barFill: { height: '100%', borderRadius: BAR_H / 2 },

    transcript: { paddingTop: 6, gap: 12 },
    turn: { gap: 2 },
    turnHead: { fontSize: 11.5 },
    turnSpeaker: { fontWeight: '700', color: c.textSecondary },
    turnTime: { color: c.textMuted, fontVariant: ['tabular-nums'] },
    turnText: { fontSize: 13.5, color: c.textPrimary, lineHeight: 19 },
    transcriptActions: { flexDirection: 'row', gap: 10, paddingTop: 4 },
    smallButton: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9,
      backgroundColor: c.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth, borderColor: c.border,
    },
    smallButtonText: { fontSize: 12, fontWeight: '600', color: c.textSecondary },

    dim: { fontSize: 12.5, color: c.textTertiary, lineHeight: 18, marginTop: 12 },
    footnote: { fontSize: 11, color: c.textMuted, lineHeight: 16, marginTop: 8 },
  });
};
