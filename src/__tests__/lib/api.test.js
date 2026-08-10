/**
 * Tests for src/lib/api.js
 *
 * The API module is a pure JavaScript layer — no React, no DOM components.
 * It wraps the browser's fetch() and localStorage APIs. Our testing strategy:
 *
 *   1. Replace global.fetch with a jest.fn() that returns a controlled fake
 *      Response object, so we never hit a real server.
 *   2. Use jsdom's real localStorage (cleared in beforeEach) — no need to mock it.
 *   3. Simulate SSR (server-side rendering) by temporarily deleting global.window,
 *      since the api module guards against window being undefined.
 *
 * Because this is plain JS (no JSX), we do not need @testing-library/react here.
 * We just import the functions directly and call them.
 */

import { getToken, setToken, clearToken, auth, conversations, configApi } from '@/lib/api';

// ─── localStorage / cookie helpers ──────────────────────────────────────────

/**
 * getToken reads 'auth_token' from localStorage.
 * Each test gets a fresh localStorage because we call localStorage.clear() in beforeEach.
 */
describe('getToken', () => {
  // Reset localStorage before every test in this describe block.
  // This ensures a token stored in one test cannot be seen by the next.
  beforeEach(() => localStorage.clear());

  it('returns null when localStorage has no token', () => {
    // No setup needed — localStorage was cleared by beforeEach.
    // toBeNull() uses strict null check (===), not loose falsy check.
    expect(getToken()).toBeNull();
  });

  it('returns stored token', () => {
    // Simulate a token being set by a previous login.
    // We use the real localStorage (provided by jsdom) rather than a mock
    // because we want to confirm the api module reads from it correctly.
    localStorage.setItem('auth_token', 'abc123');
    expect(getToken()).toBe('abc123'); // toBe checks strict equality (===)
  });

  it('returns null in SSR environment (window undefined)', () => {
    // Next.js renders pages on the server (Node.js) where window does not exist.
    // The api module has a guard: if (typeof window === 'undefined') return null.
    // We simulate the SSR environment by deleting window from the global scope.
    // We MUST save and restore the original value — otherwise every test after
    // this one would run in a broken windowless environment.
    const win = global.window;
    delete global.window;
    expect(getToken()).toBeNull();
    global.window = win; // restore
  });
});

describe('setToken', () => {
  beforeEach(() => localStorage.clear());

  it('stores token in localStorage', () => {
    setToken('tok');
    // We verify the side effect directly on localStorage.
    // getItem returns null if the key doesn't exist, otherwise the string value.
    expect(localStorage.getItem('auth_token')).toBe('tok');
  });

  it('sets cookie with token', () => {
    // document.cookie in jsdom is a real cookie jar (basic implementation).
    // After setting a cookie it appears in document.cookie as a key=value string.
    // toContain checks that the substring is present anywhere in the full cookie string.
    setToken('tok');
    expect(document.cookie).toContain('auth_token=tok');
  });

  it('is a no-op in SSR environment', () => {
    // In SSR there is no localStorage to write to. The api module must not throw.
    // not.toThrow() wraps the call in a try/catch and fails if any error escapes.
    const win = global.window;
    delete global.window;
    expect(() => setToken('tok')).not.toThrow();
    global.window = win;
  });
});

describe('clearToken', () => {
  beforeEach(() => {
    // Pre-populate localStorage so we have something to clear.
    localStorage.setItem('auth_token', 'existing');
  });

  it('removes token from localStorage', () => {
    clearToken();
    // getItem returns null when the key does not exist.
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('is a no-op in SSR environment', () => {
    const win = global.window;
    delete global.window;
    expect(() => clearToken()).not.toThrow();
    global.window = win;
  });
});

// ─── fetch mock helpers ──────────────────────────────────────────────────────

/**
 * mockFetch sets up global.fetch to return a fake Response object.
 *
 * The browser's fetch() returns a Response. We need to control:
 *   - ok: boolean (true for 2xx status codes)
 *   - status: HTTP status code
 *   - headers.get(): returns the content-type
 *   - json(): returns a Promise resolving to the parsed body
 *   - text(): returns a Promise resolving to the raw text body
 *
 * We use jest.fn().mockResolvedValue() because fetch itself returns a Promise.
 * mockResolvedValue is shorthand for mockReturnValue(Promise.resolve(value)).
 */
function mockFetch(status, body, contentType = 'application/json') {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => contentType },
    // json() and text() must be functions returning Promises — that is the real Response API
    json: () => Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body),
    text: () => Promise.resolve(text),
  });
}

/**
 * mockFetchError simulates a server returning a non-2xx status with a JSON error body.
 * The api module's request() function reads error details from the response body.
 */
function mockFetchError(status, errorBody) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(errorBody),
    text: () => Promise.resolve(JSON.stringify(errorBody)),
  });
}

/**
 * File-level beforeEach: runs before EVERY test in this file (not just within a describe).
 * Resets localStorage and all mock call histories between tests.
 *
 * jest.clearAllMocks() calls mockClear() on every mock created in this file.
 * mockClear() resets the call history (mock.calls, mock.instances, mock.results)
 * but does NOT remove the mock implementation set by mockReturnValue/mockResolvedValue.
 */
beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
});

// ─── request internals (tested through public API) ───────────────────────────

/**
 * The internal `request` function is not exported, so we test it indirectly
 * through auth.me(), which is the simplest public function that calls request().
 * This is intentional — we test the observable behavior, not the private implementation.
 */
describe('request (via auth.me)', () => {
  it('sends Authorization header when token exists', async () => {
    // Store a token so the api module picks it up from localStorage.
    localStorage.setItem('auth_token', 'mytoken');
    mockFetch(200, { id: 1 });

    await auth.me();

    // global.fetch.mock.calls is an array of arguments arrays for each call.
    // We use expect.objectContaining() to check a SUBSET of the headers object —
    // we don't care what other headers are present, only that Authorization is correct.
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/me'),     // URL must contain this path
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer mytoken' }),
      }),
    );
  });

  it('omits Authorization header when no token', async () => {
    // localStorage is empty (cleared by file-level beforeEach).
    mockFetch(200, { id: 1 });
    await auth.me();

    // Destructure the arguments of the first fetch call: [url, options]
    const [, opts] = global.fetch.mock.calls[0];
    // not.toHaveProperty asserts the key is completely absent (not just undefined).
    expect(opts.headers).not.toHaveProperty('Authorization');
  });

  it('returns null for empty response body', async () => {
    // Some endpoints return 200 with an empty body (e.g., logout).
    // The api module must handle this gracefully by returning null.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: () => Promise.resolve(''), // empty body
    });
    const result = await auth.me();
    expect(result).toBeNull();
  });

  it('throws with detail message on HTTP error', async () => {
    // FastAPI (our backend) returns { detail: "message" } for validation errors.
    mockFetchError(400, { detail: 'Bad credentials' });
    // rejects.toThrow checks that the returned Promise rejects with an error
    // whose message contains the given string.
    await expect(auth.me()).rejects.toThrow('Bad credentials');
  });

  it('throws with message field on HTTP error', async () => {
    // Some error responses use { message: "..." } instead of { detail: "..." }.
    mockFetchError(400, { message: 'Invalid input' });
    await expect(auth.me()).rejects.toThrow('Invalid input');
  });

  it('throws generic HTTP error when no body message', async () => {
    // If the response body cannot be parsed as JSON or contains no message field,
    // the api module falls back to "HTTP <status>".
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => 'text/plain' },
      json: () => Promise.reject(new SyntaxError('bad json')), // JSON parse fails
      text: () => Promise.resolve('Server error'),
    });
    await expect(auth.me()).rejects.toThrow('HTTP 500');
  });
});

// ─── auth API ─────────────────────────────────────────────────────────────────

/**
 * For each auth method, we verify:
 *   1. The correct URL is called
 *   2. The correct HTTP method is used
 *   3. The correct request body is sent
 *
 * We read global.fetch.mock.calls[0] to inspect what fetch was called with.
 * mock.calls is an array of [args] arrays, one per call. calls[0][0] is the URL,
 * calls[0][1] is the options object.
 */
describe('auth.login', () => {
  it('POSTs email and password', async () => {
    mockFetch(200, { access_token: 't', user: {} });
    await auth.login('user@example.com', 'pw123');

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/api/auth/login');
    expect(opts.method).toBe('POST');
    // opts.body is a JSON string — we parse it to compare the object structure.
    expect(JSON.parse(opts.body)).toEqual({ email: 'user@example.com', password: 'pw123' });
  });
});

describe('auth.register', () => {
  it('POSTs email, password and username', async () => {
    mockFetch(201, { access_token: 't', user: {} });
    await auth.register('user@example.com', 'pw123', 'Alice');

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/api/auth/register');
    expect(opts.method).toBe('POST');
    // The backend expects "username", not "name" — this test catches a naming mismatch.
    expect(JSON.parse(opts.body)).toEqual({ email: 'user@example.com', password: 'pw123', username: 'Alice' });
  });
});

describe('auth.me', () => {
  it('sends GET to /api/auth/me', async () => {
    mockFetch(200, { id: 1, email: 'a@b.com' });
    const result = await auth.me();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/me'),
      expect.any(Object), // we don't care about the options shape here
    );
    // Verify the parsed response is returned correctly.
    expect(result).toEqual({ id: 1, email: 'a@b.com' });
  });
});

describe('auth.logout', () => {
  it('POSTs to /api/auth/logout', async () => {
    mockFetch(200, null);
    await auth.logout();

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/api/auth/logout');
    expect(opts.method).toBe('POST');
  });

  it('silently swallows errors', async () => {
    // logout() must never reject, even if the server is unreachable.
    // This prevents the logout UI flow from crashing when offline.
    // mockRejectedValue makes fetch() itself throw (network failure).
    global.fetch = jest.fn().mockRejectedValue(new Error('network'));

    // resolves.toBeUndefined() asserts the Promise resolves (does not reject)
    // with an undefined value (void return).
    await expect(auth.logout()).resolves.toBeUndefined();
  });
});

// ─── conversations API ────────────────────────────────────────────────────────

describe('conversations.list', () => {
  it('GETs /api/conversations', async () => {
    mockFetch(200, []);
    await conversations.list();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/conversations'),
      expect.any(Object),
    );
  });
});

describe('conversations.create', () => {
  it('POSTs with default title "New Chat"', async () => {
    mockFetch(201, { id: '1', title: 'New Chat' });
    await conversations.create(); // no argument — should use default title

    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ title: 'New Chat' });
  });

  it('POSTs with custom title', async () => {
    mockFetch(201, { id: '1', title: 'My Chat' });
    await conversations.create('My Chat');

    const [, opts] = global.fetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ title: 'My Chat' });
  });
});

describe('conversations.get', () => {
  it('GETs /api/conversations/:id', async () => {
    mockFetch(200, { id: '42' });
    await conversations.get('42');
    // The URL must include the ID as a path segment.
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/conversations/42'),
      expect.any(Object),
    );
  });
});

describe('conversations.delete', () => {
  it('DELETEs /api/conversations/:id', async () => {
    mockFetch(204, null); // 204 No Content is the typical delete response
    await conversations.delete('99');

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/api/conversations/99');
    expect(opts.method).toBe('DELETE');
  });
});

describe('conversations.update', () => {
  it('PATCHes with data', async () => {
    mockFetch(200, { id: '1', title: 'Renamed' });
    await conversations.update('1', { title: 'Renamed' });

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/api/conversations/1');
    expect(opts.method).toBe('PATCH'); // PATCH for partial update, not PUT (full replace)
    expect(JSON.parse(opts.body)).toEqual({ title: 'Renamed' });
  });
});

// ─── conversations.chat ───────────────────────────────────────────────────────

/**
 * makeStreamResponse simulates a Server-Sent Events (SSE) response body.
 *
 * How SSE streaming works:
 *   - The server keeps the HTTP connection open.
 *   - It pushes lines in the format "data: <payload>\n" continuously.
 *   - The client reads the response body as a stream using response.body.getReader().
 *   - reader.read() returns { done: false, value: Uint8Array } for each chunk.
 *   - When the stream ends, reader.read() returns { done: true }.
 *
 * We simulate this with a fake reader that returns all the lines as a single chunk,
 * then signals done on the second call. TextEncoder converts our string to bytes
 * (Uint8Array) exactly as the real network would deliver them.
 */
function makeStreamResponse(lines) {
  const text = lines.join('\n');
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);

  // consumed tracks whether we have returned the data chunk yet.
  let consumed = false;
  const reader = {
    // read() must return a Promise — the real ReadableStreamDefaultReader API is async.
    read: jest.fn().mockImplementation(() => {
      if (!consumed) {
        consumed = true;
        // First call: return the entire SSE payload as a byte array.
        return Promise.resolve({ done: false, value: bytes });
      }
      // Second call: signal end of stream.
      return Promise.resolve({ done: true, value: undefined });
    }),
  };

  return {
    ok: true,
    status: 200,
    // The content-type header tells the api module to use streaming mode.
    headers: { get: () => 'text/event-stream' },
    body: { getReader: () => reader },
    json: () => Promise.resolve({}),
  };
}

describe('conversations.chat', () => {
  /**
   * Non-streaming path: the server returns application/json instead of text/event-stream.
   * The api module reads the full body and calls onChunk once with the content.
   */
  it('calls onChunk and onDone for non-streaming JSON response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ content: 'Hello world' }),
    });

    const onChunk = jest.fn();
    const onDone = jest.fn();
    await conversations.chat('conv1', 'hi', { onChunk, onDone });

    expect(onChunk).toHaveBeenCalledWith('Hello world');
    expect(onDone).toHaveBeenCalled(); // must be called to signal completion
  });

  it('falls back to message field in non-streaming JSON', async () => {
    // Some response formats use { message: "..." } instead of { content: "..." }.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ message: 'Hi there' }),
    });
    const onChunk = jest.fn();
    await conversations.chat('conv1', 'hi', { onChunk });
    expect(onChunk).toHaveBeenCalledWith('Hi there');
  });

  /**
   * Streaming path: the server sends multiple SSE "data:" lines.
   * The api module calls onChunk for each parsed content chunk.
   */
  it('streams SSE data: lines and calls onChunk per chunk', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      makeStreamResponse([
        'data: {"content":"Hello"}',
        'data: {"content":" world"}',
        '', // empty line = SSE event boundary (ignored)
      ]),
    );
    const onChunk = jest.fn();
    const onDone = jest.fn();
    await conversations.chat('conv1', 'hi', { onChunk, onDone });

    // onChunk is called TWICE — once per data line.
    expect(onChunk).toHaveBeenCalledWith('Hello');
    expect(onChunk).toHaveBeenCalledWith(' world');
    expect(onDone).toHaveBeenCalled();
  });

  it('stops streaming on [DONE] sentinel', async () => {
    // The OpenAI streaming protocol sends "data: [DONE]" to signal the end.
    // All lines after [DONE] must be ignored.
    global.fetch = jest.fn().mockResolvedValue(
      makeStreamResponse([
        'data: {"content":"Hi"}',
        'data: [DONE]',
        'data: {"content":"Should not appear"}', // must be ignored
        '',
      ]),
    );
    const onChunk = jest.fn();
    const onDone = jest.fn();
    await conversations.chat('conv1', 'hi', { onChunk, onDone });

    // Only the first line should have produced a chunk.
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('handles delta.content format (OpenAI-style)', async () => {
    // OpenAI streaming uses { delta: { content: "..." } } per chunk.
    global.fetch = jest.fn().mockResolvedValue(
      makeStreamResponse(['data: {"delta":{"content":"chunk"}}', '']),
    );
    const onChunk = jest.fn();
    await conversations.chat('conv1', 'hi', { onChunk });
    expect(onChunk).toHaveBeenCalledWith('chunk');
  });

  it('handles choices[0].delta.content format', async () => {
    // The full OpenAI chat completion streaming format wraps delta in choices[].
    global.fetch = jest.fn().mockResolvedValue(
      makeStreamResponse([
        'data: {"choices":[{"delta":{"content":"gpt chunk"}}]}',
        '',
      ]),
    );
    const onChunk = jest.fn();
    await conversations.chat('conv1', 'hi', { onChunk });
    expect(onChunk).toHaveBeenCalledWith('gpt chunk');
  });

  it('handles plain text (non-JSON) data lines', async () => {
    // Some streaming backends send plain text instead of JSON.
    // The api module must fall back to using the raw line content.
    global.fetch = jest.fn().mockResolvedValue(
      makeStreamResponse(['data: just plain text', '']),
    );
    const onChunk = jest.fn();
    await conversations.chat('conv1', 'hi', { onChunk });
    expect(onChunk).toHaveBeenCalledWith('just plain text');
  });

  it('skips comment lines starting with :', async () => {
    // SSE comment lines start with ": " (colon). They are heartbeat/keep-alive signals
    // and must never produce content in the chat UI.
    global.fetch = jest.fn().mockResolvedValue(
      makeStreamResponse([
        ': keep-alive',
        'data: {"content":"real"}',
        '',
      ]),
    );
    const onChunk = jest.fn();
    await conversations.chat('conv1', 'hi', { onChunk });

    // Only the "real" data line should have been processed.
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith('real');
  });

  it('calls onError on HTTP error response', async () => {
    // When the server returns 4xx or 5xx, the api module must call onError
    // instead of crashing or swallowing the error silently.
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ detail: 'Unauthorized' }),
    });
    const onError = jest.fn();
    await conversations.chat('conv1', 'hi', { onError });

    // expect.objectContaining allows us to match a subset of the Error object.
    // We only care that the message is correct, not the full stack trace.
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Unauthorized' }));
  });

  it('calls onError on network failure', async () => {
    // A network failure (no internet, server unreachable) causes fetch() to throw
    // rather than returning a Response. The api module must catch this and call onError.
    global.fetch = jest.fn().mockRejectedValue(new Error('network fail'));
    const onError = jest.fn();
    await conversations.chat('conv1', 'hi', { onError });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'network fail' }));
  });

  it('works with no callbacks provided', async () => {
    // The api module must not crash when callbacks are omitted.
    // Some callers only care about the side effect (e.g., streaming to a shared store)
    // and never provide explicit callbacks.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ content: 'ok' }),
    });
    // resolves.toBeUndefined() confirms the Promise resolves without throwing.
    await expect(conversations.chat('conv1', 'hi')).resolves.toBeUndefined();
  });

  it('includes auth token in streaming request', async () => {
    // Even for streaming requests, the Authorization header must be present.
    // This test confirms the token is read from localStorage for streaming too.
    localStorage.setItem('auth_token', 'stream-token');
    global.fetch = jest.fn().mockResolvedValue(
      makeStreamResponse(['data: {"content":"x"}', '']),
    );
    await conversations.chat('conv1', 'hi', {});

    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers).toHaveProperty('Authorization', 'Bearer stream-token');
  });
});

// ─── configApi ────────────────────────────────────────────────────────────────

describe('configApi.get', () => {
  it('GETs /api/config', async () => {
    mockFetch(200, { model: 'claude-opus-4-7' });
    const result = await configApi.get();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/config'),
      expect.any(Object),
    );
    // Verify the parsed response object is returned to the caller.
    expect(result).toEqual({ model: 'claude-opus-4-7' });
  });
});

describe('configApi.update', () => {
  it('PATCHes /api/config with data', async () => {
    mockFetch(200, { model: 'gpt-4o' });
    await configApi.update({ model: 'gpt-4o' });

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/api/config');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ model: 'gpt-4o' });
  });
});
