import { CODE_LANGUAGES, type CodeLanguage } from '@agnohire/shared';
import Editor from '@monaco-editor/react';

/**
 * Code editor using Monaco Editor for interactive skill simulations.
 */
export function CodeEditor({
  value,
  onChange,
  onBlur,
  language,
  onLanguageChange,
}: {
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  language?: CodeLanguage;
  onLanguageChange?: (lang: CodeLanguage) => void;
}) {
  return (
    <div className="flex flex-col h-full overflow-hidden rounded-lg border border-border bg-surface focus-within:ring-2 focus-within:ring-accent">
      {onLanguageChange && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-3 py-2">
          <label className="text-xs font-medium text-text-muted">Language</label>
          <select
            value={language ?? 'python'}
            onChange={(e) => onLanguageChange(e.target.value as CodeLanguage)}
            onBlur={onBlur}
            className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {CODE_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>
      )}
      <div className="flex-1 w-full min-h-[400px] sm:min-h-0" onBlur={onBlur}>
        <Editor
          height="100%"
          language={language ?? 'python'}
          value={value}
          onChange={(val) => onChange(val || '')}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            padding: { top: 16, bottom: 16 },
            scrollBeyondLastLine: false,
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  );
}
