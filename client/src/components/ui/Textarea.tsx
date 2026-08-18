import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../utils/cn.js';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-text-primary',
        'placeholder:text-text-muted resize-y min-h-[100px]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
