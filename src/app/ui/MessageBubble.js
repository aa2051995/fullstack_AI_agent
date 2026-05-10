'use client';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 px-2 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded transition opacity-0 group-hover:opacity-100"
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

const markdownComponents = {
  pre({ children }) {
    return <div className="relative group my-3">{children}</div>;
  },
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    const code = String(children).replace(/\n$/, '');
    const isBlock = match || String(children).includes('\n');

    if (match) {
      return (
        <>
          <div className="flex items-center justify-between px-4 py-2 bg-zinc-800 rounded-t-lg border-b border-zinc-700">
            <span className="text-xs text-zinc-400 font-mono">{match[1]}</span>
            <CopyButton text={code} />
          </div>
          <SyntaxHighlighter
            style={oneDark}
            language={match[1]}
            PreTag="div"
            customStyle={{ margin: 0, borderRadius: '0 0 8px 8px', background: '#111', padding: '1em 1.25em', fontSize: '0.85em' }}
          >
            {code}
          </SyntaxHighlighter>
        </>
      );
    }

    if (isBlock) {
      return (
        <code className="block bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-sm font-mono text-zinc-300 overflow-x-auto whitespace-pre">
          {children}
        </code>
      );
    }

    return (
      <code className="bg-white/10 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
        {children}
      </code>
    );
  },
};

export default function MessageBubble({ message, isStreaming }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end px-4 py-2 max-w-3xl mx-auto w-full">
        <div className="max-w-[80%] bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 px-4 py-3 max-w-3xl mx-auto w-full">
      {/* AI Avatar */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center mt-0.5">
        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      </div>

      {/* Content */}
      <div className={`flex-1 text-sm text-zinc-100 prose-chat min-w-0 ${isStreaming ? 'streaming-cursor' : ''}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {message.content || ''}
        </ReactMarkdown>
      </div>
    </div>
  );
}
