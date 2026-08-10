/**
 * Tests for src/app/ui/AuthForm.js
 *
 * AuthForm is used for both login (/login) and signup (/signup) via a `mode` prop.
 * It depends on three external systems:
 *   - next/navigation (useRouter) — navigation after successful auth
 *   - @/lib/context (useApp) — to call setAuth() after receiving a token
 *   - @/lib/api (auth.login / auth.register) — actual HTTP calls
 *   - react-hot-toast — success/error notifications
 *
 * All four are mocked. We test the form's behavior: does it call the right API,
 * show the right loading/error state, navigate correctly after success, etc.
 *
 * ─── IMPORTANT: jest.mock() hoisting rule ────────────────────────────────────
 *
 * Jest transforms jest.mock() calls to the TOP of the file before any imports run.
 * This means the factory function runs before even the `import` statements execute.
 * Because of this, you CANNOT reference variables declared with `const` or `let`
 * in the factory — they are not initialized yet and you'll get:
 *   "Cannot access 'mockAuthLogin' before initialization"
 *
 * The solution used throughout this file:
 *   1. Use jest.fn() directly inside the factory (no outer variable reference).
 *   2. Import the mocked module AFTER the jest.mock() declaration.
 *   3. Configure the mock's return value in beforeEach() after all variables exist.
 */

import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// next/navigation provides useRouter for programmatic navigation (push/replace).
// We mock it so tests can assert that router.replace('/chat') was called after login.
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

// next/link renders an <a> tag in production. We replace it with a plain <a> so
// rendered links can be queried by href in tests without Next.js's link prefetching.
jest.mock('next/link', () =>
  function Link({ href, children, ...props }) {
    return <a href={href} {...props}>{children}</a>;
  }
);

// react-hot-toast shows toast notifications. We mock the entire module so:
//   - toast.success and toast.error are jest.fn() we can spy on.
//   - No real toast DOM is rendered (which would cause off-screen element warnings).
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
  success: jest.fn(),
  error: jest.fn(),
}));

// Context mock: useApp is called by AuthForm to get setAuth (stores user + token in state).
// We return a mock setAuth that we can inspect in assertions.
jest.mock('@/lib/context', () => ({ useApp: jest.fn() }));

// API mock: auth.login and auth.register make HTTP requests.
// We mock them with jest.fn() so we can control what they resolve/reject to.
// setToken is also used by AuthForm to persist the token to localStorage.
jest.mock('@/lib/api', () => ({
  auth: { login: jest.fn(), register: jest.fn() },
  setToken: jest.fn(),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────
// These imports run AFTER the jest.mock() declarations (which are hoisted),
// so they receive the mocked versions, not the real modules.

import AuthForm from '@/app/ui/AuthForm';
import { useApp } from '@/lib/context';
import { auth } from '@/lib/api';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';

// ─── Per-test setup ───────────────────────────────────────────────────────────

// Module-level variables that hold fresh jest.fn() instances for each test.
// These are defined here (not inside beforeEach) so they can be referenced in
// the assertions below. They are reassigned in beforeEach so each test gets
// a clean mock with no previous call history.
let mockSetAuth;
let mockReplace;
let mockPush;

beforeEach(() => {
  // jest.clearAllMocks() resets call histories on ALL mocks in this file.
  // This is called first so the subsequent mockReturnValue calls start clean.
  jest.clearAllMocks();

  // Create fresh jest.fn() for each test to avoid call-count pollution.
  mockSetAuth = jest.fn();
  mockReplace = jest.fn();
  mockPush = jest.fn();

  // Configure the mock module return values for this test.
  // useApp.mockReturnValue() makes useApp() return the specified object
  // every time the component calls it.
  useApp.mockReturnValue({ setAuth: mockSetAuth });

  // useRouter is a jest.fn() (from our jest.mock above). We call mockReturnValue
  // on it to control what the component receives when it calls useRouter().
  useRouter.mockReturnValue({ push: mockPush, replace: mockReplace });
});

// ─── Login mode ───────────────────────────────────────────────────────────────

describe('AuthForm (login mode)', () => {
  it('renders email and password fields', () => {
    render(<AuthForm mode="login" />);
    // Queries by placeholder text — these are the accessible labels for screen readers.
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
  });

  it('does NOT render a name field', () => {
    render(<AuthForm mode="login" />);
    // Login form has no name field (that's only for signup).
    // queryByPlaceholderText returns null (not throws) when the element is absent.
    expect(screen.queryByPlaceholderText('Your name')).not.toBeInTheDocument();
  });

  it('renders "Welcome back" heading', () => {
    render(<AuthForm mode="login" />);
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
  });

  it('renders "Sign in to continue" subtitle', () => {
    render(<AuthForm mode="login" />);
    // The /i flag makes the regex case-insensitive, so "Sign in to continue"
    // and "sign in to continue" both match.
    expect(screen.getByText(/sign in to continue/i)).toBeInTheDocument();
  });

  it('renders Sign in submit button', () => {
    render(<AuthForm mode="login" />);
    // getByRole('button', { name: ... }) finds a button by its accessible name.
    // The accessible name is derived from the button's text content.
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('renders link to /signup', () => {
    render(<AuthForm mode="login" />);
    // The login page has a "Sign up" link pointing to /signup.
    expect(screen.getByRole('link', { name: /sign up/i })).toHaveAttribute('href', '/signup');
  });

  it('submits login with email and password', async () => {
    // mockResolvedValue makes auth.login() return a Promise that resolves to this value.
    auth.login.mockResolvedValue({ access_token: 'tok', user: { email: 'a@b.com' } });

    // userEvent.setup() returns a user instance that simulates full browser behavior:
    // focus events, character-by-character typing, pointer events on click.
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);

    // user.type fires keydown, keypress, input, and keyup events for each character.
    await user.type(screen.getByPlaceholderText('you@example.com'), 'a@b.com');
    await user.type(screen.getByPlaceholderText('••••••••'), 'pass123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // waitFor retries the callback until it passes or times out.
    // We need it because form submission is async (awaits auth.login).
    await waitFor(() => {
      expect(auth.login).toHaveBeenCalledWith('a@b.com', 'pass123');
      expect(mockSetAuth).toHaveBeenCalled();
      // After successful login, the component redirects to /chat using router.replace.
      expect(mockReplace).toHaveBeenCalledWith('/chat');
    });
  });

  it('shows toast on successful login', async () => {
    auth.login.mockResolvedValue({ access_token: 'tok', user: {} });
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);
    await user.type(screen.getByPlaceholderText('you@example.com'), 'a@b.com');
    await user.type(screen.getByPlaceholderText('••••••••'), 'pass');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    // toast.success is our mocked function. We verify it was called with the right message.
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Welcome back!'));
  });

  it('shows error message on login failure', async () => {
    // mockRejectedValue makes auth.login() return a Promise that rejects with this Error.
    auth.login.mockRejectedValue(new Error('Invalid credentials'));
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);
    await user.type(screen.getByPlaceholderText('you@example.com'), 'a@b.com');
    await user.type(screen.getByPlaceholderText('••••••••'), 'wrongpass');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // After the rejected promise settles, the component renders the error message.
    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });
  });

  it('shows fallback error message when error has no message', async () => {
    // If the thrown value is not an Error object (e.g., a plain object from axios),
    // the component must show a generic fallback message.
    auth.login.mockRejectedValue({}); // no .message property
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);
    await user.type(screen.getByPlaceholderText('you@example.com'), 'a@b.com');
    await user.type(screen.getByPlaceholderText('••••••••'), 'pass');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => {
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });
  });

  it('disables button and shows loading text while submitting', async () => {
    // We create a Promise that never resolves until we call resolve() manually.
    // This keeps the form in its "loading" state for the duration of the test.
    let resolve;
    auth.login.mockReturnValue(new Promise((r) => { resolve = r; }));

    const user = userEvent.setup();
    render(<AuthForm mode="login" />);
    await user.type(screen.getByPlaceholderText('you@example.com'), 'a@b.com');
    await user.type(screen.getByPlaceholderText('••••••••'), 'pass');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // At this point auth.login has been called but not resolved yet.
    // The component should show "Signing in…" and disable the button.
    expect(screen.getByText(/signing in/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();

    // Resolve the pending promise so the test can clean up properly.
    // act() ensures React processes the state updates from the resolution.
    await act(async () => resolve({ access_token: 't', user: {} }));
  });

  it('clears error before new submission', async () => {
    // If a first attempt shows an error, a second attempt must clear that error
    // immediately (before the API call completes) so the UI is not confusing.
    auth.login.mockRejectedValueOnce(new Error('First error'));    // first call rejects
    auth.login.mockResolvedValueOnce({ access_token: 't', user: {} }); // second succeeds

    const user = userEvent.setup();
    render(<AuthForm mode="login" />);
    await user.type(screen.getByPlaceholderText('you@example.com'), 'a@b.com');
    await user.type(screen.getByPlaceholderText('••••••••'), 'pass');

    // First submission — causes an error message to appear.
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText('First error')).toBeInTheDocument());

    // Second submission — the error must be cleared.
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.queryByText('First error')).not.toBeInTheDocument());
  });

  it('updates email field on change', async () => {
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);
    const emailInput = screen.getByPlaceholderText('you@example.com');
    await user.type(emailInput, 'test@test.com');
    // After typing, the input's current value must reflect what was typed.
    expect(emailInput.value).toBe('test@test.com');
  });

  it('updates password field on change', async () => {
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);
    const pwInput = screen.getByPlaceholderText('••••••••');
    await user.type(pwInput, 'secret');
    expect(pwInput.value).toBe('secret');
  });
});

// ─── Register mode ────────────────────────────────────────────────────────────

describe('AuthForm (signup mode)', () => {
  it('renders name, email and password fields', () => {
    // Signup form has an additional "Your name" field not present in login.
    render(<AuthForm mode="signup" />);
    expect(screen.getByPlaceholderText('Your name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
  });

  it('renders "Create account" heading', () => {
    render(<AuthForm mode="signup" />);
    // We use getByRole('heading') to match only the h1/h2/etc. element, not a button
    // that might also contain "Create account" text. This avoids "found multiple elements" errors.
    expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
  });

  it('renders "Start chatting" subtitle', () => {
    render(<AuthForm mode="signup" />);
    expect(screen.getByText(/start chatting/i)).toBeInTheDocument();
  });

  it('renders link to /login', () => {
    render(<AuthForm mode="signup" />);
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
  });

  it('submits register with name, email and password', async () => {
    auth.register.mockResolvedValue({ access_token: 'tok', user: { email: 'a@b.com' } });
    const user = userEvent.setup();
    render(<AuthForm mode="signup" />);

    await user.type(screen.getByPlaceholderText('Your name'), 'Alice');
    await user.type(screen.getByPlaceholderText('you@example.com'), 'a@b.com');
    await user.type(screen.getByPlaceholderText('••••••••'), 'pass123');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      // auth.register must be called with (email, password, name) — note the argument order.
      expect(auth.register).toHaveBeenCalledWith('a@b.com', 'pass123', 'Alice');
      expect(mockReplace).toHaveBeenCalledWith('/chat');
    });
  });

  it('shows toast "Account created!" on success', async () => {
    auth.register.mockResolvedValue({ access_token: 'tok', user: {} });
    const user = userEvent.setup();
    render(<AuthForm mode="signup" />);
    await user.type(screen.getByPlaceholderText('Your name'), 'Alice');
    await user.type(screen.getByPlaceholderText('you@example.com'), 'a@b.com');
    await user.type(screen.getByPlaceholderText('••••••••'), 'pass123');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Account created!'));
  });

  it('shows loading text "Creating account…" while submitting', async () => {
    let resolve;
    auth.register.mockReturnValue(new Promise((r) => { resolve = r; }));

    const user = userEvent.setup();
    render(<AuthForm mode="signup" />);
    await user.type(screen.getByPlaceholderText('Your name'), 'Alice');
    await user.type(screen.getByPlaceholderText('you@example.com'), 'a@b.com');
    await user.type(screen.getByPlaceholderText('••••••••'), 'pass');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    // The pending promise keeps the form in loading state.
    expect(screen.getByText(/creating account/i)).toBeInTheDocument();

    // Clean up: resolve the pending promise so no unhandled rejection is left.
    await act(async () => resolve({ access_token: 't', user: {} }));
  });

  it('uses form data to build user object when API returns no user', async () => {
    // Some register endpoints return only the token, not the full user profile.
    // The component should build a minimal user object from the form data instead.
    auth.register.mockResolvedValue({ access_token: 'tok' }); // no user field
    const user = userEvent.setup();
    render(<AuthForm mode="signup" />);
    await user.type(screen.getByPlaceholderText('Your name'), 'Alice');
    await user.type(screen.getByPlaceholderText('you@example.com'), 'a@b.com');
    await user.type(screen.getByPlaceholderText('••••••••'), 'pass');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      // expect.objectContaining({ email, name }) checks a SUBSET of the arguments.
      // We don't care about other fields (e.g., id) that might be set internally.
      expect(mockSetAuth).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'a@b.com', name: 'Alice' }),
        'tok',
      );
    });
  });

  it('shows error message on register failure', async () => {
    auth.register.mockRejectedValue(new Error('Email already in use'));
    const user = userEvent.setup();
    render(<AuthForm mode="signup" />);
    await user.type(screen.getByPlaceholderText('Your name'), 'Alice');
    await user.type(screen.getByPlaceholderText('you@example.com'), 'a@b.com');
    await user.type(screen.getByPlaceholderText('••••••••'), 'pass');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => expect(screen.getByText('Email already in use')).toBeInTheDocument());
  });
});
