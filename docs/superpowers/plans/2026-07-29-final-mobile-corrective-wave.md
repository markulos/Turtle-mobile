# Final Mobile Corrective Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the final mobile review blockers around music lifecycle, native queue controls, account transitions, authenticated transfer ownership, upload idempotency, and process-death staging recovery.

**Architecture:** Authentication exposes a stable JWT-derived user identity and a non-secret token generation fingerprint. Playback and transfer owners serialize or abort work at identity-generation boundaries. Native queue capability state lives in the controller/service, while upload persistence and staging cleanup use owner-aware manifests.

**Tech Stack:** React Native 0.81, Expo 54, React 19, `@rntp/player` 5.8, Socket.IO client 4.8, Expo FileSystem/SecureStore/Crypto, AsyncStorage, Jest 29.

## Global Constraints

- Work only in `D:\hobby PROJECTS\TURTLE APP\mobile-app\.worktrees\background-audio-player` from base `fdf0c64`.
- Use strict RED → GREEN → REFACTOR TDD for every production behavior change.
- Do not edit backend code, generated native projects, Expo configuration, Live Activity configuration, or share-extension configuration.
- Preserve image, text, and ordinary link sharing; Vault upload UX; in-app final-track Next disabling; and provider ordering semantics.
- Never persist bearer tokens.
- Every staged audio/video file receives one stable, distinct `clientImportId` before its first upload attempt, and retries reuse it.
- Logout/account changes must prevent stale work from using a new account token or clearing a new account queue.

---

### Task 1: Authentication identity boundary

**Files:**
- Create: `utils/authIdentity.js`
- Create: `utils/__tests__/authIdentity.test.js`
- Modify: `context/AuthContext.js`
- Modify: `App.js`

**Interfaces:**
- Produces: `getAuthIdentity(token)` and `getAuthTokenGeneration(token)`.
- Produces: `useAuth()` fields `authIdentity` and `authGeneration`.
- Moves `ShareUploadProvider` and `VaultUploadProvider` below `AuthProvider` without changing their relative order or app overlays.

- [ ] Write tests proving stable user claims produce the same identity across token refreshes, distinct users differ, malformed tokens fail closed to a non-secret fingerprint, and generation changes with token changes.
- [ ] Run the identity tests and verify they fail because the utility does not exist.
- [ ] Implement base64url payload decoding plus a deterministic non-secret fingerprint fallback.
- [ ] Run the identity tests and TypeScript check.
- [ ] Move upload providers inside authentication and commit the boundary.

### Task 2: Playback refresh, setup recovery, and account teardown serialization

**Files:**
- Modify: `context/MusicPlayerContext.jsx`
- Modify: `context/__tests__/MusicPlayerContext.test.jsx`
- Modify: `screens/TurtleScreen/components/MusicVault.jsx`
- Modify: `screens/TurtleScreen/components/__tests__/MusicVault.test.jsx`

**Interfaces:**
- `useMusicPlayer()` separates `setupError`, `libraryError`, and command error while retaining compatibility through `error`.
- Produces: `retrySetup()` and a coalescing `refreshLibrary()`.
- Consumes: `useMediaVersion()` and `AppState`.

- [ ] Add tests for debounced media-version refresh, Vault open/focus refresh, retained tracks during refresh/error, setup error isolation, failure → retry → ready, command-triggered recovery, foreground recovery, and rapid A → logout → B teardown ordering.
- [ ] Run the focused context/Vault tests and verify each new behavior fails for the expected missing boundary.
- [ ] Implement request coalescing and session-generation checks without clearing retained tracks on refresh.
- [ ] Serialize session transitions so B setup/commands wait for A teardown, and make setup retries single-flight with one attempt per explicit trigger.
- [ ] Add the production retry control and open/focus refresh.
- [ ] Run focused playback tests and commit.

### Task 3: Native final-track Next capability

**Files:**
- Modify: `services/musicPlayerController.js`
- Modify: `services/musicPlayerService.js`
- Modify: `services/__tests__/musicPlayerController.test.js`
- Modify: `services/__tests__/musicPlayerService.test.js`

**Interfaces:**
- Controller tracks queue length/current index and exposes `handleActiveIndexChanged(index)`.
- Adapter exposes `setNextEnabled(enabled)`.
- Service handles `MediaItemTransition` in foreground/iOS background and Android background service events.

- [ ] Add controller/service tests for an initial final item, automatic transition to final, previous from final, queue replacement, and harmless final Remote Next.
- [ ] Run the tests and verify RED on missing dynamic capability behavior.
- [ ] Implement queue-position state, guarded Next, and dynamic command registration while preserving Previous/Play-Pause/Seek.
- [ ] Register native transition handlers at module load without changing app/native configuration.
- [ ] Run focused playback tests and commit.

### Task 4: Abortable multipart transfer and stable idempotency

**Files:**
- Modify: `services/streamMultipartUpload.js`
- Modify: `services/__tests__/streamMultipartUpload.test.js`
- Modify: `context/ShareUploadContext.jsx`
- Modify: `context/__tests__/ShareUploadContext.test.jsx`
- Modify: `context/VaultUploadContext.jsx`
- Create: `context/__tests__/VaultUploadContext.test.jsx`

**Interfaces:**
- `streamMultipartUpload(options)` accepts `signal` and cancels the native upload task without retrying after abort.
- Audio/video upload `parameters.clientImportId` remains byte-for-byte stable across all attempts.
- Share and Vault jobs store immutable `ownerIdentity`, `authGeneration`, and per-file IDs; bearer tokens remain memory-only.

- [ ] Add failing tests for multipart abort, stable retry IDs, distinct per-file IDs, A → B cancellation, no B-token reuse, per-user Vault keys, mismatched resume rejection, and visible-state clearing.
- [ ] Run focused transfer tests and verify RED.
- [ ] Implement abort-aware streaming and immutable owner checks at every async boundary.
- [ ] Add stable IDs at staging/enqueue and persist only IDs/owner metadata.
- [ ] Namespace Vault persistence by identity and pause/quarantine old-account batches.
- [ ] Run focused transfer tests and commit.

### Task 5: Download socket authentication generation

**Files:**
- Modify: `context/DownloadsContext.jsx`
- Create: `context/__tests__/DownloadsContext.test.jsx`

**Interfaces:**
- Socket lifecycle consumes `token`, `authIdentity`, `authGeneration`, and `isAuthenticated`.
- Each auth generation owns one socket and one guarded REST refresh.

- [ ] Add failing A → B tests proving old jobs clear, the old socket disconnects, a new socket receives B’s current token, stale A events/responses are ignored, and the client never emits a user-selected room join.
- [ ] Run the focused tests and verify RED.
- [ ] Implement generation-scoped refresh/event handlers and reconnect dependencies.
- [ ] Run focused socket tests and commit.

### Task 6: Owner-aware share staging recovery and quota

**Files:**
- Create: `services/shareUploadStaging.js`
- Create: `services/__tests__/shareUploadStaging.test.js`
- Modify: `context/ShareUploadContext.jsx`
- Modify: `utils/cacheManager.js`
- Modify: `context/__tests__/ShareUploadContext.test.jsx`

**Interfaces:**
- Per-job `manifest.json` stores owner, retry state, stable IDs, owned paths, and timestamps but no bearer token.
- `sweepShareUploadStaging({ ownerIdentity, activeDirectories, forceOwnerCleanup })` deletes abandoned/foreign/terminal staging and retains known active/retry jobs.
- `assertShareStagingCapacity(files)` enforces a total staging quota and a free-space reserve when Expo reports capacity.

- [ ] Add failing tests for orphan cleanup, active/retry retention, foreign-owner cleanup, logout cleanup, quota rejection, and manifest ID retention.
- [ ] Run focused staging tests and verify RED.
- [ ] Implement manifests, startup restoration as retryable state, owner-aware sweeping, and capacity checks.
- [ ] Include the staging sweep in cache maintenance without deleting active/retry copies.
- [ ] Run focused staging/share tests and commit.

### Task 7: Verification and report

**Files:**
- Create: `.superpowers/sdd/2026-07-28-background-music-lock-screen-controls/final-fix-mobile-report.md`

- [ ] Run every focused suite changed in Tasks 1–6.
- [ ] Run full Jest and confirm all prior 78 plus new tests pass.
- [ ] Run `npx tsc --noEmit`.
- [ ] Run `npx expo config --type public` and `npx expo config --type introspect`.
- [ ] Inspect `git diff --check`, full diff, and status; confirm no backend/generated-native/config changes.
- [ ] Write commits, tests, behavioral evidence, and remaining concerns into the requested report.
- [ ] Commit the report and perform a final fresh verification pass.
