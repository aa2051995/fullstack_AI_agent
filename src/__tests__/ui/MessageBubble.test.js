/**
 * Tests for src/app/ui/MessageBubble.js
 *
 * MessageBubble renders either a user message (right-aligned blue bubble) or an
 * assistant message (left-aligned with AI avatar, markdown rendered, code blocks
 * with syntax highlighting and a copy button).
 *
 * Two significant challenges require special mocking setups:
 *
 * 1. react-markdown is ESM-only (uses ES module exports), which Jest's CommonJS
 *    transform cannot parse. Next.js's jest config overrides transformIgnorePatterns,
 *    so we cannot fix this via configuration. Solution: replace the entire module
 *    with a hand-written React component that implements the same `components` prop
 *    interface, so CopyButton and SyntaxHighlighter still get exercised in tests.
 *
 * 2. navigator.clipboard does not exist in jsdom (jsdom has no secure context).
 *    We must polyfill it with a jest.fn() mock. Additionally, userEvent.setup()
 *    installs its own clipboard mock during pointer events, which replaces our mock.
 *    Solution: use fireEvent.click() for the writeText spy test, which does not
 *    intercept the clipboard.
 */

import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessageBubble from '@/app/ui/MessageBubble';

// ─── Mocks ────────────────────────────────────────────────────────────────────

/**
 * Mock for react-markdown (ESM-only package).
 *
 * The real react-markdown parses markdown text and calls the `components` prop
 * to render custom HTML elements. Our mock does the same parsing with regex and
 * calls components.code and components.pre the same way the real library would.
 *
 * This means:
 *   - The SyntaxHighlighter (passed as components.code) still renders.
 *   - The CopyButton (rendered inside the pre wrapper) still renders.
 *   - All our assertions about rendered code blocks still work.
 *
 * The factory function uses require() (not import) because jest.mock factories
 * run in CommonJS module scope, before any ESM imports are processed.
 */
jest.mock('react-markdown', () => {
  const React = require('react');

  return function ReactMarkdown({ children, components = {} }) {
    const content = String(children ?? '');

    // ── Fenced code block WITH language: ```js\ncode\n``` ──────────────────
    // This triggers the code component with className="language-js", which is
    // how the real react-markdown signals a fenced code block to custom renderers.
    const langMatch = /^```(\w+)\n([\s\S]*?)```\s*$/m.exec(content);
    if (langMatch) {
      const lang = langMatch[1];
      const code = langMatch[2].replace(/\n$/, '');
      const Code = components.code || 'code';
      const Pre = components.pre || 'pre';
      return React.createElement(
        Pre,
        null,
        React.createElement(Code, { className: `language-${lang}` }, code),
      );
    }

    // ── Fenced code block WITHOUT language: ```\ncode\n``` ─────────────────
    // No className is passed — this causes the code component to render plain
    // block code without syntax highlighting.
    const noLangMatch = /^```\n([\s\S]*?)```\s*$/m.exec(content);
    if (noLangMatch) {
      const code = noLangMatch[1];
      const Code = components.code || 'code';
      const Pre = components.pre || 'pre';
      return React.createElement(Pre, null, React.createElement(Code, null, code));
    }

    // ── Inline code: Use `npm install` ─────────────────────────────────────
    // Inline code does not have a className, and the surrounding text is rendered
    // as plain text before and after it.
    const inlineMatch = /`([^`\n]+)`/.exec(content);
    if (inlineMatch) {
      const Code = components.code || 'code';
      const before = content.slice(0, content.indexOf('`'));
      return React.createElement(
        'span',
        null,
        before,
        React.createElement(Code, null, inlineMatch[1]),
      );
    }

    // ── Bold text: **bold text** ────────────────────────────────────────────
    const boldMatch = /\*\*(.+?)\*\*/.exec(content);
    if (boldMatch) {
      return React.createElement('strong', null, boldMatch[1]);
    }

    // ── Plain text fallback ─────────────────────────────────────────────────
    return React.createElement('span', null, content);
  };
});

// remark-gfm is imported by MessageBubble but only consumed by the real react-markdown.
// Since react-markdown is mocked, remark-gfm's value is irrelevant — return an empty object.
jest.mock('remark-gfm', () => ({}));

/**
 * Mock for react-syntax-highlighter.
 *
 * The real Prism component applies token-level syntax coloring to code blocks.
 * In tests we don't need that — we just need to verify that:
 *   a) The syntax highlighter rendered (data-testid="syntax-highlighter" is present).
 *   b) The correct language was passed (data-language attribute).
 *
 * Using data-testid here is acceptable because there is no accessible name or role
 * that uniquely identifies a syntax highlighter block.
 */
jest.mock('react-syntax-highlighter', () => ({
  Prism: ({ children, language }) => (
    <pre data-testid="syntax-highlighter" data-language={language}>{children}</pre>
  ),
}));

// The style object imported from the prism styles package is just a CSS-in-JS theme.
// It has no effect in tests since we're mocking the highlighter itself.
jest.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({
  oneDark: {},
}));

// ─── User messages ────────────────────────────────────────────────────────────

/**
 * User messages render as right-aligned bubbles with plain text (no markdown).
 * The role="user" path is the simpler branch in MessageBubble.
 */
describe('MessageBubble (user role)', () => {
  it('renders message content', () => {
    // Basic smoke test: the text passed as content must appear in the DOM.
    render(<MessageBubble message={{ role: 'user', content: 'Hello!' }} />);
    expect(screen.getByText('Hello!')).toBeInTheDocument();
  });

  it('is right-aligned (justify-end)', () => {
    // User messages use flexbox with justify-end to push the bubble to the right.
    // We check the outer wrapper's class, which is container.firstChild.
    const { container } = render(<MessageBubble message={{ role: 'user', content: 'Hi' }} />);
    expect(container.firstChild).toHaveClass('justify-end');
  });

  it('does NOT render the AI avatar circle', () => {
    // The AI avatar is a rounded-full div that only appears for assistant messages.
    // Checking its absence confirms the user branch is taken.
    const { container } = render(<MessageBubble message={{ role: 'user', content: 'Hi' }} />);
    expect(container.querySelector('.rounded-full')).not.toBeInTheDocument();
  });

  it('renders empty content gracefully', () => {
    // The component must not crash with an empty string content.
    // not.toThrow() wraps the render in a try/catch.
    expect(() => render(<MessageBubble message={{ role: 'user', content: '' }} />)).not.toThrow();
  });

  it('renders multi-line content preserving whitespace', () => {
    // User messages use whitespace-pre-wrap so newlines in the content are visible.
    // We verify the class is present, which tells CSS to preserve whitespace.
    const { container } = render(
      <MessageBubble message={{ role: 'user', content: 'line1\nline2' }} />,
    );
    const bubble = container.querySelector('.whitespace-pre-wrap');
    expect(bubble).toBeInTheDocument();
  });
});

// ─── Assistant messages ───────────────────────────────────────────────────────

/**
 * Assistant messages render through ReactMarkdown (mocked above) with custom
 * component renderers for code blocks. The mock calls our components.code and
 * components.pre, so SyntaxHighlighter and CopyButton are exercised.
 */
describe('MessageBubble (assistant role)', () => {
  it('renders message content via markdown', () => {
    // **bold text** is matched by our mock and rendered as <strong>bold text</strong>.
    // The text "bold text" (without the **) should be visible.
    render(<MessageBubble message={{ role: 'assistant', content: '**bold text**' }} />);
    expect(screen.getByText('bold text')).toBeInTheDocument();
  });

  it('renders AI avatar', () => {
    // The AI avatar is a small rounded-full gradient circle. It must appear for
    // assistant messages but not for user messages (tested above).
    const { container } = render(
      <MessageBubble message={{ role: 'assistant', content: 'Hello' }} />,
    );
    expect(container.querySelector('.rounded-full')).toBeInTheDocument();
  });

  it('renders empty content gracefully', () => {
    // ReactMarkdown receives an empty string when content is ''. It must not crash.
    expect(() =>
      render(<MessageBubble message={{ role: 'assistant', content: '' }} />),
    ).not.toThrow();
  });

  it('adds streaming-cursor class when isStreaming=true', () => {
    // The streaming cursor (a blinking CSS animation) is added via a class.
    // This class drives the animated cursor shown while the AI is typing.
    const { container } = render(
      <MessageBubble message={{ role: 'assistant', content: 'typing' }} isStreaming={true} />,
    );
    expect(container.querySelector('.streaming-cursor')).toBeInTheDocument();
  });

  it('does NOT add streaming-cursor class when isStreaming=false', () => {
    // When streaming is done, the cursor class must be removed so the animation stops.
    const { container } = render(
      <MessageBubble message={{ role: 'assistant', content: 'done' }} isStreaming={false} />,
    );
    expect(container.querySelector('.streaming-cursor')).not.toBeInTheDocument();
  });

  it('renders inline code', () => {
    // Our mock parses `backtick-wrapped text` and calls components.code.
    // MessageBubble's code renderer returns an inline <code> tag for content without
    // a language class. The text inside the backticks must be visible.
    render(<MessageBubble message={{ role: 'assistant', content: 'Use `npm install`' }} />);
    expect(screen.getByText('npm install')).toBeInTheDocument();
  });

  it('renders a fenced code block with syntax highlighter', () => {
    // Our mock detects ```js\n...\n``` and calls:
    //   components.pre(children: components.code({ className: 'language-js' }, 'code'))
    // MessageBubble's code renderer sees className="language-js" and renders
    // SyntaxHighlighter (our mock of which adds data-testid="syntax-highlighter").
    render(
      <MessageBubble
        message={{ role: 'assistant', content: '```js\nconsole.log("hi")\n```' }}
      />,
    );
    expect(screen.getByTestId('syntax-highlighter')).toBeInTheDocument();
    // The language must be extracted from the className and passed to SyntaxHighlighter.
    expect(screen.getByTestId('syntax-highlighter')).toHaveAttribute('data-language', 'js');
  });

  it('renders code block language label', () => {
    // MessageBubble renders a small label showing the language name above the code block.
    // This test verifies the language string extracted from the className is displayed.
    render(
      <MessageBubble
        message={{ role: 'assistant', content: '```python\nprint("hi")\n```' }}
      />,
    );
    expect(screen.getByText('python')).toBeInTheDocument();
  });

  it('renders block code for unlanguaged fenced code', () => {
    // A fenced block with no language (``` without a language tag) renders as a plain
    // block <code> element without syntax highlighting.
    render(
      <MessageBubble
        message={{ role: 'assistant', content: '```\nline1\nline2\n```' }}
      />,
    );
    // document.querySelector works on the global document, same as screen queries.
    expect(document.querySelector('code')).not.toBeNull();
  });
});

// ─── CopyButton ───────────────────────────────────────────────────────────────

/**
 * CopyButton is rendered inside code blocks. It:
 *   1. Shows "Copy" by default.
 *   2. Calls navigator.clipboard.writeText(code) when clicked.
 *   3. Shows "✓ Copied" after clicking.
 *   4. Reverts to "Copy" after 2 seconds (via setTimeout).
 *
 * Two key decisions in this describe block:
 *
 * DECISION 1 — Fake timers:
 *   We use jest.useFakeTimers() so we can advance time by 2000ms instantly
 *   without making the test actually wait 2 seconds.
 *
 * DECISION 2 — Clipboard setup in beforeEach (not beforeAll):
 *   We discovered that jest.useFakeTimers() replaces global state in a way that
 *   causes our Object.defineProperty(navigator, 'clipboard', ...) to be lost
 *   between tests when set in beforeAll. Re-setting it in every beforeEach (after
 *   jest.useFakeTimers() runs) guarantees a fresh, reliable mock every time.
 */
describe('CopyButton', () => {
  let clipboardMock;

  beforeEach(() => {
    // Install fake timers FIRST. This may reset parts of the global environment.
    jest.useFakeTimers();

    // Now define the clipboard mock AFTER fake timers are installed, so it is
    // guaranteed to be in place when the test body runs.
    //
    // Object.defineProperty is required because navigator.clipboard is defined
    // as a getter on the Navigator prototype (not a plain writable property).
    // A simple assignment `navigator.clipboard = ...` would silently fail in strict mode.
    // configurable: true allows this property to be redefined in the next beforeEach.
    // writable: true allows direct property assignment on the object we set.
    clipboardMock = { writeText: jest.fn().mockResolvedValue(undefined) };
    Object.defineProperty(navigator, 'clipboard', {
      value: clipboardMock,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    // Restore real timers after each test so other test suites (in other files
    // or in this file) are not affected by fake timers lingering.
    jest.useRealTimers();
  });

  it('shows "Copy" initially', () => {
    // The CopyButton starts in its default state with the "Copy" label.
    render(
      <MessageBubble
        message={{ role: 'assistant', content: '```js\nconst x = 1\n```' }}
      />,
    );
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  it('shows "✓ Copied" after clicking and reverts after 2 seconds', async () => {
    // userEvent.setup({ advanceTimers }) is required when fake timers are active.
    // userEvent uses setTimeout internally to simulate realistic pointer event timing.
    // With fake timers, those internal timeouts never fire unless we tell userEvent
    // to advance the fake clock, which it does via the advanceTimers callback.
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(
      <MessageBubble
        message={{ role: 'assistant', content: '```js\nconst x = 1\n```' }}
      />,
    );

    // Clicking the Copy button triggers handleCopy(), which:
    //   1. Calls navigator.clipboard.writeText(text) — returns Promise.resolve()
    //   2. Awaits the promise (microtask)
    //   3. Calls setCopied(true) — React re-renders with "✓ Copied"
    //   4. Calls setTimeout(() => setCopied(false), 2000)
    await user.click(screen.getByText('Copy'));

    // findByText returns a Promise that polls until the text appears.
    // This is needed because setCopied(true) happens in the async continuation
    // of handleCopy, which runs after user.click() resolves.
    expect(await screen.findByText('✓ Copied')).toBeInTheDocument();

    // Advance fake time by 2000ms, which fires the setTimeout callback.
    // act() wraps the state update (setCopied(false)) in a React flush.
    act(() => jest.advanceTimersByTime(2000));

    // waitFor retries until "✓ Copied" is gone. We use queryByText (not getByText)
    // because queryByText returns null when not found (getByText would throw).
    await waitFor(() => expect(screen.queryByText('✓ Copied')).not.toBeInTheDocument());
  });

  it('calls clipboard.writeText with code content', async () => {
    // WHY fireEvent instead of userEvent:
    //   userEvent.setup() installs its own navigator.clipboard mock during pointer
    //   events to handle clipboard-related browser behavior. This replaces our
    //   clipboardMock mid-click, causing our spy to show 0 calls.
    //   fireEvent.click() dispatches a raw DOM click event without any higher-level
    //   browser simulation, so our clipboardMock stays in place.
    //
    // WHY the assertion works synchronously:
    //   handleCopy is: async function() { await navigator.clipboard.writeText(text); ... }
    //   navigator.clipboard.writeText(text) is called SYNCHRONOUSLY before the await
    //   suspends the function. So by the time fireEvent.click() returns, writeText
    //   has already been called (and recorded in clipboardMock.writeText.mock.calls).
    //
    // WHY await act(async () => { ... }):
    //   After writeText resolves (microtask), handleCopy continues and calls
    //   setCopied(true). Without act(), React would warn about an unhandled state
    //   update outside of act(). act(async () => ...) flushes that microtask.
    render(
      <MessageBubble
        message={{ role: 'assistant', content: '```js\nconst x = 1\n```' }}
      />,
    );

    await act(async () => { fireEvent.click(screen.getByText('Copy')); });

    expect(clipboardMock.writeText).toHaveBeenCalledWith('const x = 1');
  });
});
