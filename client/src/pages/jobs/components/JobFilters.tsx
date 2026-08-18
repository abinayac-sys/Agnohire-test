import { Search, X } from 'lucide-react';
import { Input } from '../../../components/ui/Input.js';
import { Select } from '../../../components/ui/Select.js';
import { Button } from '../../../components/ui/Button.js';
import type { JobFilters } from '@agnohire/shared';
import type { DomainRef, SectorRef } from '../../../services/referenceApi.js';

interface JobFiltersProps {
  filters: Partial<JobFilters>;
  onChange: (next: Partial<JobFilters>) => void;
  sectors: SectorRef[];
  domains: DomainRef[];
}

const STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING_APPROVAL', label: 'Pending Approval' },
  { value: 'OPEN', label: 'Open' },
  { value: 'CLOSED', label: 'Closed' },
];

const WORK_MODE_OPTIONS = [
  { value: 'ONSITE', label: 'On-site' },
  { value: 'REMOTE', label: 'Remote' },
  { value: 'HYBRID', label: 'Hybrid' },
];

export function JobFiltersBar({ filters, onChange, sectors, domains }: JobFiltersProps) {
  const hasFilters =
    filters.search || filters.status || filters.domainId || filters.sectorId || filters.workMode;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Search */}
      <div className="relative min-w-52 flex-1">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
        <Input
          className="pl-9"
          placeholder="Search by title or location…"
          value={filters.search ?? ''}
          onChange={(e) => onChange({ ...filters, search: e.target.value || undefined, page: 1 })}
        />
      </div>

      {/* Status */}
      <Select
        className="w-44"
        options={STATUS_OPTIONS}
        placeholder="All statuses"
        value={filters.status ?? ''}
        onChange={(e) =>
          onChange({
            ...filters,
            status: (e.target.value as JobFilters['status']) || undefined,
            page: 1,
          })
        }
      />

      {/* Sector */}
      {sectors.length > 0 && (
        <Select
          className="w-40"
          options={sectors.map((s) => ({ value: s.id, label: s.name }))}
          placeholder="All sectors"
          value={filters.sectorId ?? ''}
          onChange={(e) =>
            onChange({
              ...filters,
              sectorId: e.target.value || undefined,
              domainId: undefined,
              page: 1,
            })
          }
        />
      )}

      {/* Domain */}
      <Select
        className="w-40"
        options={domains.map((d) => ({ value: d.id, label: d.name }))}
        placeholder="All domains"
        value={filters.domainId ?? ''}
        onChange={(e) =>
          onChange({ ...filters, domainId: e.target.value || undefined, page: 1 })
        }
      />

      {/* Work mode */}
      <Select
        className="w-36"
        options={WORK_MODE_OPTIONS}
        placeholder="Work mode"
        value={filters.workMode ?? ''}
        onChange={(e) =>
          onChange({
            ...filters,
            workMode: (e.target.value as JobFilters['workMode']) || undefined,
            page: 1,
          })
        }
      />

      {/* Clear */}
      {hasFilters && (
        <Button
          variant="danger"
          size="sm"
          onClick={() => onChange({ page: 1, limit: filters.limit, sortBy: filters.sortBy, sortOrder: filters.sortOrder })}
        >
          <X className="h-3.5 w-3.5" />
          Clear
        </Button>
      )}
    </div>
  );
}
