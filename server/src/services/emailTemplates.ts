import { configService } from './configService.js';
import { BRAND_LOGO_CID } from './mailerService.js';
import { CONFIG_KEYS } from '@agnohire/shared';
import { prisma } from '../config/database.js';
import { buildEmailVariables } from './emailVariableBuilder.js';
import { compileTemplate, SYSTEM_TEMPLATES } from './emailTemplateMetadata.js';
import { renderTheme, getButtonStyle, type BrandSettings, resolveEmailLogo } from './emailThemeService.js';

/** Helper to render information tables inside content body */
function buildInfoTable(rows: { label: string; value: string | undefined | null }[]): string {
  const activeRows = rows.filter(r => r.value !== undefined && r.value !== null && String(r.value).trim() !== '');
  if (activeRows.length === 0) return '';
  
  return `
    <table width="100%" cellpadding="10" cellspacing="0"
           style="margin:25px 0;border:1px solid #dcdcdc;border-collapse:collapse;background:#fafafa;">
      ${activeRows.map(r => `
        <tr>
          <td width="35%" style="border-bottom:1px solid #dcdcdc;font-size:14px;color:#333333;font-family:Arial,sans-serif;word-break:break-word;overflow-wrap:anywhere;"><strong>${r.label}</strong></td>
          <td style="border-bottom:1px solid #dcdcdc;font-size:14px;color:#555555;font-family:Arial,sans-serif;word-break:break-word;overflow-wrap:anywhere;">${r.value}</td>
        </tr>
      `).join('')}
    </table>
  `;
}

/** Helper to render primary CTA buttons matching brand styles */
function buildCtaButton(label: string, url: string | undefined | null, brand: BrandSettings): string {
  if (!url || String(url).trim() === '') return '';
  const btnStyle = getButtonStyle(brand);
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:25px 0;text-align:center;">
      <tr>
        <td align="center">
          <a href="${url}" style="${btnStyle}">
            ${label}
          </a>
        </td>
      </tr>
    </table>
  `;
}

/** Wraps body content in a minimal, client-safe HTML shell with the brand logo. */
export async function shell(title: string, bodyHtml: string): Promise<string> {
  const company = await configService.getString(CONFIG_KEYS.COMPANY_NAME, 'AgnoHire');
  const website = await configService.getString(CONFIG_KEYS.EMAIL_BRAND_WEBSITE, 'https://agnohire.com');
  const phone = await configService.getString(CONFIG_KEYS.EMAIL_BRAND_PHONE, '+1 (555) 019-9922');
  const address = await configService.getString(CONFIG_KEYS.EMAIL_BRAND_ADDRESS, '');
  const copyright = await configService.getString(CONFIG_KEYS.EMAIL_BRAND_COPYRIGHT, '');
  const linkedin = await configService.getString(CONFIG_KEYS.EMAIL_BRAND_SOCIAL_LINKEDIN, '');
  const facebook = await configService.getString(CONFIG_KEYS.EMAIL_BRAND_SOCIAL_FACEBOOK, '');
  const twitter = await configService.getString(CONFIG_KEYS.EMAIL_BRAND_SOCIAL_TWITTER, '');

  const brand: BrandSettings = {
    companyName: company,
    primaryColor: '#0B5ED7',
    secondaryColor: '#2563eb',
    accentColor: '#0B5ED7',
    buttonColor: '#0B5ED7',
    buttonStyle: 'rounded',
    fontFamily: 'Arial',
    footerBg: '#ffffff',
    textColor: '#333333',
    website,
    phone,
    address,
    copyright,
    linkedin,
    facebook,
    twitter,
    logoCid: BRAND_LOGO_CID,
  };

  return renderTheme('default', title, bodyHtml, brand);
}

/** Resolves template contents (custom database override or default fallback) and renders the HTML */
export async function resolveTemplate(
  type: string,
  variables: Record<string, any>,
  isPreview = false,
  overrides?: { subject?: string; body?: string }
): Promise<{ subject: string; html: string }> {
  // Query database for custom tenant overrides: must be explicitly marked as the active default template
  let custom = await prisma.emailTemplate.findFirst({
    where: { type, isDefault: true, deletedAt: null }
  });

  // If no custom template is explicitly set as default, fall back to the customized in-place override if it exists
  if (!custom) {
    custom = await prisma.emailTemplate.findUnique({
      where: { id: `override-${type}` }
    });
  }

  const sys = SYSTEM_TEMPLATES.find(t => t.type === type);

  const subjectTemplate = overrides?.subject !== undefined ? overrides.subject : (custom?.subject || sys?.defaultSubject || '');
  
  // Resolve branding config
  const company = await configService.getString(CONFIG_KEYS.COMPANY_NAME, 'AgnoHire');
  const website = await configService.getString(CONFIG_KEYS.EMAIL_BRAND_WEBSITE, 'https://agnohire.com');
  const phone = await configService.getString(CONFIG_KEYS.EMAIL_BRAND_PHONE, '+1 (555) 019-9922');
  const address = await configService.getString(CONFIG_KEYS.EMAIL_BRAND_ADDRESS, '');
  const copyright = await configService.getString(CONFIG_KEYS.EMAIL_BRAND_COPYRIGHT, '');
  const linkedin = await configService.getString(CONFIG_KEYS.EMAIL_BRAND_SOCIAL_LINKEDIN, '');
  const facebook = await configService.getString(CONFIG_KEYS.EMAIL_BRAND_SOCIAL_FACEBOOK, '');
  const twitter = await configService.getString(CONFIG_KEYS.EMAIL_BRAND_SOCIAL_TWITTER, '');
  const defaultLogoWidth = Number(await configService.getString(CONFIG_KEYS.EMAIL_BRAND_LOGO_WIDTH, '220'));

  const configPrimaryColor = await configService.getString(CONFIG_KEYS.EMAIL_BRAND_PRIMARY_COLOR, '#5b5bd6');
  const configSecondaryColor = await configService.getString(CONFIG_KEYS.EMAIL_BRAND_SECONDARY_COLOR, '#2563eb');
  const configButtonColor = await configService.getString(CONFIG_KEYS.EMAIL_BRAND_BUTTON_COLOR, '#2563eb');
  const configButtonStyle = await configService.getString(CONFIG_KEYS.EMAIL_BRAND_BUTTON_STYLE, 'rounded') as any;
  const configFontFamily = await configService.getString(CONFIG_KEYS.EMAIL_BRAND_FONT, 'Segoe UI');
  const configFooterBg = await configService.getString(CONFIG_KEYS.EMAIL_BRAND_FOOTER_BG, '#2563eb');
  const configTextColor = await configService.getString(CONFIG_KEYS.EMAIL_BRAND_TEXT_COLOR, '#1a1a2e');
  const configBannerUrl = await configService.getString(CONFIG_KEYS.EMAIL_BRAND_BANNER_URL, '');

  const rawBodyText = overrides?.body !== undefined ? overrides.body : (custom?.body || sys?.defaultBody || '');
  let isJsonBody = false;
  let jsonConfig: any = null;
  if (rawBodyText.trim().startsWith('{') && rawBodyText.trim().endsWith('}')) {
    try {
      jsonConfig = JSON.parse(rawBodyText);
      isJsonBody = true;
    } catch (e) {}
  }

  const presetThemes: Record<string, { primary: string; secondary: string }> = {
    'Modern Blue': { primary: '#0B5ED7', secondary: '#2563eb' },
    'Corporate White': { primary: '#1e293b', secondary: '#475569' },
    'Executive Dark': { primary: '#0f172a', secondary: '#334155' },
    'Minimal': { primary: '#000000', secondary: '#404040' },
    'Elegant': { primary: '#4c1d95', secondary: '#6d28d9' },
    'Professional Gradient': { primary: '#0284c7', secondary: '#0369a1' },
    'ATS Classic': { primary: '#15803d', secondary: '#166534' },
    'Enterprise': { primary: '#b91c1c', secondary: '#991b1b' },
    'Glass Modern': { primary: '#0d9488', secondary: '#0f766e' },
    'Premium Blue': { primary: '#1e1b4b', secondary: '#312e81' },
  };

  let primaryColor = configPrimaryColor;
  let secondaryColor = configSecondaryColor;
  if (isJsonBody && jsonConfig?.presetTheme && presetThemes[jsonConfig.presetTheme]) {
    primaryColor = presetThemes[jsonConfig.presetTheme].primary;
    secondaryColor = presetThemes[jsonConfig.presetTheme].secondary;
  }

  const useCustomLogo = isJsonBody ? !!jsonConfig?.useCustomLogo : false;
  const customLogoId = isJsonBody ? jsonConfig?.customLogoId : '';
  const finalLogoCid = await resolveEmailLogo(useCustomLogo, customLogoId, isPreview);

  const brand: BrandSettings = {
    companyName: company,
    primaryColor: primaryColor,
    secondaryColor: secondaryColor,
    accentColor: primaryColor,
    buttonColor: isJsonBody && jsonConfig?.buttonColor ? jsonConfig.buttonColor : configButtonColor,
    buttonStyle: (isJsonBody && jsonConfig?.buttonStyle ? jsonConfig.buttonStyle : configButtonStyle) || 'rounded',
    fontFamily: isJsonBody && jsonConfig?.fontFamily ? jsonConfig.fontFamily : configFontFamily,
    footerBg: isJsonBody && jsonConfig?.footerBg ? jsonConfig.footerBg : configFooterBg,
    textColor: isJsonBody && jsonConfig?.textColor ? jsonConfig.textColor : configTextColor,
    website,
    phone,
    address,
    copyright,
    linkedin,
    facebook,
    twitter,
    bannerUrl: configBannerUrl,
    logoCid: finalLogoCid,
    logoWidth: isJsonBody && jsonConfig?.logoWidth ? Number(jsonConfig.logoWidth) : defaultLogoWidth,
  };

  const contextVars = buildEmailVariables(type, { companyName: company, ...variables }, isPreview);

  // Structured component mappings matching requirements exactly
  let title = '';
  let defaultBody = '';
  let tableRows: { label: string; value: string | undefined | null }[] = [];
  let cta: { label: string; url: string } | null = null;

  switch (type) {
    case 'interview_invite':
      title = 'Interview Invitation';
      defaultBody = `<p>Dear <strong>{{candidateName}}</strong>,</p>
<p>Thank you for your interest in joining <strong>{{companyName}}</strong>. We are pleased to invite you to attend an interview for the position of <strong>{{jobTitle}}</strong>.</p>
<p>Kindly ensure that you join the interview a few minutes before the scheduled time. If you are unable to attend, please let us know in advance so that we can arrange an alternative schedule.</p>
<p>We look forward to meeting you and discussing how your experience and skills align with our team.</p>`;
      tableRows = [
        { label: 'Position', value: '{{jobTitle}}' },
        { label: 'Interview Date', value: '{{scheduledDate}}' },
        { label: 'Interview Time', value: '{{scheduledTime}}' },
        { label: 'Time Zone', value: '{{timezone}}' },
        { label: 'Interview Mode', value: '{{interviewMode}}' },
        { label: 'Location / Meeting Link', value: `<a href="{{joinUrl}}" style="color:#0B5ED7;">{{joinUrl}}</a>` },
        { label: 'Interviewer(s)', value: '{{interviewers}}' },
        { label: 'Duration', value: '{{durationMin}}' },
      ];
      cta = { label: 'Join Interview', url: '{{joinUrl}}' };
      break;

    case 'interview_reminder':
      title = 'Interview Reminder';
      defaultBody = `<p>Dear <strong>{{candidateName}}</strong>,</p>
<p>Your interview is scheduled shortly. Please join a few minutes early.</p>`;
      tableRows = [
        { label: 'Position', value: '{{jobTitle}}' },
        { label: 'Date', value: '{{scheduledDate}}' },
        { label: 'Time', value: '{{scheduledTime}}' },
        { label: 'Duration', value: '{{durationMin}}' },
        { label: 'Meeting Link', value: `<a href="{{joinUrl}}" style="color:#0B5ED7;">{{joinUrl}}</a>` },
      ];
      cta = { label: 'View Interview', url: '{{joinUrl}}' };
      break;

    case 'schedule_invite':
    case 'interviewer_schedule':
      title = 'Interview Scheduled';
      defaultBody = `<p>Dear <strong>{{candidateName}}</strong>,</p>
<p>Your interview has been scheduled. Please find the details below.</p>`;
      tableRows = [
        { label: 'Position', value: '{{jobTitle}}' },
        { label: 'Date', value: '{{scheduledDate}}' },
        { label: 'Time', value: '{{scheduledTime}}' },
        { label: 'Interviewer', value: '{{interviewerName}}' },
        { label: 'Meeting Link', value: `<a href="{{meetingLink}}" style="color:#0B5ED7;">{{meetingLink}}</a>` },
      ];
      cta = { label: 'View Schedule', url: '{{meetingLink}}' };
      break;

    case 'assessment_invite':
      title = 'Assessment Invitation';
      defaultBody = `<p>Dear <strong>{{candidateName}}</strong>,</p>
<p>You have been invited to complete an online assessment for <strong>{{companyName}}</strong>.</p>`;
      tableRows = [
        { label: 'Assessment Name', value: '{{assessmentTitle}}' },
        { label: 'Duration', value: '{{durationMin}} minutes' },
        { label: 'Deadline', value: '{{deadline}}' },
        { label: 'Passing Percentage', value: '{{passingScore}}%' },
        { label: 'Total Questions', value: '{{questionCount}}' },
      ];
      cta = { label: 'Start Assessment', url: '{{startUrl}}' };
      break;

    case 'assessment_result':
      if (variables.passed) {
        title = 'Congratulations!';
        defaultBody = `<p>Dear <strong>{{candidateName}}</strong>,</p>
<p>Congratulations! You have successfully cleared the assessment.</p>`;
        tableRows = [
          { label: 'Assessment', value: '{{assessmentTitle}}' },
          { label: 'Score', value: '{{percentageScore}}%' },
          { label: 'Passing Score', value: '{{passingScore}}%' },
          { label: 'Next Round', value: '{{nextSteps}}' },
        ];
        cta = { label: 'View Next Steps', url: '{{startUrl}}' };
      } else {
        title = 'Assessment Result';
        defaultBody = `<p>Dear <strong>{{candidateName}}</strong>,</p>
<p>Thank you for participating. Unfortunately you were not selected for the next stage.</p>`;
        tableRows = [
          { label: 'Assessment', value: '{{assessmentTitle}}' },
          { label: 'Your Score', value: '{{percentageScore}}%' },
          { label: 'Required Score', value: '{{passingScore}}%' },
        ];
      }
      break;

    case 'interview_result':
      if (variables.passed) {
        title = 'Congratulations!';
        defaultBody = `<p>Dear <strong>{{candidateName}}</strong>,</p>
<p>Congratulations! You have successfully cleared the interview.</p>`;
        tableRows = [
          { label: 'Interview Round', value: '{{interviewRound}}' },
          { label: 'Interview Date', value: '{{scheduledDate}}' },
          { label: 'Next Stage', value: '{{nextRound}}' },
        ];
        cta = { label: 'View Next Steps', url: '{{joinUrl}}' };
      } else {
        title = 'Interview Result';
        defaultBody = `<p>Dear <strong>{{candidateName}}</strong>,</p>
<p>Thank you for attending the interview. We appreciate your interest. Unfortunately you were not selected.</p>`;
        tableRows = [
          { label: 'Interview Round', value: '{{interviewRound}}' },
          { label: 'Interview Date', value: '{{scheduledDate}}' },
        ];
      }
      break;

    case 'tentative_offer':
      title = 'Congratulations!';
      defaultBody = `<p>Dear <strong>{{candidateName}}</strong>,</p>
<p>We are pleased to extend a tentative offer confirmation.</p>`;
      tableRows = [
        { label: 'Position', value: '{{jobTitle}}' },
        { label: 'Department', value: '{{department}}' },
      ];
      cta = { label: 'View Offer', url: '{{acceptUrl}}' };
      break;

    case 'offer_sent':
      title = 'Offer Letter';
      defaultBody = `<p>Dear <strong>{{candidateName}}</strong>,</p>
<p>Congratulations! Your official offer letter is now available.</p>`;
      tableRows = [
        { label: 'Position', value: '{{jobTitle}}' },
        { label: 'Joining Date', value: '{{joiningDate}}' },
        { label: 'Location', value: '{{officeLocation}}' },
      ];
      cta = { label: 'Download Offer Letter', url: '{{acceptUrl}}' };
      break;

    case 'document_request':
      title = 'Document Submission Required';
      defaultBody = `<p>Dear <strong>{{candidateName}}</strong>,</p>
<p>Please upload the required joining documents to proceed with onboarding.</p>`;
      tableRows = [
        { label: 'Required Documents', value: '{{documentsList}}' },
      ];
      cta = { label: 'Upload Documents', url: '{{uploadUrl}}' };
      break;

    case 'documents_verified':
      title = 'Documents Verified';
      defaultBody = `<p>Dear <strong>{{candidateName}}</strong>,</p>
<p>Your submitted documents have been successfully verified.</p>`;
      tableRows = [];
      cta = { label: 'Continue Onboarding', url: '{{uploadUrl}}' };
      break;

    case 'document_reupload':
      title = 'Document Verification';
      defaultBody = `<p>Dear <strong>{{candidateName}}</strong>,</p>
<p>Some submitted documents require corrections.</p>`;
      tableRows = [
        { label: 'Rejected Documents', value: '{{documentName}}' },
        { label: 'Rejection Reason', value: '{{rejectionReason}}' },
      ];
      cta = { label: 'Upload Correct Documents', url: '{{uploadUrl}}' };
      break;

    case 'onboarding_welcome':
      title = `Welcome to ${company}`;
      defaultBody = `<p>Dear <strong>{{candidateName}}</strong>,</p>
<p>We are excited to have you join our organization.</p>`;
      tableRows = [
        { label: 'Joining Date', value: '{{joiningDate}}' },
        { label: 'Reporting Time', value: '{{reportingTime}}' },
        { label: 'Office Location', value: '{{officeLocation}}' },
        { label: 'Reporting Manager', value: '{{managerName}}' },
      ];
      cta = { label: 'Start Onboarding', url: '{{startOnboardingUrl}}' };
      break;

    default:
      title = custom?.name || sys?.name || 'AgnoHire Notification';
      defaultBody = custom?.body || sys?.defaultBody || '';
      tableRows = [];
      break;
  }

  // Parse subject and body templates with active variables
  const tName = custom?.name || sys?.name || type;
  const subject = compileTemplate(subjectTemplate, contextVars, tName, type);
  
  let finalBodyHtml = '';
  let finalTitle = title;

  if (isJsonBody && jsonConfig) {
    const greeting = jsonConfig.greeting || '';
    const message = jsonConfig.message || '';
    const closing = jsonConfig.closing || '';
    const signature = jsonConfig.signature || '';

    if (jsonConfig.heading) {
      finalTitle = compileTemplate(jsonConfig.heading, contextVars, tName, type);
    }

    const compiledGreeting = compileTemplate(greeting, contextVars, tName, type);
    let compiledMessage = compileTemplate(message, contextVars, tName, type);

    const htmlGreetingRegex = /^\s*<p[^>]*>\s*(Dear|Hi|Hello|To)\s+[^<]+,\s*<\/p>\s*/i;
    const textGreetingRegex = /^\s*(Dear|Hi|Hello|To)\s+[^\r\n]+,\s*[\r\n]*/i;
    if (compiledGreeting) {
      if (htmlGreetingRegex.test(compiledMessage)) {
        compiledMessage = compiledMessage.replace(htmlGreetingRegex, '');
      } else if (textGreetingRegex.test(compiledMessage)) {
        compiledMessage = compiledMessage.replace(textGreetingRegex, '');
      }
    }

    const compiledClosing = compileTemplate(closing, contextVars, tName, type);
    const compiledSignature = compileTemplate(signature, contextVars, tName, type).replace(/\n/g, '<br/>');

    const bodyTextHtml = `
      ${compiledGreeting ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.7;">${compiledGreeting}</p>` : ''}
      ${compiledMessage ? `<div style="font-size:15px;line-height:1.7;margin-bottom:14px;">${compiledMessage}</div>` : ''}
    `;

    // Filter table rows based on user checklist
    const selectedFields: string[] = Array.isArray(jsonConfig.infoFields) ? jsonConfig.infoFields : [];
    const filteredRows = tableRows.filter(r => {
      const normalizedLabel = r.label.toLowerCase().replace(/[^a-z0-9]/g, '');
      return selectedFields.some(f => f.toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedLabel);
    });

    const compiledRows = filteredRows.map(r => ({
      label: r.label,
      value: r.value ? compileTemplate(r.value, contextVars, tName, type) : '',
    }));
    const infoTableHtml = buildInfoTable(compiledRows);

    // Button overrides
    let ctaHtml = '';
    const ctaText = jsonConfig.ctaText !== undefined ? jsonConfig.ctaText : (cta ? cta.label : '');
    const ctaUrl = jsonConfig.ctaUrl !== undefined ? jsonConfig.ctaUrl : (cta ? cta.url : '');
    if (ctaText && ctaUrl) {
      const compiledCtaUrl = compileTemplate(ctaUrl, contextVars, tName, type);
      ctaHtml = buildCtaButton(ctaText, compiledCtaUrl, brand);
    }

    const closingHtml = compiledClosing ? `<p style="margin:25px 0 14px;font-size:15px;line-height:1.7;">${compiledClosing}</p>` : '';
    const signatureHtml = compiledSignature ? `<p style="margin:20px 0 0;font-size:15px;line-height:1.7;color:#555555;">${compiledSignature}</p>` : '';

    finalBodyHtml = bodyTextHtml + infoTableHtml + ctaHtml + closingHtml + signatureHtml;
  } else {
    // Legacy HTML rendering path
    const compiledBody = compileTemplate(rawBodyText || defaultBody, contextVars, tName, type);
    const compiledRows = tableRows.map(r => ({
      label: r.label,
      value: r.value ? compileTemplate(r.value, contextVars, tName, type) : '',
    }));
    const infoTableHtml = buildInfoTable(compiledRows);
    const compiledCtaUrl = cta ? compileTemplate(cta.url, contextVars, tName, type) : '';
    const ctaHtml = cta ? buildCtaButton(cta.label, compiledCtaUrl, brand) : '';

    finalBodyHtml = compiledBody + infoTableHtml + ctaHtml;
  }

  // Inject dynamic contents inside the unified master corporate shell
  const finalHtml = await renderTheme('default', finalTitle, finalBodyHtml, brand);

  return {
    subject,
    html: finalHtml,
  };
}

export async function interviewReminderEmail(opts: {
  candidateName: string;
  scheduledDate: Date;
  joinUrl?: string;
  timezone?: string;
}): Promise<{ subject: string; html: string }> {
  const tz = opts.timezone ?? 'UTC';
  return resolveTemplate('interview_reminder', {
    candidateName: opts.candidateName,
    scheduledDate: opts.scheduledDate.toLocaleDateString(undefined, { timeZone: tz }),
    scheduledTime: opts.scheduledDate.toLocaleTimeString(undefined, { timeZone: tz }),
    joinUrl: opts.joinUrl,
  });
}

export async function interviewInviteEmail(opts: {
  candidateName: string;
  jobTitle?: string | null;
  scheduledDate?: Date | null;
  joinUrl: string;
  timezone?: string;
}): Promise<{ subject: string; html: string }> {
  const tz = opts.timezone ?? 'UTC';
  return resolveTemplate('interview_invite', {
    candidateName: opts.candidateName,
    jobTitle: opts.jobTitle || 'AgnoHire Position',
    scheduledDate: opts.scheduledDate ? opts.scheduledDate.toLocaleDateString(undefined, { timeZone: tz }) : '',
    scheduledTime: opts.scheduledDate ? opts.scheduledDate.toLocaleTimeString(undefined, { timeZone: tz }) : '',
    joinUrl: opts.joinUrl,
  });
}

export async function scheduleInviteEmail(opts: {
  candidateName: string;
  scheduledDate: Date;
  timezone: string;
  durationMin: number;
  meetingLink?: string | null;
  instructions?: string | null;
}): Promise<{ subject: string; html: string }> {
  return resolveTemplate('schedule_invite', {
    candidateName: opts.candidateName,
    scheduledDate: opts.scheduledDate.toLocaleDateString(undefined, { timeZone: opts.timezone }),
    scheduledTime: opts.scheduledDate.toLocaleTimeString(undefined, { timeZone: opts.timezone }),
    timezone: opts.timezone,
    durationMin: opts.durationMin,
    meetingLink: opts.meetingLink,
    instructions: opts.instructions,
  });
}

export async function interviewerScheduleEmail(opts: {
  interviewerName: string;
  candidateName: string;
  scheduledDate: Date;
  timezone: string;
  durationMin: number;
  meetingLink?: string | null;
}): Promise<{ subject: string; html: string }> {
  return resolveTemplate('interviewer_schedule', {
    interviewerName: opts.interviewerName,
    candidateName: opts.candidateName,
    scheduledDate: opts.scheduledDate.toLocaleDateString(undefined, { timeZone: opts.timezone }),
    scheduledTime: opts.scheduledDate.toLocaleTimeString(undefined, { timeZone: opts.timezone }),
    timezone: opts.timezone,
    durationMin: opts.durationMin,
    meetingLink: opts.meetingLink,
  });
}

export async function interviewResultEmail(opts: {
  candidateName: string;
  jobTitle?: string | null;
  advanced: boolean;
}): Promise<{ subject: string; html: string }> {
  return resolveTemplate('interview_result', {
    candidateName: opts.candidateName,
    jobTitle: opts.jobTitle || 'AgnoHire Position',
    passed: opts.advanced,
    failed: !opts.advanced,
  });
}

export async function adminMessageEmail(opts: {
  recipientName: string;
  senderName: string;
  subject: string;
  message: string;
}): Promise<{ subject: string; html: string }> {
  return resolveTemplate('admin_message', {
    recipientName: opts.recipientName,
    senderName: opts.senderName,
    subject: opts.subject,
    message: opts.message.replace(/\n/g, '<br/>'),
  });
}

export async function offerSentEmail(opts: {
  candidateName: string;
  jobTitle: string;
  validUntil?: Date | null;
  acceptUrl?: string;
  timezone?: string;
}): Promise<{ subject: string; html: string }> {
  const tz = opts.timezone ?? 'UTC';
  return resolveTemplate('offer_sent', {
    candidateName: opts.candidateName,
    jobTitle: opts.jobTitle,
    validUntil: opts.validUntil ? opts.validUntil.toLocaleDateString(undefined, { timeZone: tz }) : '',
    acceptUrl: opts.acceptUrl,
  });
}

export async function panelAssignmentEmail(opts: {
  panelistName: string;
  candidateName: string;
}): Promise<{ subject: string; html: string }> {
  return resolveTemplate('panel_assignment', {
    panelistName: opts.panelistName,
    candidateName: opts.candidateName,
  });
}

export async function assessmentInviteEmail(opts: {
  candidateName: string;
  assessmentTitle: string;
  startUrl: string;
  durationMin?: number | null;
  questionCount?: number | null;
}): Promise<{ subject: string; html: string }> {
  return resolveTemplate('assessment_invite', {
    candidateName: opts.candidateName,
    assessmentTitle: opts.assessmentTitle,
    startUrl: opts.startUrl,
    durationMin: opts.durationMin,
    questionCount: opts.questionCount,
  });
}

export async function assessmentResultEmail(opts: {
  candidateName: string;
  assessmentTitle: string;
  percentageScore: number;
  totalScore: number | null;
  maxScore: number | null;
  passed: boolean;
  passingScore: number;
  nextSteps?: string | null;
}): Promise<{ subject: string; html: string }> {
  return resolveTemplate('assessment_result', {
    candidateName: opts.candidateName,
    assessmentTitle: opts.assessmentTitle,
    percentageScore: opts.percentageScore,
    totalScore: opts.totalScore,
    maxScore: opts.maxScore,
    passed: opts.passed,
    failed: !opts.passed,
    passingScore: opts.passingScore,
    nextSteps: opts.nextSteps ? opts.nextSteps.replace(/\n/g, '<br/>') : '',
  });
}

export async function detailedInterviewFeedbackEmail(opts: {
  candidateName: string;
  jobTitle?: string | null;
  interviewRound?: string | null;
  overallScore: number;
  decision: 'PASS' | 'FAIL' | string;
  strengths?: string | null;
  improvements?: string | null;
  recommendedLearning?: string | null;
}): Promise<{ subject: string; html: string }> {
  return resolveTemplate('detailed_feedback', {
    candidateName: opts.candidateName,
    jobTitle: opts.jobTitle || 'AgnoHire Position',
    interviewRound: opts.interviewRound || '',
    overallScore: Math.round(opts.overallScore),
    decision: opts.decision === 'FAIL' ? 'Fail' : 'Pass',
    strengths: opts.strengths ? opts.strengths.replace(/\n/g, '<br/>') : '',
    improvements: opts.improvements ? opts.improvements.replace(/\n/g, '<br/>') : '',
    recommendedLearning: opts.recommendedLearning ? opts.recommendedLearning.replace(/\n/g, '<br/>') : '',
    passed: opts.decision !== 'FAIL',
    failed: opts.decision === 'FAIL',
  });
}

export async function documentRequestEmail(opts: {
  candidateName: string;
  uploadUrl: string;
  documents: { name: string; required: boolean }[];
  isAdditional?: boolean;
}): Promise<{ subject: string; html: string }> {
  const reqDocs = opts.documents.filter(d => d.required).map(d => d.name);
  const optDocs = opts.documents.filter(d => !d.required).map(d => d.name);
  
  let docsListHtml = '';
  if (reqDocs.length) {
    docsListHtml += `<strong>Required Documents:</strong><ul>${reqDocs.map(d => `<li>${d}</li>`).join('')}</ul>`;
  }
  if (optDocs.length) {
    docsListHtml += `<strong>Additional Documents:</strong><ul>${optDocs.map(d => `<li>${d} (Optional)</li>`).join('')}</ul>`;
  }

  const overrides = opts.isAdditional ? {
    subject: 'Additional Document Requested',
    body: `<p>Dear <strong>{{candidateName}}</strong>,</p>
<p>HR has requested an additional document for your onboarding.</p>`
  } : undefined;

  return resolveTemplate('document_request', {
    candidateName: opts.candidateName,
    uploadUrl: opts.uploadUrl,
    documentsList: docsListHtml,
  }, false, overrides);
}

export async function documentReuploadEmail(opts: {
  candidateName: string;
  uploadUrl: string;
  documentName: string;
  rejectionReason: string;
}): Promise<{ subject: string; html: string }> {
  return resolveTemplate('document_reupload', {
    candidateName: opts.candidateName,
    uploadUrl: opts.uploadUrl,
    documentName: opts.documentName,
    rejectionReason: opts.rejectionReason,
  });
}

export async function allDocumentsVerifiedEmail(opts: {
  candidateName: string;
  isAdditional?: boolean;
}): Promise<{ subject: string; html: string }> {
  const overrides = opts.isAdditional ? {
    subject: 'Additional Documents Verified',
    body: `<p>Dear <strong>{{candidateName}}</strong>,</p>
<p>Your additional submitted documents have been successfully verified.</p>`
  } : undefined;

  return resolveTemplate('documents_verified', {
    candidateName: opts.candidateName,
  }, false, overrides);
}

export async function tentativeOfferEmail(opts: {
  candidateName: string;
  acceptUrl: string;
  jobTitle?: string;
  department?: string;
  offerAmount?: string;
  joiningDate?: string;
}): Promise<{ subject: string; html: string }> {
  return resolveTemplate('tentative_offer', {
    candidateName: opts.candidateName,
    acceptUrl: opts.acceptUrl,
    jobTitle: opts.jobTitle,
    department: opts.department,
    offerAmount: opts.offerAmount,
    joiningDate: opts.joiningDate,
  });
}

export async function hrDocumentSubmittedEmail(opts: {
  candidateName: string;
  jobTitle: string;
  submissionDate: Date;
  uploadedCount: number;
  reviewUrl: string;
  timezone?: string;
}): Promise<{ subject: string; html: string }> {
  return resolveTemplate('hr_document_submitted', {
    candidateName: opts.candidateName,
    jobTitle: opts.jobTitle,
    submissionDate: opts.submissionDate.toLocaleDateString(undefined, { timeZone: opts.timezone ?? 'UTC' }),
    uploadedCount: opts.uploadedCount,
    reviewUrl: opts.reviewUrl,
  });
}

export async function onboardingWelcomeEmail(opts: {
  candidateName: string;
  joiningDate: string;
  reportingTime: string;
  officeLocation: string;
  managerName: string;
  startOnboardingUrl: string;
}): Promise<{ subject: string; html: string }> {
  return resolveTemplate('onboarding_welcome', {
    candidateName: opts.candidateName,
    joiningDate: opts.joiningDate,
    reportingTime: opts.reportingTime,
    officeLocation: opts.officeLocation,
    managerName: opts.managerName,
    startOnboardingUrl: opts.startOnboardingUrl,
  });
}

export async function tenantApprovedEmail(opts: {
  tenantOwnerName: string;
  tenantOwnerEmail: string;
  companyName: string;
  workspaceUrl: string;
}): Promise<{ subject: string; html: string }> {
  return resolveTemplate('tenant_approved', {
    tenantOwnerName: opts.tenantOwnerName,
    tenantOwnerEmail: opts.tenantOwnerEmail,
    companyName: opts.companyName,
    workspaceUrl: opts.workspaceUrl,
  });
}
