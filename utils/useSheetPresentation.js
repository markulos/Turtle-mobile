/**
 * The life of a bottom sheet, once.
 *
 * Every card in this app that expands up from the bottom edge — the board menu,
 * the board creator, the track menu, the album menu, the gallery filters — was
 * built from the same forty lines, pasted:
 *
 *     const anim = useRef(new Animated.Value(0)).current;
 *     const { panHandlers, dragY: drag } = useSheetDismiss(onClose, visible);
 *     const [cardH, setCardH] = useState(420);
 *     const [mounted, setMounted] = useState(visible);
 *     useEffect(() => { ...open timing / close timing / setMounted(false)... }, [visible]);
 *     const translateY = Animated.add(anim.interpolate(...), drag);
 *     if (!mounted) return null;
 *
 * All of it is mechanism, none of it is what the card is FOR, and every copy was
 * a chance for one sheet to drift from the rest — which is exactly what had
 * happened by the time this was written.
 *
 * WHAT IT OWNS
 *
 *   • `anim`, the 0→1 presentation progress. One value drives both the card's
 *     slide and the scrim's fade, so the two can never disagree.
 *   • The mount latch. A closing sheet has to stay in the tree until it has
 *     finished sliding out, so `mounted` outlives `visible` by one animation.
 *   • The measured card height, which is what the slide distance is made of.
 *     State rather than a ref: the transform is built at render, so a ref would
 *     update silently and leave the interpolation stale.
 *   • Pull-down-to-dismiss, by composing useSheetDismiss — its drag offset is
 *     ADDED to the presentation transform rather than replacing it, so a drag
 *     never fights the open/close timing.
 *
 * WHAT IT DOESN'T
 *
 * Layout, chrome and keyboard lift stay with the caller. In particular the
 * keyboard lift belongs on a WRAPPER, never on the card: the card's transform is
 * an RN Animated one and a Reanimated style cannot drive the same node.
 *
 * USAGE
 *
 *   const sheet = useSheetPresentation({ visible, onClose, height: 340, onOpen });
 *   if (!sheet.mounted) return null;
 *   <Animated.View style={[styles.scrim, sheet.scrimStyle]} />
 *   <Animated.View {...sheet.panHandlers} onLayout={sheet.onCardLayout}
 *                  style={[styles.card, sheet.cardStyle]} />
 *
 * `scrollProps` / `scrollPropsFor` / `noDragProps` pass straight through from
 * useSheetDismiss — see that file for when each is needed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated } from 'react-native';

import { SHEET, timing } from './motion';
import { useSheetDismiss } from './useSheetDismiss';

export function useSheetPresentation({ visible, onClose, height = 420, onOpen } = {}) {
  const anim = useRef(new Animated.Value(0)).current;
  const dismiss = useSheetDismiss(onClose, visible);
  const { dragY } = dismiss;

  // Seeded from the caller so the pre-layout first frame is already fully
  // off-screen; replaced by the real height the moment the card lays out.
  const [cardH, setCardH] = useState(height);
  const [mounted, setMounted] = useState(visible);

  // The close branch has to know whether the sheet was ever open, and reading
  // `mounted` from the effect's closure would mean listing it as a dependency —
  // which would re-run the whole thing on the un-mount it just scheduled. A ref
  // is the same answer without the loop.
  const mountedRef = useRef(visible);

  // Latest-ref so the once-per-open callback can't fire a stale closure.
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    if (visible) {
      mountedRef.current = true;
      setMounted(true);
      // A sheet always opens on its first page with its fields empty. Re-zeroing
      // the drag matters on a reopen after a committed pull-down, which parks
      // the card off-screen rather than resetting it (see useSheetDismiss).
      dragY.setValue(0);
      onOpenRef.current?.();
      timing(anim, 1, { duration: SHEET.in, easing: SHEET.easing }).start();
    } else if (mountedRef.current) {
      timing(anim, 0, { duration: SHEET.out, easing: SHEET.easing }).start(({ finished }) => {
        // An interrupted close means something re-opened us mid-slide; leaving
        // the card mounted is what lets that reopen animate from where it was.
        if (!finished) return;
        mountedRef.current = false;
        setMounted(false);
      });
    }
  }, [visible, anim, dragY]);

  // Presentation slide plus live drag, as one value.
  const translateY = useMemo(
    () => Animated.add(
      anim.interpolate({ inputRange: [0, 1], outputRange: [cardH, 0] }),
      dragY,
    ),
    [anim, dragY, cardH],
  );

  const onCardLayout = useCallback((e) => {
    const h = Math.round(e?.nativeEvent?.layout?.height ?? 0);
    if (h <= 0) return;
    setCardH((prev) => (prev === h ? prev : h));
  }, []);

  const cardStyle = useMemo(() => ({ transform: [{ translateY }] }), [translateY]);
  const scrimStyle = useMemo(() => ({ opacity: anim }), [anim]);

  return {
    ...dismiss,
    mounted,
    anim,
    cardH,
    translateY,
    cardStyle,
    scrimStyle,
    onCardLayout,
  };
}

export default useSheetPresentation;
