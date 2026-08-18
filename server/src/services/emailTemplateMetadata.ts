export interface PlaceholderInfo {
  name: string;
  description: string;
}

export interface SystemTemplate {
  type: string;
  name: string;
  category: 'Interview' | 'Assessment' | 'Hiring' | 'Onboarding' | 'Administration';
  defaultSubject: string;
  defaultBody: string;
  placeholders: PlaceholderInfo[];
}

export const MOCK_DATA: Record<string, any> = {
  candidateName: 'Candidate',
  jobTitle: 'Senior Java Developer',
  scheduledDate: '25 July 2026 10:00 AM UTC',
  joinUrl: 'https://client.agnohire.com/interview/demo-access-token',
  meetingLink: 'https://meet.google.com/demo-meet-link',
  timezone: 'UTC',
  durationMin: 45,
  interviewerName: 'Interviewer',
  recipientName: 'Recipient',
  senderName: 'Sender',
  subject: 'Custom Admin Message',
  message: 'Hello, we would love to connect with you regarding your application.',
  validUntil: '30 July 2026 05:00 PM UTC',
  acceptUrl: 'https://client.agnohire.com/offer/accept-demo',
  panelistName: 'Panel Member',
  assessmentTitle: 'Core Java & Data Structures',
  startUrl: 'https://client.agnohire.com/assessment/start-demo',
  questionCount: 15,
  percentageScore: 85,
  totalScore: 85,
  maxScore: 100,
  passed: true,
  passingScore: 70,
  nextSteps: 'Our hiring team will schedule a final round of technical discussion next week.',
  overallScore: 88,
  decision: 'PASS',
  strengths: 'Excellent problem solving skills.\nStrong database fundamentals.',
  improvements: 'Could explain Big-O space complexity in more detail.',
  recommendedLearning: 'Advanced concurrency patterns in Java.',
  uploadUrl: 'https://client.agnohire.com/onboarding/upload-demo',
  documentName: 'Previous Employer Experience Letter',
  rejectionReason: 'The uploaded file is blurry and the signature is not legible.',
  submissionDate: '24 July 2026 02:30 PM UTC',
  uploadedCount: 4,
  reviewUrl: 'https://client.agnohire.com/admin/candidates/onboarding-review-demo',
  companyName: 'AgnoHire Cloud Solutions',
  salary: 'INR 1,800,000 per annum',
  joiningDate: '15 August 2026',
  supportEmail: 'support@agnohire.com',
  currentDate: '14 July 2026',
};

const COMMON_PLACEHOLDERS: PlaceholderInfo[] = [
  { name: 'candidateName', description: 'Name of the candidate' },
  { name: 'companyName', description: 'Name of the company/tenant' },
  { name: 'supportEmail', description: 'Company support email' },
  { name: 'currentDate', description: 'Current date' },
];

export const SYSTEM_TEMPLATES: SystemTemplate[] = [
  {
    type: 'interview_reminder',
    name: 'Interview Reminder',
    category: 'Interview',
    defaultSubject: 'Reminder: your upcoming interview',
    defaultBody: JSON.stringify({
      heading: 'Interview Reminder',
      greeting: 'Dear {{candidateName}},',
      message: 'This is a reminder that your interview is scheduled. Please join a few minutes early.',
      infoFields: ['position', 'date', 'time', 'duration', 'meetinglink'],
      ctaText: 'Join Interview',
      ctaUrl: '{{joinUrl}}',
      closing: 'Please ensure your device setup works correctly. Good luck!',
      signature: 'Best Regards,\nHR Team\n{{companyName}}',
      presetTheme: 'Modern Blue',
    }),
    placeholders: [
      ...COMMON_PLACEHOLDERS,
      { name: 'scheduledDate', description: 'Interview schedule date/time' },
      { name: 'joinUrl', description: 'Link to join the interview interface' },
    ],
  },
  {
    type: 'interview_invite',
    name: 'Interview Invitation',
    category: 'Interview',
    defaultSubject: 'Your interview invitation — {{jobTitle}}',
    defaultBody: JSON.stringify({
      heading: 'Interview Invitation',
      greeting: 'Dear {{candidateName}},',
      message: 'Thank you for your interest in joining {{companyName}}. You\'ve been invited to an interview for the {{jobTitle}} position. When you\'re ready, use the secure link below to begin.',
      infoFields: ['position', 'interviewdate', 'interviewtime', 'timezone', 'interviewmode', 'locationmeetinglink', 'interviewers', 'duration'],
      ctaText: 'Start Interview',
      ctaUrl: '{{joinUrl}}',
      closing: 'Kindly ensure that you join the interview a few minutes before the scheduled time. We look forward to meeting you.',
      signature: 'Best Regards,\nHR Team\n{{companyName}}',
      presetTheme: 'Modern Blue',
    }),
    placeholders: [
      ...COMMON_PLACEHOLDERS,
      { name: 'jobTitle', description: 'Title of the job role' },
      { name: 'scheduledDate', description: 'Interview date/time (optional)' },
      { name: 'joinUrl', description: 'Secure start interview link' },
    ],
  },
  {
    type: 'schedule_invite',
    name: 'Schedule Interview Invitation (Live/Panel)',
    category: 'Interview',
    defaultSubject: 'Your interview is scheduled',
    defaultBody: JSON.stringify({
      heading: 'Interview Scheduled',
      greeting: 'Dear {{candidateName}},',
      message: 'Your interview has been scheduled. Please find the details below.',
      infoFields: ['position', 'date', 'time', 'meetinglink'],
      ctaText: 'View Schedule',
      ctaUrl: '{{meetingLink}}',
      closing: 'Please let us know if you need to reschedule.',
      signature: 'Best Regards,\nRecruiting Coordinator\n{{companyName}}',
      presetTheme: 'Modern Blue',
    }),
    placeholders: [
      ...COMMON_PLACEHOLDERS,
      { name: 'scheduledDate', description: 'Schedule date/time' },
      { name: 'timezone', description: 'Selected timezone' },
      { name: 'durationMin', description: 'Duration in minutes' },
      { name: 'meetingLink', description: 'Google Meet link (optional)' },
      { name: 'instructions', description: 'Special interviewer instructions (optional)' },
    ],
  },
  {
    type: 'interviewer_schedule',
    name: 'Interviewer Assignment',
    category: 'Interview',
    defaultSubject: 'Interview scheduled: {{candidateName}}',
    defaultBody: JSON.stringify({
      heading: 'Interview Assigned',
      greeting: 'Dear {{interviewerName}},',
      message: 'You have been assigned to interview {{candidateName}}. Details below.',
      infoFields: ['position', 'date', 'time', 'interviewer', 'meetinglink'],
      ctaText: 'View Schedule',
      ctaUrl: '{{meetingLink}}',
      closing: 'Please review the candidate scorecard beforehand.',
      signature: 'Best Regards,\nOperations Team\n{{companyName}}',
      presetTheme: 'Modern Blue',
    }),
    placeholders: [
      ...COMMON_PLACEHOLDERS,
      { name: 'interviewerName', description: 'Name of the interviewer' },
      { name: 'candidateName', description: 'Name of the candidate' },
      { name: 'scheduledDate', description: 'Schedule date/time' },
      { name: 'timezone', description: 'Selected timezone' },
      { name: 'durationMin', description: 'Duration in minutes' },
      { name: 'meetingLink', description: 'Google Meet link (optional)' },
    ],
  },
  {
    type: 'interview_result',
    name: 'Interview Result (Pass/Fail)',
    category: 'Interview',
    defaultSubject: 'Update on your interview',
    defaultBody: JSON.stringify({
      heading: 'Interview Result',
      greeting: 'Dear {{candidateName}},',
      message: '{{#if passed}}Great news — after reviewing your interview for the {{jobTitle}} role, we\'d like to move you forward to the next stage. 🎉 Our team will be in touch shortly with the details and next steps.{{/if}}{{#if failed}}Thank you for taking the time to interview for the {{jobTitle}} role. After careful consideration, we won\'t be moving forward with your application at this time. We were genuinely impressed by your background and encourage you to apply for future roles.{{/if}}',
      infoFields: [],
      ctaText: 'View Next Steps',
      ctaUrl: '{{joinUrl}}',
      closing: 'We appreciate your time and effort.',
      signature: 'Best Regards,\nHR Team\n{{companyName}}',
      presetTheme: 'Modern Blue',
    }),
    placeholders: [
      ...COMMON_PLACEHOLDERS,
      { name: 'jobTitle', description: 'Title of the job role' },
      { name: 'passed', description: 'True if candidate passed' },
      { name: 'failed', description: 'True if candidate failed' },
    ],
  },
  {
    type: 'assessment_invite',
    name: 'Assessment Invitation',
    category: 'Assessment',
    defaultSubject: 'Your assessment invitation — {{assessmentTitle}}',
    defaultBody: JSON.stringify({
      heading: 'Assessment Invitation',
      greeting: 'Dear {{candidateName}},',
      message: 'You have been invited to complete the {{assessmentTitle}} skills assessment. This is a proctored assessment: your camera and microphone will be active, and switching tabs or leaving full screen is recorded.',
      infoFields: ['assessmentname', 'duration', 'deadline', 'passingpercentage', 'totalquestions'],
      ctaText: 'Start Assessment',
      ctaUrl: '{{startUrl}}',
      closing: 'Please find a quiet space and use a desktop Chrome or Edge browser. Best of luck!',
      signature: 'Best Regards,\nRecruitment Team\n{{companyName}}',
      presetTheme: 'Modern Blue',
    }),
    placeholders: [
      ...COMMON_PLACEHOLDERS,
      { name: 'assessmentTitle', description: 'Title of the assessment' },
      { name: 'startUrl', description: 'Secure start assessment link' },
    ],
  },
  {
    type: 'assessment_result',
    name: 'Assessment Result (Passed/Failed)',
    category: 'Assessment',
    defaultSubject: 'Assessment Result: {{assessmentTitle}}',
    defaultBody: JSON.stringify({
      heading: 'Assessment Result',
      greeting: 'Dear {{candidateName}},',
      message: '{{#if passed}}Congratulations! You have passed the {{assessmentTitle}} assessment. Your Score: {{percentageScore}}% — Pass mark: {{passingScore}}%.{{/if}}{{#if failed}}Thank you for completing the {{assessmentTitle}} assessment. Your Score: {{percentageScore}}% — Pass mark: {{passingScore}}%. After careful review, we regret that your score did not meet the minimum required for this stage.{{/if}}',
      infoFields: [],
      ctaText: 'View Next Steps',
      ctaUrl: '{{startUrl}}',
      closing: '{{#if passed}}Well done and good luck with the rest of the process!{{/if}}{{#if failed}}We appreciate the time you invested.{{/if}}',
      signature: 'Best Regards,\nHR Team\n{{companyName}}',
      presetTheme: 'Modern Blue',
    }),
    placeholders: [
      ...COMMON_PLACEHOLDERS,
      { name: 'assessmentTitle', description: 'Title of the assessment' },
      { name: 'percentageScore', description: 'Percentage score achieved' },
      { name: 'passingScore', description: 'Required passing score' },
      { name: 'passed', description: 'True if candidate passed' },
      { name: 'failed', description: 'True if candidate failed' },
      { name: 'nextSteps', description: 'Next steps notes (optional)' },
    ],
  },
  {
    type: 'admin_message',
    name: 'Admin Custom Message',
    category: 'Administration',
    defaultSubject: 'Message from {{senderName}}',
    defaultBody: JSON.stringify({
      heading: 'Notification',
      greeting: 'Dear {{recipientName}},',
      message: '{{message}}',
      infoFields: [],
      ctaText: '',
      ctaUrl: '',
      closing: '',
      signature: 'Best Regards,\n{{senderName}}\n{{companyName}}',
      presetTheme: 'Modern Blue',
    }),
    placeholders: [
      ...COMMON_PLACEHOLDERS,
      { name: 'recipientName', description: 'Name of the recipient' },
      { name: 'senderName', description: 'Name of the sender' },
      { name: 'message', description: 'Custom message body text' },
    ],
  },
  {
    type: 'offer_sent',
    name: 'Offer Letter',
    category: 'Hiring',
    defaultSubject: 'Official Offer Letter',
    defaultBody: JSON.stringify({
      heading: 'Official Offer Letter',
      greeting: 'Dear {{candidateName}},',
      message: 'Congratulations! Your documents have been successfully verified and we are pleased to share your official offer letter.',
      infoFields: ['position', 'joiningdate', 'location'],
      ctaText: 'Download Offer Letter',
      ctaUrl: '{{acceptUrl}}',
      closing: 'We look forward to welcoming you to our organization.',
      signature: 'Best Regards,\nOnboarding Director\n{{companyName}}',
      presetTheme: 'Modern Blue',
    }),
    placeholders: [
      ...COMMON_PLACEHOLDERS,
      { name: 'validUntil', description: 'Offer validity date' },
      { name: 'acceptUrl', description: 'Offer acceptance link' },
    ],
  },
  {
    type: 'panel_assignment',
    name: 'Panel Assignment',
    category: 'Interview',
    defaultSubject: 'Panel assignment: {{candidateName}}',
    defaultBody: JSON.stringify({
      heading: 'Panel Assignment',
      greeting: 'Dear {{panelistName}},',
      message: 'You\'ve been added as a panelist for the interview of {{candidateName}}.',
      infoFields: [],
      ctaText: '',
      ctaUrl: '',
      closing: 'Please review the candidate and submit your feedback in AgnoHire when ready.',
      signature: 'Best Regards,\nOperations Team\n{{companyName}}',
      presetTheme: 'Modern Blue',
    }),
    placeholders: [
      ...COMMON_PLACEHOLDERS,
      { name: 'panelistName', description: 'Name of the panelist' },
      { name: 'candidateName', description: 'Name of the candidate' },
    ],
  },
  {
    type: 'detailed_feedback',
    name: 'Detailed Interview Feedback',
    category: 'Interview',
    defaultSubject: 'Interview Feedback – {{jobTitle}}',
    defaultBody: JSON.stringify({
      heading: 'Detailed Interview Feedback',
      greeting: 'Dear {{candidateName}},',
      message: 'Thank you for participating in the interview process with AgnoHire for the {{jobTitle}} position. {{#if passed}}Congratulations! You have successfully cleared this interview round. Our team will be in touch shortly with the next steps.{{/if}}{{#if failed}}After evaluating your interview, we regret to inform you that you were not selected for the next round. We encourage you to continue learning and apply again in the future.{{/if}}',
      infoFields: ['interviewRound', 'overallScore', 'decision'],
      ctaText: '',
      ctaUrl: '',
      closing: 'Best wishes for your future endeavors.',
      signature: 'Regards,\nRecruitment Team\n{{companyName}}',
      presetTheme: 'Modern Blue',
    }),
    placeholders: [
      ...COMMON_PLACEHOLDERS,
      { name: 'jobTitle', description: 'Title of the job role' },
      { name: 'interviewRound', description: 'Name of the interview round' },
      { name: 'overallScore', description: 'Overall candidate percentage score' },
      { name: 'decision', description: 'PASS or FAIL decision' },
      { name: 'strengths', description: 'Key strengths observed' },
      { name: 'improvements', description: 'Areas for improvement' },
      { name: 'recommendedLearning', description: 'Recommended courses or topics' },
      { name: 'passed', description: 'True if candidate passed' },
      { name: 'failed', description: 'True if candidate failed' },
    ],
  },
  {
    type: 'document_request',
    name: 'Document Upload Request',
    category: 'Onboarding',
    defaultSubject: 'Action Required: Upload Your Joining Documents',
    defaultBody: JSON.stringify({
      heading: 'Document Submission Required',
      greeting: 'Dear {{candidateName}},',
      message: 'Congratulations on accepting the offer. Please upload the required joining documents to proceed with onboarding.',
      infoFields: ['requireddocuments'],
      ctaText: 'Upload Documents',
      ctaUrl: '{{uploadUrl}}',
      closing: 'Reach out if you have any questions.',
      signature: 'Best Regards,\nHR Operations\n{{companyName}}',
      presetTheme: 'Modern Blue',
    }),
    placeholders: [
      ...COMMON_PLACEHOLDERS,
      { name: 'uploadUrl', description: 'Document upload interface link' },
    ],
  },
  {
    type: 'document_reupload',
    name: 'Document Re-upload Request',
    category: 'Onboarding',
    defaultSubject: 'Action Required: Document Re-upload Required',
    defaultBody: JSON.stringify({
      heading: 'Document Verification Corrections',
      greeting: 'Dear {{candidateName}},',
      message: 'Your submitted document {{documentName}} has been rejected. Reason for Rejection: {{rejectionReason}}. Please review and upload a correct copy to proceed with onboarding.',
      infoFields: ['rejecteddocuments', 'rejectionreason'],
      ctaText: 'Upload Correct Documents',
      ctaUrl: '{{uploadUrl}}',
      closing: 'Please re-upload as soon as possible.',
      signature: 'Best Regards,\nVerification Team\n{{companyName}}',
      presetTheme: 'Modern Blue',
    }),
    placeholders: [
      ...COMMON_PLACEHOLDERS,
      { name: 'documentName', description: 'Name of the rejected document' },
      { name: 'rejectionReason', description: 'HR notes on why it was rejected' },
      { name: 'uploadUrl', description: 'Document upload interface link' },
    ],
  },
  {
    type: 'documents_verified',
    name: 'Documents Successfully Verified',
    category: 'Onboarding',
    defaultSubject: 'Documents Verified Successfully',
    defaultBody: JSON.stringify({
      heading: 'Documents Verified',
      greeting: 'Dear {{candidateName}},',
      message: 'Your submitted documents have been successfully verified.',
      infoFields: [],
      ctaText: 'Continue Onboarding',
      ctaUrl: '{{uploadUrl}}',
      closing: 'Welcome to our organization.',
      signature: 'Best Regards,\nHR Team\n{{companyName}}',
      presetTheme: 'Modern Blue',
    }),
    placeholders: [
      ...COMMON_PLACEHOLDERS,
    ],
  },
  {
    type: 'tentative_offer',
    name: 'Tentative Offer',
    category: 'Hiring',
    defaultSubject: 'Congratulations! Tentative Offer Confirmation',
    defaultBody: JSON.stringify({
      heading: 'Tentative Offer Confirmation',
      greeting: 'Dear {{candidateName}},',
      message: 'Congratulations! We are pleased to extend a tentative offer.',
      infoFields: ['position', 'department', 'tentativectc', 'joiningdate'],
      ctaText: 'View Offer',
      ctaUrl: '{{acceptUrl}}',
      closing: 'Please confirm your details to proceed.',
      signature: 'Best Regards,\nHR Team\n{{companyName}}',
      presetTheme: 'Modern Blue',
    }),
    placeholders: [
      ...COMMON_PLACEHOLDERS,
      { name: 'acceptUrl', description: 'Offer acceptance link' },
    ],
  },
  {
    type: 'hr_document_submitted',
    name: 'Document Successfully Submitted (HR Notification)',
    category: 'Onboarding',
    defaultSubject: 'Documents Submitted by Candidate',
    defaultBody: JSON.stringify({
      heading: 'Documents Submitted',
      greeting: 'Dear HR Team,',
      message: 'A candidate has submitted documents for verification. Details are listed below.',
      infoFields: ['candidateName', 'jobTitle', 'submissionDate', 'uploadedCount'],
      ctaText: 'Review Documents',
      ctaUrl: '{{reviewUrl}}',
      closing: 'Please verify the uploaded documents as soon as possible.',
      signature: 'Best Regards,\nSystem Notification\n{{companyName}}',
      presetTheme: 'Modern Blue',
    }),
    placeholders: [
      ...COMMON_PLACEHOLDERS,
      { name: 'jobTitle', description: 'Title of the job role' },
      { name: 'submissionDate', description: 'Date of submission' },
      { name: 'uploadedCount', description: 'Number of uploaded documents' },
      { name: 'reviewUrl', description: 'HR review page link' },
    ],
  },
  {
    type: 'onboarding_welcome',
    name: 'Onboarding Welcome',
    category: 'Onboarding',
    defaultSubject: 'Welcome to {{companyName}}!',
    defaultBody: JSON.stringify({
      heading: 'Welcome to our Organization!',
      greeting: 'Dear {{candidateName}},',
      message: 'We are excited to have you join our organization.',
      infoFields: ['joiningdate', 'reportingtime', 'officelocation', 'reportingmanager'],
      ctaText: 'Start Onboarding',
      ctaUrl: '{{startOnboardingUrl}}',
      closing: 'Looking forward to a great start.',
      signature: 'Best Regards,\nOnboarding Specialist\n{{companyName}}',
      presetTheme: 'Modern Blue',
    }),
    placeholders: [
      ...COMMON_PLACEHOLDERS,
      { name: 'joiningDate', description: 'Date of joining' },
      { name: 'reportingTime', description: 'Reporting time' },
      { name: 'officeLocation', description: 'Office location' },
      { name: 'managerName', description: 'Reporting manager name' },
      { name: 'startOnboardingUrl', description: 'Onboarding portal start link' },
    ],
  },
];

export function compileTemplate(
  body: string,
  variables: Record<string, any>,
  templateName?: string,
  emailType?: string
): string {
  let result = body;

  const normalizedVars: Record<string, any> = {};
  for (const [k, v] of Object.entries(variables)) {
    normalizedVars[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = v;
  }

  // Handle conditionals: {{#if var}}content{{/if}}
  result = result.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_match, key, content) => {
    const lookupKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    const value = variables[key] !== undefined ? variables[key] : normalizedVars[lookupKey];
    if (value === undefined || value === null) {
      console.warn(`[Placeholder Validation] Missing conditional key "${key}" for Template: "${templateName || 'unknown'}", Type: "${emailType || 'unknown'}".`);
    }
    if (value && (typeof value !== 'string' || value.trim() !== '')) {
      return content;
    }
    return '';
  });
  // Handle regular variables: {{var}}
  result = result.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const lookupKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    const value = variables[key] !== undefined ? variables[key] : normalizedVars[lookupKey];
    if (value === undefined || value === null) {
      console.warn(`[Placeholder Validation] Missing variable key "${key}" for Template: "${templateName || 'unknown'}", Type: "${emailType || 'unknown'}".`);
      return '';
    }
    return String(value);
  });
  return result;
}
