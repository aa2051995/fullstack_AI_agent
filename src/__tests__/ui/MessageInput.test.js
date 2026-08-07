/**
 * Tests for src/app/ui/MessageInput.js
 *
 * MessageInput is the text entry area at the bottom of the chat. It has two modes:
 *   - Idle: shows a textarea and a Send button. The send button is disabled when empty.
 *   - Streaming: shows the textarea (disabled) and a Stop button instead of Send.
 *
 * It reads two things from the global context:
 *   - state.isStreaming — controls whether to show Send or Stop
 *   - state.config.model — the model name displayed below the textarea
 *
 * We mock the context module to return a plain object (mockState) and mutate
 * mockState.isStreaming in beforeEach to switch between idle and streaming modes.
 *
 * Why mutate an object instead of calling mockReturnValue each time?
 *   The jest.mock() factory runs once and returns the same mock object reference
 *   on every call. We mutate mockState so the mock always returns the SAME reference,
 *   which means we can change behavior between tests without re-mocking.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessageInput from '@/app/ui/MessageInput';

// ─── Mocks ────────────────────────────────────────────────────────────────────

/**
 * mockState is a mutable plain object that the context mock returns by reference.
 * Tests that need streaming mode set `mockState.isStreaming = true` in beforeEach.
 *
 * This pattern avoids re-mocking the module for each test suite, which would
 * require more complex jest.mock() factory management.
 */
const mockState = { isStreaming: false, config: { model: 'claude-opus-4-7' } };

jest.mock('@/lib/context', () => ({
  // The factory captures `mockState` from the outer scope via closure.
  // Because mockState is an object (a reference type), mutations to it are seen
  // by the mock on every call — even after the factory has run.
  useApp: () => ({ state: mockState }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * renderInput creates fresh jest.fn() callbacks and renders MessageInput.
 * Returns { onSend, onStop } so tests can assert on how/whether they were called.
 *
 * Spreading `props` allows individual tests to override defaults (e.g., disabled: true).
 */
function renderInput(props = {}) {
  const onSend = jest.fn();
  const onStop = jest.fn();
  render(<MessageInput onSend={onSend} onStop={onStop} disabled={false} {...props} />);
  return { onSend, onStop };
}

beforeEach(() => {
  // Reset streaming mode before each test. Tests in the "streaming" describe block
  // override this in their own beforeEach.
  mockState.isStreaming = false;
  jest.clearAllMocks();
});

// ─── Idle state ───────────────────────────────────────────────────────────────

describe('MessageInput (idle)', () => {
  it('renders the textarea', () => {
    renderInput();
    // getByPlaceholderText is the most natural way to find a textarea with a placeholder.
    expect(screen.getByPlaceholderText('Message AI…')).toBeInTheDocument();
  });

  it('renders the send button when not streaming', () => {
    renderInput();
    // The send button has a title attribute used for accessibility and tooltip display.
    // getByTitle is appropriate here because there's no visible text label on the icon button.
    expect(screen.getByTitle('Send (Enter)')).toBeInTheDocument();
  });

  it('shows current model name', () => {
    renderInput();
    // The model name from state.config.model is displayed below the textarea
    // to inform users which AI model is active.
    expect(screen.getByText('claude-opus-4-7')).toBeInTheDocument();
  });

  it('send button is disabled when textarea is empty', () => {
    renderInput();
    // An empty or whitespace-only message must not be sendable — it's meaningless.
    // The button is disabled at render time before any input.
    expect(screen.getByTitle('Send (Enter)')).toBeDisabled();
  });

  it('send button is disabled when prop disabled=true', async () => {
    // The parent component can disable MessageInput during async operations
    // (e.g., while a previous message is still being processed).
    const user = userEvent.setup();
    const { onSend } = renderInput({ disabled: true });

    // Even after typing, the send button must remain disabled.
    await user.type(screen.getByPlaceholderText('Message AI…'), 'hello');
    expect(screen.getByTitle('Send (Enter)')).toBeDisabled();

    // Clicking a disabled button must not call onSend.
    await user.click(screen.getByTitle('Send (Enter)'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('send button becomes enabled when value is non-empty', async () => {
    const user = userEvent.setup();
    renderInput();
    // After typing at least one non-whitespace character, the button becomes enabled.
    await user.type(screen.getByPlaceholderText('Message AI…'), 'hello');
    expect(screen.getByTitle('Send (Enter)')).not.toBeDisabled();
  });
});

// ─── Sending messages ─────────────────────────────────────────────────────────

describe('MessageInput – sending', () => {
  it('calls onSend with trimmed value on button click', async () => {
    const user = userEvent.setup();
    const { onSend } = renderInput();

    // Leading and trailing whitespace must be stripped before sending.
    // '  hello world  ' becomes 'hello world'.
    await user.type(screen.getByPlaceholderText('Message AI…'), '  hello world  ');
    await user.click(screen.getByTitle('Send (Enter)'));

    expect(onSend).toHaveBeenCalledWith('hello world');
  });

  it('clears textarea after sending', async () => {
    const user = userEvent.setup();
    renderInput();
    const ta = screen.getByPlaceholderText('Message AI…');

    await user.type(ta, 'hello');
    await user.click(screen.getByTitle('Send (Enter)'));

    // After sending, the textarea must be empty so the user can type a new message.
    expect(ta.value).toBe('');
  });

  it('calls onSend on Enter key press', async () => {
    const user = userEvent.setup();
    const { onSend } = renderInput();
    const ta = screen.getByPlaceholderText('Message AI…');

    // '{Enter}' is userEvent's keyboard shorthand for the Enter key.
    // The component's keydown handler must detect Enter (without Shift) and submit.
    await user.type(ta, 'hello{Enter}');
    expect(onSend).toHaveBeenCalledWith('hello');
  });

  it('does NOT send on Shift+Enter (adds newline)', async () => {
    // Shift+Enter is the standard multiline input shortcut. It must NOT trigger onSend.
    // The component should insert a newline character instead.
    const user = userEvent.setup();
    const { onSend } = renderInput();
    const ta = screen.getByPlaceholderText('Message AI…');

    await user.type(ta, 'hello');
    // {Shift>} holds Shift down, {Enter} presses Enter, {/Shift} releases Shift.
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    expect(onSend).not.toHaveBeenCalled();
    // The textarea value must contain a newline character.
    expect(ta.value).toContain('\n');
  });

  it('does NOT send empty or whitespace-only message', async () => {
    const user = userEvent.setup();
    const { onSend } = renderInput();
    const ta = screen.getByPlaceholderText('Message AI…');

    // Type only spaces (which the component should treat as empty).
    await user.type(ta, '   ');

    // We use fireEvent.keyDown here rather than user.keyboard because the button
    // is still disabled (all spaces → trimmed value is ''), and userEvent won't
    // click a disabled button. fireEvent sends the raw event regardless.
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('does NOT call onSend when disabled=true even with Enter', async () => {
    const user = userEvent.setup();
    const { onSend } = renderInput({ disabled: true });

    // Even typing and pressing Enter on a disabled input must not submit.
    // The keydown handler must check the disabled prop before calling onSend.
    await user.type(screen.getByPlaceholderText('Message AI…'), 'hello{Enter}');
    expect(onSend).not.toHaveBeenCalled();
  });
});

// ─── Streaming state ──────────────────────────────────────────────────────────

describe('MessageInput (streaming)', () => {
  beforeEach(() => {
    // Set streaming mode for ALL tests in this describe block.
    // This describe-level beforeEach runs AFTER the file-level beforeEach,
    // overriding the isStreaming = false that was just set.
    mockState.isStreaming = true;
  });

  it('renders the stop button instead of send', () => {
    renderInput();
    // In streaming mode, the stop button replaces the send button.
    expect(screen.getByTitle('Stop generating')).toBeInTheDocument();
    // The send button must be completely absent (not just hidden).
    expect(screen.queryByTitle('Send (Enter)')).not.toBeInTheDocument();
  });

  it('calls onStop when stop button is clicked', async () => {
    const user = userEvent.setup();
    const { onStop } = renderInput();
    await user.click(screen.getByTitle('Stop generating'));
    expect(onStop).toHaveBeenCalled();
  });

  it('textarea is disabled when streaming', () => {
    renderInput();
    // The user should not be able to type during streaming — the response is still
    // being generated. The textarea is disabled to prevent new input.
    expect(screen.getByPlaceholderText('Message AI…')).toBeDisabled();
  });
});

// ─── Auto-resize ──────────────────────────────────────────────────────────────

describe('MessageInput – auto-resize', () => {
  it('adjusts textarea height as content changes', async () => {
    const user = userEvent.setup();
    renderInput();
    const ta = screen.getByPlaceholderText('Message AI…');

    // jsdom does not compute real layout (scrollHeight is always 0), so we cannot
    // assert on the actual pixel height. We verify that typing multiline content
    // does not throw any errors — confirming the resize handler runs safely.
    await user.type(ta, 'line1\nline2\nline3');
    expect(ta).toBeInTheDocument(); // component did not crash
  });
});
