import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, Calendar, GraduationCap, MapPin, Search } from 'lucide-react';
import { Input } from '../../components/ui/Input.js';
import { Badge } from '../../components/ui/Badge.js';
import { Spinner } from '../../components/ui/Spinner.js';
import * as careersApi from '../../services/careersApi.js';
import { apiErrorMessage } from '../../services/api.js';

const MAX_VISIBLE_SKILLS = 5;

function formatExperience(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) return `${min}–${max} yrs experience`;
  if (min != null) return `${min}+ yrs experience`;
  return `Up to ${max} yrs experience`;
}

function formatSalary(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) return `${min.toLocaleString()} – ${max.toLocaleString()} per annum`;
  return `${(min ?? max)!.toLocaleString()} per annum`;
}

function formatPostedDate(postedAt: string): string {
  return new Date(postedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Public, no-auth careers page — standalone shell (no Sidebar/Topbar), meant
 * to be visited directly or embedded via <iframe> on the tenant's own site.
 */
export function CareersListPage() {
  const { tenantSlug = '' } = useParams<{ tenantSlug: string }>();
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['public-careers-jobs', tenantSlug, search, location],
    queryFn: () => careersApi.fetchPublicJobs(tenantSlug, { search: search || undefined, location: location || undefined }),
    enabled: !!tenantSlug,
  });

  return (
    <div className="min-h-screen bg-bg">
      {data?.tenant.showHeader && (
        <header className="border-b border-border bg-surface">
          <div className="mx-auto max-w-5xl px-6 py-10">
            <h1 className="font-heading text-2xl font-bold text-text-primary sm:text-3xl">
              {data.tenant.name}
            </h1>
            <p className="mt-2 text-sm text-text-secondary">Explore our open roles and apply directly below.</p>
          </div>
        </header>
      )}

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <Input
              className="pl-9"
              placeholder="Search job title or keyword…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="relative sm:w-64">
            <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <Input
              className="pl-9"
              placeholder="Location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
        </div>

        {isLoading && (
          <div className="flex justify-center py-20">
            <Spinner size="lg" />
          </div>
        )}

        {isError && (
          <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-text-secondary">
            {apiErrorMessage(error, 'This careers page is not available right now.')}
          </div>
        )}

        {!isLoading && !isError && (data?.jobs.items.length ?? 0) === 0 && (
          <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-text-secondary">
            No open positions match your search right now — check back soon.
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {data?.jobs.items.map((job) => {
            const experience = formatExperience(job.experienceMin, job.experienceMax);
            const salary = formatSalary(job.budgetMin, job.budgetMax);
            const visibleSkills = job.skills.slice(0, MAX_VISIBLE_SKILLS);
            const extraSkills = job.skills.length - visibleSkills.length;

            return (
              <Link
                key={job.id}
                to={`/careers/${tenantSlug}/jobs/${job.id}`}
                className="rounded-xl border border-border bg-surface p-5 shadow-elev-1 transition-colors hover:border-accent/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-heading text-base font-semibold text-text-primary">{job.title}</h2>
                  <Briefcase className="h-4 w-4 shrink-0 text-text-muted" />
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  {job.location && <Badge variant="outline">{job.location}</Badge>}
                  {job.workMode && <Badge variant="outline">{job.workMode}</Badge>}
                </div>

                {visibleSkills.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {visibleSkills.map((skill) => (
                      <Badge key={skill} variant="muted">{skill}</Badge>
                    ))}
                    {extraSkills > 0 && <Badge variant="muted">+{extraSkills} more</Badge>}
                  </div>
                )}

                <div className="mt-3 space-y-1 text-sm text-text-secondary">
                  {experience && (
                    <p className="flex items-center gap-1.5"><GraduationCap className="h-3.5 w-3.5 text-text-muted" />{experience}</p>
                  )}
                  {salary && <p className="font-medium text-text-primary">{salary}</p>}
                </div>

                <p className="mt-3 flex items-center gap-1.5 text-xs text-text-muted">
                  <Calendar className="h-3 w-3" /> Posted {formatPostedDate(job.postedAt)}
                </p>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
