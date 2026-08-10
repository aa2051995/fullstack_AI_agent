# Frontend Testing Guide

This document explains how testing works in JavaScript, React, and frontend development in general, using the tests in this project as concrete examples. Read this before touching any test file.

---

## Table of Contents

1. [Why We Test](#1-why-we-test)
2. [The Testing Pyramid](#2-the-testing-pyramid)
3. [The Testing Stack](#3-the-testing-stack)
4. [How Jest Works](#4-how-jest-works)
5. [Assertions — expect()](#5-assertions--expect)
6. [Setup and Teardown](#6-setup-and-teardown)
7. [Mocking](#7-mocking)
8. [Async Testing](#8-async-testing)
9. [Fake Timers](#9-fake-timers)
10. [React Testing Library](#10-react-testing-library)
11. [Querying the DOM](#11-querying-the-dom)
12. [act() — React's Async Flushing Wrapper](#12-act--reacts-async-flushing-wrapper)
13. [userEvent vs fireEvent](#13-userevent-vs-fireevent)
14. [Testing the API Layer (api.test.js)](#14-testing-the-api-layer)
15. [Testing React Context (context.test.js)](#15-testing-react-context)
16. [Testing UI Components](#16-testing-ui-components)
17. [The navigator.clipboard Problem](#17-the-navigatorclipboard-problem)
18. [SSR Guards](#18-ssr-guards)
19. [Common Pitfalls and How We Solved Them](#19-common-pitfalls-and-how-we-solved-them)

---

## 1. Why We Test

A test is an automated check that a piece of code does what you expect. Without tests you can only verify your app works by clicking through it manually — which is slow, incomplete, and breaks as soon as you forget a scenario. Tests give you four things:

- **Confidence to refactor.** Change the internals of `api.js`; if the public behavior is unchanged, the tests still pass.
- **Documentation.** A test named `"calls onError on network failure"` tells future developers exactly what the function must do in that situation.
- **Regression prevention.** Once a bug is fixed and a test is written for it, the bug cannot silently come back.
- **Fast feedback.** Running 169 tests takes under 10 seconds. Clicking through an entire app takes much longer and still misses edge cases.

---

## 2. The Testing Pyramid

```
         /\
        /  \
       / E2E \          ← Few, slow, test real browser
      /--------\
     /Integration\      ← Some, medium, test multiple units together
    /--------------\
   /   Unit Tests   \   ← Many, fast, test one thing in isolation
  /------------------\
```

**Unit tests** test a single function or component with all dependencies replaced by fakes (mocks). This project's `api.test.js` and `context.test.js` are mostly unit tests.

**Integration tests** render a real component tree and let multiple pieces interact. The UI component tests (`AuthForm`, `Sidebar`, etc.) are integration tests: the component's own logic is real, but external dependencies like `fetch` and the router are mocked.

**End-to-End (E2E) tests** spin up a real browser and a real server and simulate actual user journeys. We do not have E2E tests in this project; tools like Playwright or Cypress are used for those.

---

## 3. The Testing Stack

| Package | Role |
|---|---|
| **Jest** | Test runner: discovers test files, runs them, reports pass/fail |
| **jest-environment-jsdom** | Provides a fake browser DOM (window, document, navigator) inside Node.js |
| **@testing-library/react** | Renders React components and exposes `render`, `screen`, `act`, `waitFor`, `fireEvent` |
| **@testing-library/user-event** | Simulates realistic user input: pointer events, keyboard, clipboard |
| **@testing-library/jest-dom** | Extra matchers: `toBeInTheDocument`, `toHaveClass`, `toBeDisabled`, etc. |

### Why jsdom?

Tests run in Node.js, which has no browser. `jest-environment-jsdom` provides a JavaScript implementation of the browser DOM — `window`, `document`, `localStorage`, `navigator`, CSS class queries — so component code that touches the DOM can run without a real browser. It is not a perfect replica; some browser APIs like `navigator.clipboard` are absent by default and must be polyfilled or mocked.

### How Jest discovers tests

Jest finds every file matching `**/__tests__/**/*.{js,jsx}` (or ending in `.test.js`). Each file runs in its own isolated Node.js module environment, which is why mocks in one file never leak into another.

---

## 4. How Jest Works

### describe / it / test

`describe` groups related tests into a named block. `it` (alias: `test`) declares a single test case.

```js
describe('getToken', () => {         // group name shown in output
  it('returns null when empty', () => {  // individual test
    expect(getToken()).toBeNull();
  });
});
```

`describe` blocks can be nested to any depth. The hierarchy is purely organizational — it does not affect how tests run.

### The test lifecycle

Jest runs each file sequentially. Within a file:
1. All module-level code runs (imports, `jest.mock()` calls, variable declarations).
2. The `describe` callbacks run — but only to *register* the `it` callbacks. No test code runs yet.
3. Jest runs each `it` callback in registration order, wrapping each in the setup/teardown chain.

This distinction matters. Code at the top level of a `describe` runs once during registration, not once per test. `beforeEach` code runs once per test.

---

## 5. Assertions — expect()

`expect(value)` returns an assertion object. Chaining a matcher checks the value.

```js
expect(42).toBe(42);                   // strict ===
expect({ a: 1 }).toEqual({ a: 1 });    // deep equality
expect('hello world').toContain('world');
expect(null).toBeNull();
expect(fn).toHaveBeenCalledWith('arg');
```

### Negation

Any matcher can be negated with `.not`:

```js
expect(screen.queryByText('Error')).not.toBeInTheDocument();
```

### Async matchers

```js
await expect(promise).resolves.toBe('value');   // promise must resolve to value
await expect(promise).rejects.toThrow('msg');   // promise must reject with message
```

### jest-dom matchers (DOM-specific)

These are added by `@testing-library/jest-dom` in `jest.setup.js`:

```js
expect(el).toBeInTheDocument();   // element exists in the document
expect(el).toBeDisabled();        // form element is disabled
expect(el).toHaveClass('btn');    // element has CSS class
expect(el).toHaveValue('text');   // input's current value
expect(el).toHaveAttribute('href', '/login');
```

---

## 6. Setup and Teardown

These hooks run at defined points in the test lifecycle.

| Hook | Runs |
|---|---|
| `beforeAll(fn)` | Once before the first test in its `describe` block |
| `afterAll(fn)` | Once after the last test in its `describe` block |
| `beforeEach(fn)` | Before every individual test in its `describe` block |
| `afterEach(fn)` | After every individual test in its `describe` block |

Hooks defined at file scope (outside any `describe`) apply to every test in the file.

### Why we use beforeEach for cleanup

```js
// api.test.js
beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
});
```

Each test must start from a clean state. If test A stores something in `localStorage`, test B must not see it. `jest.clearAllMocks()` resets all mock call histories so previous test calls do not pollute assertions in later tests. This is one of the most important patterns in the codebase.

### beforeAll vs beforeEach

Use `beforeAll` only for expensive setup that is safe to share across tests (a database connection, a compiled WASM module). For anything that could be mutated by a test — like a mock function's call history — use `beforeEach` so each test gets a fresh copy.

---

## 7. Mocking

Mocking is the act of replacing a real dependency with a controlled fake so your test only exercises the code under test, not the dependency.

### jest.fn() — mock functions

A mock function records every call made to it:

```js
const onSend = jest.fn();
onSend('hello');
expect(onSend).toHaveBeenCalledWith('hello');   // passes
expect(onSend).toHaveBeenCalledTimes(1);         // passes
```

You can also control what it returns:

```js
const fn = jest.fn()
  .mockReturnValue('sync value')
  .mockResolvedValue('async value');   // returns Promise.resolve('async value')
  .mockRejectedValue(new Error('oh no')); // returns a rejected promise
```

### jest.mock() — module mocking

`jest.mock('module-path', factory)` replaces an entire module with a fake before any code imports it. Jest **hoists** `jest.mock()` calls to the top of the file at compile time, so they always run before imports — even if you write them after your `import` statements.

```js
// This mock is hoisted above the import below:
jest.mock('@/lib/api', () => ({
  auth: { login: jest.fn(), register: jest.fn() },
}));

import { auth } from '@/lib/api'; // receives the mock, not the real module
```

**Critical hoisting rule**: because `jest.mock` factory functions run before any module-level code, you **cannot** reference variables declared with `const` or `let` in the factory — they are not initialized yet. Use `jest.fn()` directly in the factory, then configure return values in `beforeEach`.

```js
// WRONG — will throw "Cannot access 'mockLogin' before initialization"
const mockLogin = jest.fn();
jest.mock('@/lib/api', () => ({ auth: { login: mockLogin } }));

// CORRECT — use jest.fn() in the factory, configure in beforeEach
jest.mock('@/lib/api', () => ({ auth: { login: jest.fn() } }));
import { auth } from '@/lib/api';
beforeEach(() => auth.login.mockResolvedValue({ access_token: 'tok' }));
```

### jest.spyOn() — wrapping existing methods

`jest.spyOn(obj, 'method')` wraps an existing method so calls are recorded. The original implementation still runs unless you also chain `.mockImplementation()`. Use `spy.mockRestore()` in `afterAll` to undo the wrapping.

```js
const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
// console.error is now silenced and calls are tracked
spy.mockRestore(); // restore original console.error
```

### Mock state management

| Method | Effect |
|---|---|
| `mockFn.mockClear()` | Resets call history only. Implementation unchanged. |
| `mockFn.mockReset()` | Resets call history AND removes implementation. |
| `mockFn.mockRestore()` | For spies: removes the spy and restores original method. |
| `jest.clearAllMocks()` | Calls `mockClear()` on every mock in the file. |

We call `jest.clearAllMocks()` in `beforeEach` throughout the project because we want each test to start with empty call history while keeping the implementation set by a previous `mockReturnValue`.

### Mocking fetch

The browser's `fetch` is a global. We replace it with a controlled jest.fn before each test:

```js
function mockFetch(status, body) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}
```

This lets us control exactly what the server "returns" without running a real server. We can simulate 200 OK, 400 errors, 500 crashes, and network failures.

### Mocking localStorage

jsdom provides a real `localStorage` implementation. We simply call `localStorage.clear()` in `beforeEach` to reset it between tests. We never need to mock it — we use the real thing.

### Mocking ESM-only packages (react-markdown)

`react-markdown` v9 is ESM-only: it ships JavaScript modules with `export` statements, which Node.js (and Jest's CommonJS transform) cannot parse directly. The `transformIgnorePatterns` in `jest.config.js` was supposed to include it in Babel's transform pass, but Next.js's internal Jest config overrides that setting. The simplest fix: replace the entire module with a hand-written React component that exercises the same `components` prop interface our code uses:

```js
jest.mock('react-markdown', () => {
  const React = require('react');
  return function ReactMarkdown({ children, components = {} }) {
    // parse fenced code blocks, inline code, bold text, etc.
    // and call components.code / components.pre just like the real library
  };
});
```

This keeps our tests fast (no real markdown parsing) while still exercising the `code` and `pre` component renderers.

---

## 8. Async Testing

Most of the app's logic is asynchronous (fetch calls, streaming, state updates). Jest must be told to wait for async work to finish before evaluating assertions.

### async/await in tests

Mark the test function `async` and `await` any async calls:

```js
it('POSTs email and password', async () => {
  mockFetch(200, { access_token: 't' });
  await auth.login('a@b.com', 'pass');
  expect(global.fetch).toHaveBeenCalledWith(...);
});
```

### resolves / rejects

For testing promise outcomes without intermediate variables:

```js
// Instead of: const result = await fn(); expect(result).toBe(...)
await expect(auth.me()).resolves.toEqual({ id: 1 });

// Instead of: try { await fn(); } catch (e) { expect(e.message).toBe(...) }
await expect(auth.me()).rejects.toThrow('Bad credentials');
```

### waitFor()

`waitFor` keeps re-evaluating its callback on a small interval until the assertion passes or a timeout is reached. Use it when a state change happens asynchronously after a user interaction:

```js
await user.click(submitButton);
await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Welcome back!'));
```

Without `waitFor`, the assertion would run before the async form submission handler finishes.

### findBy* queries

`screen.findByText('✓ Copied')` is a shorthand for `waitFor(() => screen.getByText('✓ Copied'))`. It returns a Promise that resolves when the element appears in the DOM. Use it instead of `getByText` when you expect the element to appear after an async operation.

---

## 9. Fake Timers

JavaScript's real `setTimeout` and `setInterval` would make tests that use them take as long as the actual delay — a 2-second timer makes a test 2 seconds slower. Fake timers replace all timer APIs with controlled versions:

```js
jest.useFakeTimers();         // install fake timers
jest.advanceTimersByTime(2000); // fast-forward by 2000ms
jest.useRealTimers();         // restore real timers
```

### Why this matters for the CopyButton test

`handleCopy` does:
```js
await navigator.clipboard.writeText(text);
setCopied(true);
setTimeout(() => setCopied(false), 2000);  // ← real 2-second delay
```

With real timers, testing the "reverts after 2 seconds" behavior would require actually waiting 2 seconds. With fake timers we advance time instantly:

```js
jest.useFakeTimers();
await user.click(copyButton);
expect(screen.getByText('✓ Copied')).toBeInTheDocument();
act(() => jest.advanceTimersByTime(2000));  // fire the setTimeout callback now
await waitFor(() => expect(screen.queryByText('✓ Copied')).not.toBeInTheDocument());
```

### Macrotasks vs microtasks

**Macrotasks**: `setTimeout`, `setInterval` — controlled by fake timers.
**Microtasks**: Promise continuations (`.then`, `await` continuations) — NOT controlled by fake timers. They always flush immediately, regardless of fake/real timer mode.

This distinction caused a subtle bug: `userEvent.setup()` internally installs its own `navigator.clipboard` when processing a click. Our clipboard mock was set in `beforeEach`, but `userEvent` replaced it during `user.click()`. The solution was to use `fireEvent.click()` instead (see Section 17).

---

## 10. React Testing Library

`@testing-library/react` renders components into jsdom and provides tools to interact with them. Its core philosophy is:

> **Test what the user sees and does, not implementation details.**

That means: query elements by their visible text or ARIA role, not by class names or component hierarchy. An element's `className` is an implementation detail that can change without breaking behavior; its visible text or role cannot.

### render()

```js
const { container, rerender, unmount } = render(<MyComponent prop="value" />);
```

- `container` is the root DOM node wrapping the component.
- `rerender(jsx)` updates the component with new props (used in ConfigPanel sync test).
- `unmount()` removes the component and runs cleanup effects.

`@testing-library/react` automatically runs cleanup after each test (via `afterEach`) so rendered components never leak between tests.

### screen

`screen` is a global object with all the query methods bound to `document.body`. Prefer `screen` over destructuring from `render` — it produces clearer error messages and works the same regardless of nesting.

```js
screen.getByText('Submit');           // always searches document.body
screen.getByRole('button');
screen.getByPlaceholderText('Email');
```

---

## 11. Querying the DOM

Testing Library provides three query families:

| Family | If not found | Use when |
|---|---|---|
| `getBy*` | Throws immediately | Element must be present right now |
| `queryBy*` | Returns `null` | Asserting an element is *absent* |
| `findBy*` | Returns Promise (polls) | Element appears after async work |

Each family has variants for how to locate elements:

| Variant | Example | What it matches |
|---|---|---|
| `*ByRole` | `getByRole('button', { name: /sign in/i })` | ARIA role + accessible name |
| `*ByText` | `getByText('Hello!')` | Visible text content |
| `*ByPlaceholderText` | `getByPlaceholderText('Email')` | Input placeholder |
| `*ByLabelText` | `getByLabelText('Password')` | Form field label |
| `*ByDisplayValue` | `getByDisplayValue('Old Title')` | Current input/textarea value |
| `*ByTestId` | `getByTestId('syntax-highlighter')` | `data-testid` attribute |
| `*ByTitle` | `getByTitle('Send (Enter)')` | `title` attribute |

Prefer `*ByRole` and `*ByText` — they match what a screen reader or a user actually perceives. Use `*ByTestId` only when there is no accessible alternative.

### Why queryBy* for absent elements

```js
// WRONG — getByText throws if not found, so .not.toBeInTheDocument() never runs
expect(screen.getByText('Error')).not.toBeInTheDocument();

// CORRECT — queryByText returns null when not found
expect(screen.queryByText('Error')).not.toBeInTheDocument();
```

---

## 12. act() — React's Async Flushing Wrapper

React batches state updates and runs effects asynchronously. When test code triggers state changes (clicking a button, dispatching an action), React must flush those updates before we query the DOM. `act()` tells React: "flush all pending state updates and effects now."

```js
// Clicking a button that triggers a setState
await act(async () => {
  screen.getByText('login').click();
});
// Now the DOM reflects the new state
```

Testing Library wraps most interactions in `act` automatically. You need to call it explicitly when:
- You're using `fireEvent` and there's a pending async state update
- You're using `.click()` directly on a DOM element
- You're manipulating state through a React context dispatch outside of userEvent

```js
// Explicit act needed here because we called button.click() directly,
// not via userEvent which handles act internally
await act(async () => {
  screen.getByText('Copy').click();
});
```

---

## 13. userEvent vs fireEvent

### fireEvent

`fireEvent.click(element)` dispatches a raw synthetic DOM event. It is synchronous, minimal, and does not simulate any browser behavior beyond triggering the event listener. No pointer events, no focus management, no clipboard setup.

Use `fireEvent` when:
- You need a raw, synchronous event (e.g., `fireEvent.change(slider, { target: { value: '1.5' } })`)
- You specifically do NOT want userEvent's higher-level browser simulation (e.g., clipboard interception)
- The interaction is simple and does not involve complex browser behaviors

### userEvent

`userEvent.setup()` creates a user-event instance. `user.click()`, `user.type()`, `user.keyboard()` simulate the full sequence of events a real browser would fire: `pointerdown` → `mousedown` → `focus` → `mouseup` → `click`, etc. This is important for testing focus management, keyboard navigation, and form behavior.

```js
const user = userEvent.setup();
await user.type(input, 'hello{Enter}');  // types each character, then presses Enter
```

Key difference: `userEvent` methods return Promises and must be awaited. `fireEvent` is synchronous.

### The clipboard interception issue

`userEvent.setup({ advanceTimers: jest.advanceTimersByTime })` internally installs its own `navigator.clipboard` mock during a click operation to handle clipboard-related pointer events. This replaced our carefully-set `clipboardMock`. We discovered this by logging `navigator.clipboard === clipboardMock` before and after `user.click()` — they were different objects after the click.

The fix: use `fireEvent.click()` for the clipboard spy assertion test, which does not touch `navigator.clipboard`. The `handleCopy` function calls `navigator.clipboard.writeText(text)` synchronously before its first `await`, so the call is recorded immediately when `fireEvent.click` fires the event.

---

## 14. Testing the API Layer

**File:** `src/__tests__/lib/api.test.js`

The API module (`src/lib/api.js`) wraps `fetch` and `localStorage`. Testing it means controlling both dependencies.

### Strategy

1. **Replace `global.fetch`** with `jest.fn()` that returns a mock Response object with controllable `ok`, `status`, `json()`, and `text()` properties.
2. **Use real `localStorage`** — jsdom provides a working implementation. Clear it in `beforeEach`.
3. **Simulate SSR** by temporarily deleting `global.window`, since the API guards against running in a server environment.

### The mockFetch helper

```js
function mockFetch(status, body) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}
```

This is a factory that creates a consistent fake Response. `mockFetch(200, { user: {} })` simulates a successful JSON response. `mockFetchError(400, { detail: 'Bad credentials' })` simulates an error.

### Testing SSE streaming

The chat endpoint uses Server-Sent Events (SSE): the server keeps the connection open and pushes `data: {...}` lines continuously. The Response body is a `ReadableStream` with a `getReader()` method. Our fake stream reader:

```js
function makeStreamResponse(lines) {
  const bytes = new TextEncoder().encode(lines.join('\n'));
  let consumed = false;
  const reader = {
    read: jest.fn().mockImplementation(() => {
      if (!consumed) {
        consumed = true;
        return Promise.resolve({ done: false, value: bytes });
      }
      return Promise.resolve({ done: true, value: undefined });
    }),
  };
  return { ok: true, body: { getReader: () => reader }, ... };
}
```

The first `read()` call returns the encoded SSE lines as a `Uint8Array`. The second call returns `{ done: true }` to signal the stream is finished. This exactly mirrors how a real `ReadableStream` reader works.

---

## 15. Testing React Context

**File:** `src/__tests__/lib/context.test.js`

The app state lives in a React Context powered by `useReducer`. The reducer handles 12+ action types. We cannot import and call the reducer directly (it's not exported), so we test it through the Context provider.

### The TestConsumer pattern

Instead of writing a complete page component, we write tiny inline components that expose exactly the slice of state or action we need:

```js
function Comp() {
  const { state, setAuth } = useApp();
  return (
    <>
      <span data-testid="auth">{String(state.isAuthenticated)}</span>
      <button onClick={() => setAuth({ email: 'x@y.com' }, 'tok')}>login</button>
    </>
  );
}
renderWithProvider(<Comp />);
await act(async () => screen.getByText('login').click());
expect(screen.getByTestId('auth').textContent).toBe('true');
```

This approach:
- Tests real behavior (the actual context and reducer run)
- Avoids testing unrelated UI
- Makes the test intention immediately clear

### Why wrap renderWithProvider in act(async)?

The `AppProvider` runs a `useEffect` on mount that reads from `localStorage` and dispatches a `SET_HYDRATED` action. This effect runs asynchronously after render. Wrapping `renderWithProvider` in `act(async () => { ... })` waits for all effects to settle before we query the DOM.

### Testing outside the provider

```js
it('throws when useApp is used outside AppProvider', () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  function Bad() { useApp(); return null; }
  expect(() => render(<Bad />)).toThrow('useApp must be used within AppProvider');
  spy.mockRestore();
});
```

React logs a console.error before throwing when a component crashes. We silence it with a spy so the test output is clean, then restore it immediately after.

---

## 16. Testing UI Components

### AuthForm (src/__tests__/ui/AuthForm.test.js)

AuthForm uses `next/navigation`, `@/lib/context`, and `@/lib/api`. All three are mocked. The pattern:

1. Declare mocks with `jest.mock()` (hoisted automatically)
2. Import the mocked modules after the declarations
3. Use `beforeEach` to assign fresh mock functions and configure return values

This is necessary because `jest.mock()` factories run before `let` declarations are initialized — so you cannot reference outer variables in the factory itself. Instead, you configure the mock in `beforeEach` after the variable has been initialized.

### MessageBubble (src/__tests__/ui/MessageBubble.test.js)

Two main challenges:

1. **react-markdown is ESM-only.** The module is mocked with a hand-written component that parses fenced code blocks and inline code using regex, then renders using the same `components.code` and `components.pre` props that the real library would call. This means the SyntaxHighlighter and CopyButton still render and are tested.

2. **navigator.clipboard.** See Section 17.

### MessageInput (src/__tests__/ui/MessageInput.test.js)

MessageInput reads from the app context (`state.isStreaming`, `state.config.model`). We mock the context module to return a plain object, and mutate `mockState.isStreaming` in `beforeEach` to switch between the idle and streaming test suites.

### Sidebar (src/__tests__/ui/Sidebar.test.js)

Sidebar has two-layer external dependencies: the Next.js router AND the API module. Both are mocked. We also mock `window.confirm` (which Sidebar calls before deleting a conversation) using `jest.fn(() => true)`.

The `groupByDate` logic is tested *indirectly* — we pass conversations with specific `updated_at` dates and assert that the rendered section header (`"Today"`, `"Yesterday"`, `"Older"`) appears in the DOM. This is better than testing the date math directly because it verifies the UI renders the correct label, not just that the function returns the right string.

### ConfigPanel (src/__tests__/ui/ConfigPanel.test.js)

ConfigPanel calls `configApi.get` on mount and merges the server config into context. Testing mount effects requires wrapping `render` in `act(async () => { ... })` so the `useEffect` callback runs to completion before we assert. The test for the saving state (showing "Saving…") uses an unresolved Promise: `mockConfigUpdate.mockReturnValue(new Promise(r => { resolve = r; }))` — the button shows "Saving…" while the promise is pending, then `act(async () => resolve(config))` settles it.

---

## 17. The navigator.clipboard Problem

### Background

jsdom (the DOM emulator) does not provide `navigator.clipboard` — in browsers, clipboard access requires a "secure context" (HTTPS), and jsdom has no security model. So `navigator.clipboard` is `undefined` in tests by default.

### How we set it up

```js
beforeEach(() => {
  jest.useFakeTimers();
  // Re-define AFTER useFakeTimers — see below.
  clipboardMock = { writeText: jest.fn().mockResolvedValue(undefined) };
  Object.defineProperty(navigator, 'clipboard', {
    value: clipboardMock,
    configurable: true,
    writable: true,
  });
});
```

`Object.defineProperty` is required because `navigator.clipboard` is typically a getter on the Navigator prototype, and a simple `navigator.clipboard = ...` assignment would silently fail in strict mode. `configurable: true` allows the property to be redefined in subsequent tests.

### Why it's re-set in beforeEach (not beforeAll)

Initial approach: set up the mock once in `beforeAll`, spy on its prototype. This failed: after `jest.useRealTimers()` ran in `afterEach`, then `jest.useFakeTimers()` ran in the next `beforeEach`, `navigator.clipboard` was a different object. The mock set in `beforeAll` was gone. By re-running `Object.defineProperty` in every `beforeEach` (after `jest.useFakeTimers()`), we guarantee the mock is always fresh and correct.

### Why fireEvent instead of userEvent

`userEvent.setup()` installs its own clipboard mock on `navigator.clipboard` during pointer events (to handle clipboard-related browser behavior). This replaced our mock mid-click. We verified this by logging `navigator.clipboard === clipboardMock` before and after `user.click()` — it returned `false` after. 

`fireEvent.click()` dispatches a raw event with no higher-level browser simulation, so our clipboard mock stays in place. Since `navigator.clipboard.writeText(text)` is called synchronously before the `await` in `handleCopy`, the mock records the call immediately when the click fires.

---

## 18. SSR Guards

Next.js renders pages on the server (Node.js), where `window`, `document`, and `localStorage` do not exist. The API module guards against this:

```js
export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token');
}
```

To test these guards, we delete `global.window` temporarily:

```js
it('returns null in SSR environment', () => {
  const win = global.window;
  delete global.window;
  expect(getToken()).toBeNull();
  global.window = win;  // restore so later tests are not affected
});
```

Saving and restoring the original value is critical — without it, every test after this one would run without `window`.

---

## 19. Common Pitfalls and How We Solved Them

### 1. jest.mock() hoisting breaks variable references

**Problem:** `jest.mock` factories run before `let`/`const` declarations are initialized.
**Solution:** Use `jest.fn()` directly inside the factory. Import the mocked module after the mock declaration. Configure return values in `beforeEach`.

### 2. React state update outside act()

**Problem:** `console.error: Warning: An update to X inside a test was not wrapped in act()`.
**Solution:** Wrap the interaction that triggers async state updates in `await act(async () => { ... })`. This flushes React's pending update queue.

### 3. ESM-only modules (react-markdown)

**Problem:** `SyntaxError: Unexpected token 'export'`.
**Solution:** `jest.mock('react-markdown', factory)` — provide a CommonJS-compatible implementation that calls the same `components` prop interface.

### 4. "Found multiple elements with text"

**Problem:** `getByText(/create account/i)` matches both a heading and a button.
**Solution:** Use the specific ARIA role query: `getByRole('heading', { name: /create account/i })` to narrow to headings only.

### 5. navigator.clipboard spy shows 0 calls

**Problem:** The clipboard mock was set in `beforeAll`, but something replaced `navigator.clipboard` between tests.
**Solution:** Re-set `Object.defineProperty(navigator, 'clipboard', ...)` in every `beforeEach`, after `jest.useFakeTimers()`. Also switch from `user.click()` to `fireEvent.click()` for the spy assertion test, since `userEvent` intercepts the clipboard.

### 6. waitFor timeout on synchronous assertions

**Problem:** `waitFor(() => expect(x).toBe(y))` works but is unnecessary if `x` is already updated.
**Solution:** For synchronous state changes, use direct `expect()` after `await act(...)`. Reserve `waitFor` for genuinely asynchronous changes (API calls, timers that have been advanced).

### 7. Fake timer + userEvent interaction

**Problem:** `userEvent.setup({ advanceTimers: jest.advanceTimersByTime })` is required when fake timers are active. Without `advanceTimers`, userEvent's internal delay mechanism hangs because it uses `setTimeout` internally, which fake timers intercept.
**Solution:** Always pass `{ advanceTimers: jest.advanceTimersByTime }` to `userEvent.setup()` when `jest.useFakeTimers()` is active.
