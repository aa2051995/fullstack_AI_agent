'use client';
import { useEffect } from 'react';
import { useApp } from '@/lib/context';
import { conversations as convApi } from '@/lib/api';
import Sidebar from '@/app/ui/Sidebar';
import ConfigPanel from '@/app/ui/ConfigPanel';

export default function ChatLayout({ children }) {
  const { state, setConversations } = useApp();

  useEffect(() => {
    if (!state.isAuthenticated) return;
    convApi.list().then(setConversations).catch(() => {});
  }, [state.isAuthenticated]);

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0a0a]">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 relative">
        {children}
      </main>
      {state.isConfigOpen && <ConfigPanel />}
    </div>
  );
}
