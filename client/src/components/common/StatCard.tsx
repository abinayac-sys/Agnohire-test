import type { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  trend?: string;
}

export function StatCard({ label, value, icon: Icon, trend }: StatCardProps) {
  return (
    <div className="card-interactive p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</p>
          <p
            className="mt-2 text-3xl font-bold tracking-tight text-text-primary"
            style={{ fontFamily: 'var(--app-font-family)' }}
          >
            {value}
          </p>
        </div>
        {Icon && (
          <span className="icon-chip h-11 w-11 shrink-0">
            <Icon className="h-5 w-5" />
          </span>
        )}
      </div>
      {trend && <p className="mt-3 text-xs font-medium text-text-secondary">{trend}</p>}
    </div>
  );
}
