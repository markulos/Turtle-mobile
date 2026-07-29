# Share to Audio and Reusable Video-to-Audio Conversion

## Goal

Turtle accepts audio, video, and links from the mobile operating-system share
sheet and saves playable audio into the Music Vault. Existing audio files are
preserved without a lossy re-encode. Video files and video-backed links are
downloaded or uploaded, converted by the backend to high-quality M4A/AAC, and
then added to the `Audio` album.

The conversion layer is intentionally reusable so future Turtle features can
request video-to-audio conversion without duplicating FFmpeg process handling,
probing, cleanup, or media ingestion.

## Current State

The native share-intent library already supplies text, web URLs, images, audio,
video, and generic file references. `ShareTargetScreen` currently keeps only
`image/*` files, however, so audio and video shares are silently reduced to an
empty request. Android also advertises video sharing while omitting `audio/*`
and generic-file intent filters.

The backend already has:

- a durable `download_jobs` queue;
- yt-dlp acquisition for supported streaming pages;
- a guarded ghost downloader for direct URLs;
- FFmpeg and ffprobe binaries;
- ingestion that can classify a downloaded `audio/*` file;
- a Music Vault gallery filtered by `media.type = 'audio'`.

It does not yet support audio through the normal multipart upload path, does
not extract audio from video, and only starts a ghost download when a link is
shared to the special `Download` album.

## Chosen Architecture

Use one backend media-import pipeline with an explicit output intent:

```text
outputKind = "source" | "audio"
```

The existing download queue remains the durable owner of URL imports. Its
schema is extended so deduplication and processing account for the requesting
user, destination album, and output kind.

Multipart file uploads continue using the existing streaming upload endpoint.
When `outputKind=audio`, the endpoint stages the uploaded file and hands it to
the same probe, transform, and ingest services used by URL jobs. The HTTP
request returns an accepted job response after the source is durably staged;
FFmpeg work does not hold open the mobile share request.

The shared processing path is:

```text
source acquisition
  -> authoritative ffprobe
  -> optional video-to-audio transform
  -> transactional media ingest
  -> Audio album / media index
  -> temporary-file cleanup
```

## Mobile Share Classification

Classification uses each native file entry, not only the share intent's broad
`type` field:

1. Use a specific MIME type when present.
2. For missing or `application/octet-stream` MIME, fall back to a conservative
   filename-extension map.
3. Keep audio, video, image, and unsupported generic files distinct.
4. Treat a valid HTTP(S) web URL as a downloadable source, not as proof of its
   media type. The backend decides after acquisition and ffprobe.

The first-class `Audio — Save to Music Vault` destination appears when the
share contains:

- one or more audio files;
- one or more video files; or
- a valid HTTP(S) web URL.

For audio files the subtitle says the original will be preserved. For video
files and links it says Turtle will extract the audio. Unsupported document
files do not expose the Audio target and produce a clear unsupported-file
message instead of an empty share.

Android registers `audio/*` for single and multiple shares and retains video
support. iOS retains generic-file support and explicitly accepts movie content
where required by the share-extension configuration.

Large audio and video files are streamed with the existing native
`expo-file-system` upload mechanism. They are never converted to base64 in
JavaScript.

## API Contracts

### URL import

`POST /api/downloads`

```json
{
  "url": "https://example.test/watch/123",
  "outputKind": "audio",
  "album": "Audio"
}
```

The authenticated caller owns the job. `outputKind` defaults to `source` and
`album` defaults to `Download` so existing callers remain compatible.

### Share convenience route

`POST /api/share` keeps its existing contract. When the selected board is:

```json
{ "kind": "album", "name": "Audio" }
```

and the payload contains a valid HTTP(S) URL, it enqueues the same audio-output
download job and returns its job ID with the normal share response.

### File import

`POST /api/media/upload` keeps its existing multipart file field `media` and
accepts:

```text
outputKind=audio
album=Audio
tags=["Audio"]
```

For this intent, only sources with an audio stream are accepted. The response
uses HTTP 202 and returns `{ success: true, queued: true, jobId }` after the
source file has been durably staged.

## Probe and Conversion Contract

FFprobe output, not the declared MIME type or extension, is authoritative.

- Audio-only source: preserve the original file and container.
- Video source with audio: select the first audio stream and create M4A/AAC.
- Source with no audio stream: fail with `Source contains no audio stream`.
- Corrupt or unprobeable source: fail without creating a media row.

Video conversion uses:

```text
container: M4A
codec: AAC-LC
bitrate: 192 kbps
channels: stereo
sample rate: 48 kHz
video streams: removed
fast-start metadata: enabled
```

The backend launches the bundled FFmpeg/ffprobe executables directly through a
small process runner rather than adding new work to the deprecated
`fluent-ffmpeg` wrapper. The runner:

- captures bounded diagnostic output;
- has an abort signal and hard timeout;
- kills the child process on cancel, timeout, or server shutdown;
- writes output inside the owning job directory;
- removes partial output after failure.

Only one audio transcode runs at a time by default. Downloads may retain their
existing concurrency, but a semaphore prevents three simultaneous FFmpeg
processes from exhausting CPU and temporary disk. The concurrency and timeout
remain server constants that can become environment settings later.

## Queue and Data Model

`download_jobs` gains enough intent metadata to represent URL and staged-file
imports without breaking existing jobs:

```text
input_kind   "url" | "upload"
source_path  nullable durable staged path
output_kind  "source" | "audio"
album        destination album
```

URL-job deduplication keys on normalized URL, user ID, destination album, and
output kind. A normal `Download` request must not accidentally reuse an
existing `Audio` conversion, and one user's job must never satisfy another
user's request. Local uploads are not URL-deduplicated.

The `Audio` album is seeded and pinned as a share destination. Successful
audio-output ingestion persists:

```text
media.type       = "audio"
media.mimeType   = probed output MIME
media.tags       includes "Audio"
media.duration   = probed duration
media.user_id    = authenticated caller
source_folder    = "ghost-download" or "upload"
originalPath     = source URL when applicable
```

Album creation and tag membership are kept consistent. The albums endpoint
includes seeded empty albums instead of deriving its entire result only from
existing media tags.

## Reliability and Resource Safety

- Multipart imports have an explicit configurable file-size ceiling matching
  the downloader's default 2 GiB ceiling; unlimited temporary disk growth is
  removed.
- Every staged source and converted output belongs to one job directory.
- Success, cancellation, terminal error, and retry cleanup are deterministic.
- A media row is committed only after validation and final-file placement are
  ready; failed derivative/database work cannot leave an apparently successful
  job.
- Gallery cache keys include `kind`, fixing ineffective audio-page caching.
- Queue events and job status expose `downloading`, `converting`, `ingesting`,
  `done`, and a concise terminal error.
- Existing `outputKind=source` download behavior stays backward compatible.

The broader audit found that authentication enforcement can run in a
development fail-open mode and that raw media URLs are capability-like public
paths. Those policies affect the whole application and are reported
separately; this feature still scopes jobs and database rows to the resolved
authenticated user wherever authentication is enabled.

## User Experience

The share sheet dismisses as soon as the backend accepts the job. Turtle shows
`Queued for Music Vault` rather than claiming conversion has already finished.
Existing share-upload status UI is generalized from image-only terminology to
file/import terminology.

Once ingestion completes, the item appears in
`/api/media/gallery?kind=audio` and therefore in Music Vault. The native Track
Player queue refreshes its library without interrupting an already-playing
queue.

Failures are actionable:

- unsupported file;
- source contains no audio;
- download failed;
- conversion timed out;
- server storage limit reached.

## Testing

Backend automated tests cover:

- strict audio/video/no-audio probe classification;
- original audio preservation;
- deterministic M4A/AAC command construction;
- conversion success, timeout, abort, and partial-file cleanup;
- direct audio URL and video URL imports;
- streamed audio and video file imports;
- deduplication by user, album, and output intent;
- `Audio` album seeding/pinning;
- `gallery?kind=audio` visibility and cache separation.

Mobile automated tests cover:

- MIME-first and extension-fallback classification;
- Audio target visibility for audio, video, and valid URLs;
- rejection of unsupported documents;
- streaming multipart parameters for audio/video files;
- URL routing through the share convenience endpoint;
- queue-accepted status and retry behavior.

End-to-end device checks share:

- a recording-app audio file;
- a local video file;
- a direct audio URL;
- a supported streaming/video page URL.

Each item must eventually appear in Music Vault and play through the native
background queue and lock-screen controls.

## Out of Scope

- editing ID3/MP4 tags beyond the metadata already available;
- waveform generation;
- choosing among multiple audio streams;
- lossless extraction when the video already contains a compatible AAC stream;
- bulk playlist import;
- DRM bypass;
- conversion of arbitrary document formats;
- a general-purpose user-facing conversion screen.
