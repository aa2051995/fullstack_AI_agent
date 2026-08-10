/**
 * Integration tests for src/app/chat/layout.js (ChatLayout)
 *
 * ChatLayout is the shell around every page under /chat. It:
 *   1. Renders <Sidebar /> on the left
 *   2. Renders `children` in the main content area
 *   3. Renders <ConfigPanel /> only when state.isConfigOpen is true
 *   4. Runs a useEffect that calls convApi.list() when the user is authenticated
 *      and populates the context with setConversations(data)
 *
 * The most important behaviour to test is the conditional conversation loading:
 *   - Load when authenticated (token in localStorage → hydration → effect fires)
 *   - Do NOT load when not authenticated (guards against unauthenticated requests)
 *   - ConfigPanel appears / disappears based on isConfigOpen state flag
 *
 * WHY these are integration tests:
 *   ChatLayout ties the API call (convApi.list) directly to the auth state in the
 *   real context. We verify the real reducer receives setConversations and that
 *   the context reflects the loaded conversations. Sidebar and ConfigPanel are
 *   mocked as simple stubs so we focus purely on ChatLayout's own behavior.
 *
 * MOCKING DECISIONS:
 *   - @/lib/context:       NOT mocked — real AppProvider
 *   - @/lib/api:           mocked — control what convApi.list returns
 *   - @/app/ui/Sidebar:    mocked stub (complex deps: router, toast, api)
 *   - @/app/ui/ConfigPanel: mocked stub (complex deps: api, toast)
 */

import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppProvider, useApp } from '@/lib/context';
import ChatLayout from '@/app/chat/layout';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockConvList = jest.fn();

jest.mock('@/lib/api', () => ({
  // AppProvider's hydration useEffect calls getToken() to read the stored auth token.
  // We must include it here or AppProvider throws "getToken is not a function".
  getToken: () => localStorage.getItem('auth_token'),
  conversations: {
    list: (...a) => mockConvList(...a),
  },
}));

/**
 * Sidebar and ConfigPanel have their own heavy dependency trees
 * (router, toast, api, etc.). Mocking them as simple stubs keeps these
 * tests focused on ChatLayout's responsibilities, not theirs.
 */
jest.mock('@/app/ui/Sidebar', () => () => <div data-testid="sidebar" />);
jest.mock('@/app/ui/ConfigPanel', () => () => <div data-testid="config-panel" />);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * ContextSpy exposes context state as data attributes so we can assert
 * on the conversations array length after setConversations is dispatched.
 */
function ContextSpy() {
  const { state } = useApp();
  return (
    <div
      data-testid="context-spy"
      data-conv-count={state.conversations.length}
      data-config-open={String(state.isConfigOpen)}
    />
  );
}

/**
 * ToggleConfigButton lets tests open the config panel without needing
 * the real Sidebar to be rendered.
 */
function ToggleConfigButton() {
  const { toggleConfig } = useApp();
  return <button onClick={toggleConfig}>toggle-config</button>;
}

async function renderWithAuth(children) {
  localStorage.setItem('auth_token', 'tok');
  localStorage.setItem('app_user', JSON.stringify({ email: 'u@test.com' }));
  let result;
  await act(async () => {
    result = render(
      <AppProvider>
        <ContextSpy />
        <ToggleConfigButton />
        <ChatLayout>{children ?? <div data-testid="page-content">page</div>}</ChatLayout>
      </AppProvider>
    );
  });
  return result;
}

async function renderUnauthenticated(children) {
  let result;
  await act(async () => {
    result = render(
      <AppProvider>
        <ContextSpy />
        <ChatLayout>{children ?? <div data-testid="page-content">page</div>}</ChatLayout>
      </AppProvider>
    );
  });
  return result;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  mockConvList.mockResolvedValue([
    { id: 'c1', title: 'Chat 1', updated_at: new Date().toISOString() },
    { id: 'c2', title: 'Chat 2', updated_at: new Date().toISOString() },
  ]);
});

// ─── Static structure ──────────────────────────────────────────────────────────

describe('ChatLayout – structure', () => {
  it('renders the Sidebar stub', async () => {
    await renderWithAuth();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
  });

  it('renders children in the main content area', async () => {
    await renderWithAuth(<div data-testid="child">child content</div>);
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('does NOT render ConfigPanel by default (isConfigOpen starts false)', async () => {
    await renderWithAuth();
    // ConfigPanel is only rendered when state.isConfigOpen is true.
    expect(screen.queryByTestId('config-panel')).not.toBeInTheDocument();
  });
});

// ─── ConfigPanel conditional rendering ────────────────────────────────────────

describe('ChatLayout – ConfigPanel visibility', () => {
  it('renders ConfigPanel when isConfigOpen becomes true', async () => {
    await renderWithAuth();
    const user = userEvent.setup();

    // Dispatch TOGGLE_CONFIG via the helper button → isConfigOpen flips to true.
    await user.click(screen.getByText('toggle-config'));

    // ChatLayout re-renders with state.isConfigOpen === true → renders ConfigPanel.
    await waitFor(() => expect(screen.getByTestId('config-panel')).toBeInTheDocument());
  });

  it('removes ConfigPanel when isConfigOpen is toggled back to false', async () => {
    await renderWithAuth();
    const user = userEvent.setup();

    // Open then close.
    await user.click(screen.getByText('toggle-config')); // true
    await waitFor(() => expect(screen.getByTestId('config-panel')).toBeInTheDocument());

    await user.click(screen.getByText('toggle-config')); // false
    await waitFor(() => expect(screen.queryByTestId('config-panel')).not.toBeInTheDocument());
  });
});

// ─── Conversation list loading ─────────────────────────────────────────────────

describe('ChatLayout – conversation list loading', () => {
  it('calls convApi.list when the user is authenticated', async () => {
    await renderWithAuth();
    // The useEffect fires after hydration sets isAuthenticated=true.
    await waitFor(() => expect(mockConvList).toHaveBeenCalledTimes(1));
  });

  it('populates the context with the conversations from the server', async () => {
    await renderWithAuth();

    // After setConversations(data) is dispatched to the real reducer,
    // state.conversations.length must equal the number of items returned.
    await waitFor(() => {
      expect(screen.getByTestId('context-spy')).toHaveAttribute('data-conv-count', '2');
    });
  });

  it('does NOT call convApi.list when not authenticated', async () => {
    // The guard `if (!state.isAuthenticated) return` prevents the API call
    // when the user has no token — avoids 401 errors on protected endpoints.
    await renderUnauthenticated();

    await act(async () => {}); // flush any pending effects
    expect(mockConvList).not.toHaveBeenCalled();
  });

  it('handles convApi.list errors silently', async () => {
    // .catch(() => {}) swallows errors so a failed list load does not crash the layout.
    mockConvList.mockRejectedValue(new Error('Forbidden'));

    await expect(renderWithAuth()).resolves.toBeDefined();
    // Conversations stay empty — no partial/corrupt state.
    await act(async () => {});
    expect(screen.getByTestId('context-spy')).toHaveAttribute('data-conv-count', '0');
  });

  it('does NOT re-fetch conversations when isAuthenticated is already true and no re-render', async () => {
    // The useEffect has [state.isAuthenticated] as its dependency array.
    // It fires once when isAuthenticated transitions to true, not on every render.
    await renderWithAuth();
    await waitFor(() => expect(mockConvList).toHaveBeenCalledTimes(1));

    // No re-render has changed isAuthenticated, so list should still be called only once.
    expect(mockConvList).toHaveBeenCalledTimes(1);
  });
});
