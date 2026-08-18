import { MOCK_DATA } from './emailTemplateMetadata.js';

export function buildEmailVariables(
  _type: string,
  context: Record<string, any>,
  isPreview = false
): Record<string, any> {
  const baseContext = isPreview ? { ...MOCK_DATA, ...context } : context;

  // Derive composite or fallbacks
  const companyName = baseContext.companyName || 'AgnoHire';
  const currentDate = baseContext.currentDate || new Date().toLocaleDateString();
  const currentYear = baseContext.currentYear || new Date().getFullYear().toString();
  const supportEmail = baseContext.supportEmail || 'support@agnohire.com';

  return {
    ...baseContext,
    companyName,
    currentDate,
    currentYear,
    supportEmail,
  };
}
