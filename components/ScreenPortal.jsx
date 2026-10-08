/**
 * ScreenPortal — render a view somewhere ELSE in the tree, over everything.
 *
 * The one thing a nested view cannot do for itself is paint over its own
 * ancestors. The day planner is the case that forced this: it is a sheet
 * inside the Planner's horizontal view pager, and a pull-up that wants to
 * become the whole screen has to cover the screen's header — which is two
 * levels of ancestor up, behind a ScrollView that clips its children. Every
 * way of solving that in place is worse:
 *
 *  - Hiding the header while the sheet is up changes the LAYOUT: the pager
 *    grows, the month grid re-scales to its new area, and both happen again in
 *    reverse on the way down. That is the lag this file exists to delete.
 *  - A Modal would cover the screen, but it is a separate native window: it
 *    swallows the touches meant for the calendar behind it, and this screen
 *    already presents real Modals that an iOS modal-over-modal would break.
 *
 * So the sheet stays where its state, its gesture and its props are, and only
 * its OUTPUT moves: `<ScreenPortal>` hands the element to a host mounted as
 * the last child of the screen's root, which paints after everything else.
 *
 * ── Why a subscription and not provider state ──────────────────────────────
 *
 * The obvious version keeps the mounted elements in the provider's own state,
 * and re-renders every child of the provider — the whole screen — each time
 * the portalled view changes. That is a worse version of the problem we came
 * here to fix. The nodes live in a mutable store instead, and ONLY the host
 * subscribes, so a re-render of the portalled content costs exactly that
 * content and nothing else.
 *
 * ── Why useLayoutEffect ────────────────────────────────────────────────────
 *
 * Registering in a plain effect would land the host's update after the frame
 * had already been painted, so the portalled view would always be one frame
 * behind its own props — visible as a lag while typing in the sheet. A layout
 * effect is flushed synchronously before paint, so the two commits land in the
 * same frame.
 *
 * ── What it does NOT do ────────────────────────────────────────────────────
 *
 * It is not React DOM's createPortal: the portalled element is RENDERED where
 * the host is, so it sees the contexts above the HOST, not the ones above the
 * `<ScreenPortal>`. Everything the planner's sheet needs (theme, server,
 * safe area, gesture root) is provided at the app root, well above both.
 */
import React, {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { StyleSheet, View } from 'react-native';

const PortalContext = createContext(null);

/**
 * Hosts the portals for one screen. Wrap the screen's body in it and put a
 * `<ScreenPortalHost />` as the LAST child of the screen's root view — last,
 * because paint order in React Native is tree order, and "over everything" is
 * the whole point.
 */
export function ScreenPortalProvider({ children }) {
  // Mutable on purpose: see the note above. The Map keeps insertion order, so
  // two portals stack in the order they mounted.
  const store = useRef({ nodes: new Map(), listeners: new Set() });

  const api = useMemo(() => {
    const announce = () => {
      for (const l of store.current.listeners) {
        try { l(); } catch { /* a listener's own problem */ }
      }
    };
    return {
      mount: (id, node) => { store.current.nodes.set(id, node); announce(); },
      unmount: (id) => { if (store.current.nodes.delete(id)) announce(); },
      subscribe: (listener) => {
        store.current.listeners.add(listener);
        return () => { store.current.listeners.delete(listener); };
      },
      read: () => Array.from(store.current.nodes.entries()),
    };
    // Stable for the life of the screen, so nothing below re-renders for it.
  }, []);

  return <PortalContext.Provider value={api}>{children}</PortalContext.Provider>;
}

/**
 * Where the portalled views actually render.
 *
 * `box-none` is essential: the host spans the whole screen, and a touch that
 * does not land on a portalled view has to reach the screen underneath it.
 *
 * It takes the hood inset as a style like any other absolute fill would — the
 * host covers the status bar, so whatever it hosts is responsible for clearing
 * it (components/tabBarLayout's panelTopInset is that rule, written down).
 */
export function ScreenPortalHost({ style }) {
  const api = useContext(PortalContext);
  const [, bump] = useState(0);

  useEffect(() => {
    if (!api) return undefined;
    const off = api.subscribe(() => bump((n) => n + 1));
    // Read again now that we are listening. The first mount registers from a
    // LAYOUT effect in the portal — which runs before this passive one — so
    // that announcement was made to an empty room, and without this the host
    // would render nothing until some later update happened to wake it.
    bump((n) => n + 1);
    return off;
  }, [api]);

  const nodes = api ? api.read() : [];
  if (nodes.length === 0) return null;

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, style]}>
      {nodes.map(([id, node]) => (
        <React.Fragment key={id}>{node}</React.Fragment>
      ))}
    </View>
  );
}

/**
 * Put these children in the host instead of here.
 *
 * `id` identifies the slot, so a re-mount replaces rather than stacks. Renders
 * nothing in place — the element goes up, not down.
 */
export function ScreenPortal({ id, children }) {
  const api = useContext(PortalContext);
  const mount = api?.mount;
  const unmount = api?.unmount;

  useLayoutEffect(() => {
    mount?.(id, children);
  }, [id, children, mount]);

  useEffect(() => () => unmount?.(id), [id, unmount]);

  return null;
}

/** For a caller that needs to know whether it is inside a provider at all. */
export function useScreenPortal() {
  return useContext(PortalContext);
}

export default ScreenPortal;
