'use client';

import React, { type ReactNode } from 'react';
import clsx from 'clsx';
import { AuroraBackground } from '@lobehub/ui/awesome';
import LobeBlock from '@lobehub/ui/es/Block/index';
import LobeModal from '@lobehub/ui/es/Modal/index';
import { Spinner, surfaceCardClassName } from './controls';

export { surfaceCardClassName };

export type MaxWidth = '3xl' | '4xl' | '5xl' | '6xl' | '7xl' | 'full';

interface PageCanvasProps {
  children: ReactNode;
  maxWidth?: MaxWidth;
  className?: string;
  size?: MaxWidth;
}

export function PageCanvas({ children, maxWidth, size, className }: PageCanvasProps): React.JSX.Element {
  const mw = maxWidth ?? size ?? '5xl';
  return (
    <div className="h-full w-full overflow-y-auto">
      <div className={clsx('mx-auto w-full px-4 pt-6 pb-24 md:px-10 md:py-14', {
        'max-w-3xl': mw === '3xl',
        'max-w-4xl': mw === '4xl',
        'max-w-5xl': mw === '5xl',
        'max-w-6xl': mw === '6xl',
        'max-w-7xl': mw === '7xl',
        'max-w-full': mw === 'full',
      }, className)}>
        {children}
      </div>
    </div>
  );
}

interface PageTitleProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  right?: ReactNode;
  titleText?: string;
  truncateTitle?: boolean;
  compact?: boolean;
}

export function PageTitle({ eyebrow, title, description, right, titleText, truncateTitle = false, compact = false }: PageTitleProps): React.JSX.Element {
  const resolvedTitleText = titleText ?? (typeof title === 'string' || typeof title === 'number' ? String(title) : undefined);
  return (
    <div className="mb-6 md:mb-10 flex flex-col md:flex-row md:items-end justify-between gap-4 md:gap-6 animate-in">
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <div className="mb-1.5 md:mb-2 text-[11px] md:text-[12px] font-medium uppercase tracking-[0.08em] text-sys-blue">
            {eyebrow}
          </div>
        )}
        <h1
          className={clsx(
            compact
              ? 'font-display text-[26px] sm:text-[30px] md:text-[34px] font-semibold leading-[1.16] tracking-[-0.02em] text-txt-primary min-w-0'
              : 'font-display text-[26px] sm:text-[32px] md:text-[42px] font-bold leading-[1.1] tracking-[-0.02em] text-txt-primary min-w-0',
            truncateTitle && 'overflow-hidden whitespace-nowrap text-ellipsis',
          )}
          title={truncateTitle ? resolvedTitleText : undefined}
        >
          {title}
        </h1>
        {description && (
          <p className="mt-2 md:mt-3 text-[14px] md:text-[17px] leading-relaxed text-txt-secondary max-w-2xl">
            {description}
          </p>
        )}
      </div>
      {right && <div className="flex items-center gap-2 shrink-0 flex-wrap">{right}</div>}
    </div>
  );
}

type SurfaceTone = 'default' | 'blue' | 'green' | 'orange' | 'red';

const SURFACE_TONE_CLASSNAMES: Record<SurfaceTone, string> = {
  default: '',
  blue: 'border-sys-blue/40 bg-sys-blue/[0.04]',
  green: 'border-sys-green/30 bg-sys-green/[0.04]',
  orange: 'border-sys-orange/30 bg-sys-orange/[0.04]',
  red: 'border-sys-red/30 bg-sys-red/[0.04]',
};

interface CardProps {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  interactive?: boolean;
  selected?: boolean;
  tone?: SurfaceTone;
  onClick?: () => void;
}

export function Card({ children, className, padded = true, interactive = false, selected = false, tone = 'default', onClick }: CardProps): React.JSX.Element {
  const clickable = interactive || Boolean(onClick);
  return (
    <LobeBlock
      className={clsx(
        surfaceCardClassName,
        clickable && 'transition-all duration-200 ease-spring hover:border-separator hover:bg-bg-raised',
        selected && 'border-sys-blue/50 bg-sys-blue/[0.04]',
        SURFACE_TONE_CLASSNAMES[tone],
        className,
      )}
      clickable={clickable}
      onClick={onClick}
      padding={padded ? 16 : 0}
    >
      {children}
    </LobeBlock>
  );
}

interface ActionPanelProps {
  children?: ReactNode;
  tone?: Exclude<SurfaceTone, 'default'>;
  title?: ReactNode;
  description?: ReactNode;
  right?: ReactNode;
  footer?: ReactNode;
  compact?: boolean;
  className?: string;
  bodyClassName?: string;
}

export function ActionPanel({ children, tone = 'blue', title, description, right, footer, compact = false, className, bodyClassName }: ActionPanelProps): React.JSX.Element {
  const hasHeader = title !== undefined || description !== undefined || right !== undefined;
  return (
    <div className={clsx('rounded-2xl border', compact ? 'space-y-3 p-4' : 'space-y-4 p-5', SURFACE_TONE_CLASSNAMES[tone], className)}>
      {hasHeader ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? <div className="text-[14px] font-semibold text-txt-primary">{title}</div> : null}
            {description ? <div className="mt-0.5 text-[12px] leading-relaxed text-txt-secondary">{description}</div> : null}
          </div>
          {right ? <div className="shrink-0">{right}</div> : null}
        </div>
      ) : null}
      {children !== undefined ? (bodyClassName ? <div className={bodyClassName}>{children}</div> : children) : null}
      {footer ? <div className="border-t border-separator-thin pt-3 text-[12px] text-txt-tertiary">{footer}</div> : null}
    </div>
  );
}

interface LoadingBlockProps {
  className?: string;
  label?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  compact?: boolean;
  children?: ReactNode;
}

export function LoadingBlock({ className, label, size = 'md', compact = false, children }: LoadingBlockProps): React.JSX.Element {
  return (
    <div className={clsx('flex flex-col items-center justify-center gap-3 text-[13px] text-txt-tertiary', compact ? 'py-10' : 'py-20', className)}>
      <Spinner size={size} />
      {label ? <div>{label}</div> : null}
      {children}
    </div>
  );
}

export function AuroraBackdrop(): React.JSX.Element {
  return (
    <AuroraBackground
      className="absolute inset-0 h-full w-full"
      classNames={{ content: 'hidden' }}
      styles={{ content: { display: 'none' } }}
    />
  );
}

interface InlineMetaProps {
  children: ReactNode;
  className?: string;
}

interface ModalProps {
  open: boolean;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onCancel?: () => void;
  dismissible?: boolean;
  width?: number;
}

export function Modal({ open, title, children, footer, onCancel, dismissible = true, width = 400 }: ModalProps): React.JSX.Element {
  return (
    <LobeModal
      centered
      className="rounded-2xl border border-separator-thin bg-bg-elevated shadow-xl"
      closable={dismissible}
      footer={footer}
      keyboard={dismissible}
      mask={{ closable: dismissible }}
      onCancel={onCancel}
      open={open}
      title={title}
      width={width}
    >
      {children}
    </LobeModal>
  );
}

export function InlineMeta({ children, className }: InlineMetaProps): React.JSX.Element {
  return <div className={clsx('text-[12px] text-txt-tertiary', className)}>{children}</div>;
}

interface SectionProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  padded?: boolean;
  compact?: boolean;
}

export function Section({ title, subtitle, right, footer, children, className, bodyClassName, padded = true, compact = false }: SectionProps): React.JSX.Element {
  const hasHeader = title !== undefined || right !== undefined;
  return (
    <section className={clsx(surfaceCardClassName, 'overflow-hidden', className)}>
      {hasHeader && (
        <header className={clsx('flex items-end justify-between gap-3 border-b border-separator-thin', compact ? 'px-4 py-3' : 'px-4 pb-3 pt-4 md:px-6 md:pb-4 md:pt-5 md:gap-4')}>
          <div className="min-w-0">
            {title && <h2 className={clsx('font-semibold tracking-tight text-txt-primary', compact ? 'text-[15px]' : 'text-[17px] md:text-[19px]')}>{title}</h2>}
            {subtitle && <p className={clsx('mt-0.5 text-txt-secondary', compact ? 'text-[12px]' : 'text-[12px] md:text-[13px]')}>{subtitle}</p>}
          </div>
          {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
        </header>
      )}
      {children !== undefined && <div className={clsx(padded && (compact ? 'px-4 py-3' : 'px-4 py-4 md:px-6 md:py-5'), bodyClassName)}>{children}</div>}
      {footer ? <footer className={clsx('border-t border-separator-thin text-[12px] text-txt-tertiary', compact ? 'px-4 py-3' : 'px-4 py-3 md:px-6')}>{footer}</footer> : null}
    </section>
  );
}
