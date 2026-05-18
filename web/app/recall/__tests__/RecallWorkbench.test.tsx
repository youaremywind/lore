import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const stateCall = vi.hoisted(() => ({ count: 0, debugError: '', debugData: null as Record<string, unknown> | null }));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: <T,>(initial: T) => {
      stateCall.count += 1;
      if (stateCall.count === 2) return [stateCall.debugData as T, vi.fn()] as const;
      if (stateCall.count === 4) return [stateCall.debugError as T, vi.fn()] as const;
      if (stateCall.count === 5) return [true, vi.fn()] as const;
      return actual.useState(initial);
    },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../../../lib/api', () => ({
  api: { get: vi.fn() },
}));

vi.mock('../../../components/RecallStages', () => ({
  default: () => <div data-recall-stages="true" />,
}));

vi.mock('../../../lib/i18n', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../components/ui', () => ({
  PageCanvas: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  PageTitle: ({ title }: { title: React.ReactNode }) => <header>{title}</header>,
  Section: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Card: ({ children, padded }: { children: React.ReactNode; padded?: boolean }) => <div data-card="true" data-padded={String(padded)}>{children}</div>,
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  TextButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button data-text-button="true" {...props}>{children}</button>,
  Notice: ({ children, tone, className }: { children: React.ReactNode; tone?: string; className?: string }) => <div data-notice-tone={tone} className={className}>{children}</div>,
  Empty: ({ text }: { text: string }) => <div>{text}</div>,
  AppCheckbox: ({ checked, children }: { checked?: boolean; children?: React.ReactNode }) => <div data-app-checkbox="true" data-checked={checked}>{children}</div>,
  AppInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input data-app-input="true" {...props} />,
  AppTextArea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea data-app-text-area="true" {...props} />,
  surfaceCardClassName: 'rounded-2xl border border-separator-thin bg-bg-elevated shadow-card',
  fmt: (value: unknown) => String(value ?? '—'),
  asNumber: (value: unknown, fallback = 0) => Number(value) || fallback,
}));

import RecallWorkbench from '../RecallWorkbench';

describe('RecallWorkbench foundation controls', () => {
  it('renders advanced controls through shared inputs instead of native select', () => {
    stateCall.count = 0;
    stateCall.debugError = '';
    stateCall.debugData = null;
    const html = renderToStaticMarkup(<RecallWorkbench />);

    expect((html.match(/data-app-input="true"/g) || []).length).toBe(6);
    expect(html).toContain('data-app-checkbox="true"');
    expect(html).toContain('data-app-text-area="true"');
    expect(html).toContain('data-text-button="true"');
    expect(html).not.toContain('<select');
  });

  it('renders debug errors through shared danger Notice', () => {
    stateCall.count = 0;
    stateCall.debugError = 'Debug request failed';
    stateCall.debugData = null;
    const html = renderToStaticMarkup(<RecallWorkbench />);
    stateCall.debugError = '';

    expect(html).toContain('data-notice-tone="danger"');
    expect(html).toContain('Debug request failed');
  });

  it('renders results through shared Card with preserved p-5 spacing', () => {
    stateCall.count = 0;
    stateCall.debugError = '';
    stateCall.debugData = { stages: [] };
    const html = renderToStaticMarkup(<RecallWorkbench />);
    stateCall.debugData = null;

    expect(html).toContain('data-card="true"');
    expect(html).toContain('data-padded="false"');
    expect(html).toContain('class="p-5"><div data-recall-stages="true"');
  });
});
