// Test of src/lib/filings/intl.ts with fake EDINET, OpenDART and filings.xbrl.org:
// parsing, country lists, data-desk matching, missing keys, failures, merging, dry runs.
// Run: npm test
import { dartDesc, matchInst, mergeItems, readDart, readEdinet, readXbrl, runIntlFilingsSync, type IntlFiling } from "../src/lib/filings/intl";
import { memoryStore } from "../src/lib/market/store";

process.env.INTL_GAP_MS = "0"; process.env.EDINET_API_KEY = "ed-key"; process.env.OPENDART_API_KEY = "dart-key";
const NOW = new Date("2026-10-30T07:00:00Z");
const calls: string[] = []; let xbrlDown = false;
const edinetDay: Record<string, unknown[]> = {
  "2026-10-30": [
    { docID: "S100AAA1", edinetCode: "E02144", secCode: "72030", filerName: "トヨタ自動車株式会社", docTypeCode: "140", periodEnd: "2026-09-30", submitDateTime: "2026-10-30 15:00", docDescription: "四半期報告書－第123期第2四半期", withdrawalStatus: "0" },
    { docID: "S100AAA2", edinetCode: "E99999", secCode: null, filerName: "Some Fund", fundCode: "G01234", docTypeCode: "120", submitDateTime: "2026-10-30 09:00", withdrawalStatus: "0" },
    { docID: "S100AAA3", edinetCode: "E01777", secCode: "67580", filerName: "ソニーグループ株式会社", docTypeCode: "030", submitDateTime: "2026-10-30 09:00", withdrawalStatus: "0" },
    { docID: "S100AAA4", edinetCode: "E01777", secCode: "67580", filerName: "ソニーグループ株式会社", docTypeCode: "180", submitDateTime: "2026-10-30 10:00", withdrawalStatus: "1" },
  ],
  "2026-10-29": [{ docID: "S100BBB1", edinetCode: "E01777", secCode: "67580", filerName: "ソニーグループ株式会社", docTypeCode: "180", submitDateTime: "2026-10-29 16:30", docDescription: "臨時報告書", withdrawalStatus: "0" }],
};
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(input instanceof Request ? input.url : String(input)); calls.push(url.hostname + url.pathname + url.search);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (url.hostname === "api.edinet-fsa.go.jp") {
    if (url.searchParams.get("Subscription-Key") !== "ed-key") return json({ statusCode: 401, message: "Access denied due to invalid subscription key." });
    const d = url.searchParams.get("date")!; return json({ metadata: { status: "200", message: "OK" }, results: edinetDay[d] ?? [] });
  }
  if (url.hostname === "opendart.fss.or.kr") {
    if (url.searchParams.get("crtfc_key") !== "dart-key") return json({ status: "010", message: "등록되지 않은 키입니다." });
    if (url.searchParams.get("pblntf_ty") === "B") return json({ status: "013", message: "조회된 데이타가 없습니다." });
    const page = Number(url.searchParams.get("page_no"));
    const rows = page === 1
      ? [{ corp_code: "00126380", corp_name: "삼성전자", stock_code: "005930", corp_cls: "Y", report_nm: "분기보고서 (2026.09)", rcept_no: "20261029000123", flr_nm: "삼성전자", rcept_dt: "20261029", rm: "" },
         { corp_code: "00999999", corp_name: "비상장", stock_code: "", corp_cls: "E", report_nm: "사업보고서 (2025.12)", rcept_no: "20261029000999", flr_nm: "x", rcept_dt: "20261029" }]
      : [{ corp_code: "00164779", corp_name: "SK하이닉스", stock_code: "000660", corp_cls: "Y", report_nm: "[기재정정]주요사항보고서(자기주식취득결정)", rcept_no: "20261030000456", flr_nm: "SK하이닉스", rcept_dt: "20261030" }];
    return json({ status: "000", message: "정상", page_no: page, page_count: 100, total_count: 3, total_page: 2, list: rows });
  }
  if (url.hostname === "filings.xbrl.org") {
    if (xbrlDown) return json({ errors: [{ status: "503" }] }, 503);
    const c = url.searchParams.get("filter[country]");
    if (c !== "GB" && c !== "DE") return json({ data: [], included: [] });
    return json({ data: [{ type: "filing", id: c === "GB" ? "11" : "12", attributes: { fxo_id: c === "GB" ? "2138001-2026-06-30-ESEF-GB-0" : "5299-2025-12-31-ESEF-DE-0", country: c, period_end: c === "GB" ? "2026-06-30" : "2025-12-31", date_added: "2026-10-28 11:22:33", processed: "2026-10-28 12:00:00", error_count: c === "GB" ? 0 : 2, viewer_url: "/2138001/2026-06-30/ESEF/GB/0/viewer.html", package_url: "/2138001/2026-06-30/ESEF/GB/0/pkg.zip" }, relationships: { entity: { data: { type: "entity", id: "e" + c } } } }],
      included: [{ type: "entity", id: "e" + c, attributes: { identifier: c === "GB" ? "213800ABCDEF" : "529900XYZ", name: c === "GB" ? "Shell plc" : "Siemens AG" } }] });
  }
  return json({ error: "not mocked" }, 404);
}) as typeof fetch;

let fails = 0;
const t = (label: string, ok: boolean, info?: unknown) => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + label, ok ? "" : JSON.stringify(info)); };

const ed = readEdinet(edinetDay["2026-10-30"] as never[]);
t("EDINET: listed companies' reports only (no funds, other types or withdrawn), ticker without check digit", ed.length === 1 && ed[0].tk === "7203" && ed[0].desc === "Quarterly securities report" && ed[0].period === "2026-09-30" && ed[0].url.endsWith("S100AAA1") && !!ed[0].orig, ed);
const dr = readDart([{ corp_cls: "Y", rcept_no: "1", rcept_dt: "20261029", report_nm: "사업보고서 (2025.12)", stock_code: "005930" }, { corp_cls: "N", rcept_no: "2", rcept_dt: "20261029" }]);
t("OpenDART: KOSPI/KOSDAQ only, English name, period from the title", dr.length === 1 && dr[0].desc === "Annual report" && dr[0].period === "2025-12" && dr[0].url === "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=1", dr);
t("OpenDART: corrections are marked", dartDesc("[기재정정]주요사항보고서(자기주식취득결정)") === "Major issues report (correction)");
const xb = readXbrl({ data: [{ id: "1", attributes: { country: "GB", date_added: "2026-10-28 11:00:00", fxo_id: "x", viewer_url: "/a/viewer.html", error_count: 1 }, relationships: { entity: { data: { id: "e" } } } }], included: [{ type: "entity", id: "e", attributes: { name: "Shell plc", identifier: "LEI1" } }] });
t("filings.xbrl.org: GB → UK, absolute links, entity name and LEI", xb[0]?.cc === "UK" && xb[0].url === "https://filings.xbrl.org/a/viewer.html" && xb[0].co === "Shell plc" && xb[0].cid === "LEI1" && /1 validation error$/.test(xb[0].desc), xb);
const f = (o: Partial<IntlFiling>) => ({ src: "EDINET", co: "", cid: "", cc: "JP", form: "x", date: "2026-10-29", period: null, acc: "a", url: "", index: "", desc: "", items: [], ...o }) as IntlFiling;
t("matching: same country and ticker (suffixes, leading zeros) or same name", matchInst(f({ tk: "7203" }), [{ id: "EQ.7203", tk: "7203.T", name: "Toyota", cc: "JP" }, { id: "x", tk: "7203", name: "", cc: "KR" }]).join() === "EQ.7203"
  && matchInst(f({ cc: "KR", tk: "005930" }), [{ id: "S", tk: "5930", name: "", cc: "KR" }]).join() === "S" && matchInst(f({ cc: "UK", co: "Shell plc" }), [{ id: "EQ.SHEL", tk: "SHEL", name: "SHELL", cc: "UK" }]).join() === "EQ.SHEL");
t("merging: one per filing, last 60 days, newest first", mergeItems([f({ acc: "old", date: "2026-07-01" }), f({ acc: "a", desc: "old" })], [f({ acc: "a", desc: "new" }), f({ acc: "b", date: "2026-10-30" })], NOW).map((x) => x.acc + x.desc).join() === "b,anew");

const store = memoryStore({ adm_inst: [{ id: "EQ.TM", data: { id: "EQ.TM", meta: { type: "equity", tk: "7203.T", name: "Toyota Motor", country: "JP" } } }, { id: "EQ.SHEL", data: { meta: { tk: "SHEL", name: "Shell", country: "GB" } } }] });
const r = await runIntlFilingsSync({ store, now: NOW });
const docs = Object.fromEntries(store.dump().filings.map((d) => [d.id, d.data as Record<string, any>])); // eslint-disable-line @typescript-eslint/no-explicit-any
t("all three sources answered", !r.sources.edinet.error && r.sources.opendart.n === 2 && r.sources.xbrl.n === 2, r.sources);
t("Japan list: both days, newest first, credit", docs["latest-JP"]?.items.length === 2 && docs["latest-JP"].items[0].acc === "S100AAA1" && /EDINET, Financial Services Agency/.test(docs["latest-JP"].credit), docs["latest-JP"]);
t("Korea list: pages followed, unlisted companies dropped", docs["latest-KR"]?.items.map((x: IntlFiling) => x.acc).join() === "20261030000456,20261029000123" && /OpenDART/.test(docs["latest-KR"].credit), docs["latest-KR"]?.items);
t("ESEF lists: per country and EU together (UK not in EU)", docs["latest-UK"]?.items.length === 1 && docs["latest-DE"]?.items.length === 1 && docs["latest-EU"]?.items.length === 1 && docs["latest-EU"].items[0].co === "Siemens AG");
t("data-desk instruments get their own filings (ticker and name matches)", docs["EQ.TM"]?.items[0]?.acc === "S100AAA1" && docs["EQ.TM"].src === "EDINET" && docs["EQ.SHEL"]?.items[0]?.co === "Shell plc", r.matched);
t("summary in filings/_intl, SEC's filings/_meta untouched", /3 of 3 sources answered/.test(docs._intl?.note) && !docs._meta, docs._intl?.note);
t("no key in stored links", !JSON.stringify(store.dump()).includes("ed-key") && !JSON.stringify(store.dump()).includes("dart-key"));

// Keys missing, a source down: skipped/failed sources keep their lists.
delete process.env.OPENDART_API_KEY; xbrlDown = true;
const r2 = await runIntlFilingsSync({ store, now: new Date("2026-10-31T07:00:00Z") });
const docs2 = Object.fromEntries(store.dump().filings.map((d) => [d.id, d.data as Record<string, any>])); // eslint-disable-line @typescript-eslint/no-explicit-any
t("missing key is skipped with a note, a failing source is reported", r2.sources.opendart.skipped === "OPENDART_API_KEY not set" && !!r2.sources.xbrl.error && /Not updated: OpenDART \(OPENDART_API_KEY not set\), filings\.xbrl\.org \(failed\)/.test(r2.note), r2);
t("lists from skipped or failed sources stay", docs2["latest-KR"]?.items.length === 2 && docs2["latest-UK"]?.items.length === 1);

process.env.EDINET_API_KEY = "wrong";
const r3 = await runIntlFilingsSync({ store: memoryStore(), now: NOW, only: ["edinet"], dryRun: true });
t("bad EDINET key: error from the body status (HTTP 200), stops after the first day", /401/.test(r3.sources.edinet.error ?? "") && calls.filter((c) => c.includes("Subscription-Key=wrong")).length === 1, r3.sources);
t("dry run writes nothing", r3.dryRun && !r3.lists["latest-JP"]);

console.log(fails ? `\n${fails} FAILED` : "\nall passed"); process.exit(fails ? 1 : 0);
