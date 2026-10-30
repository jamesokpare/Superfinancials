/**
 * Decision dates for central banks that publish them only in notices (no calendar file): the Central Bank
 * of Nigeria, Central Bank of Kenya, Bank of Ghana, Central Bank of Egypt and Banco de México. Each bank's
 * monetary-policy page is read and dates are taken from sentences about the next Monetary Policy Committee
 * meeting or decision (English or Spanish). Only future dates within 15 months are kept, a multi-day
 * meeting is dated on its last day (the announcement), and dates already in the hand-curated calendar
 * (cbcal.ts) are skipped. Every event links the page it was read from.
 */
import { BROWSER_UA, type CalEvent } from "./sources";

export type NoticeBank = { cc: string; name: string; short: string; imp: 1 | 2 | 3; pages: (year: number) => string[] };
export const NOTICE_BANKS: NoticeBank[] = [
  { cc: "NG", name: "Central Bank of Nigeria", short: "CBN MPC", imp: 3, pages: () => ["https://www.cbn.gov.ng/", "https://www.cbn.gov.ng/MonetaryPolicy/Decisions.html"] },
  { cc: "KE", name: "Central Bank of Kenya", short: "CBK MPC", imp: 2, pages: () => ["https://www.centralbank.go.ke/", "https://www.centralbank.go.ke/monetary-policy/"] },
  { cc: "GH", name: "Bank of Ghana", short: "BoG MPC", imp: 2, pages: (y) => [`https://www.bog.gov.gh/news/mpc-meeting-dates-for-${y}/`, `https://www.bog.gov.gh/news/mpc-meeting-dates-for-${y + 1}/`, "https://www.bog.gov.gh/monetary-policy/"] },
  { cc: "EG", name: "Central Bank of Egypt", short: "CBE MPC", imp: 2, pages: () => ["https://www.cbe.org.eg/en/monetary-policy"] },
  { cc: "MX", name: "Banco de México", short: "Banxico", imp: 2, pages: () => ["https://www.banxico.org.mx/publicaciones-y-prensa/anuncios-de-las-decisiones-de-politica-monetaria/anuncios-politica-monetaria-t.html", "https://www.banxico.org.mx/publications-and-press/announcements-of-monetary-policy-decisions/announcements-monetary-policy.html"] },
];

const MONTHS: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const MON_RE = Object.keys(MONTHS).join("|");
const iso = (y: number, m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null);
const strip = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<(br|\/p|\/li|\/tr|\/h\d|\/div)[^>]*>/gi, ". ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#8211;|&ndash;/g, "–").replace(/\s+/g, " ");

/** Dates in a piece of text; a range ("23 – 24 September 2026", "March 16 to March 18, 2026") gives its last day. */
export function datesIn(text: string): string[] {
  const out: string[] = []; const d = "(\\d{1,2})(?:st|nd|rd|th)?"; const sep = "\\s*(?:[-–—]|to|and|y|al|&)\\s*";
  // day [– day] Month[,] year      e.g. 19 and 20 May 2026 · 6 de noviembre de 2026
  for (const m of text.matchAll(new RegExp(`${d}(?:${sep}${d})?\\s+(?:de\\s+)?(${MON_RE})\\s*,?\\s*(?:de(?:l)?\\s+)?(\\d{4})`, "gi"))) { const x = iso(+m[4], MONTHS[m[3].toLowerCase()], +(m[2] ?? m[1])); if (x) out.push(x); }
  // Month day[, ][– [Month] day], year   e.g. November 24-25, 2026 · March 16 to Wednesday, March 18, 2026
  for (const m of text.matchAll(new RegExp(`(${MON_RE})\\s+${d}(?:${sep}(?:[A-Za-z]+day,?\\s+)?(?:(${MON_RE})\\s+)?${d})?\\s*,\\s*(\\d{4})`, "gi"))) { const mo = MONTHS[(m[3] ?? m[1]).toLowerCase()]; const x = iso(+m[5], mo, +(m[4] ?? m[2])); if (x) out.push(x); }
  return out;
}
const KEY = /monetary policy committee|\bMPC\b|policy rate (?:decision|announcement)|monetary policy (?:decision|announcement|meeting)|decisi[oó]n(?:es)? de pol[ií]tica monetaria|anuncio(?:s)? de pol[ií]tica monetaria/i;
/** Future meeting dates from one page's text: dates in sentences that mention the MPC / a policy decision. */
export function noticeDates(html: string, now: Date, horizonDays = 460): string[] {
  const today = now.toISOString().slice(0, 10), until = new Date(now.getTime() + horizonDays * 864e5).toISOString().slice(0, 10);
  const sentences = strip(html).split(/(?<=[.!?])\s+(?=[A-Z¿])|\s\.\s/);
  const out = new Set<string>();
  for (const s of sentences) if (KEY.test(s) && s.length < 600) for (const x of datesIn(s)) if (x >= today && x <= until) out.add(x);
  return [...out].sort();
}

export async function cbNoticeEvents(now: Date, known: Set<string>): Promise<{ events: CalEvent[]; errors: string[] }> {
  const events: CalEvent[] = []; const errors: string[] = []; const y = now.getUTCFullYear();
  for (const b of NOTICE_BANKS) {
    const found = new Map<string, string>(); let reached = 0;
    for (const url of b.pages(y)) {
      try {
        const r = await fetch(url, { headers: { ...BROWSER_UA, accept: "text/html" }, signal: AbortSignal.timeout(30_000) });
        if (!r.ok) continue; reached++;
        for (const d of noticeDates(await r.text(), now)) if (!found.has(d)) found.set(d, url);
      } catch { /* next page */ }
    }
    if (!reached) errors.push(`${b.short}: no page reached`);
    for (const [date, url] of found) {
      if (known.has(`${b.cc}|${date}`)) continue;
      events.push({ id: `cbn-${b.cc.toLowerCase()}-${date}`, title: `${b.short}: monetary policy decision`, date, cc: b.cc, cat: "cb", imp: b.imp, srcName: `${b.name}, official notice`, url,
        notes: `Meeting date read from the ${b.name}'s own notice (the last day of a multi-day meeting, when the decision is announced). Check the linked page for changes.` });
    }
  }
  return { events, errors };
}
