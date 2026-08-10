/**
 * Tests for src/app/ui/Sidebar.js
 *
 * The Sidebar displays conversations grouped by date, provides search/filter,
 * conversation management (rename, delete), settings toggle, and logout.
 *
 * Dependencies that are mocked:
 *   - next/navigation (useRouter, usePathname) — routing and active-link detection
 *   - next/link — rendered as a plain <a> tag
 *   - react-hot-toast — toast notifications (success/error)
 *   - @/lib/context (useApp) — app state and action dispatchers
 *   - @/lib/api (conversations, auth) — actual HTTP calls
 *
 * Testing approach for groupByDate:
 *   We test the date grouping INDIRECTLY by passing conversations with specific
 *   `updated_at` timestamps and asserting the rendered section headers. This is
 *   better than exporting and testing the grouping function in isolation because
 *   it verifies the UI reflects the correct label ("Today", "Yesterday", etc.),
 *   not just that the function returns the right string.
 */

import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Sidebar from '@/app/ui/Sidebar';

// ─── Mocks ────────────────────────────────────────────────────────────────────

/**
 * mockPush / mockPathname: used by tests that check navigation or active link highlighting.
 * mockPathname is a jest.fn() so individual tests can change what it returns.
 */
const mockPush = jest.fn();
const mockPathname = jest.fn(() => '/chat');

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  // usePathname is called inside the component to determine the active conversation.
  // We wrap it in a jest.fn() so tests can override the return value (e.g., '/chat/c1').
  usePathname: () => mockPathname(),
}));

jest.mock('next/link', () => {
  return function Link({ href, children, ...props }) {
    return <a href={href} {...props}>{children}</a>;
  };
});

// react-hot-toast: mock both the default export and named exports.
// Some code does `import toast from 'react-hot-toast'` (default) and some does
// `import { toast } from 'react-hot-toast'` (named). We cover both.
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
  success: jest.fn(),
  error: jest.fn(),
}));
import toast from 'react-hot-toast';

/**
 * Context mock: we use module-level jest.fn() variables for action dispatchers.
 * This lets individual tests inspect call arguments without re-mocking the module.
 *
 * mockState is a plain object that gets replaced before each test via setMockState().
 * We use a `let` variable here rather than a const because setMockState() reassigns it.
 */
const mockDeleteConversation = jest.fn();
const mockUpdateConversation = jest.fn();
const mockToggleSidebar = jest.fn();
const mockToggleConfig = jest.fn();
const mockClearAuth = jest.fn();

let mockState = {};

jest.mock('@/lib/context', () => ({
  // The factory cannot reference outer `let mockState` (not yet initialized when hoisted).
  // Instead we return a closure that reads mockState at call time — by the time the
  // component calls useApp(), mockState has been assigned in beforeEach.
  useApp: () => ({
    state: mockState,
    deleteConversation: mockDeleteConversation,
    updateConversation: mockUpdateConversation,
    toggleSidebar: mockToggleSidebar,
    toggleConfig: mockToggleConfig,
    clearAuth: mockClearAuth,
  }),
}));

/**
 * API mock: conversations.delete and conversations.update are the two write operations
 * Sidebar performs. auth.logout is called on sign-out.
 *
 * We wrap them in arrow functions so tests can change mockConvDelete's behavior
 * (e.g., mockConvDelete.mockRejectedValue(...)) without the mock losing its reference.
 */
const mockConvDelete = jest.fn();
const mockConvUpdate = jest.fn();
const mockAuthLogout = jest.fn();

jest.mock('@/lib/api', () => ({
  conversations: {
    delete: (...a) => mockConvDelete(...a),
    update: (...a) => mockConvUpdate(...a),
  },
  auth: { logout: (...a) => mockAuthLogout(...a) },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * makeConv creates a conversation fixture with sensible defaults.
 * Pass overrides to customize individual fields: makeConv({ title: 'Chat about X' }).
 * updated_at is the current time by default, placing the conversation in "Today" group.
 */
function makeConv(overrides = {}) {
  return {
    id: 'c1',
    title: 'My Chat',
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * setMockState replaces the global mockState object before each test.
 * Providing default values for isSidebarOpen and conversations prevents tests
 * from accidentally inheriting state from a previous test.
 */
function setMockState(partial = {}) {
  mockState = {
    isSidebarOpen: true,
    conversations: [],
    user: null,
    ...partial,
  };
}

beforeEach(() => {
  setMockState();            // fresh empty state
  jest.clearAllMocks();      // clear call histories
  mockPathname.mockReturnValue('/chat'); // default: no conversation is active

  // window.confirm is called before deleting a conversation to ask for confirmation.
  // We mock it globally and default to returning true (user confirms).
  // Individual tests that test the "cancel" path override this to return false.
  window.confirm = jest.fn(() => true);
});

// ─── groupByDate (indirectly tested via Sidebar render) ───────────────────────

describe('Sidebar – groupByDate grouping', () => {
  it('groups today\'s conversation under "Today"', () => {
    // makeConv() uses new Date().toISOString() which is "now" → Today group.
    setMockState({ isSidebarOpen: true, conversations: [makeConv()] });
    render(<Sidebar />);
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('groups yesterday\'s conversation under "Yesterday"', () => {
    // 86400000ms = 1 day. Multiplying by 1.5 ensures we land in "yesterday"
    // regardless of what time during the day the test runs.
    const yesterday = new Date(Date.now() - 86400000 * 1.5).toISOString();
    setMockState({ isSidebarOpen: true, conversations: [makeConv({ updated_at: yesterday })] });
    render(<Sidebar />);
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
  });

  it('groups old conversation under "Older"', () => {
    // 30 days ago — definitely not Today or Yesterday.
    const old = new Date(Date.now() - 86400000 * 30).toISOString();
    setMockState({ isSidebarOpen: true, conversations: [makeConv({ updated_at: old })] });
    render(<Sidebar />);
    expect(screen.getByText('Older')).toBeInTheDocument();
  });

  it('does not render empty groups', () => {
    // With only a "Today" conversation, "Yesterday" and "Last 7 days" must not render.
    // queryByText returns null (not throws) when absent, which .not.toBeInTheDocument() checks.
    setMockState({ isSidebarOpen: true, conversations: [makeConv()] });
    render(<Sidebar />);
    expect(screen.queryByText('Yesterday')).not.toBeInTheDocument();
    expect(screen.queryByText('Last 7 days')).not.toBeInTheDocument();
  });
});

// ─── Sidebar open ─────────────────────────────────────────────────────────────

describe('Sidebar (open)', () => {
  beforeEach(() => setMockState({ isSidebarOpen: true, conversations: [] }));

  it('renders the New chat link', () => {
    render(<Sidebar />);
    expect(screen.getByText('New chat')).toBeInTheDocument();
  });

  it('renders search input', () => {
    render(<Sidebar />);
    expect(screen.getByPlaceholderText('Search conversations')).toBeInTheDocument();
  });

  it('renders Settings button', () => {
    render(<Sidebar />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders "No conversations yet" when list is empty', () => {
    render(<Sidebar />);
    expect(screen.getByText('No conversations yet')).toBeInTheDocument();
  });

  it('calls toggleSidebar when close button is clicked', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    // The close button has title="Close sidebar" — we find it by title attribute.
    await user.click(screen.getByTitle('Close sidebar'));
    expect(mockToggleSidebar).toHaveBeenCalled();
  });

  it('calls toggleConfig when Settings is clicked', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(screen.getByText('Settings'));
    expect(mockToggleConfig).toHaveBeenCalled();
  });

  it('shows user info when state.user is set', () => {
    // When a user is logged in, their name/email appear at the bottom of the sidebar.
    setMockState({ isSidebarOpen: true, conversations: [], user: { name: 'Alice', email: 'a@b.com' } });
    render(<Sidebar />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('shows user email initial as avatar letter', () => {
    // The user avatar shows the first letter of the email, uppercased.
    // 'bob@b.com' → 'B'
    setMockState({ isSidebarOpen: true, conversations: [], user: { email: 'bob@b.com' } });
    render(<Sidebar />);
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('renders conversation titles', () => {
    setMockState({ isSidebarOpen: true, conversations: [makeConv({ title: 'Hello Chat' })] });
    render(<Sidebar />);
    expect(screen.getByText('Hello Chat')).toBeInTheDocument();
  });

  it('highlights active conversation', () => {
    // When the URL path matches /chat/:id, that conversation item gets a distinct
    // background color (bg-zinc-700 class) to indicate it's active.
    mockPathname.mockReturnValue('/chat/c1'); // path = active conversation
    setMockState({ isSidebarOpen: true, conversations: [makeConv({ id: 'c1' })] });
    const { container } = render(<Sidebar />);

    // We use container.querySelector here because the class is an implementation
    // detail of the active state — there is no ARIA attribute for "selected" on a list item.
    const activeItem = container.querySelector('.bg-zinc-700');
    expect(activeItem).toBeInTheDocument();
  });
});

// ─── Sidebar closed ───────────────────────────────────────────────────────────

describe('Sidebar (closed)', () => {
  beforeEach(() => setMockState({ isSidebarOpen: false, conversations: [] }));

  it('renders only the open-sidebar toggle button', () => {
    render(<Sidebar />);
    // In closed state, only the icon to open it is visible.
    expect(screen.getByTitle('Open sidebar')).toBeInTheDocument();
    // The full sidebar content (New chat, search, etc.) is hidden.
    expect(screen.queryByText('New chat')).not.toBeInTheDocument();
  });

  it('calls toggleSidebar when open button is clicked', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(screen.getByTitle('Open sidebar'));
    expect(mockToggleSidebar).toHaveBeenCalled();
  });
});

// ─── Search filtering ─────────────────────────────────────────────────────────

describe('Sidebar – search', () => {
  beforeEach(() => {
    setMockState({
      isSidebarOpen: true,
      conversations: [
        makeConv({ id: '1', title: 'About React' }),
        makeConv({ id: '2', title: 'Python tips' }),
      ],
    });
  });

  it('filters conversations by search text', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    // Typing in the search input filters the conversation list in real time.
    await user.type(screen.getByPlaceholderText('Search conversations'), 'React');

    // Only "About React" should remain visible.
    expect(screen.getByText('About React')).toBeInTheDocument();
    // "Python tips" must be hidden (not rendered).
    expect(screen.queryByText('Python tips')).not.toBeInTheDocument();
  });

  it('is case-insensitive', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    // Typing lowercase "python" must match "Python tips" (capital P).
    await user.type(screen.getByPlaceholderText('Search conversations'), 'python');
    expect(screen.getByText('Python tips')).toBeInTheDocument();
  });

  it('shows "No conversations found" when no match', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.type(screen.getByPlaceholderText('Search conversations'), 'xyz_no_match');
    expect(screen.getByText('No conversations found')).toBeInTheDocument();
  });
});

// ─── Delete conversation ──────────────────────────────────────────────────────

describe('Sidebar – delete conversation', () => {
  beforeEach(() => {
    setMockState({ isSidebarOpen: true, conversations: [makeConv({ id: 'c1', title: 'Chat 1' })] });
    mockConvDelete.mockResolvedValue(undefined); // default: delete succeeds
  });

  it('calls API delete and dispatches deleteConversation on confirm', async () => {
    // window.confirm returns true (set in the global beforeEach) — user confirms deletion.
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByTitle('Delete'));

    // waitFor retries until both assertions pass — needed because the handler is async.
    await waitFor(() => {
      // The API call removes the conversation from the server.
      expect(mockConvDelete).toHaveBeenCalledWith('c1');
      // The context dispatch removes it from the local state.
      expect(mockDeleteConversation).toHaveBeenCalledWith('c1');
    });
  });

  it('pushes to /chat when deleting active conversation', async () => {
    // If the deleted conversation is the one currently being viewed,
    // the app must navigate away to /chat (the empty state).
    mockPathname.mockReturnValue('/chat/c1'); // c1 is currently active
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByTitle('Delete'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/chat'));
  });

  it('does not delete when confirm is cancelled', async () => {
    // window.confirm returning false means the user clicked "Cancel" in the dialog.
    window.confirm = jest.fn(() => false);
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByTitle('Delete'));

    // No API call and no dispatch should have happened.
    expect(mockConvDelete).not.toHaveBeenCalled();
  });

  it('shows error toast on delete failure', async () => {
    // If the API call fails, the component must notify the user via a toast error.
    mockConvDelete.mockRejectedValue(new Error('Server error'));
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByTitle('Delete'));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});

// ─── Rename conversation ──────────────────────────────────────────────────────

describe('Sidebar – rename conversation', () => {
  beforeEach(() => {
    setMockState({ isSidebarOpen: true, conversations: [makeConv({ id: 'c1', title: 'Old Title' })] });
    mockConvUpdate.mockResolvedValue({ id: 'c1', title: 'New Title' });
  });

  it('shows rename input on Rename button click', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByTitle('Rename'));

    // After clicking Rename, the conversation title is replaced with an editable input.
    // getByDisplayValue finds an input by its current value.
    expect(screen.getByDisplayValue('Old Title')).toBeInTheDocument();
  });

  it('calls API update and dispatches updateConversation on submit', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByTitle('Rename'));
    const input = screen.getByDisplayValue('Old Title');

    // Clear the existing value and type a new title, then press Enter to submit.
    await user.clear(input);
    await user.type(input, 'New Title{Enter}');

    await waitFor(() => {
      // Both the API call and the context dispatch must happen.
      expect(mockConvUpdate).toHaveBeenCalledWith('c1', { title: 'New Title' });
      expect(mockUpdateConversation).toHaveBeenCalledWith('c1', { title: 'New Title' });
    });
  });

  it('shows error toast on rename failure', async () => {
    mockConvUpdate.mockRejectedValue(new Error('fail'));
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByTitle('Rename'));
    const input = screen.getByDisplayValue('Old Title');
    await user.clear(input);
    await user.type(input, 'X{Enter}');

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it('skips API call when title is unchanged', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByTitle('Rename'));
    const input = screen.getByDisplayValue('Old Title');

    // fireEvent.blur fires the blur event without typing a new value.
    // The rename handler is triggered on both Enter and blur, but if the
    // title hasn't changed, the API call should be skipped (no unnecessary PATCH).
    fireEvent.blur(input);

    await waitFor(() => expect(mockConvUpdate).not.toHaveBeenCalled());
  });
});

// fireEvent is imported here (after all jest.mock() calls) for use in the
// rename test above. Imports can appear after jest.mock() — jest.mock() is
// hoisted above all imports at compile time regardless of their written order.
import { fireEvent } from '@testing-library/react';

// ─── Logout ───────────────────────────────────────────────────────────────────

describe('Sidebar – logout', () => {
  beforeEach(() => {
    // User must be logged in for the logout button to appear.
    setMockState({ isSidebarOpen: true, conversations: [], user: { name: 'Alice' } });
    mockAuthLogout.mockResolvedValue(undefined); // logout call succeeds
  });

  it('calls logout API and clearAuth then redirects', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByTitle('Sign out'));

    await waitFor(() => {
      // Three things must happen on logout:
      // 1. Tell the server the session is over.
      expect(mockAuthLogout).toHaveBeenCalled();
      // 2. Clear the local auth state (removes user and token from context + localStorage).
      expect(mockClearAuth).toHaveBeenCalled();
      // 3. Redirect to the login page.
      expect(mockPush).toHaveBeenCalledWith('/login');
    });
  });
});
