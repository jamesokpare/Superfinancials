/**
 * Minimal XLSX reader (no dependency): reads one worksheet into rows of cell
 * values. Enough for official statistics workbooks (World Bank Pink Sheet,
 * EEX auction reports): shared strings, inline strings and numbers. No
 * formulas, styles or dates-as-serials conversion (callers handle values).
 *
 * An .xlsx file is a zip archive; entries are read from the central directory
 * and inflated with node:zlib.
 */
import { inflateRawSync } from "node:zlib";

function unzip(buf: Buffer): Map<string, Buffer> {
  // End of central directory record: signature 0x06054b50, within the last 64 KB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip file");
  const n = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad zip central directory");
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42); const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (method === 0) out.set(name, raw); else if (method === 8) out.set(name, inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, "&");
/** Column letters of a cell reference ("AB12") → 0-based index. */
const colIdx = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

/** Reads the named worksheet (or the first one) as rows of strings/numbers; missing cells are "". */
export function readXlsx(buf: Buffer, sheetName?: string): (string | number)[][] {
  const z = unzip(buf); const names = new Map([...z.keys()].map((k) => [k.toLowerCase(), k]));
  const txt = (n: string) => z.get(names.get(n.replace(/^\//, "").toLowerCase()) ?? n)?.toString("utf8") ?? ""; // part names are case-insensitive
  // Shared strings: the part named in the workbook relationships (usually xl/sharedStrings.xml). Phonetic runs (<rPh>) are not text.
  const ssTarget = txt("xl/_rels/workbook.xml.rels").match(/<Relationship\b[^>]*sharedStrings"[^>]*>/)?.[0].match(/\sTarget="([^"]*)"/)?.[1];
  const ssXml = (ssTarget ? txt(ssTarget.startsWith("/") ? ssTarget : `xl/${ssTarget}`) : "") || txt("xl/sharedStrings.xml");
  const shared = [...ssXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => unxml([...m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  // workbook.xml lists sheets by name with a relationship id; workbook.xml.rels maps that to a file.
  const attr = (tagText: string, name: string) => tagText.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? "";
  const sheets = [...txt("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)].map((m) => ({ name: unxml(attr(m[0], "name")), rid: attr(m[0], "r:id") }));
  const rels = new Map([...txt("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], "Id"), attr(m[0], "Target")]));
  const s = sheetName ? sheets.find((x) => x.name.toLowerCase() === sheetName.toLowerCase()) : sheets[0];
  if (!s) throw new Error(`worksheet "${sheetName}" not found (have: ${sheets.map((x) => x.name).join(", ")})`);
  const target = (rels.get(s.rid) ?? "").replace(/^\/?(xl\/)?/, "");
  const xml = txt(`xl/${target}`); if (!xml) throw new Error(`worksheet file xl/${target} missing`);
  const rows: (string | number)[][] = [];
  for (const rm of xml.matchAll(/<row\b[^>]*?(?:\br="(\d+)")?[^>]*>([\s\S]*?)<\/row>/g)) {
    const r: (string | number)[] = [];
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]; const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1]; const t = attrs.match(/\bt="(\w+)"/)?.[1];
      const body = cm[2] ?? ""; const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val: string | number = "";
      if (t === "s" && v != null) val = shared[+v] ?? "";
      else if (t === "inlineStr") val = unxml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
      else if (t === "str" || t === "e") val = v != null ? unxml(v) : "";
      else if (v != null) { const n = Number(v); val = Number.isFinite(n) ? n : unxml(v); }
      const i = ref ? colIdx(ref) : r.length; while (r.length < i) r.push(""); r[i] = val;
    }
    const rowNo = rm[1] ? Number(rm[1]) - 1 : rows.length; while (rows.length < rowNo) rows.push([]); rows[rowNo] = r;
  }
  return rows;
}

/** Builds a tiny .xlsx (stored, uncompressed) from rows: used by tests to fake official workbooks. */
export function writeXlsx(sheets: Record<string, (string | number)[][]>): Buffer {
  const files: [string, string][] = []; const names = Object.keys(sheets);
  const strs: string[] = []; const si = (s: string) => { let i = strs.indexOf(s); if (i < 0) { i = strs.length; strs.push(s); } return i; };
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const col = (i: number) => { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
  names.forEach((n, k) => files.push([`xl/worksheets/sheet${k + 1}.xml`, `<worksheet><sheetData>${sheets[n].map((row, r) => `<row r="${r + 1}">${row.map((v, c) => v === "" ? "" : typeof v === "number" ? `<c r="${col(c)}${r + 1}"><v>${v}</v></c>` : `<c r="${col(c)}${r + 1}" t="s"><v>${si(v)}</v></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`]));
  files.push(["xl/sharedStrings.xml", `<sst>${strs.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`]);
  files.push(["xl/workbook.xml", `<workbook><sheets>${names.map((n, k) => `<sheet name="${esc(n)}" sheetId="${k + 1}" r:id="rId${k + 1}"/>`).join("")}</sheets></workbook>`]);
  files.push(["xl/_rels/workbook.xml.rels", `<Relationships>${names.map((_, k) => `<Relationship Id="rId${k + 1}" Target="worksheets/sheet${k + 1}.xml"/>`).join("")}</Relationships>`]);
  const parts: Buffer[] = []; const central: Buffer[] = []; let off = 0;
  for (const [name, body] of files) {
    const nb = Buffer.from(name), data = Buffer.from(body);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nb, data); central.push(ch, nb); off += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
