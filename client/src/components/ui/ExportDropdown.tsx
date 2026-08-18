import { useState, useRef, useEffect } from 'react';
import { Download, FileText, ChevronDown } from 'lucide-react';
import { Button } from './Button.js';

interface ExportDropdownProps {
  onExportCsv?: () => void;
  onExportPdf?: () => void;
  loadingCsv?: boolean;
  loadingPdf?: boolean;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

export function ExportDropdown({
  onExportCsv,
  onExportPdf,
  loadingCsv = false,
  loadingPdf = false,
  variant = 'outline',
  size = 'md',
}: ExportDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isLoading = loadingCsv || loadingPdf;

  return (
    <div className="relative inline-block" ref={containerRef}>
      <Button
        variant={variant}
        size={size}
        onClick={() => setIsOpen(!isOpen)}
        loading={isLoading}
      >
        <Download className="h-4 w-4" />
        Export
        <ChevronDown className="h-4 w-4 opacity-50" />
      </Button>

      {isOpen && !isLoading && (
        <div className="absolute right-0 top-full z-50 mt-1 flex min-w-[140px] flex-col overflow-hidden rounded-md border border-border bg-surface shadow-lg">
          {onExportCsv && (
            <button
              onClick={() => {
                setIsOpen(false);
                onExportCsv();
              }}
              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-text-primary hover:bg-surface-overlay"
            >
              <Download className="h-4 w-4 text-text-muted" />
              CSV
            </button>
          )}
          {onExportPdf && (
            <button
              onClick={() => {
                setIsOpen(false);
                onExportPdf();
              }}
              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-text-primary hover:bg-surface-overlay"
            >
              <FileText className="h-4 w-4 text-text-muted" />
              PDF
            </button>
          )}
        </div>
      )}
    </div>
  );
}
