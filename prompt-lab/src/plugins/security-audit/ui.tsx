/**
 * Security Audit — UI primitives
 *
 * 轻量版 AntD 兼容组件，只为 security-audit 用。
 * Toast 事件名 = 'security-audit:toast'，避免和 work-browser:toast 冲突。
 */
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Info, LoaderCircle, Search as SearchIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type CommonProps = React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode };

export function Button({ type = 'default', size = 'middle', block, loading, icon, className, children, ...props }: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & { type?: 'default' | 'primary' | 'text' | 'link'; size?: 'small' | 'middle' | 'large'; block?: boolean; loading?: boolean; icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:pointer-events-none disabled:opacity-50',
        type === 'primary' && 'border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover',
        type === 'default' && 'border-border bg-card text-foreground hover:border-primary/30 hover:bg-accent',
        type === 'text' && 'border-transparent bg-transparent hover:bg-accent',
        type === 'link' && 'border-transparent bg-transparent p-0 text-primary hover:underline',
        size === 'small' ? 'h-7 px-2 text-xs' : size === 'large' ? 'h-11 px-4 text-sm' : 'h-9 px-3 text-sm',
        block && 'w-full',
        className,
      )}
    >
      {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Space({ direction = 'horizontal', size = 'small', wrap, className, children, ...props }: CommonProps & { direction?: 'horizontal' | 'vertical'; size?: 'small' | 'middle' | 'large' | number; wrap?: boolean }) {
  const gap = typeof size === 'number' ? undefined : size === 'large' ? 'gap-4' : size === 'middle' ? 'gap-3' : 'gap-2';
  return (
    <div
      {...(props as React.HTMLAttributes<HTMLDivElement>)}
      style={{ ...(props as React.HTMLAttributes<HTMLDivElement>).style, gap: typeof size === 'number' ? size : undefined }}
      className={cn('flex', direction === 'vertical' ? 'flex-col' : 'items-center', wrap && 'flex-wrap', gap, className)}
    >
      {children}
    </div>
  );
}

export function Tag({ color, children, className, icon, ...props }: CommonProps & { color?: 'red' | 'green' | 'blue' | 'orange' | 'purple' | string; icon?: React.ReactNode }) {
  return (
    <span
      {...(props as React.HTMLAttributes<HTMLSpanElement>)}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground',
        color === 'red' && 'border-red-200 bg-red-50 text-red-700',
        color === 'green' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
        color === 'blue' && 'border-blue-200 bg-blue-50 text-blue-700',
        color === 'orange' && 'border-amber-200 bg-amber-50 text-amber-700',
        color === 'purple' && 'border-violet-200 bg-violet-50 text-violet-700',
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export function Empty({ description = '暂无内容', className, style }: { description?: React.ReactNode; image?: unknown; className?: string; style?: React.CSSProperties }) {
  return (
    <div style={style} className={cn('flex min-h-36 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground', className)}>
      <div className="grid h-14 w-14 place-items-center rounded-2xl border border-dashed border-border bg-muted/60">
        <SearchIcon size={22} className="opacity-35" />
      </div>
      <span>{description}</span>
    </div>
  );
}

export function Spin({ tip, className, style }: { tip?: React.ReactNode; size?: string; className?: string; style?: React.CSSProperties }) {
  return (
    <div style={style} className={cn('flex items-center justify-center gap-2 text-sm text-muted-foreground', className)}>
      <LoaderCircle className="h-4 w-4 animate-spin" />
      {tip}
    </div>
  );
}

export function Progress({ percent = 0 }: { percent?: number; size?: string; showInfo?: boolean; status?: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </div>
  );
}

export function Modal({ open, onCancel, onOk, title, children, okText = '确定', cancelText = '取消', confirmLoading, width = 520, footer }: { open?: boolean; onCancel?: () => void; onOk?: () => void; title?: React.ReactNode; children?: React.ReactNode; okText?: string; cancelText?: string; confirmLoading?: boolean; width?: number; footer?: React.ReactNode | null; destroyOnClose?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1300] grid place-items-center bg-black/30 p-4 backdrop-blur-sm" onMouseDown={onCancel}>
      <section style={{ width }} className="max-h-[90vh] max-w-full overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex h-14 items-center justify-between border-b border-border px-5 font-semibold">
          {title}
          <Button type="text" size="small" icon={<X size={16} />} onClick={onCancel} />
        </header>
        <div className="max-h-[calc(90vh-7rem)] overflow-auto p-5">{children}</div>
        {footer !== null && (
          <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">
            {footer ?? (
              <>
                <Button onClick={onCancel}>{cancelText}</Button>
                <Button type="primary" loading={confirmLoading} onClick={onOk}>
                  {okText}
                </Button>
              </>
            )}
          </footer>
        )}
      </section>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, width = 480, extra }: { open?: boolean; onClose?: () => void; title?: React.ReactNode; children?: React.ReactNode; width?: number | string; extra?: React.ReactNode; destroyOnClose?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1200] bg-black/20 backdrop-blur-[1px]" onMouseDown={onClose}>
      <aside style={{ width }} className="absolute inset-y-0 right-0 flex max-w-[92vw] flex-col border-l border-border bg-card shadow-2xl animate-slide-in-right" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5 font-semibold">
          {title}
          <div className="flex items-center gap-2">
            {extra}
            <Button type="text" size="small" icon={<X size={16} />} onClick={onClose} />
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
      </aside>
    </div>
  );
}

export function Card({ title, extra, children, className, style, onClick }: Omit<CommonProps, 'title' | 'onClick'> & { title?: React.ReactNode; extra?: React.ReactNode; hoverable?: boolean; size?: string; bodyStyle?: React.CSSProperties; onClick?: () => void }) {
  return (
    <section
      style={style}
      onClick={onClick}
      className={cn('rounded-xl border border-border bg-card p-3 shadow-sm', onClick && 'cursor-pointer transition hover:-translate-y-px hover:border-primary/25 hover:shadow-md', className)}
    >
      {(title || extra) && <header className="mb-3 flex items-center justify-between gap-2 font-semibold">{title}<span>{extra}</span></header>}
      {children}
    </section>
  );
}

export function Select({ value, defaultValue, onChange, options = [], className, style }: { value?: string | string[]; defaultValue?: string; onChange?: (value: any) => void; options?: Array<{ label: React.ReactNode; value: string }>; mode?: 'multiple'; size?: string; className?: string; style?: React.CSSProperties }) {
  return (
    <div className="relative">
      <select
        multiple={Array.isArray(value)}
        value={value ?? defaultValue}
        onChange={(e) => onChange?.(e.target.multiple ? Array.from(e.target.selectedOptions).map((o) => o.value) : e.target.value)}
        style={style}
        className={cn('h-9 appearance-none rounded-lg border border-input bg-card px-3 pr-8 text-sm outline-none focus:border-primary/40', className)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {String(o.label)}
          </option>
        ))}
      </select>
      <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

export function Alert({ type = 'info', message, description, className, style }: { type?: 'info' | 'error' | 'warning' | 'success'; message?: React.ReactNode; description?: React.ReactNode; showIcon?: boolean; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      style={style}
      className={cn(
        'flex gap-2 rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2 text-sm text-blue-900',
        type === 'error' && 'border-red-200 bg-red-50 text-red-800',
        type === 'warning' && 'border-amber-200 bg-amber-50 text-amber-900',
        type === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
        className,
      )}
    >
      <Info size={15} className="mt-0.5 shrink-0" />
      <div>
        <div className="font-medium">{message}</div>
        {description && <div className="mt-1 text-xs opacity-80">{description}</div>}
      </div>
    </div>
  );
}

// ── Toast（security-audit 命名空间，独立于 work-browser） ──

const notify = (kind: string, text: React.ReactNode) => window.dispatchEvent(new CustomEvent('security-audit:toast', { detail: { kind, text: String(text) } }));

export const message = {
  success: (text: React.ReactNode) => notify('success', text),
  error: (text: React.ReactNode) => notify('error', text),
  warning: (text: React.ReactNode) => notify('warning', text),
  info: (text: React.ReactNode) => notify('info', text),
};

export function ToastHost() {
  const [toasts, setToasts] = useState<Array<{ id: number; kind: string; text: string }>>([]);
  const nextToastId = useRef(0);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ kind: string; text: string }>).detail;
      const id = ++nextToastId.current;
      setToasts((v) => [...v, { id, ...detail }]);
      window.setTimeout(() => setToasts((v) => v.filter((t) => t.id !== id)), 2800);
    };
    window.addEventListener('security-audit:toast', handler);
    return () => window.removeEventListener('security-audit:toast', handler);
  }, []);
  return (
    <div className="fixed right-5 top-5 z-[2000] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn('rounded-xl border bg-card px-4 py-3 text-sm shadow-xl', t.kind === 'error' && 'border-red-200 text-red-700', t.kind === 'success' && 'border-emerald-200 text-emerald-700')}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

export const Layout = ({ children, className, style }: CommonProps) => (
  <div className={cn('flex min-h-0', className)} style={style}>
    {children}
  </div>
);
Layout.Sider = ({ children, width, className, style }: CommonProps & { width?: number }) => <aside className={className} style={{ width, ...style }}>{children}</aside>;
Layout.Content = ({ children, className, style }: CommonProps) => <main className={className} style={style}>{children}</main>;
