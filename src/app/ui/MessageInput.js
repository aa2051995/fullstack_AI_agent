'use client';
import { useState, useRef, useEffect } from 'react';
import { useApp } from '@/lib/context';

export default function MessageInput({ onSend, onStop, disabled }) {
  const { state } = useApp();
  const [value, setValue] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [value]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }

  return (
    <div className="px-4 pb-4 pt-2">
      <div className="max-w-3xl mx-auto">
        <div className="relative flex items-end bg-zinc-800 border border-zinc-700 rounded-2xl overflow-hidden focus-within:border-zinc-500 transition">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message AI…"
            rows={1}
            disabled={state.isStreaming}
            className="flex-1 bg-transparent text-zinc-100 placeholder-zinc-500 px-4 py-3.5 text-sm focus:outline-none min-h-[52px] max-h-[200px]"
          />

          <div className="flex items-center gap-1 px-2 pb-2">
            {state.isStreaming ? (
              <button
                onClick={onStop}
                className="p-2 rounded-xl bg-red-600 hover:bg-red-500 text-white transition"
                title="Stop generating"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!value.trim() || disabled}
                className="p-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed text-white transition"
                title="Send (Enter)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                    d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-zinc-600 mt-2">
          <kbd className="bg-zinc-800 px-1 rounded">Enter</kbd> to send ·{' '}
          <kbd className="bg-zinc-800 px-1 rounded">Shift+Enter</kbd> for new line ·{' '}
          Model: <span className="text-zinc-500">{state.config.model}</span>
        </p>
      </div>
    </div>
  );
}
