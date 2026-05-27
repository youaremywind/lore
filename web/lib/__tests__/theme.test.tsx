import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider, useTheme } from '../theme';

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

function installBrowserState({ auroraStorageValue, themeAttribute = 'dark' }: { auroraStorageValue?: string; themeAttribute?: string } = {}): void {
  const store = new Map<string, string>();
  if (auroraStorageValue !== undefined) store.set('lore-aurora-background', auroraStorageValue);

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: vi.fn((key: string) => store.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => store.set(key, value)),
      },
    },
  });

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      documentElement: {
        getAttribute: vi.fn((key: string) => (key === 'data-theme' ? themeAttribute : null)),
        setAttribute: vi.fn(),
      },
    },
  });
}

function restoreBrowserState(): void {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
}

function ThemeProbe(): React.JSX.Element {
  const { auroraBackgroundEnabled, theme, toggleAuroraBackground } = useTheme();

  return (
    <span
      data-aurora-background-enabled={String(auroraBackgroundEnabled)}
      data-theme={theme}
      data-toggle-aurora-type={typeof toggleAuroraBackground}
    />
  );
}

describe('ThemeProvider aurora background preference', () => {
  afterEach(() => {
    restoreBrowserState();
  });

  it('defaults the aurora background preference to disabled', () => {
    installBrowserState();

    const html = renderToStaticMarkup(<ThemeProvider><ThemeProbe /></ThemeProvider>);

    expect(html).toContain('data-aurora-background-enabled="false"');
    expect(html).toContain('data-toggle-aurora-type="function"');
  });

  it('restores the aurora background preference from localStorage', () => {
    installBrowserState({ auroraStorageValue: '1' });

    const html = renderToStaticMarkup(<ThemeProvider><ThemeProbe /></ThemeProvider>);

    expect(html).toContain('data-aurora-background-enabled="true"');
  });
});
