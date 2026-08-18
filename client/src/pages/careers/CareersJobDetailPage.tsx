import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, MapPin, Paperclip, Briefcase } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Textarea } from '../../components/ui/Textarea.js';
import { Badge } from '../../components/ui/Badge.js';
import { Spinner } from '../../components/ui/Spinner.js';
import * as careersApi from '../../services/careersApi.js';
import { apiErrorMessage } from '../../services/api.js';

/** Renders AI-generated job description markdown using the app's own type
 *  scale/colors instead of react-markdown's unstyled default HTML tags. */
const descriptionMarkdownComponents = {
  h1: ({ children }: any) => <h3 className="mb-2 mt-4 font-heading text-base font-semibold text-text-primary first:mt-0">{children}</h3>,
  h2: ({ children }: any) => <h3 className="mb-2 mt-4 font-heading text-base font-semibold text-text-primary first:mt-0">{children}</h3>,
  h3: ({ children }: any) => <h4 className="mb-1.5 mt-3 font-heading text-sm font-semibold text-text-primary">{children}</h4>,
  p: ({ children }: any) => <p className="mb-3 text-sm leading-relaxed text-text-secondary last:mb-0">{children}</p>,
  ul: ({ children }: any) => <ul className="mb-3 list-disc space-y-1 pl-5 text-sm leading-relaxed text-text-secondary">{children}</ul>,
  ol: ({ children }: any) => <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-text-secondary">{children}</ol>,
  li: ({ children }: any) => <li>{children}</li>,
  strong: ({ children }: any) => <strong className="font-semibold text-text-primary">{children}</strong>,
  a: ({ children, href }: any) => <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline">{children}</a>,
};

export function CareersJobDetailPage() {
  const { tenantSlug = '', jobId = '' } = useParams<{ tenantSlug: string; jobId: string }>();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['public-careers-job', tenantSlug, jobId],
    queryFn: () => careersApi.fetchPublicJob(tenantSlug, jobId),
    enabled: !!tenantSlug && !!jobId,
  });

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [coverNote, setCoverNote] = useState('');
  const [fileName, setFileName] = useState('');
  const [formError, setFormError] = useState('');

  const apply = useMutation({
    mutationFn: () => {
      const resume = fileRef.current?.files?.[0];
      if (!resume) throw new Error('Please attach your resume');
      return careersApi.submitPublicApplication(tenantSlug, jobId, {
        fullName,
        email,
        phone: phone || undefined,
        coverNote: coverNote || undefined,
        resume,
      });
    },
    onError: (e) => setFormError(apiErrorMessage(e, 'Could not submit your application')),
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <Spinner size="lg" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-6 text-center">
        <p className="text-sm text-text-secondary">{apiErrorMessage(error, 'This job is no longer available.')}</p>
        <Link to={`/careers/${tenantSlug}`} className="text-sm font-medium text-accent hover:underline">
          ← Back to open roles
        </Link>
      </div>
    );
  }

  const { job, tenant } = data;

  return (
    <div className="min-h-screen bg-bg">
      {tenant.showHeader ? (
        <header className="border-b border-border bg-surface">
          <div className="mx-auto max-w-6xl px-6 py-8">
            <Link to={`/careers/${tenantSlug}`} className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary">
              <ArrowLeft className="h-4 w-4" /> {tenant.name}
            </Link>
            <h1 className="mt-3 font-heading text-2xl font-bold text-text-primary">{job.title}</h1>
            <div className="mt-2 flex flex-wrap gap-2">
              {job.location && <Badge variant="outline"><MapPin className="mr-1 h-3 w-3" />{job.location}</Badge>}
              {job.workMode && <Badge variant="outline">{job.workMode}</Badge>}
              <Badge variant="muted"><Briefcase className="mr-1 h-3 w-3" />{job.domain.name}</Badge>
            </div>
          </div>
        </header>
      ) : (
        <div className="mx-auto max-w-6xl px-6 pt-8">
          <Link to={`/careers/${tenantSlug}`} className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary">
            <ArrowLeft className="h-4 w-4" /> Back to open roles
          </Link>
          <h1 className="mt-3 font-heading text-2xl font-bold text-text-primary">{job.title}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            {job.location && <Badge variant="outline"><MapPin className="mr-1 h-3 w-3" />{job.location}</Badge>}
            {job.workMode && <Badge variant="outline">{job.workMode}</Badge>}
            <Badge variant="muted"><Briefcase className="mr-1 h-3 w-3" />{job.domain.name}</Badge>
          </div>
        </div>
      )}

      <main className="mx-auto grid max-w-6xl items-start gap-6 px-6 py-8 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-surface p-6 shadow-elev-1">
          <h2 className="mb-3 font-heading text-base font-semibold text-text-primary">About this role</h2>
          {(job.budgetMin != null || job.budgetMax != null) && (
            <p className="mb-3 text-sm font-medium text-text-primary">
              {job.budgetMin != null && job.budgetMax != null
                ? `${job.budgetMin.toLocaleString()} – ${job.budgetMax.toLocaleString()} per annum`
                : `${(job.budgetMin ?? job.budgetMax)!.toLocaleString()} per annum`}
            </p>
          )}
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={descriptionMarkdownComponents}>
            {job.description}
          </ReactMarkdown>
          {job.skills.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {job.skills.map((s) => <Badge key={s} variant="default">{s}</Badge>)}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border bg-surface p-6 shadow-elev-1">
          {apply.isSuccess ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <CheckCircle2 className="h-10 w-10 text-success" />
              <p className="font-heading text-lg font-semibold text-text-primary">Application submitted!</p>
              <p className="text-sm text-text-secondary">Thanks for applying to {job.title}. We'll be in touch if there's a match.</p>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                setFormError('');
                apply.mutate();
              }}
            >
              <h2 className="font-heading text-base font-semibold text-text-primary">Apply for this position</h2>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">Full name</label>
                <Input required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Doe" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">Email</label>
                <Input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">Phone (optional)</label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 000 0000" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">Resume</label>
                <input
                  ref={fileRef}
                  required
                  type="file"
                  accept=".pdf,.docx,.txt,.jpg,.jpeg,.png"
                  onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')}
                  className="block w-full text-sm text-text-secondary file:mr-3 file:rounded-md file:border-0 file:bg-surface-raised file:px-3 file:py-2 file:text-sm file:font-medium file:text-text-primary hover:file:bg-surface-overlay"
                />
                {fileName && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-text-muted"><Paperclip className="h-3 w-3" />{fileName}</p>
                )}
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">Cover note (optional)</label>
                <Textarea rows={4} value={coverNote} onChange={(e) => setCoverNote(e.target.value)} placeholder="Anything you'd like us to know…" />
              </div>
              {formError && <p className="text-sm text-danger">{formError}</p>}
              <Button type="submit" className="w-full" loading={apply.isPending}>Submit application</Button>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
