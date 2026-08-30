/**
 * ErrorBoundary — the app's crash containment.
 *
 * ─── Why this exists ────────────────────────────────────────────────────────
 *
 * Until this file the app had NO boundary anywhere: no `componentDidCatch`, no
 * `getDerivedStateFromError`, in any component. React's default for an
 * uncaught render error is to unmount the entire tree, so a malformed value out
 * of AsyncStorage, a native module missing after a dev-client rebuild, or one
 * unexpected shape in a server payload took the whole app to a blank screen
 * rather than costing the one card that actually broke.
 *
 * ─── What a boundary can and cannot isolate ─────────────────────────────────
 *
 * A boundary replaces the subtree BELOW it, so where it sits decides what
 * survives. That matters here because the app's providers are nested thirteen
 * deep and each one wraps everything under it:
 *
 *   <Boundary><MusicPlayerProvider>{rest of the app}</MusicPlayerProvider></Boundary>
 *
 * would NOT save the rest of the app — the provider that threw is an ancestor
 * of all of it, so containing the throw still blanks everything inside. Wrapping
 * providers is therefore theatre, and this file is deliberately not used that
 * way. A provider that must survive its own bad state has to catch internally
 * and hand down a degraded value; that is a different fix and belongs in the
 * provider.
 *
 * Where a boundary genuinely isolates is anywhere the failing thing is a LEAF
 * or a SIBLING rather than an ancestor:
 *
 *   - one tab screen, so a crash in Photos leaves Tasks usable
 *   - the floating overlays (toasts, pills), which are siblings of the app
 *     content and have no business taking it down
 *   - a card inside a screen, most of all one rendering server- or
 *     model-supplied structure
 *
 * The root boundary is the exception that earns its place by not pretending: it
 * cannot save anything, but it converts a white screen into a message and a
 * Retry, which is the difference between "the app is broken" and "the app told
 * me what broke".
 *
 * ─── No theme, on purpose ───────────────────────────────────────────────────
 *
 * The fallback paints itself with literal, theme-independent colours and pulls
 * in no context at all. A boundary whose own render depends on ThemeProvider is
 * useless in the case that matters most — the one where ThemeProvider is what
 * threw. Neutral translucent greys read acceptably against either the light or
 * the dark surface, which is the price of being able to render unconditionally.
 *
 * ─── Not reported as telemetry ──────────────────────────────────────────────
 *
 * Tempting, since the app already posts passive samples to the pond. But
 * `routes/perf.js` treats the PRESENCE of `meta` on a sample as the failure
 * flag, and its contract is that the phone writes it on exactly two paths —
 * `http <status>` and `network-error`. Feeding crashes through that channel
 * would silently corrupt the failure counts the owner reads. Crashes go to the
 * console; giving them their own route is a separate change.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

/** Neutral enough to read on either surface — see "No theme, on purpose". */
const MUTED = '#8E8E93';
const DANGER = '#F87171';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    // React unmounts the subtree it caught a throw from, so clearing `error`
    // already rebuilds the children from scratch. The `key` bump is belt and
    // braces on top of that: it guarantees a new element identity even where
    // the caller passes a referentially stable `children`, so a retry can never
    // degrade into a no-op button.
    this.state = { error: null, key: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    const label = this.props.label || 'app';
    // The component stack is the only part that says WHERE, and it is dropped
    // by every crash reporter that only keeps `error.message`.
    console.error(`[ErrorBoundary:${label}]`, error?.message || error, info?.componentStack || '');
    try { this.props.onError?.(error, info); } catch { /* a reporting failure must not re-enter the boundary */ }
  }

  retry = () => {
    this.setState((prev) => ({ error: null, key: prev.key + 1 }));
  };

  render() {
    const { error, key } = this.state;
    const { children, label, compact = false, fallback } = this.props;

    if (!error) return <React.Fragment key={key}>{children}</React.Fragment>;

    // An explicit fallback wins outright — a caller that knows what the failed
    // thing looked like can usually say something better than this can.
    if (fallback !== undefined) {
      return typeof fallback === 'function' ? fallback(error, this.retry) : fallback;
    }

    const what = label ? `${label} couldn't load` : "Something didn't load";

    return (
      <View style={[styles.box, compact && styles.boxCompact]} accessibilityRole="alert">
        <Text style={styles.title}>{what}</Text>
        {/* The message, not a friendly substitute for it: this screen is most
            often read by the person who can fix it, and "something went wrong"
            costs them the one clue they had. Truncated because a render error
            can carry a whole serialised object. */}
        <Text style={styles.detail} numberOfLines={compact ? 2 : 6}>
          {String(error?.message || error).slice(0, 300)}
        </Text>
        <TouchableOpacity onPress={this.retry} style={styles.btn} accessibilityRole="button">
          <Text style={styles.btnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

/**
 * Wrap a component in a boundary ONCE, at module scope.
 *
 * Doing this inline in a render (`component={(p) => <ErrorBoundary>…`) would
 * hand React a new component type every render, which unmounts and remounts the
 * screen and loses all its state — the bug this helper exists to avoid.
 */
export function withBoundary(Component, label) {
  const Guarded = (props) => (
    <ErrorBoundary label={label}>
      <Component {...props} />
    </ErrorBoundary>
  );
  Guarded.displayName = `Guarded(${label || Component.displayName || Component.name || 'Component'})`;
  return Guarded;
}

const styles = StyleSheet.create({
  box: {
    margin: 16,
    padding: 16,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(127,127,127,0.28)',
    backgroundColor: 'rgba(127,127,127,0.12)',
    alignItems: 'flex-start',
    gap: 8,
  },
  boxCompact: {
    margin: 8,
    padding: 12,
    borderRadius: 10,
    gap: 6,
  },
  title: {
    color: DANGER,
    fontSize: 15,
    fontWeight: '700',
  },
  detail: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 17,
  },
  btn: {
    marginTop: 4,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(127,127,127,0.4)',
  },
  btnText: {
    color: MUTED,
    fontSize: 13,
    fontWeight: '600',
  },
});
