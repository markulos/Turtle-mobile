import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

/**
 * CommandBus — a one-slot channel for delivering a command/message into the
 * Turtle chat from anywhere (e.g. the global CommandConsole opened by
 * long-pressing the Turtle tab). The console sets `pending`; TurtleScreen
 * consumes it through its existing send pipeline, so every slash command
 * behaves exactly as if typed in the chat. No duplicated dispatch logic.
 */
const CommandBusContext = createContext({
  pending: null,
  dispatch: () => {},
  clear: () => {},
});

export const CommandBusProvider = ({ children }) => {
  const [pending, setPending] = useState(null);
  const dispatch = useCallback((text) => setPending(text), []);
  const clear = useCallback(() => setPending(null), []);
  const value = useMemo(() => ({ pending, dispatch, clear }), [pending, dispatch, clear]);
  return (
    <CommandBusContext.Provider value={value}>
      {children}
    </CommandBusContext.Provider>
  );
};

export const useCommandBus = () => useContext(CommandBusContext);
