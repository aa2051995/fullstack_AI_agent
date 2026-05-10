'use client';
import { useEffect } from 'react';
import { useApp } from '@/lib/context';
import { conversations as convApi } from '@/lib/api';
import ChatArea from '@/app/ui/ChatArea';

export default function ConversationView({ conversationId }) {
  const { state, setCurrentConversation } = useApp();

  useEffect(() => {
    if (!conversationId || !state.isAuthenticated) return;
    if (state.currentConversationId === conversationId) return;

    convApi.get(conversationId)
      .then((data) => setCurrentConversation(data.id, data.messages || []))
      .catch(() => {});
  }, [conversationId, state.isAuthenticated]);

  return <ChatArea conversationId={conversationId} />;
}
