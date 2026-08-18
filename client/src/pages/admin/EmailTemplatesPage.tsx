import { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Mail, Plus, Pencil, Eye, RefreshCw, Send, Users, Search, Laptop, Smartphone, ChevronRight, Image as ImageIcon, Save, Palette, Palette as ThemeIcon, AlertTriangle, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { PageHeader } from '../../components/common/PageHeader.js';
import { EmptyState } from '../../components/common/EmptyState.js';
import { Button } from '../../components/ui/Button.js';
import { Input } from '../../components/ui/Input.js';
import { Textarea } from '../../components/ui/Textarea.js';
import { Badge } from '../../components/ui/Badge.js';
import { Drawer } from '../../components/ui/Drawer.js';
import { Spinner } from '../../components/ui/Spinner.js';
import { FileUploadButton } from '../../components/ui/FileUploadButton.js';
import * as adminApi from '../../services/adminApi.js';
import * as interviewApi from '../../services/interviewApi.js';
import * as assessmentApi from '../../services/assessmentApi.js';
import { apiErrorMessage } from '../../services/api.js';
import { useConfirm } from '../../providers/ConfirmProvider.js';
import { useAuthStore } from '../../store/authStore.js';
import { PERMISSIONS, type EmailTemplateItem, type AttachmentMeta } from '@agnohire/shared';

interface PlaceholderInfo {
  name: string;
  description: string;
}

const TEMPLATE_METADATA: Record<string, { category: string; placeholders: PlaceholderInfo[] }> = {
  interview_reminder: {
    category: 'Interview',
    placeholders: [
      { name: 'candidateName', description: 'Name of the candidate' },
      { name: 'companyName', description: 'Name of the company/tenant' },
      { name: 'scheduledDate', description: 'Interview schedule date/time' },
      { name: 'joinUrl', description: 'Link to join the interview interface' },
      { name: 'supportEmail', description: 'Company support email' },
      { name: 'currentDate', description: 'Current date' },
    ]
  },
  interview_invite: {
    category: 'Interview',
    placeholders: [
      { name: 'candidateName', description: 'Name of the candidate' },
      { name: 'companyName', description: 'Name of the company/tenant' },
      { name: 'jobTitle', description: 'Title of the job role' },
      { name: 'scheduledDate', description: 'Interview date/time (optional)' },
      { name: 'joinUrl', description: 'Secure start interview link' },
      { name: 'supportEmail', description: 'Company support email' },
      { name: 'currentDate', description: 'Current date' },
    ]
  },
  schedule_invite: {
    category: 'Interview',
    placeholders: [
      { name: 'candidateName', description: 'Name of the candidate' },
      { name: 'companyName', description: 'Name of the company/tenant' },
      { name: 'scheduledDate', description: 'Schedule date/time' },
      { name: 'timezone', description: 'Selected timezone' },
      { name: 'durationMin', description: 'Duration in minutes' },
      { name: 'meetingLink', description: 'Google Meet link (optional)' },
      { name: 'instructions', description: 'Special interviewer instructions (optional)' },
      { name: 'supportEmail', description: 'Company support email' },
      { name: 'currentDate', description: 'Current date' },
    ]
  },
  interviewer_schedule: {
    category: 'Interview',
    placeholders: [
      { name: 'interviewerName', description: 'Name of the interviewer' },
      { name: 'candidateName', description: 'Name of the candidate' },
      { name: 'companyName', description: 'Name of the company/tenant' },
      { name: 'scheduledDate', description: 'Schedule date/time' },
      { name: 'timezone', description: 'Selected timezone' },
      { name: 'durationMin', description: 'Duration in minutes' },
      { name: 'meetingLink', description: 'Google Meet link (optional)' },
      { name: 'supportEmail', description: 'Company support email' },
      { name: 'currentDate', description: 'Current date' },
    ]
  },
  interview_result: {
    category: 'Interview',
    placeholders: [
      { name: 'candidateName', description: 'Name of the candidate' },
      { name: 'companyName', description: 'Name of the company/tenant' },
      { name: 'jobTitle', description: 'Title of the job role' },
      { name: 'passed', description: 'True if candidate passed (for conditional block)' },
      { name: 'failed', description: 'True if candidate failed (for conditional block)' },
      { name: 'supportEmail', description: 'Company support email' },
      { name: 'currentDate', description: 'Current date' },
    ]
  },
  assessment_invite: {
    category: 'Assessment',
    placeholders: [
      { name: 'candidateName', description: 'Name of the candidate' },
      { name: 'companyName', description: 'Name of the company/tenant' },
      { name: 'assessmentTitle', description: 'Title of the assessment' },
      { name: 'startUrl', description: 'Secure start assessment link' },
      { name: 'supportEmail', description: 'Company support email' },
      { name: 'currentDate', description: 'Current date' },
    ]
  },
  assessment_result: {
    category: 'Assessment',
    placeholders: [
      { name: 'candidateName', description: 'Name of the candidate' },
      { name: 'companyName', description: 'Name of the company/tenant' },
      { name: 'assessmentTitle', description: 'Title of the assessment' },
      { name: 'percentageScore', description: 'Percentage score achieved' },
      { name: 'passingScore', description: 'Required passing score' },
      { name: 'passed', description: 'True if candidate passed (for conditional block)' },
      { name: 'failed', description: 'True if candidate failed (for conditional block)' },
      { name: 'nextSteps', description: 'Next steps notes (optional)' },
      { name: 'supportEmail', description: 'Company support email' },
      { name: 'currentDate', description: 'Current date' },
    ]
  },
  admin_message: {
    category: 'Administration',
    placeholders: [
      { name: 'recipientName', description: 'Name of the recipient' },
      { name: 'senderName', description: 'Name of the sender' },
      { name: 'companyName', description: 'Name of the company/tenant' },
      { name: 'message', description: 'Custom message body text' },
      { name: 'supportEmail', description: 'Company support email' },
      { name: 'currentDate', description: 'Current date' },
    ]
  },
  offer_sent: {
    category: 'Hiring',
    placeholders: [
      { name: 'candidateName', description: 'Name of the candidate' },
      { name: 'companyName', description: 'Name of the company/tenant' },
      { name: 'jobTitle', description: 'Title of the job role' },
      { name: 'validUntil', description: 'Offer validity date' },
      { name: 'acceptUrl', description: 'Offer acceptance link' },
      { name: 'supportEmail', description: 'Company support email' },
      { name: 'currentDate', description: 'Current date' },
    ]
  },
  panel_assignment: {
    category: 'Interview',
    placeholders: [
      { name: 'panelistName', description: 'Name of the panelist' },
      { name: 'candidateName', description: 'Name of the candidate' },
      { name: 'companyName', description: 'Name of the company/tenant' },
      { name: 'supportEmail', description: 'Company support email' },
      { name: 'currentDate', description: 'Current date' },
    ]
  },
  detailed_feedback: {
    category: 'Interview',
    placeholders: [
      { name: 'candidateName', description: 'Name of the candidate' },
      { name: 'companyName', description: 'Name of the company/tenant' },
      { name: 'jobTitle', description: 'Title of the job role' },
      { name: 'interviewRound', description: 'Name of the interview round' },
      { name: 'overallScore', description: 'Overall candidate percentage score' },
      { name: 'decision', description: 'PASS or FAIL decision' },
      { name: 'strengths', description: 'Key strengths observed' },
      { name: 'improvements', description: 'Areas for improvement' },
      { name: 'recommendedLearning', description: 'Recommended courses or topics' },
      { name: 'passed', description: 'True if candidate passed' },
      { name: 'failed', description: 'True if candidate failed' },
      { name: 'supportEmail', description: 'Company support email' },
      { name: 'currentDate', description: 'Current date' },
    ]
  },
  document_request: {
    category: 'Onboarding',
    placeholders: [
      { name: 'candidateName', description: 'Name of the candidate' },
      { name: 'companyName', description: 'Name of the company/tenant' },
      { name: 'uploadUrl', description: 'Document upload interface link' },
      { name: 'documentsList', description: 'HTML formatted required/optional list' },
      { name: 'supportEmail', description: 'Company support email' },
      { name: 'currentDate', description: 'Current date' },
    ]
  },
  document_reupload: {
    category: 'Onboarding',
    placeholders: [
      { name: 'candidateName', description: 'Name of the candidate' },
      { name: 'companyName', description: 'Name of the company/tenant' },
      { name: 'documentName', description: 'Name of the rejected document' },
      { name: 'rejectionReason', description: 'HR notes on why it was rejected' },
      { name: 'uploadUrl', description: 'Document upload interface link' },
      { name: 'supportEmail', description: 'Company support email' },
      { name: 'currentDate', description: 'Current date' },
    ]
  },
  documents_verified: {
    category: 'Onboarding',
    placeholders: [
      { name: 'candidateName', description: 'Name of the candidate' },
      { name: 'companyName', description: 'Name of the company/tenant' },
      { name: 'supportEmail', description: 'Company support email' },
      { name: 'currentDate', description: 'Current date' },
    ]
  },
  tentative_offer: {
    category: 'Hiring',
    placeholders: [
      { name: 'candidateName', description: 'Name of the candidate' },
      { name: 'companyName', description: 'Name of the company/tenant' },
      { name: 'acceptUrl', description: 'Offer acceptance link' },
      { name: 'supportEmail', description: 'Company support email' },
      { name: 'currentDate', description: 'Current date' },
    ]
  },
  hr_document_submitted: {
    category: 'Onboarding',
    placeholders: [
      { name: 'candidateName', description: 'Name of the candidate' },
      { name: 'companyName', description: 'Name of the company/tenant' },
      { name: 'jobTitle', description: 'Title of the job role' },
      { name: 'submissionDate', description: 'Date of submission' },
      { name: 'uploadedCount', description: 'Number of uploaded documents' },
      { name: 'reviewUrl', description: 'HR review page link' },
      { name: 'supportEmail', description: 'Company support email' },
      { name: 'currentDate', description: 'Current date' },
    ]
  },
};

const THEMES = [
  { value: 'modern_corporate', label: 'Modern Corporate' },
  { value: 'minimal_clean', label: 'Minimal Clean' },
  { value: 'executive_dark', label: 'Executive Dark' },
  { value: 'gradient_pro', label: 'Gradient Professional' },
  { value: 'startup_style', label: 'Startup Style' },
  { value: 'enterprise', label: 'Enterprise' },
  { value: 'recruitment_premium', label: 'Recruitment Premium' },
  { value: 'elegant', label: 'Elegant' },
  { value: 'glass_ui', label: 'Glass UI' },
  { value: 'classic_business', label: 'Classic Business' },
];

const FONTS = [
  'Segoe UI',
  'Inter',
  'Poppins',
  'Roboto',
  'Open Sans',
  'Lato',
  'Nunito',
  'Source Sans Pro',
  'Work Sans',
  'IBM Plex Sans',
  'Manrope',
];

const CATEGORIES = ['All', 'Interview', 'Assessment', 'Hiring', 'Onboarding', 'Administration'];

export function EmailTemplatesPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  
  const { data: templates, isLoading } = useQuery({ queryKey: ['admin-email-templates'], queryFn: adminApi.fetchEmailTemplates });
  const { data: configs, isLoading: configLoading } = useQuery({ queryKey: ['system-config'], queryFn: adminApi.fetchConfig });
  
  const [activeTab, setActiveTab] = useState<'templates' | 'branding'>('templates');
  const [editing, setEditing] = useState<EmailTemplateItem | 'new' | null>(null);
  const [previewing, setPreviewing] = useState<EmailTemplateItem | null>(null);
  
  // Search and Filter States
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  const remove = useMutation({
    mutationFn: (id: string) => adminApi.deleteEmailTemplate(id),
    onSuccess: () => { toast.success('Template reset to system default'); qc.invalidateQueries({ queryKey: ['admin-email-templates'] }); },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not reset template')),
  });

  const filteredItems = useMemo(() => {
    const items = templates ?? [];
    return items.filter((t) => {
      const meta = TEMPLATE_METADATA[t.type];
      const category = meta ? meta.category : 'Administration';
      
      const matchesSearch = 
        t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.type.toLowerCase().includes(searchTerm.toLowerCase()) ||
        category.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.subject.toLowerCase().includes(searchTerm.toLowerCase());
        
      const matchesCategory = selectedCategory === 'All' || category === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [templates, searchTerm, selectedCategory]);

  if (isLoading || configLoading) return <div className="flex justify-center py-20"><Spinner /></div>;

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Template Customizer" 
        description="Configure tenant-wide custom branding, colors, and layout templates, or edit transactional workflows." 
        actions={activeTab === 'templates' ? <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> New custom template</Button> : null} 
      />

      {/* Main Tab Switcher */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setActiveTab('templates')}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 -mb-px transition-all ${
            activeTab === 'templates'
              ? 'border-accent text-accent'
              : 'border-transparent text-text-muted hover:text-text-secondary'
          }`}
        >
          <Mail className="h-4 w-4" /> Templates
        </button>
        <button
          onClick={() => setActiveTab('branding')}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 -mb-px transition-all ${
            activeTab === 'branding'
              ? 'border-accent text-accent'
              : 'border-transparent text-text-muted hover:text-text-secondary'
          }`}
        >
          <Palette className="h-4 w-4" /> Branding &amp; Themes
        </button>
      </div>

      {activeTab === 'templates' ? (
        <>
          {/* Filter and Search Bar */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-4">
            <div className="flex flex-wrap gap-1">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
                    selectedCategory === cat
                      ? 'bg-accent text-accent-fg shadow-sm'
                      : 'text-text-secondary hover:bg-surface-raised hover:text-text-primary'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <Input
                placeholder="Search templates..."
                className="pl-9 h-9 text-xs"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          {filteredItems.length === 0 ? (
            <EmptyState icon={<Mail className="h-8 w-8" />} title="No matching templates" description="Try clearing your search query or choosing a different category." />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredItems.map((t) => {
                const isSystemDefault = t.id.startsWith('sys-');
                const meta = TEMPLATE_METADATA[t.type];
                const category = meta ? meta.category : 'Administration';
                
                return (
                  <div 
                    key={t.id} 
                    className="flex flex-col justify-between rounded-xl border border-border bg-surface p-5 hover:shadow-md hover:border-border-hover transition-all"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-text-muted tracking-wider uppercase">{category}</span>
                        <div className="flex items-center gap-1.5">
                          <Badge variant={isSystemDefault ? 'muted' : 'info'}>
                            {isSystemDefault ? 'System Default' : 'Customized'}
                          </Badge>
                          {((!t.id.startsWith('sys-') && !t.isSystemOverride) ? t.isDefault : !templates?.some(item => !item.id.startsWith('sys-') && !item.isSystemOverride && item.type === t.type && item.isDefault)) && (
                            <Badge variant="success">
                              Active
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-text-primary mb-1">{t.name}</h3>
                        <p className="text-xs text-text-muted font-mono">{t.type}</p>
                      </div>
                      <div className="border-t border-border/40 pt-3">
                        <span className="text-xs font-medium text-text-secondary block mb-1">Subject</span>
                        <p className="text-xs text-text-muted line-clamp-2">{t.subject}</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-border/40 mt-5 pt-3">
                      <span className="text-[10px] text-text-muted">
                        {t.updatedAt && t.updatedAt !== new Date(0).toISOString()
                          ? `Updated: ${format(new Date(t.updatedAt), 'dd MMM yyyy')}`
                          : 'Never modified'}
                      </span>
                      <div className="flex gap-1.5">
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={() => setPreviewing(t)}
                          title="Preview email format"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={() => setEditing(t)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {!isSystemDefault && (
                          t.isSystemOverride ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-danger border-danger/30 hover:bg-danger/10"
                              onClick={async () => {
                                if (await confirm({
                                  title: 'Reset Template',
                                  message: `Reset ${t.name} to the system default template? Your custom override will be deleted permanently.`,
                                  confirmText: 'Reset to Default',
                                  variant: 'danger'
                                })) {
                                  remove.mutate(t.id);
                                }
                              }}
                              title="Reset custom override to default"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-danger border-danger/30 hover:bg-danger/10"
                              onClick={async () => {
                                if (await confirm({
                                  title: 'Delete Template',
                                  message: `Are you sure you want to delete this custom template? This action cannot be undone.`,
                                  confirmText: 'Delete',
                                  variant: 'danger'
                                })) {
                                  remove.mutate(t.id);
                                }
                              }}
                              title="Delete custom template"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <ResultEmailsPanel />
        </>
      ) : (
        <BrandingSettingsPanel configs={configs || []} />
      )}
      
      {editing && (
        <TemplateDrawer
          template={editing === 'new' ? null : editing}
          configs={configs || []}
          templates={templates || []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['admin-email-templates'] }); }}
        />
      )}

      {previewing && (
        <PreviewModal
          template={previewing}
          configs={configs || []}
          onClose={() => setPreviewing(null)}
        />
      )}
    </div>
  );
}

/** Tenant Branding Settings tab view */
function BrandingSettingsPanel({ configs }: { configs: adminApi.ConfigItem[] }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  
  const logoId = configs.find(c => c.key === 'email.brand_logo')?.value || '';
  const brandLogoUrl = logoId ? (logoId.startsWith('http') ? logoId : `/api/system/branding/email.brand_logo?v=${encodeURIComponent(logoId)}`) : '/logo.png';

  // Form states mapping directly to SystemConfiguration keys
  const [companyName, setCompanyName] = useState(configs.find(c => c.key === 'general.company_name')?.value || 'AgnoHire');
  const [theme, setTheme] = useState(configs.find(c => c.key === 'email.brand_theme')?.value || 'modern_corporate');
  const [primaryColor, setPrimaryColor] = useState(configs.find(c => c.key === 'email.brand_primary_color')?.value || '#2563eb');
  const [secondaryColor, setSecondaryColor] = useState(configs.find(c => c.key === 'email.brand_secondary_color')?.value || '#2563eb');
  const [buttonColor, setButtonColor] = useState(configs.find(c => c.key === 'email.brand_button_color')?.value || '#2563eb');
  const [buttonStyle, setButtonStyle] = useState(configs.find(c => c.key === 'email.brand_button_style')?.value || 'rounded');
  const [fontFamily, setFontFamily] = useState(configs.find(c => c.key === 'email.brand_font')?.value || 'Segoe UI');
  const [footerBg, setFooterBg] = useState(configs.find(c => c.key === 'email.brand_footer_bg')?.value || '#2563eb');
  const [textColor, setTextColor] = useState(configs.find(c => c.key === 'email.brand_text_color')?.value || '#1a1a2e');
  
  const [website, setWebsite] = useState(configs.find(c => c.key === 'email.brand_website')?.value || 'https://agnohire.com');
  const [phone, setPhone] = useState(configs.find(c => c.key === 'email.brand_phone')?.value || '');
  const [address, setAddress] = useState(configs.find(c => c.key === 'email.brand_address')?.value || '');
  const [copyright, setCopyright] = useState(configs.find(c => c.key === 'email.brand_copyright')?.value || '');
  
  const [linkedin, setLinkedin] = useState(configs.find(c => c.key === 'email.brand_social_linkedin')?.value || '');
  const [facebook, setFacebook] = useState(configs.find(c => c.key === 'email.brand_social_facebook')?.value || '');
  const [twitter, setTwitter] = useState(configs.find(c => c.key === 'email.brand_social_twitter')?.value || '');
  const [bannerUrl, setBannerUrl] = useState(configs.find(c => c.key === 'email.brand_banner_url')?.value || '');

  const save = useMutation({
    mutationFn: async () => {
      const updates = [
        { key: 'general.company_name', value: companyName },
        { key: 'email.brand_theme', value: theme },
        { key: 'email.brand_primary_color', value: primaryColor },
        { key: 'email.brand_secondary_color', value: secondaryColor },
        { key: 'email.brand_button_color', value: buttonColor },
        { key: 'email.brand_button_style', value: buttonStyle },
        { key: 'email.brand_font', value: fontFamily },
        { key: 'email.brand_footer_bg', value: footerBg },
        { key: 'email.brand_text_color', value: textColor },
        { key: 'email.brand_website', value: website },
        { key: 'email.brand_phone', value: phone },
        { key: 'email.brand_address', value: address },
        { key: 'email.brand_copyright', value: copyright },
        { key: 'email.brand_social_linkedin', value: linkedin },
        { key: 'email.brand_social_facebook', value: facebook },
        { key: 'email.brand_social_twitter', value: twitter },
        { key: 'email.brand_banner_url', value: bannerUrl },
      ];
      
      for (const update of updates) {
        await adminApi.updateConfig(update.key, update.value);
      }
    },
    onSuccess: () => {
      toast.success('Branding and theme settings saved successfully');
      qc.invalidateQueries({ queryKey: ['system-config'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not save branding settings')),
  });

  const applyLogoToAll = useMutation({
    mutationFn: async (logoId: string) => {
      await adminApi.applyLogoToAllTemplates({ useCustomLogo: true, customLogoId: logoId, logoWidth: 220 });
    },
    onSuccess: () => {
      toast.success('Logo applied to all email templates successfully!');
      qc.invalidateQueries({ queryKey: ['system-config'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not apply logo to all templates')),
  });

  const saveLogo = useMutation({
    mutationFn: (id: string) => adminApi.updateConfig('email.brand_logo', id),
    onSuccess: () => {
      toast.success('Company logo updated');
      qc.invalidateQueries({ queryKey: ['system-config'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not upload logo')),
  });

  const onLogoUploaded = async (meta: AttachmentMeta) => {
    const proceed = await confirm({
      title: 'Apply Logo',
      message: 'Apply this logo to the all email template',
      confirmText: 'Apply',
      variant: 'primary',
    });
    if (proceed) {
      saveLogo.mutate(meta.id, {
        onSuccess: () => {
          applyLogoToAll.mutate(meta.id);
        }
      });
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      {/* Settings Form */}
      <div className="xl:col-span-2 space-y-6 rounded-xl border border-border bg-surface p-6">
        <div>
          <h2 className="text-sm font-semibold text-text-primary mb-1">Company Information</h2>
          <p className="text-xs text-text-muted">Set standard identifier labels for all communication shells.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-text-secondary">Company Display Name</label>
            <Input value={companyName} onChange={e => setCompanyName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-text-secondary">Email Template Logo</label>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-bg">
                  {brandLogoUrl ? (
                    <img src={brandLogoUrl} alt="logo" className="h-full w-full object-contain" />
                  ) : (
                    <ImageIcon className="h-5 w-5 text-text-muted" />
                  )}
                </div>
                <FileUploadButton
                  accept="image/png,image/svg+xml,image/jpeg"
                  label="Upload Logo (PNG, SVG, JPG)"
                  onUploaded={onLogoUploaded}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger hover:bg-danger/10 disabled:opacity-50"
                  disabled={!logoId}
                  loading={saveLogo.isPending}
                  onClick={async () => {
                    const proceed = await confirm({
                      title: 'Reset Logo',
                      message: 'Are you sure you want to reset the email template logo to the default AgnoHire logo?',
                      confirmText: 'Reset',
                      variant: 'danger',
                    });
                    if (proceed) {
                      saveLogo.mutate('', {
                        onSuccess: () => {
                          applyLogoToAll.mutate('');
                        }
                      });
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="flex items-start gap-1.5 text-[11px] text-warning">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                This logo will be used for all email templates system-wide.
              </p>
              <div>
                <label className="mb-1 block text-[10px] text-text-muted">Or enter external logo URL:</label>
                <Input 
                  value={logoId.startsWith('http') ? logoId : ''} 
                  onChange={e => saveLogo.mutate(e.target.value)} 
                  placeholder="e.g. https://mycompany.com/logo.png"
                  className="text-xs"
                />
              </div>
            </div>
          </div>
        </div>

        <hr className="border-border/60" />

        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-sm font-semibold text-text-primary mb-1">Brand Colors &amp; Styling</h2>
            <p className="text-xs text-text-muted">Choose your brand palette and formatting parameters.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setPrimaryColor('#2563eb');
              setSecondaryColor('#2563eb');
              setButtonColor('#2563eb');
              setFooterBg('#2563eb');
              setTextColor('#1a1a2e');
              setTheme('modern_corporate');
              setFontFamily('Segoe UI');
              setButtonStyle('rounded');
            }}
            className="text-xs font-semibold px-3 py-1.5 border border-danger/30 text-danger bg-danger/5 hover:bg-danger/10 rounded-lg transition-colors"
          >
            Reset Colors &amp; Styling
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-text-secondary">Default Layout Theme</label>
            <select 
              value={theme} 
              onChange={e => setTheme(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-bg px-3 text-xs text-text-primary focus:border-accent focus:outline-none"
            >
              {THEMES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-text-secondary">Font Family</label>
            <select 
              value={fontFamily} 
              onChange={e => setFontFamily(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-bg px-3 text-xs text-text-primary focus:border-accent focus:outline-none"
            >
              {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-text-secondary">Button Shape style</label>
            <select 
              value={buttonStyle} 
              onChange={e => setButtonStyle(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-bg px-3 text-xs text-text-primary focus:border-accent focus:outline-none"
            >
              <option value="rounded">Rounded Corners</option>
              <option value="square">Square</option>
              <option value="pill">Pill</option>
              <option value="outline">Outline</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 flex items-center justify-between text-xs font-semibold text-text-secondary">
              Primary Brand Color
              <span className="font-mono text-[10px] text-text-muted">{primaryColor}</span>
            </label>
            <div className="flex gap-2">
              <Input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} className="h-9 w-12 p-0.5" />
              <Input value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} className="flex-1 text-xs" />
            </div>
          </div>
          <div>
            <label className="mb-1.5 flex items-center justify-between text-xs font-semibold text-text-secondary">
              Secondary Color
              <span className="font-mono text-[10px] text-text-muted">{secondaryColor}</span>
            </label>
            <div className="flex gap-2">
              <Input type="color" value={secondaryColor} onChange={e => setSecondaryColor(e.target.value)} className="h-9 w-12 p-0.5" />
              <Input value={secondaryColor} onChange={e => setSecondaryColor(e.target.value)} className="flex-1 text-xs" />
            </div>
          </div>
          <div>
            <label className="mb-1.5 flex items-center justify-between text-xs font-semibold text-text-secondary">
              CTA Button Color
              <span className="font-mono text-[10px] text-text-muted">{buttonColor}</span>
            </label>
            <div className="flex gap-2">
              <Input type="color" value={buttonColor} onChange={e => setButtonColor(e.target.value)} className="h-9 w-12 p-0.5" />
              <Input value={buttonColor} onChange={e => setButtonColor(e.target.value)} className="flex-1 text-xs" />
            </div>
          </div>
          <div>
            <label className="mb-1.5 flex items-center justify-between text-xs font-semibold text-text-secondary">
              Footer Background
              <span className="font-mono text-[10px] text-text-muted">{footerBg}</span>
            </label>
            <div className="flex gap-2">
              <Input type="color" value={footerBg} onChange={e => setFooterBg(e.target.value)} className="h-9 w-12 p-0.5" />
              <Input value={footerBg} onChange={e => setFooterBg(e.target.value)} className="flex-1 text-xs" />
            </div>
          </div>
          <div>
            <label className="mb-1.5 flex items-center justify-between text-xs font-semibold text-text-secondary">
              Body Text Color
              <span className="font-mono text-[10px] text-text-muted">{textColor}</span>
            </label>
            <div className="flex gap-2">
              <Input type="color" value={textColor} onChange={e => setTextColor(e.target.value)} className="h-9 w-12 p-0.5" />
              <Input value={textColor} onChange={e => setTextColor(e.target.value)} className="flex-1 text-xs" />
            </div>
          </div>
        </div>

        <hr className="border-border/60" />

        <div>
          <h2 className="text-sm font-semibold text-text-primary mb-1">Company Contact &amp; Footer Info</h2>
          <p className="text-xs text-text-muted">Standard footer metadata appended automatically to branding shells.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-text-secondary">Corporate Website URL</label>
            <Input value={website} onChange={e => setWebsite(e.target.value)} placeholder="e.g. https://mycompany.com" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-text-secondary">Support / Contact Phone</label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="e.g. +1 (555) 123-4567" />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-semibold text-text-secondary">Physical Office Address</label>
            <Textarea value={address} onChange={e => setAddress(e.target.value)} rows={2} placeholder="e.g. 100 Pine Street, San Francisco, CA" />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-semibold text-text-secondary">Copyright Notice</label>
            <Input value={copyright} onChange={e => setCopyright(e.target.value)} placeholder="e.g. &copy; 2026 MyCompany Inc. All rights reserved." />
          </div>
        </div>

        <hr className="border-border/60" />

        <div>
          <h2 className="text-sm font-semibold text-text-primary mb-1">Social Links &amp; Marketing Banners</h2>
          <p className="text-xs text-text-muted">Optional header banners and footer social profiles.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-text-secondary">LinkedIn Profile URL</label>
            <Input value={linkedin} onChange={e => setLinkedin(e.target.value)} placeholder="https://linkedin.com/..." />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-text-secondary">Facebook Page URL</label>
            <Input value={facebook} onChange={e => setFacebook(e.target.value)} placeholder="https://facebook.com/..." />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-text-secondary">Twitter / X URL</label>
            <Input value={twitter} onChange={e => setTwitter(e.target.value)} placeholder="https://twitter.com/..." />
          </div>
          <div className="md:col-span-3">
            <label className="mb-1 block text-xs font-semibold text-text-secondary">Hero Banner Image URL (Optional)</label>
            <Input value={bannerUrl} onChange={e => setBannerUrl(e.target.value)} placeholder="e.g. https://mycompany.com/images/email-banner.jpg" />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            <Save className="h-4 w-4 mr-1.5" /> Save Branding Configuration
          </Button>
        </div>
      </div>

      {/* Info Card Sidebar */}
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
          <div className="flex items-start gap-2.5">
            <ThemeIcon className="h-5 w-5 text-accent mt-0.5" />
            <div>
              <h3 className="text-xs font-bold text-text-primary">Theme Inheritance</h3>
              <p className="text-xs text-text-muted mt-1 leading-relaxed">
                Branding configurations applied here are automatically inherited as defaults for all AgnoHire transactional templates.
              </p>
            </div>
          </div>
          <div className="rounded-lg bg-surface-raised p-3.5 border border-border/40 text-xs text-text-muted space-y-2">
            <span className="font-semibold text-text-secondary block">Rendering Resolution Hierarchy:</span>
            <div className="flex items-center gap-1.5">
              <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent font-semibold">1</span>
              <span>Template-Specific Theme Override</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent font-semibold">2</span>
              <span>Global Layout Theme (General settings)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent font-semibold">3</span>
              <span>Branding Palette &amp; Logos</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Renders the sandboxed email preview in a modal */
function PreviewModal({ template, configs, onClose }: { template: EmailTemplateItem; configs: adminApi.ConfigItem[]; onClose: () => void }) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [html, setHtml] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    
    // Resolve template custom theme if set, else fallback to global config theme
    const themeKey = `email.theme.${template.type}`;
    const defaultTheme = configs.find(c => c.key === 'email.brand_theme')?.value || 'modern_corporate';
    const activeTheme = configs.find(c => c.key === themeKey)?.value || defaultTheme;

    // Send active config colors/options to API preview endpoint
    const brand = {
      companyName: configs.find(c => c.key === 'general.company_name')?.value || 'AgnoHire',
      logoId: configs.find(c => c.key === 'email.brand_logo')?.value || '',
      primaryColor: configs.find(c => c.key === 'email.brand_primary_color')?.value || '#2563eb',
      secondaryColor: configs.find(c => c.key === 'email.brand_secondary_color')?.value || '#2563eb',
      buttonColor: configs.find(c => c.key === 'email.brand_button_color')?.value || '#2563eb',
      buttonStyle: configs.find(c => c.key === 'email.brand_button_style')?.value || 'rounded',
      fontFamily: configs.find(c => c.key === 'email.brand_font')?.value || 'Segoe UI',
      footerBg: configs.find(c => c.key === 'email.brand_footer_bg')?.value || '#2563eb',
      textColor: configs.find(c => c.key === 'email.brand_text_color')?.value || '#1a1a2e',
      website: configs.find(c => c.key === 'email.brand_website')?.value || '',
      phone: configs.find(c => c.key === 'email.brand_phone')?.value || '',
      address: configs.find(c => c.key === 'email.brand_address')?.value || '',
      copyright: configs.find(c => c.key === 'email.brand_copyright')?.value || '',
      linkedin: configs.find(c => c.key === 'email.brand_social_linkedin')?.value || '',
      facebook: configs.find(c => c.key === 'email.brand_social_facebook')?.value || '',
      twitter: configs.find(c => c.key === 'email.brand_social_twitter')?.value || '',
      bannerUrl: configs.find(c => c.key === 'email.brand_banner_url')?.value || '',
    };

    adminApi.previewEmailTemplate(template.subject, template.body, activeTheme, brand, template.type)
      .then((res) => setHtml(res.html))
      .catch((e) => toast.error(apiErrorMessage(e, 'Preview failed')))
      .finally(() => setLoading(false));
  }, [template, configs]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background-blur/60 backdrop-blur-sm">
      <div className="relative flex flex-col w-full max-w-4xl h-[85vh] bg-surface border border-border rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">{template.name} Preview</h3>
            <p className="text-xs text-text-muted mt-0.5 font-mono">{template.type}</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex rounded-lg bg-surface-raised p-1">
              <button
                onClick={() => setDevice('desktop')}
                className={`rounded-md p-1.5 transition-colors ${device === 'desktop' ? 'bg-surface text-accent shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}
              >
                <Laptop className="h-4 w-4" />
              </button>
              <button
                onClick={() => setDevice('mobile')}
                className={`rounded-md p-1.5 transition-colors ${device === 'mobile' ? 'bg-surface text-accent shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}
              >
                <Smartphone className="h-4 w-4" />
              </button>
            </div>
            <Button variant="danger" onClick={onClose} size="sm">Cancel</Button>
          </div>
        </div>

        {/* Content iframe */}
        <div className="flex-1 bg-surface-raised flex items-center justify-center p-6 overflow-auto">
          {loading ? (
            <Spinner />
          ) : (
            <div
              style={{ width: '100%', maxWidth: device === 'mobile' ? '360px' : '560px' }}
              className="h-full bg-white border border-border shadow-sm rounded-lg overflow-hidden transition-all duration-300"
            >
              <iframe
                title="Email Preview"
                srcDoc={html}
                className="w-full h-full border-0 bg-white"
                sandbox="allow-same-origin"
              />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Side-by-Side Template Editor Drawer */
function TemplateDrawer({ template, configs, templates, onClose, onSaved }: { template: EmailTemplateItem | null; configs: adminApi.ConfigItem[]; templates: EmailTemplateItem[]; onClose: () => void; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const isNew = !template;
  const isSystem = template?.id.startsWith('sys-');

  const [name, setName] = useState(template?.name ?? '');
  const [type, setType] = useState(template?.type ?? '');
  const [subject, setSubject] = useState(template?.subject ?? '');

  // A system-default template being customized for the first time, or an
  // existing override, is always the ACTIVE template for its type — force
  // isDefault true rather than trusting a possibly-stale flag on the record.
  const forceDefaultActive = !!(template && (template.id.startsWith('sys-') || template.id.startsWith('override-')));

  const [isDefault, setIsDefault] = useState(forceDefaultActive ? true : (template ? template.isDefault : false));
  const [isCustomType, setIsCustomType] = useState(false);

  const TEMPLATE_TYPE_LABELS: Record<string, string> = {
    interview_invite: 'Interview Invitation',
    interview_reminder: 'Interview Reminder (Candidate)',
    schedule_invite: 'Interview Scheduled (Candidate)',
    interviewer_schedule: 'Interview Scheduled (Interviewer)',
    assessment_invite: 'Assessment Invitation',
    assessment_result: 'Assessment Result',
    interview_result: 'Interview Round Result',
    tentative_offer: 'Tentative Offer Confirmation',
    offer_sent: 'Official Offer Letter',
    document_request: 'Document Submission Request',
    documents_verified: 'Documents Verified Notification',
    document_reupload: 'Document Re-upload Request',
    onboarding_welcome: 'Onboarding Welcome Email',
  };

  const handleTypeChange = (newType: string) => {
    if (newType === 'custom_manual') {
      setIsCustomType(true);
      setType('');
      setName('Custom Notification Template');
      setSubject('Important Notification');
      setHeading('Notification');
      setGreeting('Dear {{candidateName}},');
      setMessage('Hello, you have a new notification.');
      setInfoFields([]);
      setCtaText('');
      setCtaUrl('');
      setClosing('Our team will contact you shortly.');
      setSignature('Best Regards,\nHR Team\n{{companyName}}');
      setPresetTheme('Modern Blue');
      return;
    }

    setIsCustomType(false);
    setType(newType);
    const preset = DEFAULT_PRESETS[newType];
    if (preset) {
      const systemItem = templates.find(t => t.type === newType);
      const defaultSubject = systemItem ? systemItem.subject : '';

      setName(prev => !prev || prev.endsWith(' Custom') || prev.endsWith(' (Custom)') || Object.values(DEFAULT_PRESETS).some(p => prev === p.heading + ' Custom' || prev === p.heading) ? preset.heading + ' Custom' : prev);
      setSubject(defaultSubject);

      setHeading(preset.heading);
      setGreeting(preset.greeting);
      setMessage(preset.message);
      setInfoFields(preset.infoFields);
      setCtaText(preset.ctaText);
      setCtaUrl(preset.ctaUrl);
      setClosing(preset.closing);
      setSignature(preset.signature);
      setPresetTheme(preset.presetTheme);
    }
  };

  // Preset default states for No-Code builder
  const CATEGORIZED_PLACEHOLDERS: Record<string, { name: string; description: string }[]> = {
    'Candidate': [
      { name: 'candidateName', description: 'Full name of the candidate' },
      { name: 'recipientName', description: 'Name of the email recipient' },
    ],
    'Interview': [
      { name: 'jobTitle', description: 'Title of the job position' },
      { name: 'scheduledDate', description: 'Date of the interview' },
      { name: 'scheduledTime', description: 'Time of the interview' },
      { name: 'timezone', description: 'Selected timezone' },
      { name: 'interviewMode', description: 'Mode of interview (Online/Face-to-Face)' },
      { name: 'joinUrl', description: 'Direct secure meeting lobby URL' },
      { name: 'meetingLink', description: 'Meeting connection link' },
      { name: 'interviewers', description: 'Names of panelists/interviewers' },
      { name: 'durationMin', description: 'Interview duration in minutes' },
    ],
    'Recruiter': [
      { name: 'senderName', description: 'Name of recruiter / HR sender' },
      { name: 'supportEmail', description: 'Company HR support email' },
    ],
    'Company': [
      { name: 'companyName', description: 'Display name of the company' },
      { name: 'currentYear', description: 'Current calendar year' },
    ]
  };

  const CHECKLIST_FIELDS: Record<string, { id: string; label: string }[]> = {
    interview_invite: [
      { id: 'position', label: 'Position' },
      { id: 'interviewDate', label: 'Interview Date' },
      { id: 'interviewTime', label: 'Interview Time' },
      { id: 'timezone', label: 'Time Zone' },
      { id: 'interviewMode', label: 'Interview Mode' },
      { id: 'locationmeetinglink', label: 'Location / Meeting Link' },
      { id: 'interviewers', label: 'Interviewer(s)' },
      { id: 'duration', label: 'Duration' },
    ],
    interview_reminder: [
      { id: 'position', label: 'Position' },
      { id: 'date', label: 'Date' },
      { id: 'time', label: 'Time' },
      { id: 'duration', label: 'Duration' },
      { id: 'meetinglink', label: 'Meeting Link' },
    ],
    schedule_invite: [
      { id: 'position', label: 'Position' },
      { id: 'date', label: 'Date' },
      { id: 'time', label: 'Time' },
      { id: 'interviewer', label: 'Interviewer' },
      { id: 'meetinglink', label: 'Meeting Link' },
    ],
    interviewer_schedule: [
      { id: 'position', label: 'Position' },
      { id: 'date', label: 'Date' },
      { id: 'time', label: 'Time' },
      { id: 'interviewer', label: 'Interviewer' },
      { id: 'meetinglink', label: 'Meeting Link' },
    ],
    assessment_invite: [
      { id: 'assessmentName', label: 'Assessment Name' },
      { id: 'duration', label: 'Duration' },
      { id: 'deadline', label: 'Deadline' },
      { id: 'passingPercentage', label: 'Passing Percentage' },
      { id: 'totalQuestions', label: 'Total Questions' },
    ],
    assessment_result: [
      { id: 'assessment', label: 'Assessment' },
      { id: 'score', label: 'Score' },
      { id: 'passingScore', label: 'Passing Score' },
      { id: 'nextRound', label: 'Next Round' },
    ],
    interview_result: [
      { id: 'interviewRound', label: 'Interview Round' },
      { id: 'interviewDate', label: 'Interview Date' },
      { id: 'nextStage', label: 'Next Stage' },
    ],
    tentative_offer: [
      { id: 'position', label: 'Position' },
      { id: 'department', label: 'Department' },
    ],
    offer_sent: [
      { id: 'position', label: 'Position' },
      { id: 'joiningDate', label: 'Joining Date' },
      { id: 'location', label: 'Location' },
    ],
    document_request: [
      { id: 'requiredDocuments', label: 'Required Documents' },
    ],
    document_reupload: [
      { id: 'rejectedDocuments', label: 'Rejected Documents' },
      { id: 'rejectionReason', label: 'Rejection Reason' },
    ],
    onboarding_welcome: [
      { id: 'joiningDate', label: 'Joining Date' },
      { id: 'reportingTime', label: 'Reporting Time' },
      { id: 'officeLocation', label: 'Office Location' },
      { id: 'reportingManager', label: 'Reporting Manager' },
    ],
    detailed_feedback: [
      { id: 'interviewRound', label: 'Interview Round' },
      { id: 'overallScore', label: 'Overall Score' },
      { id: 'decision', label: 'Decision' },
    ]
  };

  const DEFAULT_PRESETS: Record<string, any> = {
    interview_invite: {
      heading: 'Interview Invitation',
      greeting: 'Dear {{candidateName}},',
      message: 'Thank you for your interest in joining {{companyName}}. We are pleased to invite you to attend an interview for the position of {{jobTitle}}.',
      infoFields: ['position', 'interviewdate', 'interviewtime', 'timezone', 'interviewmode', 'locationmeetinglink', 'interviewers', 'duration'],
      ctaText: 'Join Interview',
      ctaUrl: '{{joinUrl}}',
      closing: 'Kindly ensure that you join the interview a few minutes before the scheduled time. We look forward to meeting you.',
      signature: 'Best Regards,\nHR Team\n{{companyName}}',
      presetTheme: 'Modern Blue',
    },
    interview_reminder: {
      heading: 'Interview Reminder',
      greeting: 'Dear {{candidateName}},',
      message: 'Your interview is scheduled shortly. Please join a few minutes early.',
      infoFields: ['position', 'date', 'time', 'duration', 'meetinglink'],
      ctaText: 'View Interview',
      ctaUrl: '{{joinUrl}}',
      closing: 'Please ensure your device setup works correctly.',
      signature: 'Best Regards,\nHR Team\n{{companyName}}',
      presetTheme: 'Modern Blue',
    },
    schedule_invite: {
      heading: 'Interview Scheduled',
      greeting: 'Dear {{candidateName}},',
      message: 'Your interview has been scheduled. Please find the details below.',
      infoFields: ['position', 'date', 'time', 'meetinglink'],
      ctaText: 'View Schedule',
      ctaUrl: '{{meetingLink}}',
      closing: 'Please let us know if you need to reschedule.',
      signature: 'Best Regards,\nRecruiting Coordinator\n{{companyName}}',
      presetTheme: 'Modern Blue',
    },
    interviewer_schedule: {
      heading: 'Interview Scheduled',
      greeting: 'Dear {{interviewerName}},',
      message: 'You have been assigned to interview {{candidateName}}. Details below.',
      infoFields: ['position', 'date', 'time', 'interviewer', 'meetinglink'],
      ctaText: 'View Schedule',
      ctaUrl: '{{meetingLink}}',
      closing: 'Please review the candidate scorecard beforehand.',
      signature: 'Best Regards,\nOperations Team\n{{companyName}}',
      presetTheme: 'Modern Blue',
    },
    assessment_invite: {
      heading: 'Assessment Invitation',
      greeting: 'Dear {{candidateName}},',
      message: 'You have been invited to complete an online assessment for {{companyName}}.',
      infoFields: ['assessmentname', 'duration', 'deadline', 'passingpercentage', 'totalquestions'],
      ctaText: 'Start Assessment',
      ctaUrl: '{{startUrl}}',
      closing: 'Ensure you have an uninterrupted connection before starting.',
      signature: 'Best Regards,\nRecruitment Team\n{{companyName}}',
      presetTheme: 'Modern Blue',
    },
    assessment_result: {
      heading: 'Assessment Result',
      greeting: 'Dear {{candidateName}},',
      message: 'Thank you for completing the online assessment.',
      infoFields: ['assessment', 'score', 'passingscore', 'nextround'],
      ctaText: 'View Next Steps',
      ctaUrl: '{{startUrl}}',
      closing: 'We appreciate your effort and participation.',
      signature: 'Best Regards,\nHR Team\n{{companyName}}',
      presetTheme: 'Modern Blue',
    },
    interview_result: {
      heading: 'Interview Result',
      greeting: 'Dear {{candidateName}},',
      message: 'Thank you for attending the interview.',
      infoFields: ['interviewround', 'interviewdate', 'nextstage'],
      ctaText: 'View Next Steps',
      ctaUrl: '{{joinUrl}}',
      closing: 'Our team will contact you shortly.',
      signature: 'Best Regards,\nHR Team\n{{companyName}}',
      presetTheme: 'Modern Blue',
    },
    tentative_offer: {
      heading: 'Tentative Offer Confirmation',
      greeting: 'Dear {{candidateName}},',
      message: 'Congratulations! We are pleased to extend a tentative offer.',
      infoFields: ['position', 'department'],
      ctaText: 'View Offer',
      ctaUrl: '{{acceptUrl}}',
      closing: 'Please confirm your details to proceed.',
      signature: 'Best Regards,\nHR Team\n{{companyName}}',
      presetTheme: 'Modern Blue',
    },
    offer_sent: {
      heading: 'Official Offer Letter',
      greeting: 'Dear {{candidateName}},',
      message: 'Congratulations! Your official offer letter is now available.',
      infoFields: ['position', 'joiningdate', 'location'],
      ctaText: 'Download Offer Letter',
      ctaUrl: '{{acceptUrl}}',
      closing: 'We look forward to welcoming you to our organization.',
      signature: 'Best Regards,\nOnboarding Director\n{{companyName}}',
      presetTheme: 'Modern Blue',
    },
    document_request: {
      heading: 'Document Submission Required',
      greeting: 'Dear {{candidateName}},',
      message: 'Please upload the required joining documents to proceed with onboarding.',
      infoFields: ['requireddocuments'],
      ctaText: 'Upload Documents',
      ctaUrl: '{{uploadUrl}}',
      closing: 'Reach out if you have any questions.',
      signature: 'Best Regards,\nHR Operations\n{{companyName}}',
      presetTheme: 'Modern Blue',
    },
    documents_verified: {
      heading: 'Documents Verified',
      greeting: 'Dear {{candidateName}},',
      message: 'Your submitted documents have been successfully verified.',
      infoFields: [],
      ctaText: 'Continue Onboarding',
      ctaUrl: '{{uploadUrl}}',
      closing: 'Welcome to our organization.',
      signature: 'Best Regards,\nHR Team\n{{companyName}}',
      presetTheme: 'Modern Blue',
    },
    document_reupload: {
      heading: 'Document Verification Corrections',
      greeting: 'Dear {{candidateName}},',
      message: 'Some submitted documents require corrections.',
      infoFields: ['rejecteddocuments', 'rejectionreason'],
      ctaText: 'Upload Correct Documents',
      ctaUrl: '{{uploadUrl}}',
      closing: 'Please re-upload as soon as possible.',
      signature: 'Best Regards,\nVerification Team\n{{companyName}}',
      presetTheme: 'Modern Blue',
    },
    onboarding_welcome: {
      heading: 'Welcome to our Organization!',
      greeting: 'Dear {{candidateName}},',
      message: 'We are excited to have you join our organization.',
      infoFields: ['joiningdate', 'reportingtime', 'officelocation', 'reportingmanager'],
      ctaText: 'Start Onboarding',
      ctaUrl: '{{startOnboardingUrl}}',
      closing: 'Looking forward to a great start.',
      signature: 'Best Regards,\nOnboarding Specialist\n{{companyName}}',
      presetTheme: 'Modern Blue',
    }
  };

  const initialJson = useMemo(() => {
    if (!template?.body) return null;
    try {
      if (template.body.trim().startsWith('{') && template.body.trim().endsWith('}')) {
        return JSON.parse(template.body);
      }
    } catch(e) {}
    return null;
  }, [template]);

  const presetDefault = useMemo(() => {
    const t = template?.type || type || 'interview_invite';
    return DEFAULT_PRESETS[t] || {
      heading: 'Notification',
      greeting: 'Dear {{candidateName}},',
      message: template?.body || 'Hello, you have a new notification.',
      infoFields: [],
      ctaText: '',
      ctaUrl: '',
      closing: '',
      signature: 'Regards,\nTeam',
      presetTheme: 'Modern Blue',
    };
  }, [template, type]);

  const [heading, setHeading] = useState(initialJson?.heading ?? presetDefault.heading);
  const [greeting, setGreeting] = useState(initialJson?.greeting ?? presetDefault.greeting);
  const [message, setMessage] = useState(initialJson?.message ?? presetDefault.message);
  const [infoFields, setInfoFields] = useState<string[]>(initialJson?.infoFields ?? presetDefault.infoFields);
  const [ctaText, setCtaText] = useState(initialJson?.ctaText ?? presetDefault.ctaText);
  const [ctaUrl, setCtaUrl] = useState(initialJson?.ctaUrl ?? presetDefault.ctaUrl);
  const [closing, setClosing] = useState(initialJson?.closing ?? presetDefault.closing);
  const [signature, setSignature] = useState(initialJson?.signature ?? presetDefault.signature);
  const [presetTheme, setPresetTheme] = useState(initialJson?.presetTheme ?? presetDefault.presetTheme);
  const [useCustomLogo, setUseCustomLogo] = useState<boolean>(initialJson?.useCustomLogo ?? false);
  const [customLogoId, setCustomLogoId] = useState<string>(initialJson?.customLogoId ?? '');
  const [logoWidth, setLogoWidth] = useState<number>(initialJson?.logoWidth ?? 220);

  const [activeTab, setActiveTab] = useState<'preview' | 'placeholders'>('preview');
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);

  // Input focus tracking
  const [lastFocusedField, setLastFocusedField] = useState<string | null>(null);
  const [lastSelectionStart, setLastSelectionStart] = useState<number>(0);
  const [lastSelectionEnd, setLastSelectionEnd] = useState<number>(0);

  const handleFocus = (fieldId: string, e: any) => {
    setLastFocusedField(fieldId);
    setLastSelectionStart(e.target.selectionStart || 0);
    setLastSelectionEnd(e.target.selectionEnd || 0);
  };

  const insertFormatting = (fieldId: string, tagOpen: string, tagClose: string) => {
    const map: Record<string, { value: string; setter: (v: string) => void }> = {
      message: { value: message, setter: setMessage },
      closing: { value: closing, setter: setClosing },
      signature: { value: signature, setter: setSignature },
    };
    const target = map[fieldId];
    if (target) {
      const val = target.value;
      const selectedText = val.substring(lastSelectionStart, lastSelectionEnd);
      const newVal = val.substring(0, lastSelectionStart) + tagOpen + selectedText + tagClose + val.substring(lastSelectionEnd);
      target.setter(newVal);
    }
  };

  const handleReset = () => {
    const confirmReset = window.confirm('Are you sure you want to reset this template back to the original visual default settings?');
    if (!confirmReset) return;
    
    setHeading(presetDefault.heading);
    setGreeting(presetDefault.greeting);
    setMessage(presetDefault.message);
    setInfoFields(presetDefault.infoFields);
    setCtaText(presetDefault.ctaText);
    setCtaUrl(presetDefault.ctaUrl);
    setClosing(presetDefault.closing);
    setSignature(presetDefault.signature);
    setPresetTheme(presetDefault.presetTheme);
    setUseCustomLogo(false);
    setCustomLogoId('');
    setLogoWidth(220);
  };

  const save = useMutation({
    mutationFn: async () => {
      const serializedBody = JSON.stringify({
        heading,
        greeting,
        message,
        infoFields,
        ctaText,
        ctaUrl,
        closing,
        signature,
        presetTheme,
        useCustomLogo,
        customLogoId,
        logoWidth
      });

      if (template) {
        await adminApi.updateEmailTemplate(template.id, { name, subject, body: serializedBody, isDefault });
      } else {
        await adminApi.createEmailTemplate({ name, type, subject, body: serializedBody, isDefault });
      }
    },
    onSuccess: () => { 
      toast.success(template ? 'Template override saved' : 'Custom template created'); 
      onSaved(); 
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not save')),
  });

  const applyLogoMutation = useMutation({
    mutationFn: async () => {
      await adminApi.applyLogoToAllTemplates({ useCustomLogo, customLogoId, logoWidth });
    },
    onSuccess: () => {
      toast.success('Logo and width applied to all email templates successfully!');
      queryClient.invalidateQueries({ queryKey: ['admin-email-templates'] });
      queryClient.invalidateQueries({ queryKey: ['system-config'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not apply logo to all templates')),
  });

  const handleSaveCheck = () => {
    if (!name.trim()) {
      toast.error('Template Name is required');
      return;
    }
    if (!type.trim()) {
      toast.error('Template Type (System ID) is required');
      return;
    }
    if (!/^[a-z0-9_]+$/.test(type.trim())) {
      toast.error('Template Type must only contain lowercase letters, numbers, and underscores (e.g. custom_template)');
      return;
    }
    if (!subject.trim()) {
      toast.error('Subject Line is required');
      return;
    }
    save.mutate();
  };

  // Debounced Live Preview compilation passing unsaved parameters
  useEffect(() => {
    if (activeTab !== 'preview') return;
    setPreviewLoading(true);
    
    // Get active branding configs
    const brand = {
      companyName: configs.find(c => c.key === 'general.company_name')?.value || 'AgnoHire',
      logoId: useCustomLogo && customLogoId ? customLogoId : (configs.find(c => c.key === 'email.brand_logo')?.value || ''),
      logoWidth: logoWidth,
      primaryColor: configs.find(c => c.key === 'email.brand_primary_color')?.value || '#2563eb',
      secondaryColor: configs.find(c => c.key === 'email.brand_secondary_color')?.value || '#2563eb',
      buttonColor: configs.find(c => c.key === 'email.brand_button_color')?.value || '#2563eb',
      buttonStyle: configs.find(c => c.key === 'email.brand_button_style')?.value || 'rounded',
      fontFamily: configs.find(c => c.key === 'email.brand_font')?.value || 'Segoe UI',
      footerBg: configs.find(c => c.key === 'email.brand_footer_bg')?.value || '#2563eb',
      textColor: configs.find(c => c.key === 'email.brand_text_color')?.value || '#1a1a2e',
      website: configs.find(c => c.key === 'email.brand_website')?.value || '',
      phone: configs.find(c => c.key === 'email.brand_phone')?.value || '',
      address: configs.find(c => c.key === 'email.brand_address')?.value || '',
      copyright: configs.find(c => c.key === 'email.brand_copyright')?.value || '',
      linkedin: configs.find(c => c.key === 'email.brand_social_linkedin')?.value || '',
      facebook: configs.find(c => c.key === 'email.brand_social_facebook')?.value || '',
      twitter: configs.find(c => c.key === 'email.brand_social_twitter')?.value || '',
      bannerUrl: configs.find(c => c.key === 'email.brand_banner_url')?.value || '',
    };

    const bodyJson = JSON.stringify({
      heading,
      greeting,
      message,
      infoFields,
      ctaText,
      ctaUrl,
      closing,
      signature,
      presetTheme,
      useCustomLogo,
      customLogoId,
      logoWidth
    });

    const timeout = setTimeout(() => {
      adminApi.previewEmailTemplate(subject, bodyJson, 'default', brand, template?.type || type)
        .then((res) => setPreviewHtml(res.html))
        .catch(() => {})
        .finally(() => setPreviewLoading(false));
    }, 450);

    return () => clearTimeout(timeout);
  }, [subject, heading, greeting, message, infoFields, ctaText, ctaUrl, closing, signature, presetTheme, useCustomLogo, customLogoId, logoWidth, activeTab, configs, template, type]);

  const insertPlaceholder = (phName: string) => {
    if (!lastFocusedField) {
      toast.error('Please click inside an input text field to place the cursor before selecting a placeholder');
      return;
    }
    const tag = `{{${phName}}}`;
    
    const map: Record<string, { value: string; setter: (v: string) => void }> = {
      subject: { value: subject, setter: setSubject },
      heading: { value: heading, setter: setHeading },
      greeting: { value: greeting, setter: setGreeting },
      message: { value: message, setter: setMessage },
      ctaText: { value: ctaText, setter: setCtaText },
      ctaUrl: { value: ctaUrl, setter: setCtaUrl },
      closing: { value: closing, setter: setClosing },
      signature: { value: signature, setter: setSignature },
    };

    const target = map[lastFocusedField];
    if (target) {
      const val = target.value;
      const newVal = val.substring(0, lastSelectionStart) + tag + val.substring(lastSelectionEnd);
      target.setter(newVal);
      const newPos = lastSelectionStart + tag.length;
      setLastSelectionStart(newPos);
      setLastSelectionEnd(newPos);
    }
  };

  const currentType = template?.type || type;
  const availableCheckboxes = CHECKLIST_FIELDS[currentType] || [];

  const THEME_PRESETS = [
    'Modern Blue', 'Corporate White', 'Executive Dark', 'Minimal', 'Elegant',
    'Professional Gradient', 'ATS Classic', 'Enterprise', 'Glass Modern', 'Premium Blue'
  ];

  return (
    <Drawer 
      open 
      onClose={onClose} 
      title={isNew ? 'New Custom Template' : `Customize template: ${template.name}`} 
      subtitle={template?.type ? `Type: ${template.type}` : 'Create custom transactional template'}
      size="2xl"
      footer={
        <div className="flex justify-between items-center w-full">
          <Button variant="outline" size="sm" onClick={handleReset}>Reset to Default</Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button loading={save.isPending} disabled={save.isPending} onClick={handleSaveCheck}>
              {template ? 'Save Override' : 'Create'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-6 h-full min-h-[500px]">
        {/* Left Side: Form Editor */}
        <div className="space-y-4 pr-2 border-r border-border/40 overflow-y-auto min-w-0">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-text-secondary">Template Name</label>
              <Input 
                value={name} 
                onChange={(e) => setName(e.target.value)} 
                disabled={isSystem}
                placeholder="e.g. Interview Schedule"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-text-secondary">Template Type (System ID)</label>
              {template ? (
                <p className="text-xs font-mono bg-surface-raised px-3 py-2 rounded-lg border border-border/60 text-text-secondary h-9 flex items-center">{template.type}</p>
              ) : (
                <select
                  value={isCustomType ? 'custom_manual' : type}
                  onChange={(e) => handleTypeChange(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-bg px-3 text-xs text-text-primary focus:border-accent focus:outline-none"
                >
                  <option value="" disabled>Select template type</option>
                  {Object.keys(DEFAULT_PRESETS).map((tKey) => (
                    <option key={tKey} value={tKey}>
                      {TEMPLATE_TYPE_LABELS[tKey] || DEFAULT_PRESETS[tKey].heading} ({tKey})
                    </option>
                  ))}
                  <option value="custom_manual">Custom (Enter manually)</option>
                </select>
              )}
              {isCustomType && !template && (
                <div className="mt-2 animate-fadeIn">
                  <Input
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    placeholder="Enter custom template type ID (e.g. my_template)"
                    className="text-xs"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-text-secondary">Email Theme Preset</label>
              <select
                value={presetTheme}
                onChange={(e) => setPresetTheme(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-bg px-3 text-xs text-text-primary focus:border-accent focus:outline-none"
              >
                {THEME_PRESETS.map(preset => (
                  <option key={preset} value={preset}>{preset}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-text-secondary">Subject Line</label>
              <Input 
                id="subject"
                value={subject} 
                onChange={(e) => setSubject(e.target.value)}
                onBlur={(e) => handleFocus('subject', e)}
                placeholder="Supports {{placeholders}}"
              />
            </div>
          </div>

          <div className="space-y-2 bg-surface-raised p-3 rounded-lg border border-border/60">
            <label className="flex items-center gap-2 text-xs font-semibold text-text-secondary cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={useCustomLogo} 
                  onChange={(e) => setUseCustomLogo(e.target.checked)} 
                  className="h-3.5 w-3.5 rounded border-border text-accent focus:ring-accent" 
                /> 
                Use Custom Logo for this template
              </label>
              {useCustomLogo && (
                <div className="space-y-3 mt-2 bg-surface p-3 rounded border border-border/40">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-bg">
                      {customLogoId ? (
                        <img 
                          src={customLogoId.startsWith('http') ? customLogoId : `/api/system/branding/general.company_logo?v=${encodeURIComponent(customLogoId)}`} 
                          alt="custom logo" 
                          className="h-full w-full object-contain" 
                        />
                      ) : (
                        <ImageIcon className="h-5 w-5 text-text-muted" />
                      )}
                    </div>
                    <FileUploadButton 
                      accept="image/png,image/svg+xml,image/jpeg"
                      label="Upload Custom Logo"
                      onUploaded={(meta) => setCustomLogoId(meta.id)}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] text-text-muted">Or enter external logo URL:</label>
                    <Input 
                      value={customLogoId} 
                      onChange={e => setCustomLogoId(e.target.value)} 
                      placeholder="e.g. https://mycompany.com/logo.png"
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <label className="block text-[10px] text-text-muted">Logo Width: <span className="font-semibold text-text-secondary">{logoWidth}px</span></label>
                      <button 
                        type="button" 
                        onClick={() => setLogoWidth(220)} 
                        className="text-[9px] text-accent hover:underline"
                      >
                        Reset Default
                      </button>
                    </div>
                    <input 
                      type="range" 
                      min="50" 
                      max="500" 
                      step="10"
                      value={logoWidth} 
                      onChange={e => setLogoWidth(Number(e.target.value))} 
                      className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-accent"
                    />
                  </div>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm("Are you sure you want to apply this logo and custom size to all email templates across the system? This will also update the global company branding defaults.")) {
                          applyLogoMutation.mutate();
                        }
                      }}
                      disabled={applyLogoMutation.isPending}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 border border-border text-[10px] font-semibold rounded-md text-text bg-surface-raised hover:bg-bg/40 focus:outline-none disabled:opacity-50 transition-colors shadow-sm"
                    >
                      {applyLogoMutation.isPending ? 'Applying...' : 'Apply Logo & Size to All Templates'}
                    </button>
                  </div>
                </div>
              )}
            </div>

          <hr className="border-border/60" />

          {/* No-Code Section fields */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-text-secondary">Email Heading</label>
            <Input 
              id="heading"
              value={heading} 
              onChange={(e) => setHeading(e.target.value)}
              onBlur={(e) => handleFocus('heading', e)}
              placeholder="e.g. Interview Invitation"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-text-secondary">Greeting</label>
            <Input 
              id="greeting"
              value={greeting} 
              onChange={(e) => setGreeting(e.target.value)}
              onBlur={(e) => handleFocus('greeting', e)}
              placeholder="e.g. Dear {{candidateName}},"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-text-secondary">Main Message Content</label>
            <div className="flex gap-1.5 mb-1 bg-surface-raised p-1 rounded-md border border-border/60 max-w-max">
              <button type="button" onClick={() => insertFormatting('message', '<strong>', '</strong>')} className="px-2 py-0.5 text-xs font-bold border border-border bg-surface hover:bg-bg rounded">B</button>
              <button type="button" onClick={() => insertFormatting('message', '<em>', '</em>')} className="px-2 py-0.5 text-xs italic border border-border bg-surface hover:bg-bg rounded">I</button>
              <button type="button" onClick={() => insertFormatting('message', '<u>', '</u>')} className="px-2 py-0.5 text-xs underline border border-border bg-surface hover:bg-bg rounded">U</button>
              <button type="button" onClick={() => {
                const url = window.prompt('Enter link URL:');
                if (url) insertFormatting('message', `<a href="${url}" style="color:#0B5ED7;text-decoration:underline;">`, '</a>');
              }} className="px-2 py-0.5 text-xs border border-border bg-surface hover:bg-bg rounded">Link</button>
            </div>
            <Textarea 
              id="message"
              rows={5} 
              value={message} 
              onChange={(e) => setMessage(e.target.value)}
              onBlur={(e) => handleFocus('message', e)}
              placeholder="Enter main paragraph text."
              className="text-xs leading-relaxed"
            />
          </div>

          {availableCheckboxes.length > 0 && (
            <div>
              <label className="mb-2 block text-xs font-semibold text-text-secondary">Information Table Fields</label>
              <div className="grid grid-cols-2 gap-2 bg-surface-raised p-3 rounded-lg border border-border/60">
                {availableCheckboxes.map(cb => {
                  const normalized = cb.id.toLowerCase().replace(/[^a-z0-9]/g, '');
                  const checked = infoFields.some(f => f.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized);
                  return (
                    <label key={cb.id} className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer hover:text-text-primary">
                      <input 
                        type="checkbox" 
                        checked={checked} 
                        onChange={(e) => {
                          if (e.target.checked) {
                            setInfoFields([...infoFields, cb.id]);
                          } else {
                            setInfoFields(infoFields.filter(f => f.toLowerCase().replace(/[^a-z0-9]/g, '') !== normalized));
                          }
                        }}
                        className="h-3.5 w-3.5 rounded border-border text-accent focus:ring-accent" 
                      />
                      {cb.label}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-text-secondary">CTA Button Text</label>
              <Input 
                id="ctaText"
                value={ctaText} 
                onChange={(e) => setCtaText(e.target.value)}
                onBlur={(e) => handleFocus('ctaText', e)}
                placeholder="e.g. Join Interview"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-text-secondary">CTA Target URL</label>
              <Input 
                id="ctaUrl"
                value={ctaUrl} 
                onChange={(e) => setCtaUrl(e.target.value)}
                onBlur={(e) => handleFocus('ctaUrl', e)}
                placeholder="e.g. {{joinUrl}}"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-text-secondary">Closing Message</label>
            <Input 
              id="closing"
              value={closing} 
              onChange={(e) => setClosing(e.target.value)}
              onBlur={(e) => handleFocus('closing', e)}
              placeholder="e.g. We look forward to meeting you."
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-text-secondary">Signature Block</label>
            <Textarea 
              id="signature"
              rows={3} 
              value={signature} 
              onChange={(e) => setSignature(e.target.value)}
              onBlur={(e) => handleFocus('signature', e)}
              placeholder="Enter recruiter name / designations."
              className="text-xs"
            />
          </div>

          {!forceDefaultActive && (
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
              />
              Default template for this type
            </label>
          )}
        </div>

        {/* Right Side: Preview & Helper Side Panel */}
        <div className="flex flex-col h-full min-w-0 bg-surface-raised rounded-xl border border-border/85 overflow-hidden">
          {/* Tabs */}
          <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('preview')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${activeTab === 'preview' ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-secondary'}`}
              >
                Live Preview
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('placeholders')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${activeTab === 'placeholders' ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-secondary'}`}
              >
                Placeholders Picker
              </button>
            </div>
            
            {activeTab === 'preview' && (
              <div className="flex rounded-md bg-surface-raised p-0.5 border border-border">
                <div className="rounded-md p-1 bg-surface text-accent" title="Desktop Preview">
                  <Laptop className="h-3.5 w-3.5" />
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 p-4 overflow-auto flex flex-col">
            {activeTab === 'preview' ? (
              <div className="flex-1 flex justify-center items-center min-h-[300px]">
                {previewLoading && !previewHtml ? (
                  <Spinner />
                ) : (
                  <div
                    style={{ width: '100%', maxWidth: '1024px' }}
                    className="h-full min-h-[480px] bg-white border border-border shadow-sm rounded-lg overflow-auto transition-all duration-350"
                  >
                    <iframe
                      title="Live Email Preview"
                      srcDoc={previewHtml}
                      className="w-full h-full border-0 bg-white"
                      sandbox="allow-same-origin"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <h4 className="text-xs font-semibold text-text-primary mb-1">Visual Placeholders Picker</h4>
                  <p className="text-[11px] text-text-muted">Click any parameter below to insert it at your currently focused input cursor position.</p>
                </div>
                <div className="space-y-4">
                  {Object.entries(CATEGORIZED_PLACEHOLDERS).map(([categoryName, phs]) => (
                    <div key={categoryName} className="space-y-1.5">
                      <h5 className="text-[10px] font-bold uppercase tracking-wider text-text-muted">{categoryName}</h5>
                      <div className="grid grid-cols-1 gap-1.5">
                        {phs.map((ph) => (
                          <button
                            key={ph.name}
                            type="button"
                            onClick={() => insertPlaceholder(ph.name)}
                            className="flex items-center justify-between text-left p-2 rounded-lg border border-border bg-surface hover:bg-accent/5 hover:border-accent/40 transition-all group"
                          >
                            <div>
                              <code className="text-xs font-mono text-accent font-semibold group-hover:text-accent-hover">{`{{${ph.name}}}`}</code>
                              <span className="text-[10px] text-text-muted block mt-0.5">{ph.description}</span>
                            </div>
                            <ChevronRight className="h-3 w-3 text-text-muted group-hover:text-accent transition-colors" />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Drawer>
  );
}

/** Bulk result emails – lists candidates with a finalized Pass/Fail outcome */
function ResultEmailsPanel() {
  const qc = useQueryClient();
  const { hasPermission } = useAuthStore();
  const canInterview = hasPermission(PERMISSIONS.INTERVIEW_DECIDE);
  const canAssessment = hasPermission(PERMISSIONS.ASSESSMENT_VIEW);

  const categories = useMemo(() => {
    const list: { key: ResultCategory; label: string }[] = [];
    if (canAssessment) list.push({ key: 'ASSESSMENT', label: 'Assessment' });
    if (canInterview) list.push({ key: 'INTERVIEW', label: 'Interview' });
    if (canInterview) list.push({ key: 'SCHEDULE', label: 'Schedule' });
    return list;
  }, [canAssessment, canInterview]);

  const [category, setCategory] = useState<ResultCategory>(categories[0]?.key ?? 'INTERVIEW');
  const [outcome, setOutcome] = useState<'PASS' | 'FAIL'>('PASS');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [force, setForce] = useState(false);

  const reset = () => setSelected(new Set());

  const { data: rows = [], isLoading } = useQuery<ResultRow[]>({
    queryKey: ['result-candidates', category, outcome],
    enabled: categories.some((c) => c.key === category),
    queryFn: async () => {
      if (category === 'ASSESSMENT') {
        const res = await assessmentApi.fetchAssignments({
          status: 'EVALUATED',
          passed: outcome === 'PASS',
          limit: 500,
        });
        return res.items.map((a) => ({
          id: a.id,
          candidateName: a.candidate.fullName,
          candidateEmail: a.candidate.email || null,
          percentageScore: a.percentageScore,
          decidedAt: a.submittedAt ?? a.createdAt,
          lastEmailedAt: null,
        }));
      }
      const res = await interviewApi.fetchResultCandidates(outcome, category === 'SCHEDULE' ? 'SCHEDULED' : 'AI');
      return res.items.map((c) => ({
        id: c.interviewId,
        candidateName: c.candidateName,
        candidateEmail: c.candidateEmail,
        percentageScore: c.percentageScore,
        decidedAt: c.decidedAt,
        lastEmailedAt: c.lastEmailedAt,
      }));
    },
  });

  const isLocked = (c: ResultRow) => !c.candidateEmail;

  const send = useMutation({
    mutationFn: async (ids: string[]) => {
      if (category === 'ASSESSMENT') {
        const r = await assessmentApi.bulkSendAssessmentResultEmail({ assignmentIds: ids, force });
        return { sent: r.sent, failed: r.failed, skipped: r.skipped, alreadySent: 0, notConfigured: 0 };
      }
      const { result } = await interviewApi.sendBulkResults(ids, force);
      return {
        sent: result.sent,
        failed: result.failed,
        skipped: 0,
        alreadySent: result.skippedAlreadySent ?? 0,
        notConfigured: result.skippedNotConfigured ?? 0,
      };
    },
    onSuccess: ({ sent, failed, skipped, alreadySent, notConfigured }) => {
      if (sent === 0 && notConfigured > 0) {
        toast.error('Email is not configured — add SMTP settings in System Config → Email, then retry.', { duration: 6000 });
        return;
      }
      const parts = [`${sent} sent`];
      if (alreadySent) parts.push(`${alreadySent} already emailed`);
      else if (skipped) parts.push(`${skipped} skipped`);
      if (notConfigured) parts.push(`${notConfigured} skipped (SMTP off)`);
      if (failed) parts.push(`${failed} failed`);
      toast[failed > 0 ? 'error' : 'success'](`Result emails: ${parts.join(', ')}`);
      reset();
      qc.invalidateQueries({ queryKey: ['result-candidates'] });
      qc.invalidateQueries({ queryKey: ['assignments'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Could not send result emails')),
  });

  if (categories.length === 0) return null;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectable = rows.filter((i) => !isLocked(i));
  const allSelected = selectable.length > 0 && selectable.every((i) => selected.has(i.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(selectable.map((i) => i.id)));

  const CatBtn = ({ value, label }: { value: ResultCategory; label: string }) => (
    <button
      type="button"
      onClick={() => { setCategory(value); reset(); }}
      className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
        category === value ? 'border-accent text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary'
      }`}
    >
      {label}
    </button>
  );

  const OutcomeBtn = ({ value, label }: { value: 'PASS' | 'FAIL'; label: string }) => (
    <button
      type="button"
      onClick={() => { setOutcome(value); reset(); }}
      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
        outcome === value ? 'bg-accent text-accent-fg' : 'text-text-secondary hover:bg-surface-raised'
      }`}
    >
      {label}
    </button>
  );

  const sourceLabel = category === 'ASSESSMENT' ? 'assessments' : category === 'SCHEDULE' ? 'scheduled interviews' : 'interviews';

  return (
    <div className="mt-8 rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-5 pt-3">
        <Users className="mb-2 h-4 w-4 text-accent" />
        <h2 className="mb-2 mr-3 text-sm font-semibold text-text-primary">Send result emails</h2>
        <div className="flex items-center gap-1">
          {categories.map((c) => <CatBtn key={c.key} value={c.key} label={c.label} />)}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <span className="text-xs text-text-muted">Finalized {sourceLabel} by outcome</span>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-surface-raised p-1 border border-border">
            <OutcomeBtn value="PASS" label="Passed" />
            <OutcomeBtn value="FAIL" label="Failed" />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-text-muted" title="Actually re-send to candidates who were already emailed (otherwise they're skipped)">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border accent-accent"
            />
            Re-send already emailed
          </label>
          <Button
            size="sm"
            loading={send.isPending}
            disabled={selected.size === 0}
            onClick={() => send.mutate([...selected])}
          >
            <Send className="h-4 w-4" /> Send to {selected.size || 0}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Mail className="h-7 w-7" />} title="No candidates" description={`No ${sourceLabel} finalized as ${outcome === 'PASS' ? 'passed' : 'failed'} yet.`} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-border text-left uppercase tracking-wide text-text-muted bg-surface-raised">
              <tr>
                <th className="px-5 py-2.5 font-semibold w-10 text-left"><input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 rounded border-border" /></th>
                <th className="px-5 py-2.5 font-semibold text-left">Candidate</th>
                <th className="px-5 py-2.5 font-semibold text-left">Email</th>
                <th className="px-5 py-2.5 font-semibold text-left">Score</th>
                <th className="px-5 py-2.5 font-semibold text-left">Decided</th>
                <th className="px-5 py-2.5 font-semibold text-left">Last emailed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-border/60 last:border-0 hover:bg-surface-raised/40 transition-colors">
                  <td className="px-5 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      disabled={isLocked(c)}
                      title={isLocked(c) ? 'No email address on file' : c.lastEmailedAt && !force ? 'Already emailed — will be skipped unless “Re-send already emailed” is on' : undefined}
                      className="h-4 w-4 rounded border-border disabled:opacity-40"
                    />
                  </td>
                  <td className="px-5 py-2.5 text-text-primary font-medium">{c.candidateName}</td>
                  <td className="px-5 py-2.5 text-text-secondary">{c.candidateEmail ?? <span className="text-text-muted">no email</span>}</td>
                  <td className="px-5 py-2.5 text-text-secondary">{c.percentageScore != null ? `${Math.round(c.percentageScore)}%` : '—'}</td>
                  <td className="px-5 py-2.5 text-text-secondary">{c.decidedAt ? format(new Date(c.decidedAt), 'dd MMM yyyy') : '—'}</td>
                  <td className="px-5 py-2.5">{c.lastEmailedAt ? <Badge variant="success">Sent {format(new Date(c.lastEmailedAt), 'dd MMM')}</Badge> : <span className="text-text-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type ResultCategory = 'ASSESSMENT' | 'INTERVIEW' | 'SCHEDULE';

interface ResultRow {
  id: string;
  candidateName: string;
  candidateEmail: string | null;
  percentageScore: number | null;
  decidedAt: string | null;
  lastEmailedAt: string | null;
}
