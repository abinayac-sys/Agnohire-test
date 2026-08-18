import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn.js';

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function TagInput({
  value,
  onChange,
  placeholder = 'Type and press Enter…',
  className,
  disabled,
}: TagInputProps) {
  const [input, setInput] = useState('');

  function commit() {
    const tag = input.trim();
    if (tag && !value.includes(tag)) {
      onChange([...value, tag]);
    }
    setInput('');
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !input && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div
      className={cn(
        'flex min-h-10 w-full flex-wrap gap-1.5 rounded-md border border-border bg-surface px-3 py-2',
        'focus-within:ring-2 focus-within:ring-accent',
        disabled && 'opacity-50 pointer-events-none',
        className,
      )}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-accent"
        >
          {tag}
          <button
            type="button"
            onClick={() => onChange(value.filter((t) => t !== tag))}
            className="ml-0.5 hover:text-danger transition-colors"
            aria-label={`Remove ${tag}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKey}
        onBlur={commit}
        placeholder={value.length === 0 ? placeholder : ''}
        disabled={disabled}
        className="min-w-24 flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
      />
    </div>
  );
}
