import fs from 'fs';

/**
 * NOTES OPENS ON WHAT IS STILL WAITING.
 *
 * The list used to show every to-do ever ticked, newest first, so the things
 * actually left to do sank under a month of finished ones. It opens on the
 * OPEN ones now, with Done and Everything a tap away in the filter panel —
 * the Planner's three status keys, the Planner's default, on the other screen
 * that renders the same rows out of the same table.
 *
 * ─── Why a source scan ─────────────────────────────────────────────────────
 *
 * index.jsx is four thousand lines behind expo-video, Reanimated,
 * gesture-handler and the contexts — the reason feedbackFilter.js and
 * taskTodos.js exist as separate pure modules at all. The PREDICATE is unit
 * tested there (taskTodos.test.js). What cannot be tested there, and what
 * would regress silently, is the WIRING: a pipeline that stops applying it, a
 * count that stops agreeing with the list it sits above, or a default that
 * drifts off "open". All three are plain in the source.
 */
const SRC = fs.readFileSync('screens/NotesScreen/index.jsx', 'utf8');
const PANEL = fs.readFileSync('screens/NotesScreen/NotesFilterPanel.jsx', 'utf8');

describe('the default is open-only', () => {
  test('the state starts at the shared default, not at "all"', () => {
    expect(SRC).toMatch(/useState\(TODO_STATUS_DEFAULT\)/);
    // Imported, never spelled out again — a second literal 'todo' here is how
    // the two screens drift apart.
    expect(SRC).toMatch(/TODO_STATUS_DEFAULT/);
  });

  test('Clear restores open, rather than widening to everything', () => {
    const clear = SRC.slice(SRC.indexOf('onClearAll={'), SRC.indexOf('onClearAll={') + 260);
    expect(clear).toMatch(/setTodoStatus\(TODO_STATUS_DEFAULT\)/);
  });

  test('open-only does not light the filter key — it is the resting state', () => {
    expect(SRC).toMatch(/const statusScoped = todoStatus !== TODO_STATUS_DEFAULT/);
    expect(SRC).toMatch(/activeFilterCount = .*statusScoped \? 1 : 0/);
  });
});

describe('both list pipelines are scoped by it', () => {
  // `visible` is what the header counts; `listFor` is what the FlatList draws.
  // One without the other is a header that disagrees with its own rows.
  test.each([
    ['const visible = useMemo', 'the counted list'],
    ['const listFor = useCallback', 'the drawn list'],
  ])('%s applies the status filter (%s)', (anchor) => {
    const from = SRC.indexOf(anchor);
    expect(from).toBeGreaterThan(-1);
    const body = SRC.slice(from, SRC.indexOf('selectedTopic === UNTAGGED', from));
    expect(body).toMatch(/matchesTodoStatus\(n, todoStatus\)/);
  });

  test('the kind counts are tallied through the same scope', () => {
    const counts = SRC.slice(SRC.indexOf('const counts = useMemo'), SRC.indexOf('}, [timeline, serverCounts, todoStatus]'));
    expect(counts).toMatch(/matchesTodoStatus\(n, todoStatus\)/);
    // The server's note total counts a table with no completion in it, so it
    // is only still the better number while plain notes are being shown.
    expect(counts).toMatch(/todoStatus === 'done'/);
  });

  test('every pipeline that reads it also depends on it', () => {
    expect(SRC).toMatch(/\}, \[timeline, filter, todoStatus, selectedTopic\]\)/);
    expect(SRC).toMatch(/\}, \[visibleNotes, todoStatus, selectedTopic, pinnedSet\]\)/);
    expect(SRC).toMatch(/\}, \[timeline, serverCounts, todoStatus\]\)/);
  });
});

describe('the scope says so on screen', () => {
  test('the title carries it, like the kind and the topic do', () => {
    const scope = SRC.slice(SRC.indexOf('const scopeLabel = ['), SRC.indexOf("|| 'All'"));
    expect(scope).toMatch(/statusScoped \? TODO_STATUS_LABELS\[todoStatus\]/);
  });

  test('an empty Done list blames the scope, not the library', () => {
    // "No todos yet" over a Done filter is the opposite of the truth when
    // there are fifty open ones one tap away.
    expect(SRC).toMatch(/Nothing finished here yet/);
  });

  test('the panel has a Status section beside the other two', () => {
    expect(PANEL).toMatch(/title="Status"/);
    expect(PANEL).toMatch(/testID=\{`notes-filter-status-\$\{k\}`\}/);
    // And it counts as a narrowing only when it is not the default.
    expect(PANEL).toMatch(/status !== statusDefault/);
  });

  test('the screen hands the panel all three status keys', () => {
    expect(SRC).toMatch(/statuses=\{TODO_STATUS\}/);
    expect(SRC).toMatch(/statusLabels=\{TODO_STATUS_LABELS\}/);
    expect(SRC).toMatch(/onStatusChange=\{setTodoStatus\}/);
  });
});
