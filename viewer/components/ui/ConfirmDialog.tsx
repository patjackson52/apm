"use client";
import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import s from './ConfirmDialog.module.css';

/**
 * Confirmation modal on Radix Dialog — focus trap, Escape/outside-dismiss, focus restore,
 * and ARIA come from the primitive; we only token-style it. Controlled via `open`. The
 * confirm button reflects pending state and surfaces an error inline without closing.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Confirm',
  danger = false,
  pending = false,
  error,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.content} aria-describedby={undefined}>
          <Dialog.Title className={s.title}>{title}</Dialog.Title>
          {children ? <div className={s.body}>{children}</div> : null}
          {error ? <p className={s.err} role="alert">{error}</p> : null}
          <div className={s.row}>
            <Dialog.Close asChild>
              <button type="button" className={s.btn} disabled={pending}>Cancel</button>
            </Dialog.Close>
            <button
              type="button"
              className={`${s.btn} ${danger ? s.danger : s.confirm}`}
              disabled={pending}
              onClick={onConfirm}
            >
              {pending ? '…' : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
