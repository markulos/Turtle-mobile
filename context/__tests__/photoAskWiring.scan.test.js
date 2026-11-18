const fs = require('fs');
const path = require('path');

/**
 * THE SYSTEM SHEET IS NO LONGER WHAT ASKS.
 *
 * Mark, 2026-11-18: "remove the prompt that asks to autosave photos. make it
 * ask once on uploading images but also have a checkmark for never ask
 * again."
 *
 * `processBatch` opened every upload with a bare
 * `MediaLibrary.requestPermissionsAsync()` — the iOS sheet carrying our own
 * "back up and sync your camera roll" sentence, fired for a batch of PDFs,
 * fired again for somebody who had already declined, and (with access granted
 * as LIMITED) re-presenting the photo picker at the top of every single
 * upload. A system sheet has nowhere to put a "never again", which is why the
 * ask had to move in front of it.
 *
 * services/photoAccessPrompt and components/PhotoAccessAsk have the behaviour
 * under test. What is pinned HERE is the one line nobody would notice coming
 * back: a direct permission request inside the uploader puts the old prompt
 * on every upload again, and it would look completely reasonable in a diff.
 */

const read = (...parts) => fs.readFileSync(path.resolve(__dirname, '..', '..', ...parts), 'utf8');
const UPLOAD = read('context', 'VaultUploadContext.jsx');
const APP = read('App.js');

/**
 * Source with its comments taken out.
 *
 * The note above the new call NAMES the call it replaced — that note is the
 * thing that stops this coming back — so the ban has to be on the code.
 */
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the uploader', () => {
  test('NEVER asks the OS for photo permission itself', () => {
    // The whole bug, in one call. `getAssetInfoAsync` / `deleteAssetsAsync`
    // stay: they USE the permission, they do not prompt for it.
    expect(code(UPLOAD)).not.toMatch(/MediaLibrary\.requestPermissionsAsync/);
    expect(UPLOAD).toMatch(/MediaLibrary\.getAssetInfoAsync/);
    // …and the note that names it is still there, because the note is what
    // stops somebody re-adding it in good faith.
    expect(UPLOAD).toMatch(/system sheet at the/);
  });

  test('…it raises Turtle’s own question instead, over the batch’s items', () => {
    // The items are what decide whether there is a photo in this upload at
    // all — a documents-only batch must not ask about a photo library.
    expect(UPLOAD).toMatch(/askPhotoAccessIfDue\(batch\.items\)/);
    expect(UPLOAD).toMatch(
      /import \{ askPhotoAccessIfDue \} from '\.\.\/services\/photoAccessPrompt'/
    );
  });

  test('…and NEVER waits for the answer', () => {
    // The permission is optional — picker URIs work for the session they were
    // picked in — so an upload that blocks on a question is a worse app than
    // one that asks over the top of a running transfer. The `.catch` is what
    // makes an un-awaited promise safe.
    expect(UPLOAD).toMatch(/askPhotoAccessIfDue\(batch\.items\)\.catch\(\(\) => \{\}\);/);
    expect(UPLOAD).not.toMatch(/await askPhotoAccessIfDue/);
  });
});

describe('the question', () => {
  test('is mounted at the app ROOT, where an upload outlives its screen', () => {
    // Started from the photo vault, answered on whatever tab you have wandered
    // to by the time it appears.
    expect(APP).toMatch(/import PhotoAccessAsk from '\.\/components\/PhotoAccessAsk'/);
    expect(APP).toMatch(/<PhotoAccessAsk \/>/);
    // Inside an ErrorBoundary like every other root-level widget: a throw here
    // must not take the app down mid-upload.
    expect(APP).toMatch(/label="photo access ask"[^>]*><PhotoAccessAsk \/><\/ErrorBoundary>/);
  });
});
