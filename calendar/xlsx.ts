/**
 * A small .xlsx reader. The owner's workbook is written by a .NET library (ClosedXML-style: every element carries
 * an `x:` namespace prefix, strings are inline `t="str"`, dates are ISO `t="d"`), which exceljs cannot open. This
 * reads the cells of one sheet into rows of plain values: string | number | boolean | Date | null. Shared strings,
 * inline strings, ISO dates and numbers are handled; formulas yield their cached value.
 */
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';

export type Cell = string | number | boolean | Date | null;

const decodeEntities = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

/** Drops a namespace prefix (`<x:c>` → `<c>`) so one set of patterns works for Excel and .NET output. */
const unprefix = (xml: string) => xml.replace(/<(\/?)[A-Za-z0-9]+:/g, '<$1');

const colIndex = (ref: string): number => {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

function textOf(xml: string): string {
  return decodeEntities([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]!).join(''));
}

export async function readSheetRows(path: string, sheetName: string): Promise<Cell[][]> {
  const zip = await JSZip.loadAsync(readFileSync(path));
  const get = async (name: string) => {
    const f = zip.file(name.replace(/^\//, ''));
    return f ? unprefix(await f.async('string')) : null;
  };
  const workbook = await get('xl/workbook.xml');
  if (!workbook) throw new Error(`${path} has no xl/workbook.xml`);
  const sheet = [...workbook.matchAll(/<sheet\s([^>]*)\/?>/g)].map((m) => m[1]!).find((attrs) => new RegExp(`name="${sheetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(attrs));
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found in ${path}`);
  const rid = sheet.match(/r:id="([^"]+)"/)?.[1] ?? sheet.match(/\sid="([^"]+)"/)?.[1];
  const rels = (await get('xl/_rels/workbook.xml.rels')) ?? '';
  const target = [...rels.matchAll(/<Relationship\s([^>]*)\/?>/g)].map((m) => m[1]!).find((a) => a.includes(`Id="${rid}"`))?.match(/Target="([^"]+)"/)?.[1];
  if (!target) throw new Error(`No worksheet file for sheet "${sheetName}"`);
  const sheetXml = await get(target.startsWith('/') ? target : `xl/${target}`);
  if (!sheetXml) throw new Error(`Worksheet ${target} is missing`);

  const sst: string[] = [];
  const sstXml = await get('xl/sharedStrings.xml');
  if (sstXml) for (const m of sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) sst.push(textOf(m[1]!));

  const rows: Cell[][] = [];
  for (const rowMatch of sheetXml.matchAll(/<row\s([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNo = Number(rowMatch[1]!.match(/\sr="(\d+)"/)?.[1] ?? rows.length + 1);
    const cells: Cell[] = [];
    for (const c of rowMatch[2]!.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!;
      const inner = c[2] ?? '';
      const ref = attrs.match(/(?:^|\s)r="([A-Z]+)\d+"/)?.[1] ?? '';
      const type = attrs.match(/\st="([^"]+)"/)?.[1] ?? 'n';
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value: Cell = null;
      if (type === 'inlineStr') value = textOf(inner) || null;
      else if (v === undefined) value = null;
      else if (type === 's') value = sst[Number(v)] ?? null;
      else if (type === 'str') value = decodeEntities(v) || null;
      else if (type === 'b') value = v === '1';
      else if (type === 'd') value = Number.isNaN(Date.parse(v)) ? decodeEntities(v) : new Date(v);
      else value = Number(v);
      const idx = ref ? colIndex(ref) : cells.length;
      while (cells.length < idx) cells.push(null);
      cells[idx] = value;
    }
    while (rows.length < rowNo - 1) rows.push([]);
    rows.push(cells);
  }
  return rows;
}

/** Excel's serial day number → ISO date (1900 date system, with its leap-year quirk absorbed by the epoch). */
export function serialToIsoDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86_400_000);
  return new Date(ms).toISOString().slice(0, 10);
}

/** A fraction of a day → "HH:MM". */
export function fractionToTime(fraction: number): string {
  const minutes = Math.round((fraction % 1) * 24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
