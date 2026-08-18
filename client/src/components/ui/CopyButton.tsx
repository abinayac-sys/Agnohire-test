import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, type ButtonProps } from './Button.js';
import { cn } from '../../utils/cn.js';

interface CopyButtonProps extends Omit<ButtonProps, 'onClick' | 'children'> {
  /** Text copied to the clipboard when clicked. */
  value: string;
  /** Toast message shown on success. */
  label?: string;
}

/** Small "copy to clipboard" button — consolidates the pattern repeated inline across the app. */
export function CopyButton({ value, label = 'Copied to clipboard', className, variant = 'outline', size = 'sm', ...props }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn(className)}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        toast.success(label);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      {...props}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}
