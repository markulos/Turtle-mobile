import fs from 'fs';
import path from 'path';

/**
 * THE TITLE PICKS THE BOARD, THE KEY DOES THE FILTERS.
 *
 * Both used to call setFilterOpen, so the scope the title names was changed
 * three taps inside a sheet about something else, and the board list — the
 * long one, the one worth searching — was the part buried. They are two
 * controls because they answer two questions, and a scan is what keeps them
 * that way: wiring the title back to the filter panel would not look broken,
 * it would just quietly put the board picker back where nobody finds it.
 */
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.jsx'), 'utf8');

/** The onPress a given testID's control carries. */
function onPressFor(testID) {
  const at = SRC.indexOf(`testID="${testID}"`);
  if (at < 0) return null;
  // Walk back to the opening tag, then read the block that declares it.
  const open = SRC.lastIndexOf('<TouchableOpacity', at);
  const block = SRC.slice(open, at);
  const m = block.match(/onPress=\{\(\) => ([^}]+)\}/);
  return m ? m[1].trim() : null;
}

describe('the Notes header has two separate keys', () => {
  test('the title goes straight to the board / topic search', () => {
    expect(onPressFor('notes-scope-key')).toBe('setTopicSearchOpen(true)');
  });

  test('the filter key opens the filters, and nothing else does', () => {
    expect(onPressFor('notes-filter-key')).toBe('setFilterOpen(true)');
  });

  test('they are not the same control wearing two icons', () => {
    expect(onPressFor('notes-scope-key')).not.toBe(onPressFor('notes-filter-key'));
  });
});
