"use client";
import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import { useApp } from "@/lib/context";
import { configApi } from "@/lib/api";

const MODELS = [
  { id: "claude-opus-4-7", label: "Claude Opus 4.7 (Most capable)" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Balanced)" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (Fast)" },
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini" },
  { id: "gemini-2.5-pro", label: "gemini-2.5-pro" },
];

export default function ConfigPanel() {
  const { state, setConfig, toggleConfig } = useApp();
  const [local, setLocal] = useState({ ...state.config });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Try to load from server
    configApi
      .get()
      .then(setConfig)
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLocal({ ...state.config });
  }, [state.config]);

  async function handleSave() {
    setSaving(true);
    try {
      await configApi.update(local);
      setConfig(local);
      toast.success("Settings saved");
    } catch {
      // Save locally if server unavailable
      setConfig(local);
      toast.success("Settings saved locally");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={toggleConfig} />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-96 max-w-full bg-zinc-900 border-l border-zinc-800 z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-white">Settings</h2>
          <button
            onClick={toggleConfig}
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Model */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              Model
            </label>
            <select
              value={local.model}
              onChange={(e) => setLocal({ ...local, model: e.target.value })}
              className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition"
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* Temperature */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-zinc-300">
                Temperature
              </label>
              <span className="text-sm text-zinc-400 font-mono">
                {local.temperature.toFixed(1)}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={local.temperature}
              onChange={(e) =>
                setLocal({ ...local, temperature: parseFloat(e.target.value) })
              }
              className="w-full accent-blue-500"
            />
            <div className="flex justify-between text-xs text-zinc-600 mt-1">
              <span>Precise</span>
              <span>Creative</span>
            </div>
          </div>

          {/* Max tokens */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-zinc-300">
                Max Tokens
              </label>
              <span className="text-sm text-zinc-400 font-mono">
                {local.max_tokens.toLocaleString()}
              </span>
            </div>
            <input
              type="range"
              min="256"
              max="16384"
              step="256"
              value={local.max_tokens}
              onChange={(e) =>
                setLocal({ ...local, max_tokens: parseInt(e.target.value) })
              }
              className="w-full accent-blue-500"
            />
            <div className="flex justify-between text-xs text-zinc-600 mt-1">
              <span>256</span>
              <span>16 384</span>
            </div>
          </div>

          {/* System prompt */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              System Prompt
            </label>
            <textarea
              rows={6}
              placeholder="You are a helpful AI assistant…"
              value={local.system_prompt}
              onChange={(e) =>
                setLocal({ ...local, system_prompt: e.target.value })
              }
              className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 placeholder-zinc-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition"
            />
            <p className="text-xs text-zinc-600 mt-1">
              Instructions sent to the model before every conversation.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-zinc-800">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition"
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </div>
    </>
  );
}
