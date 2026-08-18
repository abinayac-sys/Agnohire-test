import { useQuery } from '@tanstack/react-query';
import { FileText, Calendar, IndianRupee, Download, Clock, Briefcase } from 'lucide-react';
import { PageHeader } from '../../components/common/PageHeader.js';
import { Badge, type BadgeProps } from '../../components/ui/Badge.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { fetchMyOffers } from '../../services/candidatePortalApi.js';
import type { MyOfferItem } from '@agnohire/shared';

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  SENT: 'info',
  ACCEPTED: 'success',
  DECLINED: 'danger',
  EXPIRED: 'muted',
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

const fmtSalary = (n: number | null) =>
  n == null ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);

function formatTitleCase(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

export function MyOffersPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['my-offers'], queryFn: fetchMyOffers });

  return (
    <div>
      <PageHeader title="My Offers" description="Offers extended to you and their status." />

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : isError ? (
        <Empty title="Could not load your offers" hint="Please try again in a moment." />
      ) : !data || data.length === 0 ? (
        <Empty title="No offers yet" hint="If you receive an offer, it will appear here with all the details." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.map((o) => (
            <OfferCard key={o.id} offer={o} />
          ))}
        </div>
      )}
    </div>
  );
}

function OfferCard({ offer }: { offer: MyOfferItem }) {
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface-raised p-5 shadow-elev-1">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <Briefcase className="h-5 w-5" />
          </span>
          <div>
            <h3 className="font-heading text-sm font-semibold text-text-primary">{offer.jobTitle}</h3>
            <p className="text-xs text-text-muted">Offered {fmtDate(offer.sentAt)}</p>
          </div>
        </div>
        <Badge variant={STATUS_VARIANT[offer.status] ?? 'muted'}>{formatTitleCase(offer.status)}</Badge>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4">
        <Detail icon={IndianRupee} label="Salary" value={fmtSalary(offer.salaryOffered)} />
        <Detail icon={Calendar} label="Joining date" value={fmtDate(offer.joiningDate)} />
        <Detail icon={Clock} label="Valid until" value={fmtDate(offer.validUntil)} />
      </dl>

      {offer.offerLetterUrl && (
        <a
          href={offer.offerLetterUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:border-accent/40"
        >
          <Download className="h-4 w-4" /> Download offer letter
        </a>
      )}
    </div>
  );
}

function Detail({ icon: Icon, label, value }: { icon: typeof Calendar; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
      <div className="min-w-0">
        <dt className="text-[11px] uppercase tracking-wide text-text-muted">{label}</dt>
        <dd className="truncate text-sm font-medium text-text-primary">{value}</dd>
      </div>
    </div>
  );
}

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-raised px-6 py-16 text-center">
      <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface text-text-muted">
        <FileText className="h-7 w-7" />
      </span>
      <h3 className="font-heading text-base font-semibold text-text-primary">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-text-muted">{hint}</p>
    </div>
  );
}
