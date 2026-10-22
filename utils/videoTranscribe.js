/**
 * "Turn this video into words" — the rules, with no react-native in them.
 *
 * Two ways in, and which of them a pond can offer:
 *
 *   transcript — the pond transcribes the video itself. Its worker reads a
 *     video's audio already, so this asks nothing new of the server and
 *     leaves nothing new in the vault.
 *
 *   audio — the pond first lifts the audio out into a track of its own,
 *     filed beside the video (so it turns up in Files AND in Music), and
 *     transcribes that. Offered only where `features.audioExtract` says the
 *     endpoint exists; on an older pond the choice is absent with a reason
 *     rather than a button that can only fail.
 *
 * The web app's `videoTranscribe.ts` is the same rules for the same feature.
 * They are deliberately parallel: the wording a person reads should not
 * depend on which screen they happen to be holding.
 */

/** Both flags default FALSE: a pond that sends no `features` predates them. */
export function features(capabilities) {
  const f = capabilities?.features;
  return {
    mediaSubmit: f?.mediaSubmit === true,
    audioExtract: f?.audioExtract === true,
  };
}

/**
 * The choices to put in front of someone, in reading order. The plain
 * transcript leads: it is the one that always works and the one most people
 * came for.
 */
export function modeOffers(capabilities) {
  const canExtract = features(capabilities).audioExtract;
  return [
    {
      mode: 'transcript',
      title: 'Transcript only',
      detail: 'Reads the video’s audio and writes the transcript. Nothing new is added to Files.',
      icon: 'text-box-outline',
      available: true,
      why: null,
    },
    {
      mode: 'audio',
      title: 'Audio file and transcript',
      detail: 'Saves the audio as a track beside the video, then transcribes that.',
      icon: 'music-note-outline',
      available: canExtract,
      why: canExtract
        ? null
        : 'This pond cannot save the audio separately yet — it can still transcribe the video.',
    },
  ];
}

/** Where to start: the richer one when the pond has it, since it is the ask. */
export function defaultMode(capabilities) {
  return features(capabilities).audioExtract ? 'audio' : 'transcript';
}

/** A row this applies to: the vault called it a video, or its MIME did. */
export function isVideoItem(item) {
  if (!item) return false;
  if (item.type === 'video') return true;
  return String(item.mimeType || '').toLowerCase().startsWith('video/');
}

/** "Standup 2026-10-22.mp4" → "Standup 2026-10-22". */
export function itemTitle(item) {
  const raw = String(item?.originalName || item?.filename || '').trim();
  return raw.replace(/\.[a-z0-9]{2,5}$/i, '').trim() || raw || 'Video';
}

/**
 * Why this video cannot be sent from here, or null when it can. A phone
 * cannot do the conversion itself and will not pull a multi-gigabyte video
 * down just to push it back up, so a pond with no media-submit route is a
 * refusal with a reason rather than a silent fallback to the upload path.
 */
export function videoProblem(item, capabilities) {
  if (!isVideoItem(item)) return 'That is not a video.';
  if (!features(capabilities).mediaSubmit) {
    return 'This pond is too old to transcribe a file it already holds. Update the pond and try again.';
  }
  return null;
}
