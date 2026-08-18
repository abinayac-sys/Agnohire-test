import { Search, X } from 'lucide-react';
import { Input } from '../../../components/ui/Input.js';
import { Select } from '../../../components/ui/Select.js';
import { Button } from '../../../components/ui/Button.js';
import type { CandidateFilters } from '@agnohire/shared';
import type { DomainRef, SectorRef } from '../../../services/referenceApi.js';
import { DateRangeFilter } from '../../../components/common/DateRangeFilter.js';

interface Props {
  filters: Partial<CandidateFilters>;
  onChange: (next: Partial<CandidateFilters>) => void;
  sectors: SectorRef[];
  domains: DomainRef[];
  jobs?: { id: string; title: string }[];
}

const EXPERIENCE_OPTIONS = [
  { value: 'ENTRY', label: 'Entry' },
  { value: 'JUNIOR', label: 'Junior' },
  { value: 'MID', label: 'Mid' },
  { value: 'SENIOR', label: 'Senior' },
  { value: 'LEAD', label: 'Lead' },
  { value: 'PRINCIPAL', label: 'Principal' },
];

const SOURCE_OPTIONS = [
  { value: 'DIRECT', label: 'Direct' },
  { value: 'REFERRAL', label: 'Referral' },
  { value: 'LINKEDIN', label: 'LinkedIn' },
  { value: 'JOB_BOARD', label: 'Job Board' },
  { value: 'AGENCY', label: 'Agency' },
  { value: 'CAREER_SITE', label: 'Career Site' },
  { value: 'OTHER', label: 'Other' },
];

const RESUME_OPTIONS = [
  { value: 'true', label: 'Has resume' },
  { value: 'false', label: 'No resume' },
];

export function CandidateFiltersBar({ filters, onChange, jobs }: Props) {
  const hasFilters =
    filters.search ||
    filters.sectorId ||
    filters.domainId ||
    filters.jobRequisitionId ||
    filters.source ||
    filters.experienceLevel ||
    filters.hasResume !== undefined;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-52 flex-1">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
        <Input
          className="pl-9"
          placeholder="Search by name, email, or role…"
          value={filters.search ?? ''}
          onChange={(e) => onChange({ ...filters, search: e.target.value || undefined, page: 1 })}
        />
      </div>

      <DateRangeFilter
        from={filters.from}
        to={filters.to}
        onChange={(from, to) => onChange({ ...filters, from, to, page: 1 })}
      />

      <Select
        className="w-40"
        options={EXPERIENCE_OPTIONS}
        placeholder="Experience"
        value={filters.experienceLevel ?? ''}
        onChange={(e) =>
          onChange({
            ...filters,
            experienceLevel: (e.target.value as CandidateFilters['experienceLevel']) || undefined,
            page: 1,
          })
        }
      />

      <Select
        className="w-40"
        options={SOURCE_OPTIONS}
        placeholder="All sources"
        value={filters.source ?? ''}
        onChange={(e) =>
          onChange({
            ...filters,
            source: (e.target.value as CandidateFilters['source']) || undefined,
            page: 1,
          })
        }
      />



      {jobs && jobs.length > 0 && (
        <Select
          className="w-48"
          options={jobs.map((j) => ({ value: j.id, label: j.title }))}
          placeholder="All Jobs"
          value={filters.jobRequisitionId ?? ''}
          onChange={(e) => onChange({ ...filters, jobRequisitionId: e.target.value || undefined, page: 1 })}
        />
      )}

      <Select
        className="w-36"
        options={RESUME_OPTIONS}
        placeholder="Resume"
        value={filters.hasResume === undefined ? '' : String(filters.hasResume)}
        onChange={(e) =>
          onChange({
            ...filters,
            hasResume: e.target.value === '' ? undefined : e.target.value === 'true',
            page: 1,
          })
        }
      />

      {hasFilters && (
        <Button
          variant="danger"
          size="sm"
          onClick={() =>
            onChange({ page: 1, limit: filters.limit, sortBy: filters.sortBy, sortOrder: filters.sortOrder })
          }
        >
          <X className="h-3.5 w-3.5" />
          Clear
        </Button>
      )}
    </div>
  );
}
