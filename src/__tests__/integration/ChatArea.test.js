/**
 * Integration tests for src/app/ui/ChatArea.js
 *
 * ChatArea is the most complex component in the app. It:
 *   - Renders the welcome screen (4 suggestion cards) when no messages exist
 *   - Orchestrates the full send flow:
 *       1. Creates a new conversation if conversationId is null
 *       2. Adds user and assistant placeholder messages to context
 *       3. Calls convApi.chat with streaming callbacks
 *       4. Appends each chunk to the last message via appendToLastMessage
 *       5. Stops streaming when onDone fires
 *       6. Shows error toast if onError fires
 *       7. Navigates to /chat/:id after creating a new conversation
 *   - Shows ThinkingBubble while streaming (before the first assistant chunk)
 *   - Passes isStreaming=true to the last assistant MessageBubble
 *   - Aborts the in-flight request when handleStop is called
 *   - Disables the input when the user is not authenticated
 *
 * WHY these are integration tests (not unit tests):
 *   Previous tests (AuthForm, Sidebar, etc.) mocked @/lib/context entirely.
 *   These tests use the REAL AppProvider and useApp hook, so we exercise the
 *   full round-trip: ChatArea action → reducer dispatch → state update → re-render.
 *   Only the external boundaries (API, router, UUID, toast) are mocked.
 *
 * MOCKING DECISIONS:
 *   - @/lib/context:   NOT mocked — use real AppProvider to verify state integration
 *   - @/lib/api:       mocked — no real HTTP calls in tests
 *   - next/navigation: mocked — no real browser router
 *   - uuid:            mocked — predictable IDs (counter-based)
 *   - react-hot-toast: mocked — verify toast calls without rendering toast DOM
 *   - react-markdown / react-syntax-highlighter: mocked — ESM-only packages
 */

import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppProvider } from '@/lib/context';
import ChatArea from '@/app/ui/ChatArea';

// ─── Mocks ────────────────────────────────────────────────────────────────────

/**
 * react-markdown is ESM-only and cannot be loaded by Jest's CommonJS transform.
 * We replace it with the same smart mock used in MessageBubble.test.js:
 * it parses fenced code blocks, inline code, and bold text, and calls the same
 * `components.code` / `components.pre` props that the real library would call.
 * This keeps MessageBubble (which is rendered by ChatArea) fully exercisable.
 */
jest.mock('react-markdown', () => {
  const React = require('react');
  return function ReactMarkdown({ children, components = {} }) {
    const content = String(children ?? '');
    const langMatch = /^```(\w+)\n([\s\S]*?)```\s*$/m.exec(content);
    if (langMatch) {
      const Code = components.code || 'code';
      const Pre = components.pre || 'pre';
      return React.createElement(Pre, null,
        React.createElement(Code, { className: `language-${langMatch[1]}` }, langMatch[2].replace(/\n$/, '')));
    }
    const boldMatch = /\*\*(.+?)\*\*/.exec(content);
    if (boldMatch) return React.createElement('strong', null, boldMatch[1]);
    return React.createElement('span', null, content);
  };
});
jest.mock('remark-gfm', () => ({}));
jest.mock('react-syntax-highlighter', () => ({
  Prism: ({ children, language }) => (
    <pre data-testid="syntax-highlighter" data-language={language}>{children}</pre>
  ),
}));
jest.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({ oneDark: {} }));

/**
 * next/navigation: useRouter is needed by ChatArea to navigate to the new
 * conversation after creating one.
 */
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

/**
 * @/lib/api: mock the conversations object.
 * - create: called when no conversationId is provided (new chat flow)
 * - chat: called for every message send; accepts { onChunk, onDone, onError } callbacks
 *
 * We expose mockConvCreate and mockConvChat at module scope so individual tests
 * can change their behavior (e.g. make chat call onChunk multiple times).
 */
const mockConvCreate = jest.fn();
const mockConvChat = jest.fn();

jest.mock('@/lib/api', () => ({
  // AppProvider's hydration useEffect calls getToken() to read the stored auth token.
  // We must include it here or AppProvider throws "getToken is not a function".
  getToken: () => localStorage.getItem('auth_token'),
  conversations: {
    create: (...a) => mockConvCreate(...a),
    chat: (...a) => mockConvChat(...a),
  },
}));

/**
 * uuid: ChatArea calls uuid() twice per send (user msg + assistant placeholder).
 * We use a counter so each call returns a unique, predictable ID.
 * Predictable IDs matter for React's key prop — duplicate keys cause silent bugs.
 */
const mockUuid = jest.fn();
jest.mock('uuid', () => ({ v4: (...a) => mockUuid(...a) }));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
  error: jest.fn(),
  success: jest.fn(),
}));
import toast from 'react-hot-toast';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * ContextInit pre-loads the context with a known currentConversationId so that
 * ChatArea shows messages for that conversation immediately.
 *
 * WHY this is necessary:
 *   ChatArea computes:
 *     const isCurrentConv = state.currentConversationId === conversationId;
 *     const messages = isCurrentConv ? state.currentMessages : [];
 *
 *   The context starts with currentConversationId = null. If the ChatArea prop
 *   conversationId is 'conv-1' but the context still has null, isCurrentConv is
 *   false and messages is always []. Dispatched addMessage calls go into
 *   state.currentMessages but the component never renders them.
 *
 *   By dispatching setCurrentConversation(conversationId, []) before ChatArea
 *   renders, we ensure isCurrentConv is true from the start, so addMessage
 *   calls ARE reflected in the DOM.
 */
import { useEffect } from 'react';
import { useApp } from '@/lib/context';
function ContextInit({ conversationId }) {
  const { setCurrentConversation } = useApp();
  useEffect(() => {
    if (conversationId) setCurrentConversation(conversationId, []);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * renderWithAuth wraps <ChatArea> in the real <AppProvider> and pre-populates
 * localStorage so the hydration useEffect sees a logged-in user.
 *
 * act(async () => render(...)) waits for the AppProvider's mount useEffect
 * (which reads localStorage and dispatches SET_HYDRATED) to complete before
 * any assertions run.
 */
async function renderWithAuth(props = {}) {
  localStorage.setItem('auth_token', 'test-token');
  localStorage.setItem('app_user', JSON.stringify({ email: 'user@test.com', name: 'Tester' }));
  let result;
  await act(async () => {
    result = render(
      <AppProvider>
        <ChatArea {...props} />
      </AppProvider>
    );
  });
  return result;
}

/**
 * renderWithAuthAndConv is like renderWithAuth but also pre-initializes the
 * context with the given conversationId as the current conversation.
 * This is needed for tests that assert on rendered message DOM content, because
 * ChatArea only renders state.currentMessages when
 *   state.currentConversationId === conversationId (prop).
 */
async function renderWithAuthAndConv(conversationId) {
  localStorage.setItem('auth_token', 'test-token');
  localStorage.setItem('app_user', JSON.stringify({ email: 'user@test.com', name: 'Tester' }));
  let result;
  await act(async () => {
    result = render(
      <AppProvider>
        <ContextInit conversationId={conversationId} />
        <ChatArea conversationId={conversationId} />
      </AppProvider>
    );
  });
  return result;
}

/**
 * renderUnauthenticated renders without any localStorage auth data.
 * The AppProvider starts in the unauthenticated state.
 */
async function renderUnauthenticated(props = {}) {
  let result;
  await act(async () => {
    result = render(
      <AppProvider>
        <ChatArea {...props} />
      </AppProvider>
    );
  });
  return result;
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(() => {
  // jsdom does not implement scrollIntoView. ChatArea's auto-scroll useEffect
  // calls bottomRef.current?.scrollIntoView({ behavior: 'smooth' }).
  // Without this mock it would throw "scrollIntoView is not a function".
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
});

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();

  // UUID counter: each call returns a unique string in the form 'uuid-N'.
  let count = 0;
  mockUuid.mockImplementation(() => `uuid-${++count}`);

  // Default mocks for the happy path:
  // - create a new conversation that returns id='new-conv'
  // - chat calls onDone immediately with no chunks (simple echo)
  mockConvCreate.mockResolvedValue({ id: 'new-conv', title: 'Hello world' });
  mockConvChat.mockImplementation(async (id, content, { onDone } = {}) => {
    onDone?.();
  });
});

// ─── Welcome screen (not authenticated) ───────────────────────────────────────

describe('ChatArea – welcome screen', () => {
  it('renders the "How can I help you today?" heading', async () => {
    await renderUnauthenticated({ conversationId: null });
    expect(screen.getByText('How can I help you today?')).toBeInTheDocument();
  });

  it('renders all four suggestion cards', async () => {
    await renderUnauthenticated({ conversationId: null });
    // The four WELCOME items are rendered as clickable buttons.
    expect(screen.getByText('Chat naturally')).toBeInTheDocument();
    expect(screen.getByText('Deep reasoning')).toBeInTheDocument();
    expect(screen.getByText('Code assistant')).toBeInTheDocument();
    expect(screen.getByText('Creative writing')).toBeInTheDocument();
  });

  it('renders card descriptions', async () => {
    await renderUnauthenticated({ conversationId: null });
    expect(screen.getByText('Ask anything in plain language')).toBeInTheDocument();
  });

  it('input is disabled when not authenticated', async () => {
    // ChatArea passes disabled={!state.isAuthenticated} to MessageInput.
    // When isAuthenticated is false, the Send button must be disabled.
    await renderUnauthenticated({ conversationId: null });
    const sendBtn = screen.getByTitle('Send (Enter)');
    expect(sendBtn).toBeDisabled();
  });

  it('input is enabled after typing when authenticated', async () => {
    await renderWithAuth({ conversationId: null });
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Message AI…'), 'hello');
    expect(screen.getByTitle('Send (Enter)')).not.toBeDisabled();
  });
});

// ─── Suggestion card click ─────────────────────────────────────────────────────

describe('ChatArea – suggestion cards', () => {
  it('clicking a suggestion card triggers handleSend with the card title', async () => {
    // Each card calls onClick={() => handleSend(item.title + ': ')}
    // handleSend with no conversationId creates a new conversation.
    await renderWithAuth({ conversationId: null });
    const user = userEvent.setup();

    await user.click(screen.getByText('Chat naturally'));

    // The create API must have been called (proving handleSend ran).
    await waitFor(() => expect(mockConvCreate).toHaveBeenCalled());
  });
});

// ─── Sending a new message (no conversationId) ─────────────────────────────────

describe('ChatArea – new conversation flow', () => {
  it('creates a conversation using the first 60 chars of the message', async () => {
    await renderWithAuth({ conversationId: null });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('Message AI…'), 'Hello world');
    await user.click(screen.getByTitle('Send (Enter)'));

    await waitFor(() =>
      expect(mockConvCreate).toHaveBeenCalledWith('Hello world')
    );
  });

  it('navigates to /chat/:id after creating the conversation', async () => {
    await renderWithAuth({ conversationId: null });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('Message AI…'), 'Hi');
    await user.click(screen.getByTitle('Send (Enter)'));

    // After create returns { id: 'new-conv' }, router.push('/chat/new-conv') must be called.
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/chat/new-conv'));
  });

  it('calls convApi.chat with the new conversation id and message', async () => {
    await renderWithAuth({ conversationId: null });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('Message AI…'), 'Test message');
    await user.click(screen.getByTitle('Send (Enter)'));

    await waitFor(() =>
      expect(mockConvChat).toHaveBeenCalledWith(
        'new-conv',
        'Test message',
        expect.any(Object), // the callbacks object
      )
    );
  });

  it('shows toast error and aborts when conversation creation fails', async () => {
    // If convApi.create rejects, the component shows an error toast and does
    // not proceed to call convApi.chat.
    mockConvCreate.mockRejectedValue(new Error('Network error'));

    await renderWithAuth({ conversationId: null });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('Message AI…'), 'Hi');
    await user.click(screen.getByTitle('Send (Enter)'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to create conversation'));
    expect(mockConvChat).not.toHaveBeenCalled();
  });
});

// ─── Sending to an existing conversation ──────────────────────────────────────

describe('ChatArea – existing conversation flow', () => {
  it('does not call convApi.create when conversationId is provided', async () => {
    await renderWithAuth({ conversationId: 'existing-conv' });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('Message AI…'), 'Follow-up');
    await user.click(screen.getByTitle('Send (Enter)'));

    await waitFor(() => expect(mockConvChat).toHaveBeenCalled());
    expect(mockConvCreate).not.toHaveBeenCalled();
  });

  it('calls convApi.chat with the existing conversation id', async () => {
    await renderWithAuth({ conversationId: 'existing-conv' });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('Message AI…'), 'Follow-up');
    await user.click(screen.getByTitle('Send (Enter)'));

    await waitFor(() =>
      expect(mockConvChat).toHaveBeenCalledWith(
        'existing-conv',
        'Follow-up',
        expect.any(Object),
      )
    );
  });
});

// ─── Message rendering ─────────────────────────────────────────────────────────

describe('ChatArea – message list rendering', () => {
  it('renders user message in the DOM after sending', async () => {
    // handleSend calls addMessage({ role: 'user', content }) which dispatches
    // ADD_MESSAGE to the real reducer. The DOM should show the message.
    //
    // We use renderWithAuthAndConv('conv-1') instead of renderWithAuth({ conversationId: null })
    // because ChatArea only renders state.currentMessages when
    //   state.currentConversationId === conversationId (prop).
    // A null conversationId causes a convApi.create call that changes currentConversationId
    // to 'new-conv', making it no longer equal to the null prop — messages never appear.
    // renderWithAuthAndConv pre-initializes the context so both sides match.
    await renderWithAuthAndConv('conv-1');
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('Message AI…'), 'My question');
    await user.click(screen.getByTitle('Send (Enter)'));

    await waitFor(() => expect(screen.getByText('My question')).toBeInTheDocument());
  });

  it('renders streamed assistant content after onChunk is called', async () => {
    // The mock calls onChunk twice, then onDone.
    // Each onChunk dispatches APPEND_TO_LAST_MESSAGE, building up the full response.
    //
    // renderWithAuthAndConv pre-initializes currentConversationId so isCurrentConv
    // is true — without it, ChatArea sets messages = [] and renders nothing.
    mockConvChat.mockImplementation(async (id, content, { onChunk, onDone } = {}) => {
      onChunk?.('Hello ');
      onChunk?.('world!');
      onDone?.();
    });

    await renderWithAuthAndConv('conv-1');
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('Message AI…'), 'Hi');
    await user.click(screen.getByTitle('Send (Enter)'));

    // The two chunks are concatenated by appendToLastMessage into "Hello world!".
    await waitFor(() => expect(screen.getByText('Hello world!')).toBeInTheDocument());
  });
});

// ─── Streaming UI state ────────────────────────────────────────────────────────

describe('ChatArea – streaming state', () => {
  it('shows the Stop button while streaming is in progress', async () => {
    // We keep the mock unresolved so isStreaming stays true during the assertion.
    let resolveChat;
    mockConvChat.mockReturnValue(new Promise(r => { resolveChat = r; }));

    await renderWithAuth({ conversationId: 'conv-1' });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('Message AI…'), 'Hi');
    await user.click(screen.getByTitle('Send (Enter)'));

    // setStreaming(true) is dispatched before calling convApi.chat.
    // MessageInput reads state.isStreaming and shows the Stop button.
    await waitFor(() => expect(screen.getByTitle('Stop generating')).toBeInTheDocument());

    // Clean up: resolve so the Promise does not leak.
    await act(async () => resolveChat());
  });

  it('Stop button calls handleStop and removes the streaming state', async () => {
    let resolveChat;
    mockConvChat.mockReturnValue(new Promise(r => { resolveChat = r; }));

    await renderWithAuth({ conversationId: 'conv-1' });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('Message AI…'), 'Hi');
    await user.click(screen.getByTitle('Send (Enter)'));
    await waitFor(() => expect(screen.getByTitle('Stop generating')).toBeInTheDocument());

    // Clicking Stop calls handleStop → abortRef.current.abort() + setStreaming(false).
    await user.click(screen.getByTitle('Stop generating'));

    // After setStreaming(false) the Send button reappears.
    await waitFor(() => expect(screen.getByTitle('Send (Enter)')).toBeInTheDocument());

    await act(async () => resolveChat());
  });

  it('Send button reappears after streaming completes', async () => {
    // onDone dispatches setStreaming(false), which reverts the UI back to Send mode.
    mockConvChat.mockImplementation(async (id, content, { onChunk, onDone } = {}) => {
      onChunk?.('Response');
      onDone?.();
    });

    await renderWithAuth({ conversationId: 'conv-1' });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('Message AI…'), 'Hi');
    await user.click(screen.getByTitle('Send (Enter)'));

    await waitFor(() => expect(screen.getByTitle('Send (Enter)')).toBeInTheDocument());
  });
});

// ─── Error handling ────────────────────────────────────────────────────────────

describe('ChatArea – error handling', () => {
  it('shows error toast when onError is called with a non-abort error', async () => {
    // The chat API calls onError when the network fails or the server returns an error.
    mockConvChat.mockImplementation(async (id, content, { onError } = {}) => {
      onError?.(new Error('Generation failed'));
    });

    await renderWithAuth({ conversationId: 'conv-1' });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('Message AI…'), 'Hi');
    await user.click(screen.getByTitle('Send (Enter)'));

    // toast.error must be called with the error's message.
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Generation failed'));
  });

  it('does NOT show toast when the error is an AbortError', async () => {
    // AbortError is fired when the user clicks Stop. We must NOT show a toast for it —
    // the user intentionally cancelled the request.
    mockConvChat.mockImplementation(async (id, content, { onError } = {}) => {
      const err = new Error('AbortError');
      err.name = 'AbortError';
      onError?.(err);
    });

    await renderWithAuth({ conversationId: 'conv-1' });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('Message AI…'), 'Hi');
    await user.click(screen.getByTitle('Send (Enter)'));

    // Give the handler time to finish, then verify toast was NOT called.
    await waitFor(() => expect(mockConvChat).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('shows fallback "Generation failed" toast when onError has no message', async () => {
    // If the error object has no message, the component must show a generic fallback.
    mockConvChat.mockImplementation(async (id, content, { onError } = {}) => {
      onError?.({}); // plain object, no .message
    });

    await renderWithAuth({ conversationId: 'conv-1' });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('Message AI…'), 'Hi');
    await user.click(screen.getByTitle('Send (Enter)'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Generation failed'));
  });

  it('does not send when isStreaming is already true (guard)', async () => {
    // Two rapid clicks: first send starts streaming, second click must be ignored.
    let firstChatResolve;
    mockConvChat.mockReturnValueOnce(new Promise(r => { firstChatResolve = r; }));

    await renderWithAuth({ conversationId: 'conv-1' });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('Message AI…'), 'Hi');
    await user.click(screen.getByTitle('Send (Enter)'));

    // Now streaming is in progress. Trying to send again must be a no-op.
    await waitFor(() => expect(screen.getByTitle('Stop generating')).toBeInTheDocument());
    // The Send button is gone, so we can't click it — the guard is in the UI too.
    expect(screen.queryByTitle('Send (Enter)')).not.toBeInTheDocument();

    await act(async () => firstChatResolve());
  });
});
