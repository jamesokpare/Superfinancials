// Test of src/lib/registry with fake Companies House and GLEIF APIs: global
// search across both, UK/LEI de-duplication, country filter, one source
// failing, LEI records with parents and subsidiaries, caching.
// Run: npm test
import { isoCountry, leiCode, leiDetail, searchRegistry } from "../src/lib/registry";

process.env.COMPANIES_HOUSE_API_KEY = "test-key";
const calls: string[] = [];
let gleifDown = false;

const ent = (lei: string, name: string, country: string, extra: Record<string, unknown> = {}) => ({
  id: lei, type: "lei-records",
  attributes: { lei, bic: null, registration: { status: "ISSUED", initialRegistrationDate: "2014-01-10T00:00:00Z", lastUpdateDate: "2026-05-01T00:00:00Z", nextRenewalDate: "2027-01-10T00:00:00Z", corroborationLevel: "FULLY_CORROBORATED" },
    entity: { legalName: { name }, legalAddress: { addressLines: ["1 Main Road"], city: "Lagos", country, postalCode: "100001" }, registeredAt: { id: "RA000462" }, registeredAs: "RC 6014", jurisdiction: country, category: "GENERAL", legalForm: { id: "XXXX", other: "Public limited company" }, status: "ACTIVE", creationDate: "1981-07-08T00:00:00Z", ...extra } },
});
const DANGOTE = "549300D8OI6J0S0W2I34", PARENT = "549300ABCDEFGHIJ0K12", KID = "5493009XYZ12345ABC67", TESCO = "2138002P5RNKC5W2JZ46";

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input)); calls.push(url.host + url.pathname + url.search);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (url.host === "api.company-information.service.gov.uk") {
    const auth = new Headers(init?.headers).get("authorization");
    if (auth !== "Basic " + Buffer.from("test-key:").toString("base64")) return json({ error: "Invalid Authorization" }, 401);
    if (url.pathname === "/search/companies") return json({ total_results: 3, items: [{ company_number: "00445790", title: "TESCO PLC", company_status: "active", company_type: "plc", date_of_creation: "1947-11-27", address_snippet: "Welwyn Garden City" }] });
    return json({ error: "not mocked" }, 404);
  }
  if (url.host !== "api.gleif.org") return json({ error: "unexpected host" }, 500);
  if (gleifDown) return json({ errors: [{ title: "Service unavailable" }] }, 503);
  const p = url.pathname.replace("/api/v1", "");
  if (p === "/lei-records") {
    const cc = url.searchParams.get("filter[entity.legalAddress.country]");
    const items = [ent(DANGOTE, "DANGOTE CEMENT PLC", "NG"), ent(TESCO, "TESCO PLC", "GB", { registeredAs: "00445790" })].filter((x) => !cc || x.attributes.entity.legalAddress.country === cc);
    return json({ data: items, meta: { pagination: { total: items.length } } });
  }
  if (p === `/lei-records/${DANGOTE}`) return json({ data: ent(DANGOTE, "DANGOTE CEMENT PLC", "NG", { otherNames: [{ name: "Dangote Cement", type: "TRADING_OR_OPERATING_NAME" }] }) });
  if (p === `/lei-records/${DANGOTE}/direct-parent`) return json({ data: ent(PARENT, "DANGOTE INDUSTRIES LIMITED", "NG") });
  if (p === `/lei-records/${DANGOTE}/ultimate-parent`) return json({ data: ent(PARENT, "DANGOTE INDUSTRIES LIMITED", "NG") });
  if (p === `/lei-records/${DANGOTE}/direct-children`) return json({ data: [ent(KID, "DANGOTE CEMENT SOUTH AFRICA", "ZA", { status: "INACTIVE", expiration: { reason: "DISSOLVED", date: "2024-02-01T00:00:00Z" } })], meta: { pagination: { total: 9 } } });
  if (p === "/registration-authorities/RA000462") return json({ data: { attributes: { internationalName: "Corporate Affairs Commission", website: "https://www.cac.gov.ng" } } });
  if (p === "/lei-records/00000000000000000000") return json({ errors: [{ title: "Not Found" }] }, 404);
  return json({ errors: [{ title: "Not Found" }] }, 404);
}) as typeof fetch;

let fails = 0;
const t = (label: string, ok: boolean, info?: unknown) => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + label, ok ? "" : JSON.stringify(info)); };

t("LEI codes: 20 characters, last two digits", leiCode(" 549300d8oi6j0s0w2i34 ") === DANGOTE && leiCode("549300D8OI6J0S0W2IAB") === null && leiCode("tesco") === null);
t("country codes: the app's UK is GB to registers", isoCountry("UK") === "GB" && isoCountry("ng") === "NG" && isoCountry("Nigeria") === undefined);

const r = await searchRegistry("plc");
t("search covers the UK register and GLEIF", r.items.length === 2 && r.items[0].src === "uk" && r.items[1].src === "lei" && r.items[1].name === "DANGOTE CEMENT PLC", r.items);
t("a UK company with an LEI appears once, with the LEI attached", r.items[0].lei === TESCO && !r.items.some((x) => x.src === "lei" && x.lei === TESCO), r.items);
t("GLEIF item: number, country, status, legal form, date, address", r.items[1].number === "RC 6014" && r.items[1].cc === "NG" && r.items[1].status === "Active" && r.items[1].type === "Public limited company" && r.items[1].created === "1981-07-08" && r.items[1].address === "1 Main Road, Lagos, 100001, NG", r.items[1]);
t("per-source totals", JSON.stringify(r.sources) === JSON.stringify({ uk: { total: 3 }, lei: { total: 2 } }), r.sources);

const ng = await searchRegistry("plc", { cc: "NG" });
t("country filter: GLEIF filtered, UK register skipped", ng.items.length === 1 && ng.items[0].cc === "NG" && "off" in ng.sources.uk && calls.some((c) => c.includes("filter%5Bentity.legalAddress.country%5D=NG")), ng);

const n0 = calls.length; await searchRegistry("PLC");
t("search cached (case-insensitive)", calls.length === n0, calls.slice(n0));

gleifDown = true;
const half = await searchRegistry("tesco");
t("GLEIF down: UK results still come back, GLEIF reports an error", half.items.length === 1 && half.items[0].src === "uk" && "error" in half.sources.lei, half);
gleifDown = false;

const d = await leiDetail(DANGOTE);
t("LEI record: profile and registry authority", d.profile.name === "DANGOTE CEMENT PLC" && d.profile.registry === "Corporate Affairs Commission" && d.profile.registryWeb === "https://www.cac.gov.ng" && d.profile.number === "RC 6014" && d.profile.otherNames[0].type === "Trading or operating name", d.profile);
t("LEI record: registration status and dates", d.registration.status === "Issued" && d.registration.renewal === "2027-01-10" && d.registration.corroboration === "Fully corroborated", d.registration);
t("LEI record: parents and subsidiaries", d.directParent?.id === PARENT && d.ultimateParent?.id === PARENT && d.children?.total === 9 && d.children.items[0].status === "Dissolved", d);
t("link to the GLEIF record", d.link === `https://search.gleif.org/#/record/${DANGOTE}`);

try { await leiDetail("00000000000000000000"); t("unknown LEI throws a 404 ProviderError", false); }
catch (e) { t("unknown LEI throws a 404 ProviderError", (e as { status?: number }).status === 404, e); }

console.log(fails ? `\n${fails} registry test(s) failed` : "\nAll registry tests passed");
process.exit(fails ? 1 : 0);
