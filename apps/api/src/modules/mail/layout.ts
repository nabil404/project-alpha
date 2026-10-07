import mjml2html from 'mjml';

/**
 * The shared MJML layout every transactional email renders through, so they
 * look alike and survive Outlook, Gmail and dark mode without hand-written
 * table markup.
 *
 * Everything here is compiled once, when the module loads: MJML is far too
 * slow to run per message, and an auth endpoint must answer in the same time
 * whether or not it sends mail. The link differs per message, so the layout is
 * compiled around `LINK_SLOT` and `fillLink` swaps the escaped link in.
 */
export const LINK_SLOT = '__MAIL_LINK__';

export interface LinkEmailCopy {
  /** The `<title>` and the preview line most clients show beside the subject. */
  preview: string;
  heading: string;
  intro: string;
  action: string;
  outro: string;
}

export const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function linkEmailSource(copy: LinkEmailCopy): string {
  const e = escapeHtml;
  return `<mjml lang="en">
  <mj-head>
    <mj-title>${e(copy.preview)}</mj-title>
    <mj-preview>${e(copy.preview)}</mj-preview>
    <mj-attributes>
      <mj-all font-family="${FONT}" />
      <mj-text font-size="15px" line-height="24px" color="#1f2937" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f4f4f5" width="560px">
    <mj-section padding="32px 0 16px">
      <mj-column>
        <mj-text align="center" font-size="18px" font-weight="700">Social Glider</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" border-radius="8px" padding="32px 24px">
      <mj-column>
        <mj-text font-size="20px" font-weight="700" line-height="28px">${e(copy.heading)}</mj-text>
        <mj-text>${e(copy.intro)}</mj-text>
        <mj-button href="${LINK_SLOT}" background-color="#2563eb" color="#ffffff" font-size="15px" font-weight="600" border-radius="6px" inner-padding="12px 24px" align="left">${e(copy.action)}</mj-button>
        <mj-text font-size="13px" line-height="20px" color="#6b7280">Or paste this link into your browser:<br /><a href="${LINK_SLOT}" style="color:#2563eb;word-break:break-all">${LINK_SLOT}</a></mj-text>
        <mj-text>${e(copy.outro)}</mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="16px 0 32px">
      <mj-column>
        <mj-text align="center" font-size="12px" line-height="18px" color="#9ca3af">You received this email because of activity on your Social Glider account.</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
}

/**
 * Compiles a link email to HTML with `LINK_SLOT` where the link goes. Strict
 * validation, so a typo in a template fails at startup and in the specs rather
 * than going out as a broken email.
 */
export async function compileLinkEmail(copy: LinkEmailCopy): Promise<string> {
  const { html, errors } = await mjml2html(linkEmailSource(copy), {
    fonts: {},
    keepComments: false,
    validationLevel: 'strict',
    ignoreIncludes: true,
  });
  if (errors.length > 0) {
    throw new Error(`Invalid MJML: ${errors.map((error) => error.formattedMessage).join('; ')}`);
  }
  if (!html.includes(LINK_SLOT)) {
    throw new Error('Compiled MJML lost the link slot');
  }
  return html;
}

/** Puts the escaped link into every slot. A function replacer, so `$&` in a URL stays literal. */
export const fillLink = (html: string, url: string): string => {
  const href = escapeHtml(url);
  return html.replaceAll(LINK_SLOT, () => href);
};
