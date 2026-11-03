/**
 * npm run template-workbook
 *
 * Brings calendar/Fuadijan-Monthly-Template.xlsx up to date with the code: the Templates sheet lists every
 * template in the registry, the Calendar sheet's template dropdown offers them all and its header gains the
 * optional `campaign` column, the Columns and Read Me sheets describe every column and sheet, and the Campaigns
 * and Products sheets exist with a header and an example row each. The Calendar sheet's own cells, dropdowns
 * and widths are kept as they are, so the owner's layout survives.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { heroTemplates, knownTemplates, templateEntry } from '../src/render/registry.js';
import { CALENDAR_COLUMNS, OPTIONAL_COLUMNS } from './calendar.schema.js';
import { CAMPAIGN_COLUMNS } from './campaigns.js';
import { PRODUCT_COLUMNS } from './products.js';
import { BENEFIT_COLUMNS } from './benefits.js';
import { writeWorkbook } from './xlsx-write.js';

export const TEMPLATE_PATH = 'calendar/Fuadijan-Monthly-Template.xlsx';
export const RECORD_TEMPLATE_PATH = 'calendar/Fuadijan-Post-Record-Example.xlsx';

/** Style indexes in the template's styles.xml: 1 = Calendar header (bold on fill), 3 = wrapped text, 4 = bold header, 5 = bold wrapped. */
const S = { calendarHeader: 1, wrap: 3, header: 4, title: 5 } as const;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colLetter = (i: number): string => {
  let n = i + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

type Cell = string | null | { v: string; s: number };

function sheetXml(rows: Cell[][], widths: number[], validations = ''): string {
  const cols = `<cols>${widths.map((w, i) => `<col width="${w}" customWidth="1" min="${i + 1}" max="${i + 1}" />`).join('')}</cols>`;
  const body = rows.map((row, r) => {
    const cells = row.map((cell, c) => {
      if (cell === null || cell === '') return '';
      const { v, s } = typeof cell === 'string' ? { v: cell, s: 0 } : cell;
      return `<c r="${colLetter(c)}${r + 1}"${s ? ` s="${s}"` : ''} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');
  const last = `${colLetter(Math.max(0, ...rows.map((r) => r.length - 1)))}${rows.length}`;
  return `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><outlinePr summaryBelow="1" summaryRight="1" /><pageSetUpPr /></sheetPr><dimension ref="A1:${last}" /><sheetViews><sheetView workbookViewId="0"><selection activeCell="A1" sqref="A1" /></sheetView></sheetViews><sheetFormatPr baseColWidth="8" defaultRowHeight="15" />${cols}<sheetData>${body}</sheetData>${validations}<pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5" /></worksheet>`;
}

const header = (names: readonly string[], s: number = S.header): Cell[] => names.map((n) => ({ v: n, s }));
const wrapped = (cells: (string | null)[]): Cell[] => cells.map((c) => (c == null ? null : { v: c, s: S.wrap }));

const listValidation = (sqref: string, values: string[]) =>
  `<dataValidation sqref="${sqref}" showDropDown="0" showInputMessage="0" showErrorMessage="0" allowBlank="1" type="list"><formula1>"${values.join(',')}"</formula1></dataValidation>`;

export const COLUMN_NOTES: Record<string, string> = {
  date: 'The posting date, as a date cell (one row per post; 30 rows for a month). Day 1 is the first row.',
  slot: 'feed, carousel or reel (dropdown).',
  type: 'Free label for the kind of post: hero-dish, education, social-proof, community, teaser, launch … Rows of one campaign usually share it.',
  dish: 'The menu item as the menu spells it (Chapli Kebab), or its ProductID from the Products sheet (P004). Several: comma-separated, the first names the photos. Blank = the agent suggests one by rotation. [brackets] = to confirm.',
  theme: 'Short theme line, e.g. "Rooted in tradition".',
  caption_hint: 'A hint for the caption when the caption column is left empty.',
  post_time: 'HH:MM Sydney time, or blank for the default (/set post-time).',
  template: 'One of the render templates, see the Templates sheet (dropdown). The seed refuses an unknown value.',
  status: 'planned (dropdown: planned, photo-needed, ready, posted). Leave as planned for a new month.',
  asset: 'Optional note on the asset wanted (photo / clip / existing file).',
  objective: 'What this post is for, one sentence.',
  creative_instructions: 'The shoot and design brief. Numbered shots 1) … 2) … become the shot list; carousel slides as 1) “title” 2) “title”.',
  on_screen_text: 'Reel text cards in order, separated by →.',
  caption: 'The Instagram caption, without address line or hashtags. [brackets] mark anything to confirm.',
  cta: 'The call to action sentence.',
  hashtags: '3–5 hashtags, space separated, each with #.',
  story_ideas: 'One story idea per line (Alt+Enter).',
  confirmation_notes: 'Anything the kitchen must confirm before this can go out.',
  campaign: 'Optional. The campaign this post belongs to: its CampaignID (CAMP001) or its name from the Campaigns sheet. Several campaigns can run in the same month; each row names its own.',
  benefit: 'Optional. A customer benefit the post is about, as its BenefitID (BEN001) from the Benefits sheet or in words; the writer tells it as what the customer gets, never as the work behind it.',
};

export const READ_ME: string[] = [
  'FUADIJAN · MONTHLY SOCIAL PLAN — one workbook per month, loaded on the Strategy page of the web app ("Load a month\'s workbook") or with: npm run seed-calendar -- --file "calendar/<month>.xlsx"',
  'Calendar sheet: one row per post, 30 rows for a month, in date order. Day 1 is the first row. Keep the 18 header columns exactly as they are; the optional campaign column may follow them.',
  'Dates: type the real posting dates. The month of the first date names the plan (e.g. 2026-12). Loading a workbook for a new month adds that month next to the current one; it never overwrites it.',
  'Loading the same month again updates what changed in the sheet and leaves alone anything you edited from Telegram or the web app (your edits win). A day that already has a photo, or has moved past planned, is left as it is.',
  'Campaigns sheet: every launch, countdown or seasonal push, with its dates, status and series. Several can run at once. A Calendar row joins one through its campaign column (the CampaignID or the name). The same CampaignID is updated, never duplicated.',
  'Products sheet: the whole roster, including what is not on the menu yet (Status: active, coming soon, planned, retired). A product here can be posted about before it reaches the website; its Series says which look it gets. The same product name is updated, never duplicated.',
  'Benefits sheet: the customer benefits (BenefitID | Benefit), e.g. BEN001 Plenty of parking available. A post about an improvement names one in its benefit column and is written from what the customer gets, never from renovations, builders or equipment.',
  'The Calendar may instead be laid out as Day | CampaignID | ProductID | BenefitID | Series | Format | Hook | Caption | CTA | Hashtags | Status (a Date column is optional; without one, give the date of Day 1 when loading). Series picks the look, Format the slot (Reel, Carousel, Photo), the Hook becomes the theme the writer reads.',
  'Each sheet may come in its own workbook: a workbook of Campaigns, Products or Benefits alone loads those and changes no days.',
  'One row can carry every platform: Canva Headline, Canva Subheading, Reel Cover Text, Hook, Facebook Version, Facebook CTA, TikTok Opening Text, TikTok Hook, TikTok Script, TikTok CTA, TikTok Hashtags, Story Sequence, Reel Shot List, AI Image Prompt, Customer Message, Platform, Content Goal, Funnel Stage, KPI, Priority. What you write is used as written; what you leave blank the writer drafts when the photo arrives. See Fuadijan-Post-Record-Example.xlsx.',
  'Slogans sheet: your wording bank. Item = the menu item as the menu spells it ("all" = every post). Slogan = the headline, Alt+Enter for a line break. Line and Caption are optional. The same item + slogan is updated, never duplicated, so the bank grows month after month.',
  'Columns sheet explains every calendar column; Templates sheet lists the design templates and series the template, Series and campaign columns accept.',
  'Anything you are not sure of goes in [square brackets]; the agent asks you about it on Telegram before the post is made.',
];

export function templateRows(): Cell[][] {
  const rows: Cell[][] = [header(['template', 'renders as', 'series label', 'footer', 'preferred style'])];
  for (const t of knownTemplates()) {
    const e = templateEntry(t);
    rows.push([t, e.key, e.label, e.footer, e.style ?? 'band']);
  }
  rows.push([]);
  rows.push([{ v: 'Series (for the Series column of Campaigns and Products, and the Templates above): ' + [...new Set(heroTemplates().map((t) => t.label))].join(' · '), s: S.wrap }]);
  rows.push([{ v: 'Styles: band (house look), split (a word above and below the dish), poster (light paper, plate in front of the headline), flat (solid Ember, plate off the bottom), invite (Night panel, photo off one side, date and hours). The art director may still choose another when the photo cannot carry it; a /redo note ("poster") locks one.', s: S.wrap }]);
  return rows;
}

export function campaignRows(): Cell[][] {
  return [
    header([...CAMPAIGN_COLUMNS]),
    wrapped(['CAMP001', 'Charcoal Seafood Launch', 'Product launch', 'Grow seafood sales', 'Seafood units sold', 'FROM THE CHARCOAL SEA', '2026-12-01', '2026-12-21', 'planned', 'high']),
    wrapped(['CAMP002', 'Juice Bar Launch', 'Launch', 'Build the beverage category', 'Drinks sold with a meal', 'FRESH POUR', '2026-12-08', '2026-12-31', 'planned', 'medium']),
  ];
}

export function productRows(): Cell[][] {
  return [
    header([...PRODUCT_COLUMNS]),
    wrapped(['P001', 'Chapli Kebab', 'BBQ', 'active', 'FROM THE FIRE']),
    wrapped(['P002', 'BBQ Barramundi', 'Seafood', 'coming soon', 'FROM THE CHARCOAL SEA']),
    wrapped(['P003', 'Mango Lassi', 'Beverage', 'active', 'FRESH POUR']),
    wrapped(['P004', 'Lava Cake', 'Dessert', 'planned', 'SAVE ROOM']),
  ];
}

export function benefitRows(): Cell[][] {
  return [
    header([...BENEFIT_COLUMNS]),
    wrapped(['BEN001', 'Plenty of parking available']),
    wrapped(['BEN002', 'Fully air-conditioned dining']),
    wrapped(['BEN003', 'Family-friendly dining']),
  ];
}

export async function buildTemplateWorkbook(path = TEMPLATE_PATH): Promise<{ sheets: string[]; templates: number }> {
  const zip = await JSZip.loadAsync(readFileSync(path));
  const read = async (name: string) => zip.file(name)!.async('string');

  // Calendar: the template dropdown lists every registry template; the header gains the optional columns.
  let calendar = await read('xl/worksheets/sheet1.xml');
  const templates = knownTemplates();
  calendar = calendar.replace(/<dataValidation sqref="H2:H200"[^>]*>[\s\S]*?<\/dataValidation>/, listValidation('H2:H200', templates));
  const headerRow = calendar.match(/<row r="1"[^>]*>([\s\S]*?)<\/row>/)!;
  const present = [...headerRow[1]!.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]!);
  const missing = OPTIONAL_COLUMNS.filter((c) => !present.includes(c));
  if (missing.length) {
    const extra = missing.map((c, i) => `<c r="${colLetter(present.length + i)}1" s="${S.calendarHeader}" t="inlineStr"><is><t>${c}</t></is></c>`).join('');
    calendar = calendar.replace(headerRow[0], headerRow[0].replace('</row>', `${extra}</row>`));
    const colsEnd = calendar.indexOf('</cols>');
    const extraCols = missing.map((_, i) => `<col width="18" customWidth="1" min="${present.length + i + 1}" max="${present.length + i + 1}" />`).join('');
    calendar = `${calendar.slice(0, colsEnd)}${extraCols}${calendar.slice(colsEnd)}`;
  }
  zip.file('xl/worksheets/sheet1.xml', calendar);

  // Columns, Templates and Read Me are written from the code.
  const columnRows: Cell[][] = [header(['Column', 'What goes in it'])];
  for (const c of [...CALENDAR_COLUMNS, ...OPTIONAL_COLUMNS]) columnRows.push([c, { v: COLUMN_NOTES[c]!, s: S.wrap }]);
  zip.file('xl/worksheets/sheet2.xml', sheetXml(columnRows, [24, 120]));
  zip.file('xl/worksheets/sheet3.xml', sheetXml(templateRows(), [24, 14, 24, 10, 16]));
  zip.file('xl/worksheets/sheet5.xml', sheetXml(READ_ME.map((l, i) => [{ v: l, s: i === 0 ? S.title : S.wrap }]), [130]));

  // Campaigns and Products: added once, after the sheets the workbook has.
  const workbook = await read('xl/workbook.xml');
  const rels = await read('xl/_rels/workbook.xml.rels');
  const types = await read('[Content_Types].xml');
  const sheetNames = [...workbook.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]!);
  const wanted: { name: string; rows: Cell[][]; widths: number[]; validations: string }[] = [
    { name: 'Campaigns', rows: campaignRows(), widths: [14, 32, 18, 30, 26, 26, 14, 14, 12, 12], validations: `<dataValidations count="2">${listValidation('I2:I200', ['planned', 'active', 'done'])}${listValidation('J2:J200', ['high', 'medium', 'low'])}</dataValidations>` },
    { name: 'Products', rows: productRows(), widths: [12, 32, 18, 16, 26], validations: `<dataValidations count="1">${listValidation('D2:D200', ['active', 'coming soon', 'planned', 'retired'])}</dataValidations>` },
    { name: 'Benefits', rows: benefitRows(), widths: [12, 60], validations: '' },
  ];
  let wb = workbook;
  let rl = rels;
  let ct = types;
  let nextSheet = Math.max(...[...workbook.matchAll(/sheetId="(\d+)"/g)].map((m) => Number(m[1]))) + 1;
  let nextRel = Math.max(...[...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]))) + 1;
  for (const s of wanted) {
    const file = `xl/worksheets/sheet${nextSheet}.xml`;
    zip.file(file, sheetXml(s.rows, s.widths, s.validations));
    if (sheetNames.includes(s.name)) {
      // Already there (a re-run): rewrite its file in place instead.
      const id = workbook.match(new RegExp(`<sheet name="${s.name}"[^>]*r:id="(rId\\d+)"`))![1]!;
      const target = rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${id}"`))?.[1] ?? rels.match(new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`))![1]!;
      zip.remove(file);
      zip.file(target.replace(/^\//, ''), sheetXml(s.rows, s.widths, s.validations));
      continue;
    }
    wb = wb.replace('</sheets>', `<sheet name="${s.name}" sheetId="${nextSheet}" state="visible" r:id="rId${nextRel}" /></sheets>`);
    rl = rl.replace('</Relationships>', `<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/${file}" Id="rId${nextRel}" /></Relationships>`);
    ct = ct.replace('</Types>', `<Override PartName="/${file}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" /></Types>`);
    nextSheet++;
    nextRel++;
  }
  zip.file('xl/workbook.xml', wb);
  zip.file('xl/_rels/workbook.xml.rels', rl);
  zip.file('[Content_Types].xml', ct);
  writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return { sheets: [...wb.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]!), templates: templates.length };
}

/** One full post record, in the one-row-per-post shape the Calendar sheet takes. Anything unconfirmed sits in [brackets], so the bot asks before it goes out. */
export const RECORD_EXAMPLE: Record<string, string> = {
  Date: '2026-11-19',
  Day: 'Thursday',
  CampaignID: 'CAMP004',
  Campaign: 'Seafood Expansion',
  ProductID: 'BBQ Barramundi',
  BenefitID: 'More Choice For Customers',
  Series: 'FROM THE CHARCOAL SEA',
  Platform: 'All',
  Format: 'Reel',
  'Content Goal': 'Awareness',
  Status: 'Planned',
  'Canva Headline': 'WHOLE BBQ\nBARRAMUNDI',
  'Canva Subheading': 'FROM THE CHARCOAL SEA',
  'Reel Cover Text': 'NOT EVERYTHING OFF\nTHE GRILL IS A KEBAB',
  Hook: 'Not everything off the grill is a kebab.',
  'Instagram Caption': 'Fire. Smoke. Fresh seafood.\n\nOur BBQ Barramundi [is quickly becoming one of the most talked-about dishes at Fuadijan: confirm].\n\nCooked over the grill and served ready to share, it\'s a different way to experience the flavours we\'re known for.\n\n🐟 Whole BBQ Barramundi\n\n🔥 Smoked. Grilled. Rooted in Tradition.',
  CTA: 'Would you try BBQ Barramundi?',
  'Instagram Hashtags': '#Barramundi #BBQFish #SeafoodSydney #Fuadijan #AuburnEats #PakistaniFood #SydneyFoodie #FoodSydney',
  'Facebook Version': 'Some meals are made to be shared.\n\nOur BBQ Barramundi combines fresh seafood with the smoky flavours our customers love.\n\nIf you\'re looking for something a little different next time you visit, this might become your new favourite.\n\nWe\'re always looking for ways to give our customers more choice and more reasons to enjoy Fuadijan.',
  'Facebook CTA': 'Who would you share this with?',
  'TikTok Opening Text': 'MOST PEOPLE DON\'T KNOW\nWE SERVE THIS...',
  'TikTok Hook': 'Not everything on the grill is a kebab.',
  'TikTok Script': 'Watch this whole Barramundi hit the grill.\n\nFresh fish. Open fire. Simple flavour.\n\n[This is one of Auburn\'s most underrated dishes: confirm].',
  'TikTok CTA': 'Would you order this?',
  'TikTok Hashtags': '#SydneyFood #FoodTok #BBQFish #Barramundi #Auburn',
  'Story Sequence': 'Poll: Fish or BBQ? FISH / BBQ\nWhy not both? (show Barramundi being grilled)\nAvailable now at Fuadijan',
  'Reel Shot List': 'Whole fish on preparation bench\nMarinade being applied\nFish hitting grill\nSmoke rising\nClose-up of grill marks\nServing shot\nFamily-style table shot',
  'AI Image Prompt': 'Premium food photography of a whole BBQ barramundi served on a rustic platter, charcoal grilled appearance, vibrant herbs and lemon garnish, restaurant quality food styling, dramatic lighting, black background, no people, no text',
  'Customer Message': 'We\'re continuously expanding our menu to give customers more ways to enjoy Fuadijan.',
  Objective: 'Build seafood awareness',
  'Funnel Stage': 'Discovery',
  KPI: 'Reach, saves, comments',
  Priority: 'High',
};

export async function buildRecordExample(path = RECORD_TEMPLATE_PATH): Promise<void> {
  const columns = Object.keys(RECORD_EXAMPLE);
  await writeWorkbook(path, [{ name: 'Calendar', rows: [columns, columns.map((c) => RECORD_EXAMPLE[c]!)], widths: columns.map(() => 28) }]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  buildRecordExample().then(() => buildTemplateWorkbook()).then((r) => console.log(`${TEMPLATE_PATH}: sheets ${r.sheets.join(', ')}; ${r.templates} templates. ${RECORD_TEMPLATE_PATH} written.`)).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
