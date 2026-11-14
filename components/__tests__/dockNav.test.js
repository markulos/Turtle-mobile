import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import {
  currentTabIndex, holdPageUntil, requestTab, requestTabWhenClear,
} from '../dockNav';
import { TAB_SWITCH_SPEC, chipAim, forTabTurn, leadAfterSettle } from '../dockMotion';

/**
 * dockNav — the one door every tab change goes through.
 *
 * Two halves. The first runs the REAL navigator, because the whole design
 * rests on one fact about it that no mock can vouch for: its state is a
 * synchronous store, so `getState()` is the new state on the line after
 * `dispatch()`, before React has rendered anything. If a future
 * react-navigation stops doing that, the dock would be reading the past and
 * telling the chip to go back to a tab it just left — and this is the test
 * that says so, rather than a phone.
 *
 * The second half walks the chip through the sequences that used to go wrong,
 * with the same rules the UI thread applies.
 */

const NAMES = ['Tasks', 'Notes', 'Photos', 'Vault', 'Turtle', 'Profile'];

describe('against the real navigator', () => {
  const Tab = createBottomTabNavigator();
  const Blank = () => <View />;

  /** Mounts six tabs and hands back the tab navigator's own `navigation`. */
  const mountTabs = async () => {
    const seen = { navigation: null, renders: [] };
    const Bar = ({ navigation, state }) => {
      seen.navigation = navigation;
      seen.renders.push(state.index);
      return null;
    };
    await render(
      <NavigationContainer>
        <Tab.Navigator tabBar={(props) => <Bar {...props} />} screenOptions={{ headerShown: false }}>
          {NAMES.map((name) => <Tab.Screen key={name} name={name} component={Blank} />)}
        </Tab.Navigator>
      </NavigationContainer>,
    );
    expect(seen.navigation).not.toBeNull();
    return seen;
  };

  test('the navigator knows where it is on the line after the dispatch', async () => {
    const seen = await mountTabs();
    const settle = jest.fn();
    let reported;

    await act(async () => {
      reported = requestTab(seen.navigation, 4, settle);
      // STILL INSIDE THE SAME CALL STACK: nothing has re-rendered. The bar
      // has only ever been drawn at index 0 — and the store already says 4.
      expect(seen.renders.every((i) => i === 0)).toBe(true);
      expect(seen.navigation.getState().index).toBe(4);
    });

    expect(reported).toBe(4);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith(4, 4);
    // …and React catches up afterwards.
    expect(seen.renders[seen.renders.length - 1]).toBe(4);
  });

  test('asking twice for the same tab changes tabs ONCE', async () => {
    // The gesture and react-navigation's own button both report a tap. The
    // second to arrive must find nothing to do — not re-dispatch from a
    // render's stale idea of which tab is focused.
    const seen = await mountTabs();
    const settle = jest.fn();
    const dispatch = jest.spyOn(seen.navigation, 'dispatch');

    await act(async () => {
      requestTab(seen.navigation, 3, settle);
      requestTab(seen.navigation, 3, settle);
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(settle.mock.calls).toEqual([[3, 3], [3, 3]]);
    expect(seen.navigation.getState().index).toBe(3);
  });

  test('two different tabs in a row end on the second, and each is answered with the truth at the time', async () => {
    // Tap Photos, then Notes before React has drawn Photos. The first answer
    // says Photos, the second says Notes — neither says "still on Tasks".
    const seen = await mountTabs();
    const settle = jest.fn();

    await act(async () => {
      requestTab(seen.navigation, 2, settle);
      requestTab(seen.navigation, 1, settle);
    });

    expect(settle.mock.calls).toEqual([[2, 2], [1, 1]]);
    expect(seen.navigation.getState().index).toBe(1);
  });

  test('going back to the tab you came from, before the first change has rendered, still goes back', async () => {
    // The old path compared against a ref that an EFFECT kept up to date, so
    // "Tasks → Notes → Tasks" inside one commit looked like "already on
    // Tasks" and the second tap was dropped.
    const seen = await mountTabs();
    const settle = jest.fn();

    await act(async () => {
      requestTab(seen.navigation, 1, settle);
      requestTab(seen.navigation, 0, settle);
    });

    expect(seen.navigation.getState().index).toBe(0);
    expect(settle.mock.calls).toEqual([[1, 1], [0, 0]]);
  });

  test('a slot that is not a tab is answered, not ignored', async () => {
    const seen = await mountTabs();
    const settle = jest.fn();

    await act(async () => { requestTab(seen.navigation, 9, settle); });

    // Nothing moved, and the chip is told where the navigator actually is so
    // it can come back from wherever the touch sent it.
    expect(settle).toHaveBeenCalledWith(9, 0);
    expect(currentTabIndex(seen.navigation)).toBe(0);
  });
});

/**
 * THE APP'S OWN WIRING, against the real navigator and the real tab bar.
 *
 * The same three things App.js hands the navigator: every tab kept attached
 * (`detachInactiveScreens={false}`), the page-turn transition, and a
 * `tabPress` listener that replaces the button's default with `requestTab`.
 * A real press on a real tab button has to come out the other side as exactly
 * one tab change — this is the path VoiceOver and a keyboard take, with no
 * gesture involved at all.
 */
describe('the button\'s press, through the app\'s own listener', () => {
  const Tab = createBottomTabNavigator();
  const page = (name) => function Page() {
    return <View testID={`page-${name}`} />;
  };
  const PAGES = Object.fromEntries(NAMES.map((n) => [n, page(n)]));

  const mountApp = async (settle) => {
    const seen = { navigation: null };
    const view = await render(
      <NavigationContainer>
        <Tab.Navigator
          detachInactiveScreens={false}
          screenListeners={({ navigation, route }) => ({
            tabPress: (e) => {
              if (e && typeof e.preventDefault === 'function') e.preventDefault();
              seen.navigation = navigation;
              const st = navigation.getState();
              const i = st?.routes?.findIndex((r) => r.key === route.key);
              if (i == null || i < 0) return;
              requestTab(navigation, i, settle, st);
            },
          })}
          screenOptions={{
            headerShown: false,
            transitionSpec: TAB_SWITCH_SPEC,
            sceneStyleInterpolator: forTabTurn,
          }}
        >
          {NAMES.map((name) => (
            <Tab.Screen
              key={name}
              name={name}
              component={PAGES[name]}
              options={{ tabBarButtonTestID: `tab-${name}` }}
            />
          ))}
        </Tab.Navigator>
      </NavigationContainer>,
    );
    return { view, seen };
  };

  test('one press is one tab change, answered once', async () => {
    const settle = jest.fn();
    const { view, seen } = await mountApp(settle);

    await act(async () => { fireEvent.press(view.getByTestId('tab-Turtle')); });

    expect(settle.mock.calls).toEqual([[4, 4]]);
    expect(seen.navigation.getState().index).toBe(4);
    // The page is really there: the default was prevented, and the tab still
    // changed — so nothing depends on the button's own dispatch any more.
    expect(view.getByTestId('page-Turtle')).toBeTruthy();
  });

  test('pressing the tab you are on dispatches nothing and still answers', async () => {
    const settle = jest.fn();
    const { view, seen } = await mountApp(settle);

    await act(async () => { fireEvent.press(view.getByTestId('tab-Tasks')); });

    expect(settle.mock.calls).toEqual([[0, 0]]);
    expect(seen.navigation.getState().index).toBe(0);
  });

  test('every tab that has been opened STAYS in the tree across a long move', async () => {
    // What `detachInactiveScreens={false}` is for: going Tasks → Profile must
    // not take the screens in between out of the window and put them back.
    // Lazy still holds — a tab that was never opened is not mounted.
    const settle = jest.fn();
    const { view } = await mountApp(settle);

    for (const name of ['Notes', 'Photos', 'Tasks', 'Profile']) {
      await act(async () => { fireEvent.press(view.getByTestId(`tab-${name}`)); });
    }

    for (const name of ['Tasks', 'Notes', 'Photos', 'Profile']) {
      expect(view.queryByTestId(`page-${name}`, { includeHiddenElements: true })).not.toBeNull();
    }
    expect(view.queryByTestId('page-Vault', { includeHiddenElements: true })).toBeNull();
    expect(view.queryByTestId('page-Turtle', { includeHiddenElements: true })).toBeNull();
  });
});

describe('without a store to ask', () => {
  const routes = NAMES.map((name, i) => ({ key: `${name}-${i}`, name }));
  const state = { key: 'tabs-1', index: 0, routes };

  test('a bare harness believes its own dispatch', () => {
    const settle = jest.fn();
    const navigation = { dispatch: jest.fn() };
    requestTab(navigation, 2, settle, state);
    expect(navigation.dispatch).toHaveBeenCalledTimes(1);
    expect(navigation.dispatch.mock.calls[0][0].target).toBe('tabs-1');
    expect(settle).toHaveBeenCalledWith(2, 2);
  });

  test('a dispatch that THROWS still answers the chip', () => {
    // A request that is never answered leaves the chip parked on a tab nobody
    // is on. Whatever goes wrong, settle runs.
    const settle = jest.fn();
    const navigation = { dispatch: () => { throw new Error('navigator is gone'); }, getState: () => state };
    expect(() => requestTab(navigation, 2, settle, state)).toThrow('navigator is gone');
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle.mock.calls[0][0]).toBe(2);
  });

  test('nobody can say where the navigator is → -1, and only the lead is answered', () => {
    expect(currentTabIndex(null, null)).toBe(-1);
    expect(currentTabIndex({ getState: () => { throw new Error('unmounted'); } }, state)).toBe(0);
  });
});

/**
 * THE CHIP, ACROSS THE SEQUENCES THAT USED TO GO WRONG.
 *
 * Everything the UI thread does with a touch, as plain values: a lead written
 * at touch-down, `settle` applied in the order the JS thread sent it, and the
 * aim read after every step. A travel starts whenever the aim CHANGES, so the
 * assertion is on the whole list of aims — one wrong entry is one visible
 * move in the wrong direction.
 */
describe('the chip never goes back on itself', () => {
  const chip = (index) => {
    const s = { lead: -1, nav: index };
    const aims = [chipAim(false, -1, s.lead, s.nav)];
    const note = () => aims.push(chipAim(false, -1, s.lead, s.nav));
    return {
      aims,
      touch: (slot) => { s.lead = slot; note(); },
      // settle(requested, current), exactly as useDockSettle applies it:
      // the index first, then what is left of the lead.
      settle: (requested, current) => {
        if (current >= 0) s.nav = current;
        s.lead = leadAfterSettle(s.lead, requested, current);
        note();
      },
      abandon: (slot) => { if (s.lead === slot) s.lead = -1; note(); },
    };
  };
  const moves = (aims) => aims.filter((v, i) => i > 0 && v !== aims[i - 1]);

  test('an ordinary tap is one move', () => {
    const c = chip(0);
    c.touch(4); // finger down on Turtle
    c.settle(4, 4); // the lift: requested, and the store already agrees
    c.settle(4, 4); // React commits, and says the same thing again
    expect(moves(c.aims)).toEqual([4]);
  });

  test('THE BUG: a late commit for the LAST tab change lands on the next touch', () => {
    // Tap Photos. Before React has committed it, put a finger down on
    // Profile. The commit for Photos then arrives.
    //
    // It used to clear the lead unconditionally and write the index its own
    // render had seen — so the chip, already on its way to Profile, was sent
    // back to Photos and sat there until the second press was processed.
    const c = chip(0);
    c.touch(2);
    c.settle(2, 2); // lift on Photos: requested and answered
    c.touch(5); // finger down on Profile — the chip leaves for it
    c.settle(2, 2); // …and NOW React commits the Photos change
    expect(c.aims[c.aims.length - 1]).toBe(5); // still aimed at Profile
    c.settle(5, 5); // the second lift
    c.settle(5, 5); // and its commit
    expect(moves(c.aims)).toEqual([2, 5]);
  });

  test('the same sequence under the OLD rule is the chip going back', () => {
    // What shipped: `indexSV = index; lead = -1`, whatever the lead was.
    const s = { lead: -1, nav: 0 };
    const aims = [0];
    const note = () => aims.push(chipAim(false, -1, s.lead, s.nav));
    s.lead = 2; note();
    s.nav = 2; s.lead = -1; note(); // commit for Photos (prompt, this time)
    s.lead = 5; note(); // finger down on Profile
    s.nav = 2; s.lead = -1; note(); // a second, late effect for Photos
    expect(aims).toEqual([0, 2, 2, 5, 2]); // …back to Photos, under the finger
  });

  test('a late commit reports the PRESENT, so it cannot move the chip to the past', () => {
    // The effect reads the navigator's store when it RUNS. By the time a
    // delayed Photos commit fires, the store already says Profile.
    const c = chip(0);
    c.touch(2);
    c.settle(2, 2);
    c.touch(5);
    c.settle(5, 5); // the second lift, processed before the first commit
    c.settle(5, 5); // the late "Photos" effect — which read the store: Profile
    c.settle(5, 5);
    expect(moves(c.aims)).toEqual([2, 5]);
  });

  test('a touch that is taken away is two moves: out, and straight back', () => {
    const c = chip(1);
    c.touch(4); // the swipe home starts over Turtle
    c.abandon(4); // iOS takes it
    expect(moves(c.aims)).toEqual([4, 1]);
  });

  test('a refused tab change brings the chip home in the same answer', () => {
    const c = chip(0);
    c.touch(4);
    c.settle(4, 0); // dispatched, and the navigator did not move
    expect(moves(c.aims)).toEqual([4, 0]);
  });

  test('a tab change with no touch behind it is one move, with no lead involved', () => {
    // A deep link, the command console, VoiceOver activating a tab.
    const c = chip(0);
    c.settle(3, 3);
    expect(moves(c.aims)).toEqual([3]);
  });

  test('the answer to an OLD request leaves a newer lead alone', () => {
    expect(leadAfterSettle(5, 2, 2)).toBe(5);
    expect(leadAfterSettle(2, 2, 2)).toBe(-1);
    expect(leadAfterSettle(2, 2, 0)).toBe(-1); // refused: still this request's lead
    expect(leadAfterSettle(3, 9, 3)).toBe(-1); // the navigator is already there
    expect(leadAfterSettle(-1, 2, 2)).toBe(-1);
    // Slot 0 is a real slot, not "nothing".
    expect(leadAfterSettle(0, 0, 4)).toBe(-1);
    expect(leadAfterSettle(0, 4, 4)).toBe(0);
  });
});

/**
 * THE PAGE FOLLOWS THE CHIP. A request that arrives before the chip has
 * visually landed is HELD until then, and then made exactly as it would have
 * been. It delays; it never decides.
 */
describe('a tab request waits for the chip to land', () => {
  const routes = NAMES.map((name, i) => ({ key: name + '-' + i, name }));
  const harness = () => {
    let state = { key: 'tabs-1', index: 0, routes };
    const dispatch = jest.fn((action) => {
      const to = routes.findIndex((r) => r.key === action.payload.key || r.name === action.payload.name);
      if (to >= 0) state = { ...state, index: to };
    });
    return { navigation: { dispatch, getState: () => state }, dispatch };
  };

  beforeEach(() => { jest.useFakeTimers(); holdPageUntil(0); });
  afterEach(() => { jest.useRealTimers(); holdPageUntil(0); });

  test('held until the gate, then made once and answered', () => {
    const { navigation, dispatch } = harness();
    const settle = jest.fn();
    holdPageUntil(Date.now() + 120);

    requestTabWhenClear(navigation, 5, settle);
    expect(dispatch).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();

    jest.advanceTimersByTime(119);
    expect(dispatch).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(settle.mock.calls).toEqual([[5, 5]]);
  });

  test('the gesture and the button both waiting out the gate is still ONE tab change', () => {
    const { navigation, dispatch } = harness();
    const settle = jest.fn();
    holdPageUntil(Date.now() + 80);
    requestTabWhenClear(navigation, 3, settle);
    requestTabWhenClear(navigation, 3, settle);
    jest.advanceTimersByTime(100);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(settle.mock.calls).toEqual([[3, 3], [3, 3]]);
  });

  test('a gate that has passed, or was never set, does not delay anything', () => {
    const { navigation, dispatch } = harness();
    requestTabWhenClear(navigation, 2, jest.fn());
    expect(dispatch).toHaveBeenCalledTimes(1);
    holdPageUntil(Date.now() - 500);
    requestTabWhenClear(navigation, 4, jest.fn());
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  test('a gate absurdly far away is ignored — a bad clock cannot hold a tab change hostage', () => {
    const { navigation, dispatch } = harness();
    holdPageUntil(Date.now() + 60000);
    requestTabWhenClear(navigation, 1, jest.fn());
    expect(dispatch).toHaveBeenCalledTimes(1);
    holdPageUntil(NaN);
    requestTabWhenClear(navigation, 2, jest.fn());
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  test('a navigator that went away while the chip was landing does not throw from the timer', () => {
    const settle = jest.fn();
    const navigation = {
      dispatch: () => { throw new Error('gone'); },
      getState: () => ({ key: 'tabs-1', index: 0, routes }),
    };
    holdPageUntil(Date.now() + 50);
    requestTabWhenClear(navigation, 2, settle);
    expect(() => jest.advanceTimersByTime(60)).not.toThrow();
    // …and the chip was still answered.
    expect(settle).toHaveBeenCalledTimes(1);
  });
});
