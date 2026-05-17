import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/memory',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@lobehub/ui', () => ({
  ConfigProvider: ({ children }: { children: React.ReactNode }) => <div data-lobe-config-provider="true">{children}</div>,
}));

vi.mock('@lobehub/ui/awesome', () => ({
  AuroraBackground: ({ children }: { children?: React.ReactNode }) => <div data-aurora-background="true">{children}</div>,
}));

vi.mock('@lobehub/ui/es/ThemeProvider/index', () => ({
  default: ({ appearance, children }: { appearance?: string; children: React.ReactNode }) => (
    <div data-lobe-theme-provider="true" data-appearance={appearance}>{children}</div>
  ),
}));

vi.mock('../TokenAuth', () => ({
  default: () => <div data-token-auth="true" />,
}));

vi.mock('../ConfirmDialog', () => ({
  ConfirmProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useConfirm: () => ({ confirm: vi.fn() }),
}));

vi.mock('../../lib/api', () => ({
  AUTH_ERROR_EVENT: 'auth-error',
  getDomains: vi.fn(() => new Promise(() => {})),
  getSetupFlowStatus: vi.fn(async () => ({ configured: true })),
}));

vi.mock('@/lib/bootSetup', () => ({
  SETUP_STATUS_CHANGED_EVENT: 'setup-status-changed',
  getSetupFlowDecision: () => ({ shouldPrompt: false }),
}));

vi.mock('../../lib/i18n', () => ({
  LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useT: () => ({ lang: 'zh', setLang: vi.fn(), t: (key: string) => key }),
}));

vi.mock('../../lib/theme', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}));

vi.mock('../ui', () => ({
  AppUIProvider: ({ children }: { children: React.ReactNode }) => <div data-app-ui-provider="true">{children}</div>,
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));

import { NavDock, navIndicatorClassName } from '../AppShell';
import { AppUIProvider } from '../ui';

describe('AppShell theme contrast', () => {
  it('passes the app theme through the self-owned UI provider bridge', () => {
    const html = renderToStaticMarkup(<AppUIProvider><div>content</div></AppUIProvider>);

    expect(html).toContain('data-app-ui-provider="true"');
  });

  it('uses a subtle fill background for active nav indicator', () => {
    expect(navIndicatorClassName).toContain('bg-fill-primary');
    expect(navIndicatorClassName).toContain('shadow-none');
  });

  it('renders the responsive nav dock with the final mobile behavior', () => {
    const html = renderToStaticMarkup(<NavDock />);

    expect(html).toContain('bottom-3');
    expect(html).toContain('md:bottom-auto');
    expect(html).toContain('md:top-4');
    expect(html).not.toContain('Enable Aurora Background');
    expect(html).not.toContain('Disable Aurora Background');
    expect(html).toContain('bg-[var(--dock-bg-mobile)]');
    expect(html).toContain('md:bg-[var(--dock-bg)]');
    expect(html).not.toContain('bg-bg-elevated/80');
    expect(html).toContain('w-[min(calc(100vw-8px),24rem)] md:w-auto md:max-w-[calc(100vw-16px)]');
    expect(html).toContain('relative flex w-full items-center');
    expect(html).not.toContain('justify-between');
    expect(html).toContain('relative min-w-0 flex-1 overflow-hidden md:flex-none');
    expect(html).toContain('grid w-full grid-cols-5 items-center gap-0 overflow-hidden md:flex md:w-auto md:gap-0.5 md:overflow-x-auto');
    expect(html).toContain('min-w-0 truncate rounded-full px-1 py-2.5 text-center text-[12.5px]');
    expect(html).not.toContain('bg-[linear-gradient(to_left,var(--dock-bg-mobile),transparent)]');
    expect(html).toContain('pl-1.5 md:pl-2.5 pr-1.5 md:pr-2 py-2.5 md:py-2');
    expect(html).toContain('md:shrink-0 md:px-3.5 md:py-2 md:text-[13.5px]');
    expect(html).toContain('h-9 w-9 md:h-8 md:w-8');
    expect(html).toContain('hidden md:flex items-center gap-2');
  });
});
