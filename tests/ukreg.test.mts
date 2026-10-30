// Test of src/lib/ukreg with a fake Companies House: company-number
// normalization, search and company-detail shaping, partial failures, caching.
// Run: npm test
import { address, companyDetail, companyNumber, officerAppointments, officerId, searchCompanies, searchOfficers } from "../src/lib/ukreg";

process.env.COMPANIES_HOUSE_API_KEY = "test-key";
const calls: string[] = [];
let officersDown = false;

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input)); calls.push(url.pathname + url.search);
  const auth = new Headers(input instanceof Request ? input.headers : init?.headers).get("authorization");
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (auth !== "Basic " + Buffer.from("test-key:").toString("base64")) return json({ error: "Invalid Authorization" }, 401);
  const p = url.pathname;
  if (p === "/search/companies") return json({ total_results: 1234, items: [
    { company_number: "00445790", title: "TESCO PLC", company_status: "active", company_type: "plc", date_of_creation: "1947-11-27", address_snippet: "Tesco House, Shire Park, Kestrel Way, Welwyn Garden City, AL7 1GA" },
    { company_number: "SC123456", title: "TESCO OLD LTD", company_status: "dissolved", company_type: "ltd", date_of_creation: "1990-01-01", date_of_cessation: "2001-02-03", address: { address_line_1: "1 Road", locality: "Edinburgh", postal_code: "EH1 1AA" } },
  ] });
  if (p === "/company/00445790") return json({ company_name: "TESCO PLC", company_number: "00445790", company_status: "active", type: "plc", jurisdiction: "england-wales", date_of_creation: "1947-11-27", sic_codes: ["47110"], has_charges: true, has_insolvency_history: false,
    registered_office_address: { premises: "Tesco House", address_line_1: "Shire Park", address_line_2: "Kestrel Way", locality: "Welwyn Garden City", postal_code: "AL7 1GA" },
    accounts: { next_due: "2027-08-31", overdue: false, last_accounts: { made_up_to: "2026-02-28", type: "group" } }, confirmation_statement: { next_due: "2027-06-15", last_made_up_to: "2026-06-01", overdue: false },
    previous_company_names: [{ name: "TESCO STORES (HOLDINGS) PUBLIC LIMITED COMPANY", effective_from: "1947-11-27", ceased_on: "1983-06-08" }] });
  if (p === "/company/00445790/officers") return officersDown ? json({ error: "boom" }, 500) : json({ active_count: 2, resigned_count: 1, items: [
    { name: "MURPHY, Ken", officer_role: "director", appointed_on: "2020-10-01", nationality: "Irish", occupation: "Chief Executive", country_of_residence: "England", links: { officer: { appointments: "/officers/AbC123xyz_9/appointments" } } },
    { name: "OLD, Person", officer_role: "secretary", appointed_on: "2000-01-01", resigned_on: "2010-01-01" },
  ] });
  if (p === "/company/00445790/persons-with-significant-control") return json({ items: [{ name: "Example Holdings Ltd", kind: "corporate-entity-person-with-significant-control", natures_of_control: ["ownership-of-shares-25-to-50-percent"], notified_on: "2016-04-06" }] });
  if (p === "/company/00445790/filing-history" && url.searchParams.get("category") === "capital") return json({ items: [
    { date: "2025-03-20", category: "capital", type: "SH01", description: "capital-allotment-shares", description_values: { date: "2025-03-14", capital: [{ figure: "1,250.50", currency: "GBP" }, { figure: "10", currency: "USD" }] }, transaction_id: "SH1", links: { document_metadata: "https://document-api/sh1" } },
    { date: "2026-02-02", category: "capital", type: "SH01", description: "capital-allotment-shares", description_values: { date: "2026-01-30", capital: [{ figure: "1,300", currency: "GBP" }] }, transaction_id: "SH2", links: {} },
    { date: "2024-01-01", category: "capital", type: "SH06", description: "capital-cancellation-shares" },
  ] });
  if (p === "/company/00445790/filing-history") return json({ items: [
    { date: "2026-07-10", category: "accounts", type: "AA", description: "accounts-with-accounts-type-group", description_values: { made_up_date: "2026-02-28" }, transaction_id: "MzQ1", links: { document_metadata: "https://document-api/xyz" } },
    { date: "2026-06-12", category: "confirmation-statement", type: "CS01", description: "confirmation-statement-with-no-updates", transaction_id: "MzQ2", links: {} },
  ] });
  if (p === "/company/00445790/charges") return json({ total_count: 5, unfiltered_count: 5, satisfied_count: 3, part_satisfied_count: 0, items: [{ status: "outstanding", created_on: "2019-05-01", classification: { description: "A registered charge" }, persons_entitled: [{ name: "Bank Plc" }] }] });
  if (p === "/search/officers") return json({ total_results: 87, items: [
    { title: "Ken MURPHY", links: { self: "/officers/AbC123xyz_9/appointments" }, date_of_birth: { month: 3, year: 1967 }, appointment_count: 4, address_snippet: "Tesco House, Welwyn Garden City", description: "Total number of appointments 4 - Born March 1967" },
    { title: "No link", links: {} },
  ] });
  if (p === "/officers/AbC123xyz_9/appointments") return json({ name: "Ken MURPHY", date_of_birth: { month: 3, year: 1967 }, total_results: 2, items: [
    { appointed_to: { company_number: "00111111", company_name: "OLD CO LTD", company_status: "dissolved" }, officer_role: "director", appointed_on: "2001-01-01", resigned_on: "2005-01-01" },
    { appointed_to: { company_number: "00445790", company_name: "TESCO PLC", company_status: "active" }, officer_role: "director", appointed_on: "2020-10-01", occupation: "Chief Executive" },
  ] });
  if (p === "/company/SC000001") return json({ company_name: "PARTIAL LTD", company_status: "active", type: "ltd" });
  if (p.startsWith("/company/SC000001/officers")) return json({ error: "boom" }, 500);
  if (p.startsWith("/company/SC000001/")) return json({ items: [] });
  if (p === "/company/09999999") return json({ errors: [{ error: "company-profile-not-found" }] }, 404);
  return json({ error: "not mocked" }, 404);
}) as typeof fetch;

let fails = 0;
const t = (label: string, ok: boolean, info?: unknown) => { if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + label, ok ? "" : JSON.stringify(info)); };

t("company numbers: padded, upper-cased, prefixes kept", companyNumber("445790") === "00445790" && companyNumber(" sc 123456 ") === "SC123456" && companyNumber("Tesco") === null && companyNumber("123456789") === null);
t("address joins non-empty parts", address({ premises: "1", address_line_1: "High St", locality: "Leeds", postal_code: "LS1" }) === "1, High St, Leeds, LS1");

const sr = await searchCompanies("tesco", 20);
t("search: total and items", sr.total === 1234 && sr.items.length === 2 && sr.items[0].number === "00445790" && sr.items[0].type === "plc", sr);
t("search: address from snippet or structured address", sr.items[1].address === "1 Road, Edinburgh, EH1 1AA" && sr.items[1].ceased === "2001-02-03", sr.items[1]);
await searchCompanies("TESCO", 20);
t("search cached (case-insensitive)", calls.filter((c) => c.startsWith("/search/companies")).length === 1, calls);

const c = await companyDetail("00445790");
t("profile fields", c.profile.name === "TESCO PLC" && c.profile.sic[0] === "47110" && c.profile.address === "Tesco House, Shire Park, Kestrel Way, Welwyn Garden City, AL7 1GA" && c.profile.accounts.lastMadeUpTo === "2026-02-28" && c.profile.previousNames.length === 1, c.profile);
t("officers with counts and readable roles", c.officers?.active === 2 && c.officers.items[0].role === "Director" && c.officers.items[1].resigned === "2010-01-01", c.officers);
t("PSC natures are readable", c.psc?.[0].natures[0] === "Ownership of shares 25 to 50 percent" && c.psc[0].kind === "Corporate entity person with significant control", c.psc);
t("filings: readable description, made-up date, public document link only when a document exists", c.filings?.[0].description === "Accounts with accounts type group (made up to 2026-02-28)" && c.filings[0].doc === "https://find-and-update.company-information.service.gov.uk/company/00445790/filing-history/MzQ1/document?format=pdf&download=0" && c.filings[1].doc === null, c.filings);
t("charges: outstanding = total − satisfied", c.charges?.total === 5 && c.charges.outstanding === 2 && c.charges.items[0].entitled[0] === "Bank Plc", c.charges);
t("link to the public register", c.link === "https://find-and-update.company-information.service.gov.uk/company/00445790");

t("share allotments (SH01): newest first, statement of capital per currency, document link when filed electronically; other capital filings skipped", c.allotments?.length === 2 && c.allotments[0].allotted === "2026-01-30" && c.allotments[0].doc === null && c.allotments[1].capital[0].figure === 1250.5 && c.allotments[1].capital[1].ccy === "USD" && /SH1\/document/.test(String(c.allotments[1].doc)), c.allotments);
t("company officers carry their officer id", c.officers?.items[0].id === "AbC123xyz_9" && c.officers.items[1].id === null, c.officers?.items);
t("officer ids from links only", officerId("/officers/AbC123xyz_9/appointments") === "AbC123xyz_9" && officerId("/company/1") === null && officerId(undefined) === null);
const os = await searchOfficers("ken murphy");
t("officer search: id, birth month and year, appointment count; rows without a link skipped", os.total === 87 && os.items.length === 1 && os.items[0].id === "AbC123xyz_9" && os.items[0].born === "Mar 1967" && os.items[0].appointments === 4, os);
const oa = await officerAppointments("AbC123xyz_9");
t("appointments: current first, company links, counts", oa.name === "Ken MURPHY" && oa.items[0].company === "TESCO PLC" && oa.items[0].role === "Director" && oa.items[1].resigned === "2005-01-01" && oa.active === 1 && oa.total === 2 && oa.link.endsWith("/officers/AbC123xyz_9/appointments"), oa);

// A failing section does not break the record.
const part = await companyDetail("SC000001");
t("a failing section (officers) comes back null; the rest still loads", part.officers === null && part.profile.name === "PARTIAL LTD" && Array.isArray(part.filings) && part.profile.sic.length === 0, part);
officersDown = true;
const n0 = calls.length; await companyDetail("00445790");
t("company detail cached", calls.length === n0, calls.slice(n0));

try { await companyDetail("09999999"); t("unknown company throws a 404 ProviderError", false); }
catch (e) { t("unknown company throws a 404 ProviderError", (e as { status?: number }).status === 404, e); }

console.log(fails ? `\n${fails} ukreg test(s) failed` : "\nAll ukreg tests passed");
process.exit(fails ? 1 : 0);
