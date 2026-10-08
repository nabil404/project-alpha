import mjml2html from 'mjml';

/**
 * The MJML layout every email renders through: the Social Glider header, a
 * white card on a warm grey ground, and a centered footer, matching the
 * dashboard's design. MJML turns it into the table markup Outlook and Gmail
 * need.
 *
 * Every email is compiled once, when the module loads: MJML is far too slow to
 * run per message, and an auth endpoint must answer in the same time whether
 * or not it sends mail. What differs per message - a link, a customer's name,
 * a total - is a named slot in the copy, written `{name}`, compiled to a marker
 * and filled with the escaped value at send time.
 */

const color = {
  ground: '#f5f5f2',
  surface: '#ffffff',
  muted: '#efefeb',
  border: '#e2e2dc',
  text: '#1b1c1e',
  textMuted: '#5c5e63',
  accent: '#1f6b70',
  accentTint: '#e6f1f1',
  warning: '#855410',
  warningTint: '#f8efe0',
} as const;

const SANS = "Figtree, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const FONTS =
  'https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600&family=JetBrains+Mono:wght@400&display=swap';

export const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const SLOT = /__SLOT_([a-zA-Z]+)__/g;
const slot = (name: string): string => `__SLOT_${name}__`;

/** Fixed copy, escaped, with each `{name}` turned into that slot's marker. */
const copy = (text: string): string =>
  escapeHtml(text).replace(/\{([a-zA-Z]+)\}/g, (_match, name: string) => slot(name));

/** One piece of the card or footer, as MJML. */
export type Block = string;

const SPACE = '24px';

/**
 * The card's title. It sits 8px above the paragraph that explains it; pass
 * `space` when something else follows.
 */
export function heading(
  text: string,
  { eyebrow, space = '8px' }: { eyebrow?: string; space?: string } = {},
): Block {
  const above = eyebrow
    ? `<mj-text padding="0 0 8px" font-size="13px" line-height="18px" font-weight="500">${copy(eyebrow)}</mj-text>`
    : '';
  return `${above}<mj-text padding="0 0 ${space}" font-size="24px" line-height="32px" font-weight="600" letter-spacing="-0.01em" color="${color.text}">${copy(text)}</mj-text>`;
}

export function paragraph(text: string): Block {
  return `<mj-text padding="0 0 ${SPACE}">${copy(text)}</mj-text>`;
}

/** The card's call to action; `href` names the slot holding the link. */
export function button(label: string, href: string): Block {
  return `<mj-button href="${slot(href)}" align="left" padding="0 0 ${SPACE}" inner-padding="10px 24px" border-radius="10px" background-color="${color.accent}" color="#ffffff" font-size="15px" line-height="24px" font-weight="500">${copy(label)}</mj-button>`;
}

/** The link spelled out, for clients that block buttons. */
export function linkFallback(href: string): Block {
  return `<mj-text padding="0 0 8px" font-size="13px" line-height="20px">Or paste this link into your browser:</mj-text>
<mj-text padding="0 0 ${SPACE}" font-family="${MONO}" font-size="13px" line-height="20px" color="${color.text}"><div style="background:${color.muted};border-radius:10px;padding:12px 16px;word-break:break-all">${slot(href)}</div></mj-text>`;
}

export function divider(): Block {
  return `<mj-divider padding="0 0 ${SPACE}" border-width="1px" border-color="${color.border}" />`;
}

/** Small print. A `[label](slot)` becomes a link to that slot's URL. */
export function note(text: string, space = SPACE): Block {
  const html = copy(text).replace(
    /\[([^\]]+)\]\(([a-zA-Z]+)\)/g,
    (_match, label: string, href: string) =>
      `<a href="${slot(href)}" style="color:${color.accent};font-weight:500">${label}</a>`,
  );
  return `<mj-text padding="0 0 ${space}" font-size="13px" line-height="20px">${html}</mj-text>`;
}

export type Tone = 'accent' | 'warning';

const pillStyle = (tone: Tone) => {
  const [fg, bg] =
    tone === 'accent' ? [color.accent, color.accentTint] : [color.warning, color.warningTint];
  return `display:inline-block;padding:2px 10px;border-radius:999px;background:${bg};color:${fg};font-size:13px;line-height:18px;font-weight:500`;
};

/** A status chip on a line of its own, above the heading. */
export function pill(text: string, tone: Tone): Block {
  return `<mj-text padding="0 0 16px"><span style="${pillStyle(tone)}">${copy(text)}</span></mj-text>`;
}

export interface DetailRow {
  label: string;
  value: string;
  /** Monospace, for identifiers like an order number. */
  mono?: boolean;
  strong?: boolean;
  pill?: { text: string; tone: Tone };
}

/** Label-value rows in a bordered box, like the dashboard's detail panels. */
export function details(rows: readonly DetailRow[]): Block {
  const cells = rows
    .map((row, index) => {
      const border = index < rows.length - 1 ? `border-bottom:1px solid ${color.border};` : '';
      const value = row.mono
        ? `<span style="font-family:${MONO};font-size:13px;line-height:20px">${copy(row.value)}</span>`
        : `<span style="font-size:15px;line-height:24px;font-weight:${row.strong ? 600 : 500}">${copy(row.value)}</span>`;
      const chip = row.pill
        ? `&nbsp;&nbsp;<span style="${pillStyle(row.pill.tone)}">${copy(row.pill.text)}</span>`
        : '';
      return `<tr>
<td style="${border}padding:12px 16px;font-size:13px;line-height:18px;font-weight:500;color:${color.textMuted}">${copy(row.label)}</td>
<td align="right" style="${border}padding:12px 16px;color:${color.text}">${value}${chip}</td>
</tr>`;
    })
    .join('\n');
  return `<mj-table padding="0 0 ${SPACE}" cellpadding="0" cellspacing="0" border="1px solid ${color.border}" css-class="details">${cells}</mj-table>`;
}

/** Two headline numbers side by side. */
export function stats(
  items: readonly [{ label: string; value: string }, { label: string; value: string }],
): Block {
  const tile = ({ label, value }: { label: string; value: string }) =>
    `<td width="50%" style="background:${color.muted};border-radius:10px;padding:20px;vertical-align:top">
<div style="font-size:13px;line-height:18px;font-weight:500;color:${color.textMuted}">${copy(label)}</div>
<div style="padding-top:4px;font-size:28px;line-height:36px;font-weight:600;letter-spacing:-0.02em;color:${color.text}">${copy(value)}</div>
</td>`;
  return `<mj-table padding="0 0 ${SPACE}" cellpadding="0" cellspacing="0" table-layout="fixed"><tr>${tile(items[0])}<td width="16" style="width:16px"></td>${tile(items[1])}</tr></mj-table>`;
}

export interface EmailLayout {
  /** The preview line most clients show beside the subject. */
  preview: string;
  card: readonly Block[];
  /** Small print under the card, above the brand line. */
  footer?: readonly Block[];
}

function source({ preview, card, footer = [] }: EmailLayout): string {
  return `<mjml lang="en">
  <mj-head>
    <mj-title>${slot('subject')}</mj-title>
    <mj-preview>${copy(preview)}</mj-preview>
    <mj-font name="Figtree" href="${escapeHtml(FONTS)}" />
    <mj-attributes>
      <mj-all font-family="${SANS}" />
      <mj-text padding="0" font-size="15px" line-height="24px" color="${color.textMuted}" />
    </mj-attributes>
    <mj-style>
      a { color: ${color.accent}; }
      .details table { border-radius: 10px; border-collapse: separate !important; }
    </mj-style>
  </mj-head>
  <mj-body background-color="${color.ground}" width="600px">
    <mj-section padding="40px 0 24px">
      <mj-column>
        <mj-text padding="0" font-size="15px" line-height="24px" font-weight="600" color="${color.text}">Social Glider</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="${color.surface}" border="1px solid ${color.border}" border-radius="16px" padding="40px 40px 16px">
      <mj-column>
        ${card.join('\n        ')}
      </mj-column>
    </mj-section>
    <mj-section padding="24px 24px 40px">
      <mj-column>
        ${footer.map((block) => block.replace('<mj-text ', '<mj-text align="center" ')).join('\n        ')}
        <mj-text align="center" padding="0" font-size="13px" line-height="20px">Social Glider</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
}

/** A compiled email: fills its slots with escaped values. */
export type Fill<K extends string> = (values: Record<K | 'subject', string>) => string;

/**
 * Compiles an email to HTML, once. Strict validation, so a typo in a template
 * fails at startup and in the specs rather than going out as a broken email.
 */
export async function compileEmail<K extends string>(layout: EmailLayout): Promise<Fill<K>> {
  const { html, errors } = await mjml2html(source(layout), {
    keepComments: false,
    validationLevel: 'strict',
    ignoreIncludes: true,
  });
  if (errors.length > 0) {
    throw new Error(`Invalid MJML: ${errors.map((error) => error.formattedMessage).join('; ')}`);
  }

  return (values) =>
    // A function replacer, so a `$&` in a URL or a name stays literal.
    html.replace(SLOT, (_match, name: string) => {
      const value = (values as Record<string, string | undefined>)[name];
      if (value === undefined) {
        throw new Error(`Email slot "${name}" has no value`);
      }
      return escapeHtml(value);
    });
}
