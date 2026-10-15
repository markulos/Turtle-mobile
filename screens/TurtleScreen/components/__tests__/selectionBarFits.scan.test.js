import fs from 'fs';

/**
 * THE BULK-ACTION BAR FITS THE PHONE IT IS ON.
 *
 * It used to be `alignSelf: 'center'` with every action at its natural width,
 * so the bar was as wide as its contents wanted and the screen had no say: on
 * a 390pt phone the count badge ran off the left edge and Delete off the
 * right, and the widest, most destructive action was the one you could not
 * read. Two of its five keys — Tag and Album — also wrote the SAME row, an
 * album on this pond being a registered tag, so one of them was width spent on
 * a choice that did not exist.
 *
 * It stretches to the wrapper's inset now and the actions divide what is left,
 * which is the only arrangement that cannot overflow at any width.
 *
 * ─── Why a source scan ─────────────────────────────────────────────────────
 *
 * MediaGallery is six and a half thousand lines over expo-video, Reanimated,
 * gesture-handler, FlashList and four contexts. What regressed here is
 * LAYOUT — and a jsdom render has no widths to measure anyway, so a render
 * test could not catch the overflow even if the component mounted. What it
 * CAN be held to is the rule: no fixed-width centring, every action flexes,
 * one filing key.
 */
const SRC = fs.readFileSync('screens/TurtleScreen/components/MediaGallery.jsx', 'utf8');

/** The pill, from its bezel to the end of the Delete action. */
const bar = (() => {
  const from = SRC.indexOf('<Animated.View style={[styles.selectBezel, styles.selectActions]}>');
  if (from < 0) throw new Error('the bulk-action bar is gone — this scan is reading the wrong file');
  const to = SRC.indexOf('</Animated.View>', from);
  return SRC.slice(from, to);
})();

/** The style block the bar is drawn from. */
const barStyles = (() => {
  const from = SRC.indexOf('selectActions: {');
  if (from < 0) throw new Error('selectActions is gone — the bar is laid out inline again');
  return SRC.slice(from, SRC.indexOf('container: {', from));
})();

describe('it cannot be wider than the screen', () => {
  test('the pill stretches to its wrapper instead of centring at its own width', () => {
    expect(barStyles).toMatch(/alignSelf: 'stretch'/);
    expect(bar).not.toMatch(/alignSelf: 'center'/);
  });

  test('every action flexes, so the row divides rather than overflows', () => {
    expect(barStyles).toMatch(/selectAction: \{[^}]*flex: 1/s);
    // Three actions and the count badge. The badge is the one child that does
    // NOT flex — a number is as wide as it is.
    const flexed = bar.match(/styles\.selectAction,/g) || [];
    expect(flexed).toHaveLength(3);
  });

  test('the labels are one line, so a long one clips instead of pushing', () => {
    const labels = bar.match(/styles\.selectActionLabel/g) || [];
    expect(labels).toHaveLength(3);
    // Every one of them carries numberOfLines.
    expect(bar.match(/numberOfLines=\{1\}/g) || []).toHaveLength(3);
  });

  test('no action carries a width or a padding of its own any more', () => {
    // The inline `paddingHorizontal: 20` + per-divider margins were the width
    // the bar could not afford. One shared style, or they drift apart again.
    expect(bar).not.toMatch(/paddingHorizontal: 20/);
    expect(bar).not.toMatch(/marginHorizontal: 8/);
  });
});

describe('one filing key, not two', () => {
  test('Tag and Album are no longer separate keys in the bar', () => {
    expect(bar).toMatch(/testID="selection-add-to-album"/);
    // The Tag key's own icon and label are gone from the bar.
    expect(bar).not.toMatch(/tag-multiple/);
    expect(bar).not.toMatch(/>\s*Tag\s*</);
  });

  test('the three that remain are Share, Album and Delete', () => {
    for (const label of ['Share', 'Album', 'Delete']) {
      expect(bar).toMatch(new RegExp(`>\\s*${label}\\s*<`));
    }
  });

  test('tagging is still reachable — the picker carries the door', () => {
    expect(SRC).toMatch(/onEditTags=\{editTagsFromAlbumPicker\}/);
    const handover = SRC.slice(
      SRC.indexOf('const editTagsFromAlbumPicker = useCallback('),
      SRC.indexOf('}, [albumPickerFor, closeAlbumPicker, openBulkTags, openBulkTagsFor]'),
    );
    // The picker closes first — two sheets at once is two scrims.
    expect(handover).toMatch(/closeAlbumPicker\(\)/);
    // And the grid's selection goes through the path that CLEARS it after an
    // edit; only items handed in from elsewhere take the external one.
    expect(handover).toMatch(/if \(fromSelection\) openBulkTags\(\)/);
    expect(handover).toMatch(/else openBulkTagsFor\(items\)/);
  });
});
