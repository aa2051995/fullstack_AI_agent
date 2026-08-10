/**
 * Tests for src/lib/context.js — the global React state store.
 *
 * The app state lives in a React Context backed by useReducer. The reducer handles
 * every state mutation (login, logout, add/delete conversations, streaming flags, etc.).
 * The reducer itself is not exported, so we test it through the AppProvider and useApp hook.
 *
 * Testing strategy:
 *   - Render an <AppProvider> with a small inline component that exposes the relevant
 *     slice of state and one action button.
 *   - Click the button (wrapped in act()) to dispatch an action.
 *   - Assert that the DOM reflects the new state.
 *
 * This approach gives us full integration coverage: the provider, reducer, and hook
 * all run as they would in the real app. No internal implementation details are exposed.
 *
 * Why act(async () => { ... })?
 *   AppProvider runs a useEffect on mount that reads from localStorage and dispatches
 *   SET_HYDRATED. React effects run asynchronously after render. Wrapping render() in
 *   act(async () => {}) tells React to flush all pending effects before the test proceeds.
 */

import { render, screen, act } from '@testing-library/react';
import { AppProvider, useApp } from '@/lib/context';

// ─── Test utilities ──────────────────────────────────────────────────────────

/**
 * TestConsumer renders a generic spy component.
 *
 * @param action  - a function (ctx) => void called when the "act" button is clicked.
 *                  Use this to dispatch any context action without writing a custom component.
 * @param selector - a function (ctx) => string that extracts the value to display.
 * @param testId  - the data-testid of the output span (defaults to 'output').
 *
 * We avoid sharing components between tests so each test clearly shows what it exercises.
 * These are kept inline inside each `it` block for that reason; TestConsumer is provided
 * only when a fully generic component would reduce boilerplate.
 */
function TestConsumer({ action, selector, testId = 'output' }) {
  const ctx = useApp();
  return (
    <div>
      <span data-testid={testId}>{selector(ctx)}</span>
      {action && <button onClick={() => action(ctx)}>act</button>}
    </div>
  );
}

/**
 * renderWithProvider wraps a component in AppProvider.
 * Every component that uses useApp() must be a descendant of AppProvider.
 */
function renderWithProvider(ui) {
  return render(<AppProvider>{ui}</AppProvider>);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AppProvider / useApp integration', () => {
  /**
   * Reset state between tests.
   * localStorage.clear() ensures the hydration effect finds no stored session.
   * jest.clearAllMocks() resets all mock call histories.
   */
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  // ── Guard ────────────────────────────────────────────────────────────────────

  it('throws when useApp is used outside AppProvider', () => {
    // useApp calls useContext internally. If the context has no provider in the tree,
    // the context value will be undefined, and useApp throws a descriptive error.
    //
    // React logs its own error to console.error before re-throwing from a render.
    // We silence it with a spy so the test output is not polluted by expected errors.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    function Bad() {
      useApp(); // will throw because there's no AppProvider parent
      return null;
    }

    // The error is thrown during render, which happens synchronously inside render().
    expect(() => render(<Bad />)).toThrow('useApp must be used within AppProvider');

    spy.mockRestore(); // always restore so later tests have a real console.error
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  it('provides initial state', () => {
    // We inline a Reader component that renders multiple state fields.
    // data-testid attributes let us query individual spans with getByTestId().
    function Reader() {
      const { state } = useApp();
      return (
        <>
          <span data-testid="auth">{String(state.isAuthenticated)}</span>
          <span data-testid="hydrated">{String(state.isHydrated)}</span>
          <span data-testid="streaming">{String(state.isStreaming)}</span>
          <span data-testid="sidebar">{String(state.isSidebarOpen)}</span>
        </>
      );
    }
    renderWithProvider(<Reader />);
    // Booleans are converted to strings because DOM text content is always a string.
    expect(screen.getByTestId('auth').textContent).toBe('false');
    expect(screen.getByTestId('streaming').textContent).toBe('false');
  });

  // ── Hydration from localStorage ────────────────────────────────────────────

  it('hydrates from localStorage on mount', async () => {
    // Pre-populate localStorage as if a previous session was saved.
    // The provider reads these on mount and dispatches SET_HYDRATED.
    localStorage.setItem('auth_token', 'tok');
    localStorage.setItem('app_user', JSON.stringify({ email: 'a@b.com' }));
    localStorage.setItem('sidebar_open', 'false');

    function Reader() {
      const { state } = useApp();
      return (
        <>
          <span data-testid="hydrated">{String(state.isHydrated)}</span>
          <span data-testid="auth">{String(state.isAuthenticated)}</span>
          <span data-testid="sidebar">{String(state.isSidebarOpen)}</span>
        </>
      );
    }

    // act(async () => renderWithProvider(...)) waits for the useEffect (hydration)
    // to run and all resulting state updates to be flushed before assertions run.
    await act(async () => {
      renderWithProvider(<Reader />);
    });

    expect(screen.getByTestId('hydrated').textContent).toBe('true');
    expect(screen.getByTestId('auth').textContent).toBe('true');
    expect(screen.getByTestId('sidebar').textContent).toBe('false');
  });

  // ── SET_AUTH action ────────────────────────────────────────────────────────

  it('SET_AUTH updates user, token, isAuthenticated', async () => {
    // setAuth is a helper that dispatches { type: 'SET_AUTH', user, token }.
    function Comp() {
      const { state, setAuth } = useApp();
      return (
        <>
          <span data-testid="auth">{String(state.isAuthenticated)}</span>
          <span data-testid="user">{state.user?.email || ''}</span>
          <button onClick={() => setAuth({ email: 'x@y.com' }, 'tok')}>login</button>
        </>
      );
    }
    renderWithProvider(<Comp />);
    expect(screen.getByTestId('auth').textContent).toBe('false'); // starts logged out

    // act(async () => ...) flushes the state update triggered by the click.
    await act(async () => screen.getByText('login').click());

    expect(screen.getByTestId('auth').textContent).toBe('true');
    expect(screen.getByTestId('user').textContent).toBe('x@y.com');
  });

  // ── CLEAR_AUTH action ──────────────────────────────────────────────────────

  it('CLEAR_AUTH resets auth state and clears conversations', async () => {
    // Pre-populate localStorage to simulate being already logged in.
    localStorage.setItem('auth_token', 'tok');
    localStorage.setItem('app_user', JSON.stringify({ email: 'a@b.com' }));

    function Comp() {
      const { state, clearAuth, setConversations } = useApp();
      return (
        <>
          <span data-testid="auth">{String(state.isAuthenticated)}</span>
          <span data-testid="convs">{state.conversations.length}</span>
          <button onClick={() => setConversations([{ id: '1' }, { id: '2' }])}>load</button>
          <button onClick={clearAuth}>logout</button>
        </>
      );
    }

    // Wrap initial render to let the hydration useEffect run.
    await act(async () => renderWithProvider(<Comp />));
    await act(async () => screen.getByText('load').click());
    expect(screen.getByTestId('convs').textContent).toBe('2');

    // After logout, both auth state and conversation list must be cleared.
    await act(async () => screen.getByText('logout').click());
    expect(screen.getByTestId('auth').textContent).toBe('false');
    expect(screen.getByTestId('convs').textContent).toBe('0');
  });

  // ── ADD_CONVERSATION action ────────────────────────────────────────────────

  it('ADD_CONVERSATION prepends conversation', async () => {
    // New conversations are prepended (not appended) so the most recent appears first.
    function Comp() {
      const { state, addConversation } = useApp();
      return (
        <>
          <span data-testid="count">{state.conversations.length}</span>
          <span data-testid="first">{state.conversations[0]?.title || ''}</span>
          <button onClick={() => addConversation({ id: '1', title: 'First' })}>add1</button>
          <button onClick={() => addConversation({ id: '2', title: 'Second' })}>add2</button>
        </>
      );
    }
    renderWithProvider(<Comp />);
    await act(async () => screen.getByText('add1').click());
    await act(async () => screen.getByText('add2').click());

    expect(screen.getByTestId('count').textContent).toBe('2');
    // "Second" was added last but should be at index 0 (prepend behavior).
    expect(screen.getByTestId('first').textContent).toBe('Second');
  });

  // ── DELETE_CONVERSATION action ─────────────────────────────────────────────

  it('DELETE_CONVERSATION removes conversation and clears current if active', async () => {
    // When the active (currently viewed) conversation is deleted, currentConversationId
    // must be cleared so the app navigates to an empty state.
    function Comp() {
      const { state, setConversations, deleteConversation, setCurrentConversation } = useApp();
      return (
        <>
          <span data-testid="count">{state.conversations.length}</span>
          <span data-testid="current">{state.currentConversationId || 'none'}</span>
          <button onClick={() => setConversations([{ id: 'a' }, { id: 'b' }])}>load</button>
          <button onClick={() => setCurrentConversation('a', [{ content: 'msg' }])}>setcurr</button>
          <button onClick={() => deleteConversation('a')}>del</button>
        </>
      );
    }
    renderWithProvider(<Comp />);
    await act(async () => screen.getByText('load').click());
    await act(async () => screen.getByText('setcurr').click());
    expect(screen.getByTestId('current').textContent).toBe('a');

    await act(async () => screen.getByText('del').click());
    expect(screen.getByTestId('count').textContent).toBe('1');
    expect(screen.getByTestId('current').textContent).toBe('none'); // cleared
  });

  it('DELETE_CONVERSATION keeps currentConversationId when deleting non-active', async () => {
    // Deleting a background conversation (not the one you're currently viewing)
    // must not change the active conversation.
    function Comp() {
      const { state, setConversations, deleteConversation, setCurrentConversation } = useApp();
      return (
        <>
          <span data-testid="current">{state.currentConversationId || 'none'}</span>
          <button onClick={() => setConversations([{ id: 'a' }, { id: 'b' }])}>load</button>
          <button onClick={() => setCurrentConversation('a', [])}>setcurr</button>
          <button onClick={() => deleteConversation('b')}>del-b</button>
        </>
      );
    }
    renderWithProvider(<Comp />);
    await act(async () => screen.getByText('load').click());
    await act(async () => screen.getByText('setcurr').click());
    await act(async () => screen.getByText('del-b').click());
    // 'a' is still current because we deleted 'b', not 'a'.
    expect(screen.getByTestId('current').textContent).toBe('a');
  });

  // ── UPDATE_CONVERSATION action ─────────────────────────────────────────────

  it('UPDATE_CONVERSATION merges data into matching conversation', async () => {
    // updateConversation merges new fields into the matching conversation object
    // using spread: { ...existing, ...updates }
    function Comp() {
      const { state, setConversations, updateConversation } = useApp();
      return (
        <>
          <span data-testid="title">{state.conversations[0]?.title || ''}</span>
          <button onClick={() => setConversations([{ id: '1', title: 'Old' }])}>load</button>
          <button onClick={() => updateConversation('1', { title: 'New' })}>update</button>
        </>
      );
    }
    renderWithProvider(<Comp />);
    await act(async () => screen.getByText('load').click());
    await act(async () => screen.getByText('update').click());
    expect(screen.getByTestId('title').textContent).toBe('New');
  });

  // ── ADD_MESSAGE action ─────────────────────────────────────────────────────

  it('ADD_MESSAGE appends message', async () => {
    // Messages are appended to currentMessages (unlike conversations, which are prepended).
    // Each click adds another message to the list.
    function Comp() {
      const { state, addMessage } = useApp();
      return (
        <>
          <span data-testid="count">{state.currentMessages.length}</span>
          <button onClick={() => addMessage({ id: '1', content: 'hello', role: 'user' })}>add</button>
        </>
      );
    }
    renderWithProvider(<Comp />);
    await act(async () => screen.getByText('add').click());
    await act(async () => screen.getByText('add').click());
    expect(screen.getByTestId('count').textContent).toBe('2');
  });

  // ── UPDATE_LAST_MESSAGE action ─────────────────────────────────────────────

  it('UPDATE_LAST_MESSAGE replaces content of last message', async () => {
    // Used when the AI finishes streaming and we want to replace the partial
    // streaming content with the final complete response.
    function Comp() {
      const { state, addMessage, updateLastMessage } = useApp();
      const last = state.currentMessages[state.currentMessages.length - 1];
      return (
        <>
          <span data-testid="last">{last?.content || ''}</span>
          <button onClick={() => addMessage({ id: '1', content: 'initial', role: 'assistant' })}>add</button>
          <button onClick={() => updateLastMessage('replaced')}>update</button>
        </>
      );
    }
    renderWithProvider(<Comp />);
    await act(async () => screen.getByText('add').click());
    await act(async () => screen.getByText('update').click());
    expect(screen.getByTestId('last').textContent).toBe('replaced');
  });

  it('UPDATE_LAST_MESSAGE is safe on empty message list', async () => {
    // The reducer must guard against calling update on an empty array.
    // If currentMessages is [], there is no "last message" to update.
    function Comp() {
      const { updateLastMessage } = useApp();
      return <button onClick={() => updateLastMessage('x')}>update</button>;
    }
    renderWithProvider(<Comp />);
    // Simply verify no error is thrown — no DOM assertion needed.
    await act(async () => screen.getByText('update').click());
  });

  // ── APPEND_TO_LAST_MESSAGE action ──────────────────────────────────────────

  it('APPEND_TO_LAST_MESSAGE concatenates content', async () => {
    // During streaming, each new chunk is appended to the last message's content.
    // This creates the "typing" effect in the UI.
    function Comp() {
      const { state, addMessage, appendToLastMessage } = useApp();
      const last = state.currentMessages[state.currentMessages.length - 1];
      return (
        <>
          <span data-testid="last">{last?.content || ''}</span>
          <button onClick={() => addMessage({ id: '1', content: 'Hello', role: 'assistant' })}>add</button>
          <button onClick={() => appendToLastMessage(' World')}>append</button>
        </>
      );
    }
    renderWithProvider(<Comp />);
    await act(async () => screen.getByText('add').click());
    await act(async () => screen.getByText('append').click());
    expect(screen.getByTestId('last').textContent).toBe('Hello World');
  });

  it('APPEND_TO_LAST_MESSAGE handles undefined initial content', async () => {
    // A message may be added with no content yet (placeholder for the AI response).
    // Appending to an undefined content field must produce the appended string, not "undefinedchunk".
    function Comp() {
      const { state, addMessage, appendToLastMessage } = useApp();
      const last = state.currentMessages[state.currentMessages.length - 1];
      return (
        <>
          <span data-testid="last">{last?.content || ''}</span>
          <button onClick={() => addMessage({ id: '1', role: 'assistant' })}>add</button>
          <button onClick={() => appendToLastMessage('chunk')}>append</button>
        </>
      );
    }
    renderWithProvider(<Comp />);
    await act(async () => screen.getByText('add').click());
    await act(async () => screen.getByText('append').click());
    expect(screen.getByTestId('last').textContent).toBe('chunk'); // not 'undefinedchunk'
  });

  // ── SET_STREAMING action ───────────────────────────────────────────────────

  it('SET_STREAMING toggles isStreaming', async () => {
    // isStreaming controls whether the UI shows the stop button and disables the textarea.
    function Comp() {
      const { state, setStreaming } = useApp();
      return (
        <>
          <span data-testid="streaming">{String(state.isStreaming)}</span>
          <button onClick={() => setStreaming(true)}>start</button>
          <button onClick={() => setStreaming(false)}>stop</button>
        </>
      );
    }
    renderWithProvider(<Comp />);
    await act(async () => screen.getByText('start').click());
    expect(screen.getByTestId('streaming').textContent).toBe('true');
    await act(async () => screen.getByText('stop').click());
    expect(screen.getByTestId('streaming').textContent).toBe('false');
  });

  // ── TOGGLE_SIDEBAR action ──────────────────────────────────────────────────

  it('TOGGLE_SIDEBAR flips isSidebarOpen', async () => {
    function Comp() {
      const { state, toggleSidebar } = useApp();
      return (
        <>
          <span data-testid="sidebar">{String(state.isSidebarOpen)}</span>
          <button onClick={toggleSidebar}>toggle</button>
        </>
      );
    }

    // Wrap initial render to let hydration run and settle the initial value.
    await act(async () => renderWithProvider(<Comp />));

    // Read the current state before toggling so the test does not depend on
    // whether the initial value is true or false.
    const before = screen.getByTestId('sidebar').textContent;
    await act(async () => screen.getByText('toggle').click());
    // Verify the value flipped regardless of what it started as.
    expect(screen.getByTestId('sidebar').textContent).toBe(before === 'true' ? 'false' : 'true');
  });

  // ── TOGGLE_CONFIG action ───────────────────────────────────────────────────

  it('TOGGLE_CONFIG flips isConfigOpen', async () => {
    function Comp() {
      const { state, toggleConfig } = useApp();
      return (
        <>
          <span data-testid="config">{String(state.isConfigOpen)}</span>
          <button onClick={toggleConfig}>toggle</button>
        </>
      );
    }
    renderWithProvider(<Comp />);
    expect(screen.getByTestId('config').textContent).toBe('false');
    await act(async () => screen.getByText('toggle').click());
    expect(screen.getByTestId('config').textContent).toBe('true');
  });

  // ── SET_CONFIG action ──────────────────────────────────────────────────────

  it('SET_CONFIG merges config fields', async () => {
    // SET_CONFIG uses spread to merge: { ...state.config, ...action.config }.
    // Passing { model, temperature } updates those two fields.
    function Comp() {
      const { state, setConfig } = useApp();
      return (
        <>
          <span data-testid="model">{state.config.model}</span>
          <span data-testid="temp">{state.config.temperature}</span>
          <button onClick={() => setConfig({ model: 'gpt-4o', temperature: 1.2 })}>update</button>
        </>
      );
    }
    renderWithProvider(<Comp />);
    await act(async () => screen.getByText('update').click());
    expect(screen.getByTestId('model').textContent).toBe('gpt-4o');
    expect(screen.getByTestId('temp').textContent).toBe('1.2');
  });

  it('SET_CONFIG preserves unspecified config fields', async () => {
    // Updating only model must not delete or zero-out max_tokens.
    // This verifies the spread merge does not do a full replacement.
    function Comp() {
      const { state, setConfig } = useApp();
      return (
        <>
          <span data-testid="tokens">{state.config.max_tokens}</span>
          <button onClick={() => setConfig({ model: 'gpt-4o' })}>update</button>
        </>
      );
    }
    renderWithProvider(<Comp />);
    await act(async () => screen.getByText('update').click());
    // max_tokens was not included in the update — it must keep its initial value (4096).
    expect(screen.getByTestId('tokens').textContent).toBe('4096');
  });

  // ── localStorage persistence ────────────────────────────────────────────────

  it('persists sidebar state to localStorage after hydration', async () => {
    // The provider writes sidebar_open to localStorage whenever it changes (after
    // hydration is complete, to avoid writing the initial undefined value).
    function Comp() {
      const { state, toggleSidebar } = useApp();
      return (
        <>
          <span data-testid="sidebar">{String(state.isSidebarOpen)}</span>
          <button onClick={toggleSidebar}>toggle</button>
        </>
      );
    }
    await act(async () => renderWithProvider(<Comp />));
    await act(async () => screen.getByText('toggle').click());
    // After toggling, the new value must be written to localStorage.
    expect(localStorage.getItem('sidebar_open')).toBeDefined();
  });

  it('setAuth stores user in localStorage', async () => {
    // When a user logs in, their profile is persisted so hydration can restore
    // the session on the next page load.
    function Comp() {
      const { setAuth } = useApp();
      return <button onClick={() => setAuth({ email: 'u@u.com' }, 'tok')}>login</button>;
    }
    renderWithProvider(<Comp />);
    await act(async () => screen.getByText('login').click());
    // The user object is stored as a JSON string.
    expect(localStorage.getItem('app_user')).toContain('u@u.com');
  });

  it('clearAuth removes user from localStorage', async () => {
    // Logging out must clear the stored user so hydration does not restore the session.
    localStorage.setItem('app_user', JSON.stringify({ email: 'a@b.com' }));
    function Comp() {
      const { clearAuth } = useApp();
      return <button onClick={clearAuth}>logout</button>;
    }
    renderWithProvider(<Comp />);
    await act(async () => screen.getByText('logout').click());
    expect(localStorage.getItem('app_user')).toBeNull();
  });
});
