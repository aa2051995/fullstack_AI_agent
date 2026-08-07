/**
 * Tests for src/app/ui/ConfigPanel.js
 *
 * ConfigPanel is a settings modal that lets the user configure:
 *   - AI model (select dropdown)
 *   - Temperature (range slider)
 *   - Max tokens (range slider)
 *   - System prompt (textarea)
 *
 * On mount it loads the current config from the server (configApi.get) and syncs
 * it into the global context. When saved, it calls configApi.update then setConfig.
 * If the server save fails, it saves locally (context only) with a different toast.
 *
 * Key patterns used here:
 *
 * 1. await act(async () => render(<ConfigPanel />))
 *    ConfigPanel has a useEffect that calls configApi.get on mount. React effects
 *    run asynchronously after the initial render. Wrapping render() in act(async)
 *    waits for the effect to complete before assertions run, avoiding "not wrapped
 *    in act()" warnings.
 *
 * 2. Mutable mockConfig object
 *    The context mock returns mockConfig by reference. In the "context sync" test,
 *    we reassign mockConfig and rerender — the component sees the new config because
 *    it calls useApp() on every render, which returns the current mockConfig reference.
 *
 * 3. fireEvent.change for range sliders
 *    userEvent does not simulate slider input in jsdom. We use fireEvent.change with
 *    { target: { value: '...' } } to directly trigger the onChange handler.
 */

import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfigPanel from '@/app/ui/ConfigPanel';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// react-hot-toast: mock both default and named exports for compatibility.
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
  success: jest.fn(),
  error: jest.fn(),
}));
import toast from 'react-hot-toast';

/**
 * mockSetConfig / mockToggleConfig: action dispatchers from context.
 * We inspect these to verify the component calls them with the right arguments.
 *
 * mockConfig: holds the "current" config that the context returns.
 * Reassigning mockConfig in a test simulates an external config change
 * (e.g., another tab updated the config).
 */
const mockSetConfig = jest.fn();
const mockToggleConfig = jest.fn();

let mockConfig = {};

jest.mock('@/lib/context', () => ({
  useApp: () => ({
    state: { config: mockConfig },
    setConfig: mockSetConfig,
    toggleConfig: mockToggleConfig,
  }),
}));

/**
 * mockConfigGet / mockConfigUpdate: the API functions called by ConfigPanel.
 * We assign return values in beforeEach so each test starts with a predictable server state.
 */
const mockConfigGet = jest.fn();
const mockConfigUpdate = jest.fn();

jest.mock('@/lib/api', () => ({
  configApi: {
    get: (...a) => mockConfigGet(...a),
    update: (...a) => mockConfigUpdate(...a),
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * defaultConfig returns the initial config values used across all tests.
 * Defined as a function (not a const) so each call produces a fresh object —
 * preventing tests from accidentally mutating a shared reference.
 */
function defaultConfig() {
  return {
    model: 'claude-opus-4-7',
    temperature: 0.7,
    max_tokens: 4096,
    system_prompt: '',
  };
}

beforeEach(() => {
  mockConfig = defaultConfig();    // fresh config for each test
  jest.clearAllMocks();            // reset call histories
  mockConfigGet.mockResolvedValue(defaultConfig()); // server returns the default config
  mockConfigUpdate.mockResolvedValue(defaultConfig()); // save succeeds
});

// ─── Rendering ────────────────────────────────────────────────────────────────

describe('ConfigPanel – rendering', () => {
  it('renders the Settings heading', async () => {
    // We wrap render in act(async) because ConfigPanel calls configApi.get in a
    // useEffect on mount. Without act(), React would warn about the state update
    // from setConfig (called after configApi.get resolves) being outside act().
    await act(async () => render(<ConfigPanel />));
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders all model options', async () => {
    await act(async () => render(<ConfigPanel />));
    // Each option in the model select dropdown should be present.
    // The regex /Claude Opus 4\.7/ escapes the dot because in regex . matches any character.
    expect(screen.getByText(/Claude Opus 4\.7/)).toBeInTheDocument();
    expect(screen.getByText(/Claude Sonnet 4\.6/)).toBeInTheDocument();
    expect(screen.getByText(/Claude Haiku 4\.5/)).toBeInTheDocument();
    expect(screen.getByText('GPT-4o')).toBeInTheDocument();
  });

  it('renders temperature range input with current value', async () => {
    await act(async () => render(<ConfigPanel />));

    // getAllByRole('slider') returns all range inputs (temperature AND max_tokens).
    // Temperature is the first slider; max_tokens is the second.
    const range = screen.getAllByRole('slider');
    // toHaveValue on a range input checks the input's current value as a string.
    expect(range[0]).toHaveValue('0.7');
  });

  it('shows current temperature value as text', async () => {
    await act(async () => render(<ConfigPanel />));
    // The temperature value is displayed as a text label next to the slider.
    expect(screen.getByText('0.7')).toBeInTheDocument();
  });

  it('shows current max_tokens value formatted', async () => {
    await act(async () => render(<ConfigPanel />));
    // max_tokens is displayed with a thousands separator: 4096 → "4,096".
    expect(screen.getByText('4,096')).toBeInTheDocument();
  });

  it('renders system prompt textarea', async () => {
    await act(async () => render(<ConfigPanel />));
    expect(screen.getByPlaceholderText(/You are a helpful/)).toBeInTheDocument();
  });

  it('renders backdrop div', async () => {
    // The backdrop is a full-screen overlay behind the modal panel.
    // Clicking it closes the panel (tested below).
    const { container } = await act(async () => { const r = render(<ConfigPanel />); return r; });
    expect(container.querySelector('.fixed.inset-0')).toBeInTheDocument();
  });

  it('calls toggleConfig when backdrop is clicked', async () => {
    const user = userEvent.setup();
    const { container } = await act(async () => { const r = render(<ConfigPanel />); return r; });

    // The backdrop is the semi-transparent black overlay (.bg-black\/50).
    // The backslash in '\/' escapes the slash for the CSS class selector.
    const backdrop = container.querySelector('.fixed.inset-0.bg-black\\/50');
    await user.click(backdrop);
    expect(mockToggleConfig).toHaveBeenCalled();
  });

  it('calls toggleConfig when close button is clicked', async () => {
    const user = userEvent.setup();
    await act(async () => render(<ConfigPanel />));

    // getAllByRole('button') returns all buttons. The first button in the modal
    // is the X close button (which has no visible text label).
    const closeBtns = screen.getAllByRole('button');
    await user.click(closeBtns[0]);
    expect(mockToggleConfig).toHaveBeenCalled();
  });
});

// ─── Loading server config on mount ──────────────────────────────────────────

describe('ConfigPanel – server config load', () => {
  it('calls configApi.get on mount', async () => {
    // ConfigPanel fetches the current server config in a useEffect.
    // act(async) ensures the useEffect completes before we assert.
    await act(async () => render(<ConfigPanel />));
    expect(mockConfigGet).toHaveBeenCalled();
  });

  it('calls setConfig with server response', async () => {
    // When the server returns a config, the component calls setConfig to sync
    // the global context state with the server's values.
    const serverConfig = { ...defaultConfig(), model: 'gpt-4o' };
    mockConfigGet.mockResolvedValue(serverConfig);

    await act(async () => render(<ConfigPanel />));

    // waitFor retries until setConfig has been called with the server config.
    await waitFor(() => expect(mockSetConfig).toHaveBeenCalledWith(serverConfig));
  });

  it('silently ignores configApi.get errors', async () => {
    // If the server is unreachable, ConfigPanel must not crash or show an error.
    // It simply continues with the config from local context state.
    mockConfigGet.mockRejectedValue(new Error('network'));
    await act(async () => render(<ConfigPanel />));
    // No assertion needed — the test passes if render() doesn't throw.
  });
});

// ─── Local state changes ──────────────────────────────────────────────────────

describe('ConfigPanel – local state', () => {
  /**
   * ConfigPanel maintains local state (localConfig) that is separate from the
   * global context state. Changes to the form update localConfig immediately
   * (controlled inputs), but do NOT call setConfig until the user saves.
   *
   * This allows the user to experiment with settings without affecting the app
   * until they explicitly click "Save settings".
   */

  it('updates model selection', async () => {
    const user = userEvent.setup();
    await act(async () => render(<ConfigPanel />));

    // getByRole('combobox') finds the <select> element.
    // user.selectOptions fires change/input events exactly as a browser would.
    const select = screen.getByRole('combobox');
    await user.selectOptions(select, 'gpt-4o');

    // The select's value is now the chosen option's value attribute.
    expect(select.value).toBe('gpt-4o');
  });

  it('updates temperature slider', async () => {
    await act(async () => render(<ConfigPanel />));

    const sliders = screen.getAllByRole('slider');

    // fireEvent.change is used for sliders because userEvent does not simulate
    // dragging a range input in jsdom. We set the target.value directly, which
    // triggers the component's onChange handler.
    fireEvent.change(sliders[0], { target: { value: '1.5' } });

    // After the slider changes, the displayed temperature text should update.
    await waitFor(() => expect(screen.getByText('1.5')).toBeInTheDocument());
  });

  it('updates max_tokens slider', async () => {
    await act(async () => render(<ConfigPanel />));

    const sliders = screen.getAllByRole('slider');
    fireEvent.change(sliders[1], { target: { value: '8192' } });

    // 8192 is displayed formatted with a thousands separator.
    await waitFor(() => expect(screen.getByText('8,192')).toBeInTheDocument());
  });

  it('updates system prompt textarea', async () => {
    const user = userEvent.setup();
    await act(async () => render(<ConfigPanel />));

    const textarea = screen.getByPlaceholderText(/You are a helpful/);
    await user.type(textarea, 'Be concise.');

    // The textarea's current value must include what was typed.
    expect(textarea.value).toContain('Be concise.');
  });
});

// ─── Save behavior ────────────────────────────────────────────────────────────

describe('ConfigPanel – save', () => {
  it('calls configApi.update and setConfig on save', async () => {
    const user = userEvent.setup();
    await act(async () => render(<ConfigPanel />));

    await user.click(screen.getByText('Save settings'));

    await waitFor(() => {
      // Both the server update and the context update must happen.
      expect(mockConfigUpdate).toHaveBeenCalled();
      expect(mockSetConfig).toHaveBeenCalled();
      // A success toast confirms the save to the user.
      expect(toast.success).toHaveBeenCalledWith('Settings saved');
    });
  });

  it('shows saving state while request is in-flight', async () => {
    // Create a Promise that does not resolve until we manually call resolve().
    // This suspends the save handler mid-flight so we can check the loading state.
    let resolve;
    mockConfigUpdate.mockReturnValue(new Promise((r) => { resolve = r; }));

    const user = userEvent.setup();
    await act(async () => render(<ConfigPanel />));
    await user.click(screen.getByText('Save settings'));

    // While configApi.update is pending, the button shows "Saving…" and is disabled.
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /saving/i });
    expect(btn).toBeDisabled();

    // Resolve the pending promise so the component can finish and clean up.
    // act() flushes the resulting state updates (isSaving = false).
    await act(async () => resolve(defaultConfig()));
  });

  it('saves locally when configApi.update fails', async () => {
    // When the server is unreachable, ConfigPanel falls back to saving only to
    // the local context (no persistence to the server). A different toast is shown.
    mockConfigUpdate.mockRejectedValue(new Error('server down'));

    const user = userEvent.setup();
    await act(async () => render(<ConfigPanel />));
    await user.click(screen.getByText('Save settings'));

    await waitFor(() => {
      // setConfig was still called — local state is updated even on server failure.
      expect(mockSetConfig).toHaveBeenCalled();
      // The "locally" toast distinguishes this from a full server save.
      expect(toast.success).toHaveBeenCalledWith('Settings saved locally');
    });
  });
});

// ─── Config sync from context ─────────────────────────────────────────────────

describe('ConfigPanel – context sync', () => {
  it('local state syncs when context config changes', async () => {
    // When the context config changes from outside (e.g., after configApi.get resolves),
    // the ConfigPanel's local state must update to reflect the new config.
    // This uses rerender() to simulate the parent re-rendering with new context data.
    const { rerender } = await act(async () => render(<ConfigPanel />));

    // Simulate an external change to the context config.
    mockConfig = { ...defaultConfig(), model: 'gpt-4o-mini' };

    // rerender() triggers a re-render with the same component but now useApp()
    // returns the updated mockConfig. React re-renders and the local state sync
    // useEffect should fire (if ConfigPanel implements a sync effect).
    await act(async () => rerender(<ConfigPanel />));

    const select = screen.getByRole('combobox');
    expect(select.value).toBe('gpt-4o-mini');
  });
});

// fireEvent is imported at the bottom for use in the slider tests above.
// This is valid because jest.mock() hoisting means mocks are always set up
// before any code runs, regardless of where imports appear in the file.
import { fireEvent } from '@testing-library/react';
