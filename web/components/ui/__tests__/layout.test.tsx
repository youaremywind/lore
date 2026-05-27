import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@lobehub/ui/es/Block/index', () => ({
  default: ({ children, className, clickable, padding, onClick }: { children: React.ReactNode; className?: string; clickable?: boolean; padding?: number; onClick?: () => void }) => (
    <section data-lobe-block="true" data-clickable={clickable} data-has-on-click={String(Boolean(onClick))} data-padding={padding} className={className}>{children}</section>
  ),
}));

vi.mock('@lobehub/ui/awesome', () => ({
  AuroraBackground: ({ className, classNames, styles }: { className?: string; classNames?: { content?: string }; styles?: { content?: React.CSSProperties } }) => (
    <div
      className={className}
      data-aurora-background="true"
      data-content-class={classNames?.content}
      data-content-display={styles?.content?.display}
    />
  ),
}));

vi.mock('../controls', () => ({
  Spinner: ({ size }: { size?: string }) => <span data-spinner-size={size || 'md'} />,
  surfaceCardClassName: 'rounded-2xl border border-separator-thin bg-bg-elevated shadow-card',
}));

import { ActionPanel, AuroraBackdrop, Card, InlineMeta, LoadingBlock, PageCanvas, Section, surfaceCardClassName } from '../layout';

describe('ui layout Card', () => {
  it('renders through Lobe Block with default padding 16', () => {
    const html = renderToStaticMarkup(<Card>Content</Card>);

    expect(html).toContain('data-lobe-block="true"');
    expect(html).toContain('data-padding="16"');
    expect(html).toContain('border border-separator-thin');
    expect(html).toContain('Content');
  });

  it('renders with zero padding when padded is false', () => {
    const html = renderToStaticMarkup(<Card padded={false}>Content</Card>);

    expect(html).toContain('data-padding="0"');
    expect(html).not.toContain('data-padding="16"');
  });

  it('preserves interactive hover styling through clickable prop', () => {
    const html = renderToStaticMarkup(<Card interactive>Content</Card>);

    expect(html).toContain('data-clickable="true"');
    expect(html).toContain('hover:border-separator');
    expect(html).toContain('hover:bg-bg-raised');
  });

  it('uses the canonical surface class and supports selected cards', () => {
    const html = renderToStaticMarkup(<Card selected onClick={() => undefined}>Content</Card>);

    expect(surfaceCardClassName).toContain('bg-bg-elevated');
    expect(html).toContain('data-clickable="true"');
    expect(html).toContain('data-has-on-click="true"');
    expect(html).toContain('border-sys-blue/50');
  });

  it('renders ActionPanel with tone, header, compact, body, and footer affordances', () => {
    const html = renderToStaticMarkup(
      <ActionPanel tone="red" title="Danger" description="Delete path" right={<span>!</span>} footer="Footer" compact bodyClassName="grid gap-2">
        Body
      </ActionPanel>,
    );

    expect(html).toContain('border-sys-red/30');
    expect(html).toContain('p-4');
    expect(html).toContain('Danger');
    expect(html).toContain('Delete path');
    expect(html).toContain('grid gap-2');
    expect(html).toContain('Body');
    expect(html).toContain('Footer');
  });

  it('renders LoadingBlock with shared spinner, compact spacing, and extra content', () => {
    const html = renderToStaticMarkup(<LoadingBlock label="Loading" size="sm" compact>Details</LoadingBlock>);

    expect(html).toContain('data-spinner-size="sm"');
    expect(html).toContain('py-10');
    expect(html).toContain('Loading');
    expect(html).toContain('Details');
  });

  it('renders InlineMeta and Section helpers', () => {
    const meta = renderToStaticMarkup(<InlineMeta>core://agent</InlineMeta>);
    const section = renderToStaticMarkup(<Section title="Title" subtitle="Hint" right={<button>Act</button>} footer="Footer" compact bodyClassName="grid gap-3">Body</Section>);

    expect(meta).toContain('text-txt-tertiary');
    expect(section).toContain('Title');
    expect(section).toContain('Hint');
    expect(section).toContain('Body');
    expect(section).toContain('Act');
    expect(section).toContain('Footer');
    expect(section).toContain('grid gap-3');
    expect(section).toContain('text-[15px]');
  });

  it('keeps the mobile bottom nav clearance inside the scrollable page canvas', () => {
    const html = renderToStaticMarkup(<PageCanvas>Content</PageCanvas>);

    expect(html).toContain('overflow-y-auto');
    expect(html).toContain('pt-6');
    expect(html).toContain('pb-24');
    expect(html).toContain('md:py-14');
  });

  it('wraps the Lobe aurora background as a hidden backdrop primitive', () => {
    const html = renderToStaticMarkup(<AuroraBackdrop />);

    expect(html).toContain('data-aurora-background="true"');
    expect(html).toContain('absolute inset-0 h-full w-full');
    expect(html).toContain('data-content-class="hidden"');
    expect(html).toContain('data-content-display="none"');
  });
});
