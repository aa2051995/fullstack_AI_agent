'use client';

export default function ThinkingBubble() {
  return (
    <div className="flex gap-3 px-4 py-3 max-w-3xl mx-auto w-full">
      {/* AI Avatar */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center">
        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      </div>

      {/* Dots */}
      <div className="flex items-center gap-1.5 bg-zinc-800 rounded-2xl rounded-tl-sm px-4 py-3">
        <span className="dot-1 w-2 h-2 rounded-full bg-zinc-400 inline-block" />
        <span className="dot-2 w-2 h-2 rounded-full bg-zinc-400 inline-block" />
        <span className="dot-3 w-2 h-2 rounded-full bg-zinc-400 inline-block" />
      </div>
    </div>
  );
}
