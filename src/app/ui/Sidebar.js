'use client';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import toast from 'react-hot-toast';
import { useApp } from '@/lib/context';
import { conversations as convApi, auth as authApi } from '@/lib/api';

function groupByDate(convs) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today - 86400000);
  const week = new Date(today - 6 * 86400000);

  const groups = { Today: [], Yesterday: [], 'Last 7 days': [], Older: [] };
  for (const c of convs) {
    const d = new Date(c.updated_at || c.created_at || 0);
    if (d >= today) groups.Today.push(c);
    else if (d >= yesterday) groups.Yesterday.push(c);
    else if (d >= week) groups['Last 7 days'].push(c);
    else groups.Older.push(c);
  }
  return groups;
}

function ConvItem({ conv, isActive, onDelete, onRename }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(conv.title || 'Untitled');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function handleRename(e) {
    e.preventDefault();
    setEditing(false);
    if (title.trim() === conv.title) return;
    await onRename(conv.id, title.trim() || 'Untitled');
  }

  return (
    <div
      className={`group relative flex items-center rounded-lg px-2 py-2 cursor-pointer transition ${
        isActive ? 'bg-zinc-700' : 'hover:bg-zinc-800'
      }`}
    >
      {editing ? (
        <form onSubmit={handleRename} className="flex-1 min-w-0">
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleRename}
            className="w-full bg-zinc-900 text-white text-sm px-2 py-0.5 rounded focus:outline-none"
          />
        </form>
      ) : (
        <Link href={`/chat/${conv.id}`} className="flex-1 min-w-0">
          <span className="block text-sm text-zinc-200 truncate">{conv.title || 'Untitled'}</span>
        </Link>
      )}

      {!editing && (
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition ml-1">
          <button
            onClick={() => setEditing(true)}
            className="p-1 rounded hover:bg-zinc-600 text-zinc-400 hover:text-zinc-200 transition"
            title="Rename"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={() => onDelete(conv.id)}
            className="p-1 rounded hover:bg-zinc-600 text-zinc-400 hover:text-red-400 transition"
            title="Delete"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { state, deleteConversation, updateConversation, toggleSidebar, toggleConfig, clearAuth } = useApp();
  const [search, setSearch] = useState('');

  const activeId = pathname.startsWith('/chat/') ? pathname.split('/chat/')[1] : null;

  async function handleDelete(id) {
    if (!confirm('Delete this conversation?')) return;
    try {
      await convApi.delete(id);
      deleteConversation(id);
      if (activeId === id) router.push('/chat');
      toast.success('Conversation deleted');
    } catch {
      toast.error('Failed to delete');
    }
  }

  async function handleRename(id, newTitle) {
    try {
      await convApi.update(id, { title: newTitle });
      updateConversation(id, { title: newTitle });
    } catch {
      toast.error('Failed to rename');
    }
  }

  async function handleLogout() {
    await authApi.logout();
    clearAuth();
    router.push('/login');
  }

  const filtered = (state.conversations || []).filter((c) =>
    (c.title || '').toLowerCase().includes(search.toLowerCase())
  );
  const groups = groupByDate(filtered);

  if (!state.isSidebarOpen) {
    return (
      <button
        onClick={toggleSidebar}
        className="fixed top-3 left-3 z-50 p-2 rounded-lg bg-zinc-900 border border-zinc-700 hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
        title="Open sidebar"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
    );
  }

  return (
    <aside className="flex flex-col w-64 bg-zinc-900 border-r border-zinc-800 flex-shrink-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-zinc-800">
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
          title="Close sidebar"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <Link
          href="/chat"
          className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-800 transition text-zinc-200 hover:text-white text-sm font-medium"
          onClick={() => updateConversation && null}
        >
          <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 4v16m8-8H4" />
          </svg>
          New chat
        </Link>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search conversations"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-zinc-800 text-zinc-300 placeholder-zinc-600 text-xs pl-8 pr-3 py-2 rounded-lg focus:outline-none focus:bg-zinc-750 transition"
          />
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-2 space-y-4 pb-2">
        {Object.entries(groups).map(([label, convs]) => {
          if (!convs.length) return null;
          return (
            <div key={label}>
              <p className="px-2 py-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">{label}</p>
              <div className="space-y-0.5">
                {convs.map((conv) => (
                  <ConvItem
                    key={conv.id}
                    conv={conv}
                    isActive={conv.id === activeId}
                    onDelete={handleDelete}
                    onRename={handleRename}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center text-zinc-600 text-xs py-8">
            {search ? 'No conversations found' : 'No conversations yet'}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-zinc-800 p-2 space-y-1">
        <button
          onClick={toggleConfig}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition text-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Settings
        </button>

        {state.user && (
          <div className="flex items-center gap-2.5 px-3 py-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
              {(state.user.name || state.user.email || 'U')[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-zinc-300 truncate">{state.user.name || state.user.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition"
              title="Sign out"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
