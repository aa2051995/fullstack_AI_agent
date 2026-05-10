'use client';
import { createContext, useContext, useReducer, useEffect } from 'react';
import { setToken, clearToken, getToken } from './api';

const initialState = {
  user: null,
  token: null,
  isAuthenticated: false,
  isHydrated: false,

  conversations: [],
  currentConversationId: null,
  currentMessages: [],

  isStreaming: false,
  isSidebarOpen: true,
  isConfigOpen: false,

  config: {
    model: 'claude-opus-4-7',
    temperature: 0.7,
    system_prompt: '',
    max_tokens: 4096,
  },
};

function reducer(state, action) {
  switch (action.type) {
    case 'HYDRATE':
      return { ...state, ...action.payload, isHydrated: true };

    case 'SET_AUTH':
      return {
        ...state,
        user: action.payload.user,
        token: action.payload.token,
        isAuthenticated: true,
      };

    case 'CLEAR_AUTH':
      return {
        ...state,
        user: null,
        token: null,
        isAuthenticated: false,
        conversations: [],
        currentConversationId: null,
        currentMessages: [],
      };

    case 'SET_CONVERSATIONS':
      return { ...state, conversations: action.payload };

    case 'ADD_CONVERSATION':
      return { ...state, conversations: [action.payload, ...state.conversations] };

    case 'DELETE_CONVERSATION':
      return {
        ...state,
        conversations: state.conversations.filter((c) => c.id !== action.payload),
        currentConversationId:
          state.currentConversationId === action.payload ? null : state.currentConversationId,
        currentMessages:
          state.currentConversationId === action.payload ? [] : state.currentMessages,
      };

    case 'UPDATE_CONVERSATION':
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === action.payload.id ? { ...c, ...action.payload.data } : c
        ),
      };

    case 'SET_CURRENT_CONVERSATION':
      return {
        ...state,
        currentConversationId: action.payload.id,
        currentMessages: action.payload.messages || [],
      };

    case 'ADD_MESSAGE':
      return { ...state, currentMessages: [...state.currentMessages, action.payload] };

    case 'UPDATE_LAST_MESSAGE': {
      const msgs = [...state.currentMessages];
      if (msgs.length > 0) {
        msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: action.payload };
      }
      return { ...state, currentMessages: msgs };
    }

    case 'APPEND_TO_LAST_MESSAGE': {
      const msgs = [...state.currentMessages];
      if (msgs.length > 0) {
        const last = msgs[msgs.length - 1];
        msgs[msgs.length - 1] = { ...last, content: (last.content || '') + action.payload };
      }
      return { ...state, currentMessages: msgs };
    }

    case 'SET_STREAMING':
      return { ...state, isStreaming: action.payload };

    case 'TOGGLE_SIDEBAR':
      return { ...state, isSidebarOpen: !state.isSidebarOpen };

    case 'TOGGLE_CONFIG':
      return { ...state, isConfigOpen: !state.isConfigOpen };

    case 'SET_CONFIG':
      return { ...state, config: { ...state.config, ...action.payload } };

    default:
      return state;
  }
}

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    const token = getToken();
    const raw = localStorage.getItem('app_user');
    const user = raw ? JSON.parse(raw) : null;
    const isSidebarOpen = localStorage.getItem('sidebar_open') !== 'false';
    const rawConfig = localStorage.getItem('app_config');
    const config = rawConfig ? JSON.parse(rawConfig) : initialState.config;

    dispatch({
      type: 'HYDRATE',
      payload: { token, user, isAuthenticated: !!token && !!user, isSidebarOpen, config },
    });
  }, []);

  useEffect(() => {
    if (!state.isHydrated) return;
    localStorage.setItem('sidebar_open', String(state.isSidebarOpen));
  }, [state.isSidebarOpen, state.isHydrated]);

  useEffect(() => {
    if (!state.isHydrated) return;
    localStorage.setItem('app_config', JSON.stringify(state.config));
  }, [state.config, state.isHydrated]);

  const actions = {
    setAuth(user, token) {
      setToken(token);
      localStorage.setItem('app_user', JSON.stringify(user));
      dispatch({ type: 'SET_AUTH', payload: { user, token } });
    },
    clearAuth() {
      clearToken();
      localStorage.removeItem('app_user');
      dispatch({ type: 'CLEAR_AUTH' });
    },
    setConversations: (list) => dispatch({ type: 'SET_CONVERSATIONS', payload: list }),
    addConversation: (conv) => dispatch({ type: 'ADD_CONVERSATION', payload: conv }),
    deleteConversation: (id) => dispatch({ type: 'DELETE_CONVERSATION', payload: id }),
    updateConversation: (id, data) => dispatch({ type: 'UPDATE_CONVERSATION', payload: { id, data } }),
    setCurrentConversation: (id, messages) =>
      dispatch({ type: 'SET_CURRENT_CONVERSATION', payload: { id, messages } }),
    addMessage: (msg) => dispatch({ type: 'ADD_MESSAGE', payload: msg }),
    updateLastMessage: (content) => dispatch({ type: 'UPDATE_LAST_MESSAGE', payload: content }),
    appendToLastMessage: (chunk) => dispatch({ type: 'APPEND_TO_LAST_MESSAGE', payload: chunk }),
    setStreaming: (val) => dispatch({ type: 'SET_STREAMING', payload: val }),
    toggleSidebar: () => dispatch({ type: 'TOGGLE_SIDEBAR' }),
    toggleConfig: () => dispatch({ type: 'TOGGLE_CONFIG' }),
    setConfig: (cfg) => dispatch({ type: 'SET_CONFIG', payload: cfg }),
  };

  return <AppContext.Provider value={{ state, ...actions }}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
