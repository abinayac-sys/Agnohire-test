import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-1 h-8 w-1.5 shrink-0 rounded-full bg-gradient-to-b from-accent to-info"
        />
        <div>
          <h1 className="font-heading text-xl font-bold text-text-primary sm:text-2xl">{title}</h1>
          {description && <p className="mt-1 text-sm text-text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
