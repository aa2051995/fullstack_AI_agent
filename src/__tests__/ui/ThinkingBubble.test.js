/**
 * Tests for src/app/ui/ThinkingBubble.js
 *
 * ThinkingBubble is a simple presentational component: it renders an animated
 * "thinking" indicator (three pulsing dots) shown while the AI is generating
 * a response. It has no props, no state, and no external dependencies.
 *
 * Because it is purely visual with no logic, the tests focus on:
 *   1. Structural presence — the expected DOM elements are rendered.
 *   2. Crash safety — rendering does not throw.
 *
 * For simple components like this, a small set of structural tests provides
 * good coverage without over-specifying the implementation.
 */

import { render, screen } from '@testing-library/react';
import ThinkingBubble from '@/app/ui/ThinkingBubble';

describe('ThinkingBubble', () => {
  it('renders three animated dots', () => {
    const { container } = render(<ThinkingBubble />);

    // The three dots and the AI avatar are all styled with rounded-full.
    // querySelectorAll('.rounded-full') returns ALL matching elements.
    // We assert >= 3 rather than == 3 to be resilient to the avatar also
    // matching the selector (which has the same class).
    const dots = container.querySelectorAll('.rounded-full');
    expect(dots.length).toBeGreaterThanOrEqual(3);
  });

  it('renders the AI avatar', () => {
    const { container } = render(<ThinkingBubble />);

    // The AI avatar is specifically the w-8 h-8 rounded-full container.
    // We use a compound CSS selector (.a.b.c) to target the exact element
    // rather than any element with rounded-full.
    const avatar = container.querySelector('.w-8.h-8.rounded-full');
    expect(avatar).toBeInTheDocument();
  });

  it('renders dot-1, dot-2, dot-3 spans', () => {
    const { container } = render(<ThinkingBubble />);

    // Each dot has a specific class (dot-1, dot-2, dot-3) used by CSS animations
    // to stagger the timing — each dot pulses at a different phase.
    // We verify all three exist so the animation timing cannot be broken by
    // accidentally removing or renaming a dot.
    expect(container.querySelector('.dot-1')).toBeInTheDocument();
    expect(container.querySelector('.dot-2')).toBeInTheDocument();
    expect(container.querySelector('.dot-3')).toBeInTheDocument();
  });

  it('renders without crashing', () => {
    // A basic smoke test: if ThinkingBubble has any broken JSX or an import error,
    // this test will fail with the error thrown during render.
    // not.toThrow() catches synchronous render errors.
    expect(() => render(<ThinkingBubble />)).not.toThrow();
  });
});
