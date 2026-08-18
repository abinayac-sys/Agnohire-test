import { CONFIG_CATEGORY, CONFIG_DATA_TYPE } from './enums.js';

/**
 * Central registry of SystemConfiguration keys. The seed script inserts these
 * defaults; the Admin Console edits them at runtime. ConfigService reads them.
 *
 * `isSecret: true` values are AES-256-GCM encrypted at rest and never returned
 * in plaintext to the client.
 */
export const CONFIG_KEYS = {
  // General
  COMPANY_NAME: 'general.company_name',
  APP_ICON: 'general.app_icon',
  COMPANY_LOGO: 'general.company_logo',
  LOGIN_BACKGROUND: 'general.login_background',
  DEFAULT_TIMEZONE: 'general.default_timezone',
  DEFAULT_THEME: 'general.default_theme',
  SIDEBAR_LOGO_WIDTH: 'general.sidebar_logo_width',
  SIDEBAR_LOGO_HEIGHT: 'general.sidebar_logo_height',

  // Security
  LOGIN_MAX_ATTEMPTS: 'security.login_max_attempts',
  LOGIN_LOCK_MINUTES: 'security.login_lock_minutes',
  ACCESS_TOKEN_TTL_MIN: 'security.access_token_ttl_min',
  REFRESH_TOKEN_TTL_DAYS: 'security.refresh_token_ttl_days',
  CROSS_SECTOR_VISIBILITY: 'security.cross_sector_visibility',

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: 'rate_limit.window_ms',
  RATE_LIMIT_MAX: 'rate_limit.max_requests',
  // Per-candidate ceiling for public token routes (interview/assessment/offer).
  // Keyed per token, so this is one candidate's budget — NOT shared across a NAT.
  RATE_LIMIT_INTERVIEW_MAX: 'rate_limit.interview_max_requests',
  // Strict spam-prevention ceiling for the public careers-page apply endpoint,
  // keyed per (tenantSlug, jobId) — unlike the other rate-limit keys above,
  // this defaults LOW: it exists specifically to throttle bot/spam applications.
  RATE_LIMIT_CAREERS_APPLY_MAX: 'rate_limit.careers_apply_max_requests',

  // Email / SMTP (secrets)
  SMTP_HOST: 'email.smtp_host',
  SMTP_PORT: 'email.smtp_port',
  SMTP_USER: 'email.smtp_user',
  SMTP_PASS: 'email.smtp_pass',
  SMTP_FROM: 'email.smtp_from',
  SMTP_SECURE: 'email.smtp_secure',

  // AI (secrets)
  AI_PROVIDER_TYPE: 'ai.provider_type',
  AI_ENABLED: 'ai.enabled',
  AI_TEMPERATURE: 'ai.temperature',
  AI_MAX_TOKENS: 'ai.max_tokens',
  OPENAI_API_KEY: 'ai.openai_api_key',
  OPENAI_BASE_URL: 'ai.openai_base_url',
  OPENAI_MODEL: 'ai.openai_model',
  OPENAI_WHISPER_MODEL: 'ai.openai_whisper_model',
  OPENAI_AUDIO_MODEL: 'ai.openai_audio_model',

  // Judge0 (self-hosted code execution engine, backs CODE question grading)
  JUDGE0_ENDPOINT: 'integrations.judge0_endpoint',
  JUDGE0_API_KEY: 'integrations.judge0_api_key',

  // Interview
  INTERVIEW_DEFAULT_DURATION_MIN: 'interview.default_duration_min',
  INTERVIEW_TAB_SWITCH_STRIKES: 'interview.tab_switch_strikes',
  INTERVIEW_FULLSCREEN_STRIKES: 'interview.fullscreen_strikes',
  INTERVIEW_PROCTORING_ENABLED: 'interview.proctoring_enabled',
  INTERVIEW_SNAPSHOT_INTERVAL_SEC: 'interview.snapshot_interval_sec',
  INTERVIEW_SCREEN_SHARE_ENABLED: 'interview.screen_share_enabled',
  INTERVIEW_MAX_WARNINGS: 'interview.max_warnings',
  INTERVIEW_CAMERA_REQUIRED: 'interview.camera_required',
  INTERVIEW_MIC_REQUIRED: 'interview.mic_required',
  INTERVIEW_PASS_SCORE_THRESHOLD: 'interview.pass_score_threshold',
  INTERVIEW_AUTO_DECISION: 'interview.auto_decision',
  INTERVIEW_REPORT_DELAY_MINUTES: 'interview.report_delay_minutes',
  BIOMETRIC_SIMILARITY_THRESHOLD: 'biometric.similarity_threshold',

  // Interview scheduling (Module 5)
  SCHEDULE_WORKING_HOURS_START: 'schedule.working_hours_start',
  SCHEDULE_WORKING_HOURS_END: 'schedule.working_hours_end',
  SCHEDULE_WORKING_DAYS: 'schedule.working_days',
  SCHEDULE_SLOT_MINUTES: 'schedule.slot_minutes',
  SCHEDULE_BUFFER_MINUTES: 'schedule.buffer_minutes',
  SCHEDULE_REMINDER_LEAD_MINUTES: 'schedule.reminder_lead_minutes',
  SCHEDULE_AUTO_COMPLETE_ENABLED: 'schedule.auto_complete_enabled',
  SCHEDULE_AUTO_COMPLETE_GRACE_MINUTES: 'schedule.auto_complete_grace_minutes',

  // Assessment
  ASSESSMENT_PASS_CUTOFF: 'assessment.pass_cutoff',

  // Screening / candidates
  RESUME_MAX_SIZE_MB: 'screening.resume_max_size_mb',
  FIT_SCORE_AUTO: 'screening.fit_score_auto',
  FIT_SCORE_MODEL: 'screening.fit_score_model',

  // Pipeline
  PIPELINE_STAGES: 'pipeline.stages',
  WORKFLOW_AUTOMATION_RULES: 'pipeline.workflow_rules',

  // Public careers page display toggles (tenant-scoped). Salary visibility is
  // NOT here — it's a per-job JobRequisition.showSalaryPublicly flag instead,
  // since admins choose it case by case rather than tenant-wide.
  CAREERS_SHOW_HEADER: 'careers.show_header',
  // Master on/off switch for the entire public careers page + apply flow. When
  // off, every /public/careers/* route (and the /careers/:slug page it backs)
  // 404s — the embedded iframe on the tenant's own site stops working.
  CAREERS_ENABLED: 'careers.enabled',

  // Offer
  OFFER_REMINDER_DAYS_BEFORE: 'offer.reminder_days_before',
  ONBOARDING_REQUIRED_DOCUMENTS: 'offer.onboarding_required_documents',
  OFFER_AUTOMATE_DOCUMENT_EMAIL: 'offer.automate_document_email',

  // Integrations — Google Calendar / Google Meet (secrets)
  GOOGLE_CALENDAR_ENABLED: 'integrations.google_calendar_enabled',
  GOOGLE_MEET_ENABLED: 'integrations.google_meet_enabled',
  GOOGLE_CLIENT_ID: 'integrations.google_client_id',
  GOOGLE_CLIENT_SECRET: 'integrations.google_client_secret',
  GOOGLE_REFRESH_TOKEN: 'integrations.google_refresh_token',
  GOOGLE_ACCESS_TOKEN: 'integrations.google_access_token',
  GOOGLE_CALENDAR_ID: 'integrations.google_calendar_id',

  // Email Branding & Themes
  EMAIL_BRAND_THEME: 'email.brand_theme',
  EMAIL_BRAND_PRIMARY_COLOR: 'email.brand_primary_color',
  EMAIL_BRAND_SECONDARY_COLOR: 'email.brand_secondary_color',
  EMAIL_BRAND_BUTTON_COLOR: 'email.brand_button_color',
  EMAIL_BRAND_BUTTON_STYLE: 'email.brand_button_style',
  EMAIL_BRAND_FONT: 'email.brand_font',
  EMAIL_BRAND_FOOTER_BG: 'email.brand_footer_bg',
  EMAIL_BRAND_TEXT_COLOR: 'email.brand_text_color',
  EMAIL_BRAND_WEBSITE: 'email.brand_website',
  EMAIL_BRAND_PHONE: 'email.brand_phone',
  EMAIL_BRAND_ADDRESS: 'email.brand_address',
  EMAIL_BRAND_COPYRIGHT: 'email.brand_copyright',
  EMAIL_BRAND_SOCIAL_LINKEDIN: 'email.brand_social_linkedin',
  EMAIL_BRAND_SOCIAL_FACEBOOK: 'email.brand_social_facebook',
  EMAIL_BRAND_SOCIAL_TWITTER: 'email.brand_social_twitter',
  EMAIL_BRAND_BANNER_URL: 'email.brand_banner_url',
  EMAIL_BRAND_LOGO_WIDTH: 'email.brand_logo_width',
  EMAIL_BRAND_LOGO: 'email.brand_logo',

  // Billing
  DEFAULT_TRIAL_DAYS: 'billing.default_trial_days',
} as const;

export type ConfigKey = (typeof CONFIG_KEYS)[keyof typeof CONFIG_KEYS];

export interface ConfigSeed {
  key: ConfigKey;
  value: string;
  category: string;
  label: string;
  description?: string;
  dataType: string;
  isSecret?: boolean;
}

const T = CONFIG_DATA_TYPE;
const C = CONFIG_CATEGORY;

/** Default configuration rows inserted by the seed script. */
export const CONFIG_SEEDS: ConfigSeed[] = [
  { key: CONFIG_KEYS.COMPANY_NAME, value: 'AgnoHire', category: C.GENERAL, label: 'Company name', dataType: T.STRING },
  { key: CONFIG_KEYS.APP_ICON, value: '', category: C.GENERAL, label: 'Web icon', description: 'Square icon (PNG, JPG, WEBP) shown in the website browser tab. Leave empty to use the default favicon.', dataType: T.IMAGE },
  { key: CONFIG_KEYS.COMPANY_LOGO, value: '', category: C.GENERAL, label: 'Sidebar logo', description: 'Full / wide logo image (PNG, JPG, WEBP) shown in the sidebar. Leave empty to use the app icon + name.', dataType: T.IMAGE },
  { key: CONFIG_KEYS.LOGIN_BACKGROUND, value: '/login-bg.png', category: C.GENERAL, label: 'Login background', description: 'Full-bleed background image (PNG, JPG, WEBP) for the login screen. A wide landscape image works best. Leave empty to use the animated gradient.', dataType: T.IMAGE },
  { key: CONFIG_KEYS.SIDEBAR_LOGO_WIDTH, value: '195', category: C.GENERAL, label: 'Sidebar logo width (px)', dataType: T.NUMBER },
  { key: CONFIG_KEYS.SIDEBAR_LOGO_HEIGHT, value: '200', category: C.GENERAL, label: 'Sidebar logo height (px)', dataType: T.NUMBER },
  { key: CONFIG_KEYS.DEFAULT_TIMEZONE, value: 'UTC', category: C.GENERAL, label: 'Default timezone', dataType: T.STRING },
  { key: CONFIG_KEYS.DEFAULT_THEME, value: 'Arctic', category: C.THEME, label: 'Default theme preset', dataType: T.STRING },

  { key: CONFIG_KEYS.LOGIN_MAX_ATTEMPTS, value: '5', category: C.SECURITY, label: 'Max login attempts before lockout', dataType: T.NUMBER },
  { key: CONFIG_KEYS.LOGIN_LOCK_MINUTES, value: '15', category: C.SECURITY, label: 'Lockout duration (minutes)', dataType: T.NUMBER },
  { key: CONFIG_KEYS.ACCESS_TOKEN_TTL_MIN, value: '180', category: C.SECURITY, label: 'Access token TTL (minutes)', dataType: T.NUMBER },
  { key: CONFIG_KEYS.REFRESH_TOKEN_TTL_DAYS, value: '7', category: C.SECURITY, label: 'Refresh token TTL (days)', dataType: T.NUMBER },
  { key: CONFIG_KEYS.CROSS_SECTOR_VISIBILITY, value: 'true', category: C.SECURITY, label: 'Cross-sector visibility (all staff see all data)', description: 'When on, every staff user sees all candidates, jobs, pipelines, offers, interviews and schedules regardless of sector — useful for a single-org deployment or a demo. Turn it off to enforce strict per-sector data isolation (each user only sees their own sector plus unassigned data).', dataType: T.BOOLEAN },

  { key: CONFIG_KEYS.RATE_LIMIT_WINDOW_MS, value: '10000000', category: C.RATE_LIMIT, label: 'Rate limit window (ms)', dataType: T.NUMBER },
  // Per-IP ceiling for anonymous traffic (login, bootstrap, self-registration).
  // Sized so a large cohort behind ONE corporate/campus NAT can all sign in at
  // once for mass-hiring drives without starving the shared bucket.
  { key: CONFIG_KEYS.RATE_LIMIT_MAX, value: '10000000', category: C.RATE_LIMIT, label: 'Max requests per window', dataType: T.NUMBER },
  { key: CONFIG_KEYS.RATE_LIMIT_INTERVIEW_MAX, value: '10000000', category: C.RATE_LIMIT, label: 'Max requests per window (per candidate, public interview/assessment)', dataType: T.NUMBER },
  { key: CONFIG_KEYS.RATE_LIMIT_CAREERS_APPLY_MAX, value: '20', category: C.RATE_LIMIT, label: 'Max applications per window (per job, public careers page)', description: 'Spam-prevention ceiling for the public careers-page apply endpoint, keyed per (tenant, job) rather than per IP.', dataType: T.NUMBER },

  { key: CONFIG_KEYS.SMTP_HOST, value: '', category: C.EMAIL, label: 'SMTP host', dataType: T.STRING },
  { key: CONFIG_KEYS.SMTP_PORT, value: '587', category: C.EMAIL, label: 'SMTP port', dataType: T.NUMBER },
  { key: CONFIG_KEYS.SMTP_USER, value: '', category: C.EMAIL, label: 'SMTP username', dataType: T.STRING },
  { key: CONFIG_KEYS.SMTP_PASS, value: '', category: C.EMAIL, label: 'SMTP password', dataType: T.STRING, isSecret: true },
  { key: CONFIG_KEYS.SMTP_FROM, value: 'no-reply@agnohire.local', category: C.EMAIL, label: 'From address', dataType: T.STRING },
  { key: CONFIG_KEYS.SMTP_SECURE, value: 'false', category: C.EMAIL, label: 'Use TLS', dataType: T.BOOLEAN },

  { key: CONFIG_KEYS.AI_PROVIDER_TYPE, value: 'openai', category: C.AI, label: 'LLM provider type', description: 'Which AI provider powers JD generation, screening, interviews and the chatbot. Selecting one auto-fills the base URL and a default model.', dataType: T.STRING },
  { key: CONFIG_KEYS.AI_ENABLED, value: 'true', category: C.AI, label: 'AI features enabled', description: 'Master switch for all AI calls. When off, AI-powered actions return a friendly disabled message instead of calling the provider.', dataType: T.BOOLEAN },
  { key: CONFIG_KEYS.AI_TEMPERATURE, value: '0.4', category: C.AI, label: 'Sampling temperature', description: 'Default creativity for AI responses (0 = deterministic, 1 = creative). Individual features may override.', dataType: T.NUMBER },
  { key: CONFIG_KEYS.AI_MAX_TOKENS, value: '1600', category: C.AI, label: 'Max response tokens', description: 'Default ceiling on AI response length.', dataType: T.NUMBER },
  { key: CONFIG_KEYS.OPENAI_API_KEY, value: '', category: C.AI, label: 'API key', dataType: T.STRING, isSecret: true },
  { key: CONFIG_KEYS.OPENAI_BASE_URL, value: 'https://api.openai.com/v1', category: C.AI, label: 'API base URL (OpenAI-compatible)', dataType: T.STRING },
  { key: CONFIG_KEYS.OPENAI_MODEL, value: 'gpt-4o-mini', category: C.AI, label: 'Default model', dataType: T.STRING },
  { key: CONFIG_KEYS.OPENAI_WHISPER_MODEL, value: 'whisper-1', category: C.AI, label: 'OpenAI Whisper model', dataType: T.STRING },
  { key: CONFIG_KEYS.OPENAI_AUDIO_MODEL, value: '', category: C.AI, label: 'Audio analysis model (multimodal, e.g. gemini-2.5-flash or gpt-4o-audio-preview)', dataType: T.STRING },

  { key: CONFIG_KEYS.JUDGE0_ENDPOINT, value: '', category: C.INTEGRATIONS, label: 'Judge0 endpoint URL', description: 'Self-hosted Judge0 base URL, used to execute/grade CODE question answers. Empty disables code execution (falls back to AI evaluation).', dataType: T.STRING },
  { key: CONFIG_KEYS.JUDGE0_API_KEY, value: '', category: C.INTEGRATIONS, label: 'Judge0 API key', dataType: T.STRING, isSecret: true },

  { key: CONFIG_KEYS.INTERVIEW_DEFAULT_DURATION_MIN, value: '60', category: C.INTERVIEW, label: 'Default interview duration (min)', dataType: T.NUMBER },
  { key: CONFIG_KEYS.INTERVIEW_TAB_SWITCH_STRIKES, value: '3', category: C.INTERVIEW, label: 'Tab-switch strikes before auto-submit', dataType: T.NUMBER },
  { key: CONFIG_KEYS.INTERVIEW_FULLSCREEN_STRIKES, value: '2', category: C.INTERVIEW, label: 'Fullscreen-exit strikes before auto-submit', dataType: T.NUMBER },
  { key: CONFIG_KEYS.INTERVIEW_PROCTORING_ENABLED, value: 'true', category: C.INTERVIEW, label: 'Enable camera & mic proctoring', dataType: T.BOOLEAN },
  { key: CONFIG_KEYS.INTERVIEW_SNAPSHOT_INTERVAL_SEC, value: '15', category: C.INTERVIEW, label: 'Proctoring snapshot interval (sec)', dataType: T.NUMBER },
  { key: CONFIG_KEYS.INTERVIEW_SCREEN_SHARE_ENABLED, value: 'false', category: C.INTERVIEW, label: 'Require screen share', dataType: T.BOOLEAN },
  { key: CONFIG_KEYS.INTERVIEW_MAX_WARNINGS, value: '2', category: C.INTERVIEW, label: 'Cheating warnings before the interview ends', dataType: T.NUMBER },
  { key: CONFIG_KEYS.INTERVIEW_CAMERA_REQUIRED, value: 'true', category: C.INTERVIEW, label: 'Require a working camera to start', dataType: T.BOOLEAN },
  { key: CONFIG_KEYS.INTERVIEW_MIC_REQUIRED, value: 'true', category: C.INTERVIEW, label: 'Require a working microphone to start', dataType: T.BOOLEAN },
  { key: CONFIG_KEYS.INTERVIEW_PASS_SCORE_THRESHOLD, value: '60', category: C.INTERVIEW, label: 'Interview Pass Score Threshold', dataType: T.NUMBER },
  { key: CONFIG_KEYS.INTERVIEW_AUTO_DECISION, value: 'false', category: C.INTERVIEW, label: 'Auto-set final decision from AI decision', dataType: T.BOOLEAN },
  { key: CONFIG_KEYS.INTERVIEW_REPORT_DELAY_MINUTES, value: '5', category: C.INTERVIEW, label: 'Candidate report delay (minutes)', dataType: T.NUMBER },
  { key: CONFIG_KEYS.BIOMETRIC_SIMILARITY_THRESHOLD, value: '0.65', category: C.INTERVIEW, label: 'Biometric Similarity Threshold', dataType: T.NUMBER },

  { key: CONFIG_KEYS.SCHEDULE_WORKING_HOURS_START, value: '09:00', category: C.INTERVIEW, label: 'Scheduling: working hours start (UTC, HH:MM)', dataType: T.STRING },
  { key: CONFIG_KEYS.SCHEDULE_WORKING_HOURS_END, value: '17:00', category: C.INTERVIEW, label: 'Scheduling: working hours end (UTC, HH:MM)', dataType: T.STRING },
  { key: CONFIG_KEYS.SCHEDULE_WORKING_DAYS, value: '1,2,3,4,5', category: C.INTERVIEW, label: 'Scheduling: working days (0=Sun..6=Sat)', dataType: T.STRING },
  { key: CONFIG_KEYS.SCHEDULE_SLOT_MINUTES, value: '30', category: C.INTERVIEW, label: 'Scheduling: slot granularity (min)', dataType: T.NUMBER },
  { key: CONFIG_KEYS.SCHEDULE_BUFFER_MINUTES, value: '15', category: C.INTERVIEW, label: 'Scheduling: buffer between interviews (min)', dataType: T.NUMBER },
  { key: CONFIG_KEYS.SCHEDULE_REMINDER_LEAD_MINUTES, value: '60', category: C.INTERVIEW, label: 'Scheduling: reminder lead time (min before)', dataType: T.NUMBER },
  { key: CONFIG_KEYS.SCHEDULE_AUTO_COMPLETE_ENABLED, value: 'true', category: C.INTERVIEW, label: 'Scheduling: auto-complete interview after the meeting ends', dataType: T.BOOLEAN },
  { key: CONFIG_KEYS.SCHEDULE_AUTO_COMPLETE_GRACE_MINUTES, value: '0', category: C.INTERVIEW, label: 'Scheduling: grace period after end before auto-complete (min)', dataType: T.NUMBER },

  { key: CONFIG_KEYS.ASSESSMENT_PASS_CUTOFF, value: '60', category: C.ASSESSMENT, label: 'Auto pass/fail cutoff (%)', dataType: T.NUMBER },

  { key: CONFIG_KEYS.RESUME_MAX_SIZE_MB, value: '5', category: C.PIPELINE, label: 'Max resume upload size (MB)', dataType: T.NUMBER },
  { key: CONFIG_KEYS.FIT_SCORE_AUTO, value: 'true', category: C.PIPELINE, label: 'Auto-score fit on application', dataType: T.BOOLEAN },
  { key: CONFIG_KEYS.FIT_SCORE_MODEL, value: '', category: C.PIPELINE, label: 'Model for fit scoring (blank = use global AI model)', dataType: T.STRING },

  { key: CONFIG_KEYS.PIPELINE_STAGES, value: '["SOURCED","APPLIED","SCREENING","INTERVIEW","OFFER","HIRED","REJECTED"]', category: C.PIPELINE, label: 'Pipeline stages', dataType: T.JSON },

  { key: CONFIG_KEYS.CAREERS_SHOW_HEADER, value: 'true', category: C.CAREERS, label: 'Show header/banner on public careers page', description: 'When off, the hosted careers page omits its own branded header — useful when embedding it inside a page that already has your site\'s header/nav.', dataType: T.BOOLEAN },
  { key: CONFIG_KEYS.CAREERS_ENABLED, value: 'true', category: C.CAREERS, label: 'Careers page active', description: 'Master switch for the public careers page. Turn off to deactivate it — the hosted page and any embedded iframe on your website stop working immediately.', dataType: T.BOOLEAN },
  { key: CONFIG_KEYS.WORKFLOW_AUTOMATION_RULES, value: '[]', category: C.PIPELINE, label: 'Workflow automation rules', dataType: T.JSON },

  { key: CONFIG_KEYS.OFFER_REMINDER_DAYS_BEFORE, value: '3', category: C.EMAIL, label: 'Offer expiry reminder (days before)', dataType: T.NUMBER },
  { key: CONFIG_KEYS.ONBOARDING_REQUIRED_DOCUMENTS, value: '[]', category: C.EMAIL, label: 'Onboarding Required Documents', dataType: T.JSON },
  { key: CONFIG_KEYS.OFFER_AUTOMATE_DOCUMENT_EMAIL, value: 'true', category: C.EMAIL, label: 'Automate document request email on tentative accept', description: 'When on, the document upload request email is sent automatically as soon as a candidate accepts the tentative offer. When off, HR must send the email manually from the Document tab.', dataType: T.BOOLEAN },

  { key: CONFIG_KEYS.GOOGLE_CALENDAR_ENABLED, value: 'false', category: C.INTEGRATIONS, label: 'Google Calendar sync enabled', description: 'When on and credentials are set, scheduling an interview creates a Google Calendar event and emails invites to everyone. Turning it off leaves interviews local (no calendar sync).', dataType: T.BOOLEAN },
  { key: CONFIG_KEYS.GOOGLE_MEET_ENABLED, value: 'true', category: C.INTEGRATIONS, label: 'Auto-create Google Meet links', description: 'When on, calendar events without a manual meeting link get a Google Meet video link minted automatically.', dataType: T.BOOLEAN },
  { key: CONFIG_KEYS.GOOGLE_CLIENT_ID, value: '', category: C.INTEGRATIONS, label: 'Google OAuth client ID', description: 'From a Google Cloud OAuth 2.0 client with the Calendar API enabled.', dataType: T.STRING },
  { key: CONFIG_KEYS.GOOGLE_CLIENT_SECRET, value: '', category: C.INTEGRATIONS, label: 'Google OAuth client secret', dataType: T.STRING, isSecret: true },
  { key: CONFIG_KEYS.GOOGLE_REFRESH_TOKEN, value: '', category: C.INTEGRATIONS, label: 'Google OAuth refresh token', description: 'Long-lived token for the account whose calendar to write to. Exchanged for short-lived access tokens automatically.', dataType: T.STRING, isSecret: true },
  { key: CONFIG_KEYS.GOOGLE_ACCESS_TOKEN, value: '', category: C.INTEGRATIONS, label: 'Google access token (optional)', description: 'Optional short-lived access token. Usually leave blank and rely on the refresh token.', dataType: T.STRING, isSecret: true },
  { key: CONFIG_KEYS.GOOGLE_CALENDAR_ID, value: 'primary', category: C.INTEGRATIONS, label: 'Target calendar ID', description: 'Which calendar to write events to. Defaults to the authenticated account\'s primary calendar.', dataType: T.STRING },

  // Email Branding & Themes Seeds
  { key: CONFIG_KEYS.EMAIL_BRAND_THEME, value: 'modern_corporate', category: C.EMAIL_BRANDING, label: 'Email theme', dataType: T.STRING },
  { key: CONFIG_KEYS.EMAIL_BRAND_PRIMARY_COLOR, value: '#5b5bd6', category: C.EMAIL_BRANDING, label: 'Email primary color', dataType: T.STRING },
  { key: CONFIG_KEYS.EMAIL_BRAND_SECONDARY_COLOR, value: '#2563eb', category: C.EMAIL_BRANDING, label: 'Email secondary color', dataType: T.STRING },
  { key: CONFIG_KEYS.EMAIL_BRAND_BUTTON_COLOR, value: '#2563eb', category: C.EMAIL_BRANDING, label: 'Email CTA button color', dataType: T.STRING },
  { key: CONFIG_KEYS.EMAIL_BRAND_BUTTON_STYLE, value: 'rounded', category: C.EMAIL_BRANDING, label: 'Email button shape', dataType: T.STRING },
  { key: CONFIG_KEYS.EMAIL_BRAND_FONT, value: 'Segoe UI', category: C.EMAIL_BRANDING, label: 'Email typography font', dataType: T.STRING },
  { key: CONFIG_KEYS.EMAIL_BRAND_FOOTER_BG, value: '#2563eb', category: C.EMAIL_BRANDING, label: 'Email footer background color', dataType: T.STRING },
  { key: CONFIG_KEYS.EMAIL_BRAND_TEXT_COLOR, value: '#1a1a2e', category: C.EMAIL_BRANDING, label: 'Email body text color', dataType: T.STRING },
  { key: CONFIG_KEYS.EMAIL_BRAND_WEBSITE, value: 'https://agnohire.com', category: C.EMAIL_BRANDING, label: 'Company website URL', dataType: T.STRING },
  { key: CONFIG_KEYS.EMAIL_BRAND_PHONE, value: '+1 (555) 019-9922', category: C.EMAIL_BRANDING, label: 'Company support phone number', dataType: T.STRING },
  { key: CONFIG_KEYS.EMAIL_BRAND_ADDRESS, value: '100 Pine Street, Suite 1200, San Francisco, CA 94111', category: C.EMAIL_BRANDING, label: 'Company physical address', dataType: T.STRING },
  { key: CONFIG_KEYS.EMAIL_BRAND_COPYRIGHT, value: 'AgnoHire Inc. All rights reserved.', category: C.EMAIL_BRANDING, label: 'Email copyright statement', dataType: T.STRING },
  { key: CONFIG_KEYS.EMAIL_BRAND_SOCIAL_LINKEDIN, value: 'https://linkedin.com/company/agnohire', category: C.EMAIL_BRANDING, label: 'LinkedIn profile link', dataType: T.STRING },
  { key: CONFIG_KEYS.EMAIL_BRAND_SOCIAL_FACEBOOK, value: '', category: C.EMAIL_BRANDING, label: 'Facebook profile link', dataType: T.STRING },
  { key: CONFIG_KEYS.EMAIL_BRAND_SOCIAL_TWITTER, value: '', category: C.EMAIL_BRANDING, label: 'Twitter/X profile link', dataType: T.STRING },
  { key: CONFIG_KEYS.EMAIL_BRAND_BANNER_URL, value: '', category: C.EMAIL_BRANDING, label: 'Email hero banner image URL', dataType: T.STRING },
  { key: CONFIG_KEYS.EMAIL_BRAND_LOGO, value: '', category: C.EMAIL_BRANDING, label: 'Email Template Logo', dataType: T.IMAGE },
  { key: CONFIG_KEYS.EMAIL_BRAND_LOGO_WIDTH, value: '220', category: C.EMAIL_BRANDING, label: 'Email Template Logo Width (px)', dataType: T.NUMBER },

  { key: CONFIG_KEYS.DEFAULT_TRIAL_DAYS, value: '14', category: C.BILLING, label: 'Default trial length (days)', description: 'Free-trial length granted on tenant approval when the plan itself has no trialDays override configured.', dataType: T.NUMBER },
];
