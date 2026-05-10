'use client';
import { useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { v4 as uuid } from 'uuid';
import toast from 'react-hot-toast';
import { useApp } from '@/lib/context';
import { conversations as convApi } from '@/lib/api';
import MessageBubble from './MessageBubble';
import ThinkingBubble from './ThinkingBubble';
import MessageInput from './MessageInput';

const WELCOME = [
  { icon: '💬', title: 'Chat naturally', desc: 'Ask anything in plain language' },
  { icon: '🧠', title: 'Deep reasoning', desc: 'Complex problems broken down step by step' },
  { icon: '💻', title: 'Code assistant', desc: 'Write, explain, and debug code' },
  { icon: '✨', title: 'Creative writing', desc: 'Stories, emails, essays and more' },
];

export default function ChatArea({ conversationId }) {
  const router = useRouter();
  const {
    state,
    setCurrentConversation,
    addConversation,
    updateConversation,
    addMessage,
    appendToLastMessage,
    setStreaming,
  } = useApp();

  const bottomRef = useRef(null);
  const abortRef = useRef(null);
  const isCurrentConv = state.currentConversationId === conversationId;
  const messages = isCurrentConv ? state.currentMessages : [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, state.isStreaming]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
  }, [setStreaming]);

  const handleSend = useCallback(async (content) => {
    if (state.isStreaming) return;

    let convId = conversationId;

    // Create conversation if needed
    if (!convId) {
      try {
        const conv = await convApi.create(content.slice(0, 60) || 'New Chat');
        convId = conv.id;
        addConversation(conv);
        setCurrentConversation(conv.id, []);
        router.push(`/chat/${conv.id}`);
      } catch (err) {
        toast.error('Failed to create conversation');
        return;
      }
    }

    const userMsg = { id: uuid(), role: 'user', content, created_at: new Date().toISOString() };
    addMessage(userMsg);

    const assistantMsg = { id: uuid(), role: 'assistant', content: '', created_at: new Date().toISOString() };
    addMessage(assistantMsg);
    setStreaming(true);

    abortRef.current = new AbortController();
    let fullContent = '';

    await convApi.chat(convId, content, {
      onChunk(chunk) {
        fullContent += chunk;
        appendToLastMessage(chunk);
      },
      onDone() {
        setStreaming(false);
        // Update sidebar title from first message
        if (!conversationId) {
          updateConversation(convId, { title: content.slice(0, 60) });
        }
      },
      onError(err) {
        setStreaming(false);
        if (err?.name !== 'AbortError') {
          toast.error(err?.message || 'Generation failed');
        }
      },
    });
  }, [state.isStreaming, conversationId, addMessage, appendToLastMessage, setStreaming, addConversation, setCurrentConversation, updateConversation, router]);

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center">
            <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center mb-6 shadow-lg shadow-blue-500/20">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-zinc-100 mb-2">How can I help you today?</h2>
            <p className="text-zinc-500 text-sm mb-10 max-w-sm">
              Start a conversation — I can help with analysis, writing, coding, and much more.
            </p>
            <div className="grid grid-cols-2 gap-3 max-w-lg w-full">
              {WELCOME.map((item) => (
                <button
                  key={item.title}
                  onClick={() => handleSend(item.title + ': ')}
                  className="text-left p-4 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-600 transition group"
                >
                  <div className="text-xl mb-1">{item.icon}</div>
                  <div className="text-sm font-medium text-zinc-200 group-hover:text-white transition">{item.title}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{item.desc}</div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {messages.map((msg, i) => (
              <MessageBubble
                key={msg.id || i}
                message={msg}
                isStreaming={state.isStreaming && i === messages.length - 1 && msg.role === 'assistant'}
              />
            ))}
            {state.isStreaming && messages[messages.length - 1]?.role !== 'assistant' && (
              <ThinkingBubble />
            )}
            <div ref={bottomRef} className="h-4" />
          </div>
        )}
      </div>

      {/* Input */}
      <MessageInput
        onSend={handleSend}
        onStop={handleStop}
        disabled={!state.isAuthenticated}
      />
    </div>
  );
}
