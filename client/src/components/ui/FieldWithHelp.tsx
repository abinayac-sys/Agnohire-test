import React, { useState } from 'react';
import { Info, X } from 'lucide-react';

interface FieldWithHelpProps {
  label: string;
  children: React.ReactNode;
  help?: {
    what: string;
    why: string;
    where: string;
    example?: string;
    commonMistakes?: string;
    learnMoreUrl?: string;
  };
}

export function FieldWithHelp({ label, children, help }: FieldWithHelpProps) {
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div className="relative">
      <div className="mb-1.5 flex items-center justify-between">
        <label className="block text-sm font-medium text-text-secondary">{label}</label>
        {help && (
          <button
            type="button"
            onClick={() => setShowHelp(!showHelp)}
            className="text-text-muted hover:text-accent focus:outline-none transition-colors"
            title="Help"
          >
            <Info className="h-4 w-4" />
          </button>
        )}
      </div>
      
      {children}

      {showHelp && help && (
        <div className="mt-2 rounded-lg border border-border bg-surface-alt p-4 text-sm text-text-secondary relative shadow-sm">
          <button
            type="button"
            onClick={() => setShowHelp(false)}
            className="absolute right-2 top-2 text-text-muted hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="space-y-3 pr-4">
            <div>
              <strong className="text-text-primary block mb-0.5">What is this?</strong>
              <p>{help.what}</p>
            </div>
            <div>
              <strong className="text-text-primary block mb-0.5">Why is it needed?</strong>
              <p>{help.why}</p>
            </div>
            <div>
              <strong className="text-text-primary block mb-0.5">Where to find it?</strong>
              <p>{help.where}</p>
            </div>
            {help.example && (
              <div>
                <strong className="text-text-primary block mb-0.5">Example:</strong>
                <code className="bg-surface px-1.5 py-0.5 rounded border border-border">{help.example}</code>
              </div>
            )}
            {help.commonMistakes && (
              <div>
                <strong className="text-text-primary block mb-0.5">Common Mistakes:</strong>
                <p>{help.commonMistakes}</p>
              </div>
            )}
            {help.learnMoreUrl && (
              <div>
                <a
                  href={help.learnMoreUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline font-medium"
                >
                  Learn More (Official Docs)
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
