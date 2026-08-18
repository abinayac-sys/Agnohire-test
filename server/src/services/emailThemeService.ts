
import { configService } from './configService.js';
import { CONFIG_KEYS } from '@agnohire/shared';

export interface BrandSettings {
  companyName: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  buttonColor: string;
  buttonStyle: 'rounded' | 'square' | 'pill' | 'outline' | 'filled';
  fontFamily: string;
  footerBg: string;
  textColor: string;
  website: string;
  phone: string;
  address: string;
  copyright: string;
  linkedin: string;
  facebook: string;
  twitter: string;
  bannerUrl?: string;
  logoCid?: string;
  logoWidth?: number;
}

export const DEFAULT_LOGO_URL = '/email-default-logo.png';

export async function resolveEmailLogo(
  useCustomLogo?: boolean,
  customLogoId?: string,
  isPreview = false
): Promise<string> {
  const templateLogoId = useCustomLogo && customLogoId ? customLogoId : '';
  const globalLogo = await configService.getString(CONFIG_KEYS.EMAIL_BRAND_LOGO, '');

  const chosenLogo = templateLogoId || globalLogo;
  if (chosenLogo) {
    return chosenLogo.startsWith('http') || chosenLogo.startsWith('/') || chosenLogo.startsWith('data:')
      ? chosenLogo
      : `/api/system/branding/email.brand_logo?v=${encodeURIComponent(chosenLogo)}`;
  }
  return isPreview ? DEFAULT_LOGO_URL : 'brandlogo';
}


export function getButtonStyle(brand: BrandSettings): string {
  const bg = brand.buttonColor || '#0B5ED7';
  const shape = brand.buttonStyle || 'rounded';

  let radius = '6px';
  if (shape === 'square') radius = '0px';
  if (shape === 'pill') radius = '9999px';

  if (shape === 'outline') {
    return `display: inline-block; background: transparent; border: 2px solid ${bg}; color: ${bg}; text-decoration: none; padding: 11px 24px; border-radius: ${radius}; font-size: 15px; font-weight: 600; text-align: center;`;
  }

  return `display: inline-block; background: ${bg}; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: ${radius}; font-size: 15px; font-weight: 600; text-align: center;`;
}

export function renderTheme(
  _themeName: string, // Kept for interface compatibility but all templates use the master shell
  title: string,
  bodyHtml: string,
  brand: BrandSettings
): string {
  const primary = brand.primaryColor || '#0B5ED7';
  const text = brand.textColor || '#333333';
  const footerBgColor = brand.footerBg || primary;
  const footerTextColor = footerBgColor.toLowerCase() === '#ffffff' || footerBgColor.toLowerCase() === '#fff' ? '#666666' : '#ffffff';
  const fontFamily = brand.fontFamily || 'Arial,Helvetica,sans-serif';

  // Custom button styling override inside bodyHtml if any
  let processedBody = bodyHtml;
  const btnStyle = getButtonStyle(brand);
  processedBody = processedBody.replace(
    /style="display:inline-block;background:#5b5bd6;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;font-weight:600;"/g,
    `style="${btnStyle}"`
  );

  // Logo rendering tag
  const isUrlLogo = brand.logoCid && (brand.logoCid.startsWith('http') || brand.logoCid.startsWith('/') || brand.logoCid.startsWith('data:'));
  const width = brand.logoWidth ? `${brand.logoWidth}px` : '220px';
  const logoHtml = brand.logoCid
    ? isUrlLogo
      ? `<img src="${brand.logoCid}" alt="${brand.companyName}" style="max-width:${width};height:auto;display:block;" />`
      : `<img src="cid:${brand.logoCid}" alt="${brand.companyName}" style="max-width:${width};height:auto;display:block;" />`
    : `<span style="font-size:24px;font-weight:bold;color:${primary};letter-spacing:-0.5px;">${brand.companyName}</span>`;

  // Dynamic social links
  const socials: string[] = [];
  if (brand.linkedin) socials.push(`<a href="${brand.linkedin}" style="color:${footerTextColor};text-decoration:none;margin-right:12px;">LinkedIn</a>`);
  if (brand.facebook) socials.push(`<a href="${brand.facebook}" style="color:${footerTextColor};text-decoration:none;margin-right:12px;">Facebook</a>`);
  if (brand.twitter) socials.push(`<a href="${brand.twitter}" style="color:${footerTextColor};text-decoration:none;">Twitter</a>`);
  const socialsLine = socials.length ? `<br/>${socials.join(' | ')}` : '';

  const currentYear = new Date().getFullYear();
  const websiteLabel = brand.website ? brand.website.replace(/^https?:\/\/(www\.)?/, '') : 'www.agnohire.com';
  const websiteUrl = brand.website || 'https://agnohire.com';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:${fontFamily};color:${text};">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:30px 0;">
    <tr>
        <td align="center" style="padding:0 10px;">

            <table width="100%" cellpadding="0" cellspacing="0" style="max-width:650px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e5e5e5;box-shadow:0 4px 12px rgba(0,0,0,0.05);">

                <!-- Header -->
                <tr>
                    <td align="center" style="background:#ffffff;padding:30px 20px;border-bottom:1px solid #eeeeee;">
                        ${logoHtml}
                    </td>
                </tr>

                <!-- Banner Image -->
                ${brand.bannerUrl ? `<tr><td align="center" style="padding:0;"><img src="${brand.bannerUrl}" alt="Banner" style="width:100%;max-width:650px;display:block;height:auto;" /></td></tr>` : ''}

                <!-- Title -->
                <tr>
                    <td style="padding:35px 40px 10px;">
                        <h2 style="margin:0;color:${primary};font-size:26px;font-weight:bold;">
                            ${title}
                        </h2>
                    </td>
                </tr>

                <!-- Content -->
                <tr>
                    <td style="padding:10px 40px 30px;line-height:1.7;font-size:15px;color:${text};">
                        ${processedBody}
                    </td>
                </tr>

                <!-- Footer -->
                <tr>
                    <td align="center"
                        style="background:${footerBgColor};color:${footerTextColor};padding:25px 20px;font-size:13px;line-height:1.6;">

                        ${brand.copyright ? brand.copyright : `© ${currentYear} ${brand.companyName}. All Rights Reserved.`}<br>
                        ${brand.address ? `${brand.address}<br>` : ''}
                        ${brand.phone ? `Phone: ${brand.phone} | ` : ''}
                        Website:
                        <a href="${websiteUrl}"
                           style="color:${footerTextColor};text-decoration:none;font-weight:bold;">
                            ${websiteLabel}
                        </a>
                        ${socialsLine}
                        <br/>
                        This is an automated email. Please do not reply.
                    </td>
                </tr>

            </table>

        </td>
    </tr>
</table>

</body>
</html>`;
}