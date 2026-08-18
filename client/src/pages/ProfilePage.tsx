import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Mail,
  Phone,
  Shield,
  Globe,
  Layers,
  Building2,
  Briefcase,
  MapPin,
  User2,
  Users,
  Cake,
  KeyRound,
  Hash,
  Copy,
  Check,
  CalendarDays,
  Clock,
  CircleDot,
  Camera,
  Trash2,
  Pencil,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { ROLES, type UpdateProfileInput } from '@agnohire/shared';
import { PageHeader } from '../components/common/PageHeader.js';
import { Button } from '../components/ui/Button.js';
import { Drawer } from '../components/ui/Drawer.js';
import { Input } from '../components/ui/Input.js';
import { Textarea } from '../components/ui/Textarea.js';
import { Select } from '../components/ui/Select.js';
import { useAuthStore } from '../store/authStore.js';
import { fetchProfile, updateProfile, uploadAvatar, removeAvatar } from '../services/auth.service.js';
import { apiErrorMessage } from '../services/api.js';

const MODULE_LABELS: Record<string, string> = {
  candidate: 'Candidates', job: 'Jobs', interview: 'Interviews', sourcing: 'Sourcing',
  referral: 'Referrals', questionbank: 'Question Bank', assessment: 'Assessments',
  pipeline: 'Pipeline', offer: 'Offers', onboarding: 'Onboarding', panel: 'Hiring Panel',
  chatbot: 'Chatbot', analytics: 'Analytics', audit: 'Audit Log', gdpr: 'Compliance',
  system: 'System', integration: 'Integrations', sector: 'Sectors', user: 'Users', role: 'Roles',
};

function groupPermissions(perms: string[]) {
  const map = new Map<string, string[]>();
  for (const p of perms) {
    const prefix = p.split('.')[0];
    const action = p.slice(prefix.length + 1).replace(/[._]/g, ' ') || 'access';
    if (!map.has(prefix)) map.set(prefix, []);
    map.get(prefix)!.push(action);
  }
  return [...map.entries()]
    .map(([key, actions]) => ({ key, label: MODULE_LABELS[key] ?? key, actions: actions.sort() }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never';

const GENDER_OPTIONS = [
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
  { value: 'Other', label: 'Other' },
  { value: 'Prefer not to say', label: 'Prefer not to say' },
];

type Form = Required<Pick<UpdateProfileInput, 'fullName'>> & {
  phone: string; jobTitle: string; department: string; location: string;
  gender: string; dateOfBirth: string; address: string; bio: string;
};

export function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const qc = useQueryClient();
  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: fetchProfile });
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const avatarMut = useMutation({
    mutationFn: uploadAvatar,
    onSuccess: (p) => {
      toast.success('Photo updated');
      qc.setQueryData(['profile'], p);
      if (user) setUser({ ...user, avatarUrl: p.avatarUrl });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not upload photo')),
  });

  const removeAvatarMut = useMutation({
    mutationFn: removeAvatar,
    onSuccess: (p) => {
      toast.success('Photo removed');
      qc.setQueryData(['profile'], p);
      if (user) setUser({ ...user, avatarUrl: p.avatarUrl });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not remove photo')),
  });

  const saveMut = useMutation({
    mutationFn: (data: UpdateProfileInput) => updateProfile(data),
    onSuccess: (p) => {
      toast.success('Profile updated');
      qc.setQueryData(['profile'], p);
      if (user) setUser({ ...user, fullName: p.fullName, avatarUrl: p.avatarUrl });
      setEditing(false);
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not save profile')),
  });

  if (!user) return null;

  const initial = user.fullName.charAt(0).toUpperCase();
  const isGlobal = user.role === ROLES.SUPERADMIN || user.role === ROLES.ADMIN || user.sectorId === null;
  const groups = groupPermissions(user.permissions);
  const active = profile?.isActive ?? true;
  const avatarUrl = profile?.avatarUrl ?? user.avatarUrl;

  const copyId = async () => {
    await navigator.clipboard.writeText(user.id);
    setCopied(true);
    toast.success('User ID copied');
    setTimeout(() => setCopied(false), 1500);
  };

  const openEdit = () => {
    setForm({
      fullName: profile?.fullName ?? user.fullName,
      phone: profile?.phone ?? '',
      jobTitle: profile?.jobTitle ?? '',
      department: profile?.department ?? '',
      location: profile?.location ?? '',
      gender: profile?.gender ?? '',
      dateOfBirth: profile?.dateOfBirth ?? '',
      address: profile?.address ?? '',
      bio: profile?.bio ?? '',
    });
    setEditing(true);
  };

  const onPickAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('Please choose an image file');
    if (file.size > 5 * 1024 * 1024) return toast.error('Image must be under 5 MB');
    avatarMut.mutate(file);
  };

  const details: { icon: typeof Mail; label: string; value: string; accent?: boolean }[] = [
    { icon: User2, label: 'Full name', value: profile?.fullName ?? user.fullName },
    { icon: Mail, label: 'Email', value: user.email },
    { icon: Phone, label: 'Phone', value: profile?.phone || 'Not provided' },
    { icon: Briefcase, label: 'Job title', value: profile?.jobTitle || 'Not provided' },
    { icon: Building2, label: 'Department', value: profile?.department || 'Not provided' },
    { icon: Users, label: 'Gender', value: profile?.gender || 'Not provided' },
    { icon: Cake, label: 'Date of birth', value: fmtDate(profile?.dateOfBirth) },
    { icon: MapPin, label: 'Location', value: profile?.location || 'Not provided' },
    { icon: Layers, label: 'Sector', value: isGlobal ? 'All sectors' : profile?.sectorName || '—' },
    { icon: CalendarDays, label: 'Member since', value: fmtDate(profile?.createdAt) },
    { icon: Clock, label: 'Last active', value: fmtDateTime(profile?.lastLoginAt) },
  ];

  const stats = [
    { value: user.permissions.length, label: 'Permissions' },
    { value: groups.length, label: 'Modules' },
  ];

  return (
    <div>
      <PageHeader
        title="My Profile"
        description="Your account details and access."
        actions={
          <Button variant="outline" size="sm" onClick={openEdit}>
            <Pencil className="h-4 w-4" /> Edit Profile
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Identity card */}
        <div className="overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-elev-1 lg:col-span-1">
          <div className="relative h-24 bg-gradient-to-br from-accent via-info to-accent">
            <div className="absolute inset-0 opacity-25 [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:16px_16px]" />
          </div>

          <div className="px-6 pb-6">
            {/* Avatar + upload */}
            <div className="-mt-12 flex justify-center">
              <div className="relative">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt="Profile"
                    onClick={() => setPreviewOpen(true)}
                    className="relative z-10 h-24 w-24 rounded-full object-cover ring-4 ring-white shadow-lg cursor-pointer hover:scale-105 hover:brightness-95 transition-all duration-200"
                    title="Click to view photo"
                  />
                ) : (
                  <span className="relative z-10 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-accent to-info text-3xl font-semibold text-white ring-4 ring-white shadow-lg">
                    {initial}
                  </span>
                )}
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={avatarMut.isPending || removeAvatarMut.isPending}
                  className="absolute bottom-0 right-0 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white shadow-md ring-2 ring-white transition-transform hover:scale-105 disabled:opacity-60"
                  title="Change photo"
                >
                  <Camera className="h-4 w-4" />
                </button>
                {avatarUrl && (
                  <button
                    onClick={() => removeAvatarMut.mutate()}
                    disabled={avatarMut.isPending || removeAvatarMut.isPending}
                    className="absolute bottom-0 left-0 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-surface text-danger shadow-md ring-2 ring-white transition-transform hover:scale-105 disabled:opacity-60"
                    title="Remove photo"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickAvatar} />
              </div>
            </div>

            <div className="mt-3 text-center">
              <h2 className="font-heading text-xl font-bold text-text-primary">{user.fullName}</h2>
              {profile?.jobTitle && <p className="text-sm text-text-muted">{profile.jobTitle}</p>}
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent ring-1 ring-inset ring-accent/20">
                  <Shield className="h-3.5 w-3.5" /> {user.roleDisplayName}
                </span>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${active ? 'bg-success-muted text-success ring-success/20' : 'bg-danger-muted text-danger ring-danger/20'}`}>
                  <CircleDot className="h-3.5 w-3.5" /> {active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              {stats.map((s) => (
                <div key={s.label} className="rounded-xl border border-border bg-surface px-3 py-3 text-center">
                  <p className="font-heading text-2xl font-bold text-text-primary">{s.value}</p>
                  <p className="text-[11px] uppercase tracking-wide text-text-muted">{s.label}</p>
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-center gap-3 rounded-xl border border-accent/20 bg-accent/5 px-3 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                {isGlobal ? <Globe className="h-4 w-4" /> : <Layers className="h-4 w-4" />}
              </span>
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-text-muted">Access scope</p>
                <p className="truncate text-sm font-semibold text-accent">
                  {isGlobal ? 'Global — all sectors' : profile?.sectorName || 'Sector-scoped'}
                </p>
              </div>
            </div>

            <button onClick={copyId} className="mt-3 flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-accent/40" title="Copy user ID">
              <span className="flex min-w-0 items-center gap-2">
                <Hash className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                <span className="truncate font-mono text-xs text-text-secondary">{user.id}</span>
              </span>
              {copied ? <Check className="h-4 w-4 shrink-0 text-success" /> : <Copy className="h-4 w-4 shrink-0 text-text-muted" />}
            </button>
          </div>
        </div>

        {/* Personal details + About + Address */}
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-2xl border border-border bg-surface-raised shadow-elev-1">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div className="flex items-center gap-2">
                <User2 className="h-4 w-4 text-accent" />
                <h3 className="font-heading text-sm font-semibold text-text-primary">Personal Details</h3>
              </div>
              <Button variant="ghost" size="sm" onClick={openEdit}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            </div>
            <dl className="grid gap-x-8 gap-y-6 p-6 sm:grid-cols-2">
              {details.map(({ icon: Icon, label, value, accent }) => (
                <div key={label} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface text-text-secondary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <dt className="text-[11px] uppercase tracking-wide text-text-muted">{label}</dt>
                    <dd className={`mt-0.5 truncate text-sm font-medium ${accent ? 'text-accent' : 'text-text-primary'}`}>{value}</dd>
                  </div>
                </div>
              ))}
            </dl>
            {/* Address + About span full width */}
            <div className="grid gap-6 border-t border-border p-6 sm:grid-cols-2">
              <div>
                <p className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-muted">
                  <MapPin className="h-3.5 w-3.5" /> Address
                </p>
                <p className="text-sm text-text-primary">{profile?.address || <span className="text-text-muted">No address added yet</span>}</p>
              </div>
              <div>
                <p className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-muted">
                  <User2 className="h-3.5 w-3.5" /> About
                </p>
                <p className="text-sm text-text-primary">{profile?.bio || <span className="text-text-muted">No bio added yet</span>}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Roles & permissions (full width) */}
      <div className="mt-6 rounded-2xl border border-border bg-surface-raised shadow-elev-1">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-accent" />
            <h3 className="font-heading text-sm font-semibold text-text-primary">Roles &amp; Permissions</h3>
          </div>
          <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent">
            {user.permissions.length} across {groups.length} modules
          </span>
        </div>
        {groups.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-text-muted">No permissions granted.</p>
        ) : (
          <div className="grid gap-x-8 gap-y-6 p-6 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g) => (
              <div key={g.key}>
                <div className="mb-2.5 flex items-center gap-2">
                  <h4 className="font-heading text-xs font-semibold uppercase tracking-wide text-text-secondary">{g.label}</h4>
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-[11px] text-text-muted">{g.actions.length}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {g.actions.map((a) => (
                    <span key={a} className="rounded-md bg-surface px-2 py-1 text-xs capitalize text-text-secondary ring-1 ring-inset ring-border">{a}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit drawer */}
      <Drawer
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit Profile"
        subtitle="Update your personal details"
        footer={
          form && (
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              <Button loading={saveMut.isPending} onClick={() => saveMut.mutate(form)}>Save changes</Button>
            </div>
          )
        }
      >
        {form && (
          <div className="space-y-4">
            <Field label="Profile photo">
              <div className="flex items-center gap-4 rounded-lg border border-border bg-surface p-3">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
                ) : (
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-accent to-info text-xl font-semibold text-white">
                    {initial}
                  </span>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" loading={avatarMut.isPending} onClick={() => fileRef.current?.click()}>
                    <Camera className="h-3.5 w-3.5" /> {avatarUrl ? 'Change' : 'Upload'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!avatarUrl}
                    loading={removeAvatarMut.isPending}
                    onClick={() => removeAvatarMut.mutate()}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove photo
                  </Button>
                </div>
              </div>
            </Field>
            <Field label="Full name">
              <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Phone">
                <Input value={form.phone} placeholder="+91 …" onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
              <Field label="Date of birth">
                <Input type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
              </Field>
              <Field label="Job title">
                <Input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
              </Field>
              <Field label="Department">
                <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
              </Field>
              <Field label="Gender">
                <Select options={GENDER_OPTIONS} placeholder="Select…" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} />
              </Field>
              <Field label="Location">
                <Input value={form.location} placeholder="City, Country" onChange={(e) => setForm({ ...form, location: e.target.value })} />
              </Field>
            </div>
            <Field label="Address">
              <Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
            <Field label="About">
              <Textarea value={form.bio} placeholder="A short bio…" onChange={(e) => setForm({ ...form, bio: e.target.value })} />
            </Field>
          </div>
        )}
      </Drawer>

      {previewOpen && avatarUrl && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 animate-in fade-in"
          onClick={() => setPreviewOpen(false)}
        >
          <div
            className="relative max-w-lg w-full bg-surface rounded-xl overflow-hidden shadow-2xl border border-border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-text-primary">Profile Photo Preview</h3>
              <button
                onClick={() => setPreviewOpen(false)}
                className="rounded-lg p-1 text-text-muted hover:bg-bg hover:text-text-primary transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex items-center justify-center bg-bg p-6">
              <img src={avatarUrl} alt="Profile Large" className="max-h-[70vh] max-w-full rounded-lg object-contain shadow-md" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-text-secondary">{label}</span>
      {children}
    </label>
  );
}
