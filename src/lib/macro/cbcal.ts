/**
 * Monetary-policy decision dates from the central banks' own published calendars, curated by hand
 * (no bank offers a reliable machine feed). Dates are decision/announcement days. Only dates seen on
 * an official calendar or consistently reported are listed; banks that have not published (CBN, CBK,
 * Bank of Ghana, CBE, Banxico) are left out rather than guessed. Re-check yearly: most G10 banks
 * publish the next year's dates between June and September; BI, Banxico, BoG and CBN in Dec–Jan.
 * Last reviewed: 30 Oct 2026.
 */
import type { CalEvent } from "./sources";

type Bank = { cc: string; name: string; short: string; imp: 1 | 2 | 3; url: string; time?: string; dates: string[] };
export const CB_CALENDAR: Bank[] = [
  { cc: "US", name: "Federal Reserve (FOMC)", short: "FOMC", imp: 3, url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", time: "18:00", dates: ["2026-12-09", "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09", "2027-07-28", "2027-09-15", "2027-10-27", "2027-12-08"] },
  { cc: "EU", name: "European Central Bank", short: "ECB", imp: 3, url: "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html", time: "13:15", dates: ["2026-12-17", "2027-02-04", "2027-03-18", "2027-04-29", "2027-06-10", "2027-07-22", "2027-09-09", "2027-10-28", "2027-12-16"] },
  { cc: "UK", name: "Bank of England (MPC)", short: "BoE", imp: 3, url: "https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates", time: "12:00", dates: ["2026-11-05", "2026-12-17", "2027-02-04", "2027-03-18", "2027-04-29", "2027-06-17", "2027-07-29", "2027-09-16", "2027-11-04", "2027-12-16"] },
  { cc: "JP", name: "Bank of Japan", short: "BoJ", imp: 3, url: "https://www.boj.or.jp/en/mopo/mpmsche_minu/index.htm", dates: ["2026-12-18", "2027-01-22", "2027-03-18", "2027-04-28", "2027-06-11", "2027-07-22"] },
  { cc: "CA", name: "Bank of Canada", short: "BoC", imp: 2, url: "https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rate/", time: "13:45", dates: ["2026-12-09", "2027-01-27", "2027-03-03", "2027-04-28", "2027-06-02", "2027-07-21", "2027-09-08", "2027-10-27", "2027-12-08"] },
  { cc: "AU", name: "Reserve Bank of Australia", short: "RBA", imp: 2, url: "https://www.rba.gov.au/schedules-events/board-meeting-schedules.html", time: "03:30", dates: ["2026-11-03", "2026-12-08", "2027-02-09", "2027-03-23", "2027-05-04", "2027-06-22", "2027-08-10", "2027-09-28", "2027-11-02", "2027-12-14"] },
  { cc: "NZ", name: "Reserve Bank of New Zealand", short: "RBNZ", imp: 2, url: "https://www.rbnz.govt.nz/monetary-policy/monetary-policy-decisions", dates: ["2026-12-09", "2027-02-10", "2027-03-17", "2027-05-05", "2027-06-16", "2027-08-04", "2027-09-15", "2027-10-27"] },
  { cc: "CH", name: "Swiss National Bank", short: "SNB", imp: 2, url: "https://www.snb.ch/en/ifor/media/id/media_events", time: "08:30", dates: ["2026-12-10", "2027-03-18", "2027-06-24", "2027-09-23", "2027-12-16"] },
  { cc: "SE", name: "Sveriges Riksbank", short: "Riksbank", imp: 2, url: "https://www.riksbank.se/en-gb/press-and-published/calendar/", dates: ["2026-11-04", "2027-02-03", "2027-03-24", "2027-05-05", "2027-06-22"] },
  { cc: "NO", name: "Norges Bank", short: "Norges Bank", imp: 2, url: "https://www.norges-bank.no/en/news-events/calendar/policy-rate-decisions/", dates: ["2026-12-17", "2027-01-21", "2027-03-18", "2027-06-17", "2027-09-23", "2027-12-16"] },
  { cc: "ZA", name: "South African Reserve Bank (MPC)", short: "SARB", imp: 2, url: "https://www.resbank.co.za/en/home/what-we-do/monetary-policy/monetary-policy-committee", dates: ["2026-11-19", "2027-01-28", "2027-03-18", "2027-05-27", "2027-07-22", "2027-11-25"] },
  { cc: "IN", name: "Reserve Bank of India (MPC)", short: "RBI", imp: 2, url: "https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=62422", dates: ["2026-12-04", "2027-02-05"] },
  { cc: "BR", name: "Banco Central do Brasil (Copom)", short: "Copom", imp: 2, url: "https://www.bcb.gov.br/en/monetarypolicy/copomcalendars", dates: ["2026-11-04", "2026-12-09", "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-16", "2027-08-04", "2027-09-22", "2027-10-27"] },
  { cc: "TR", name: "Central Bank of the Republic of Türkiye", short: "CBRT", imp: 2, url: "https://www.tcmb.gov.tr/wps/wcm/connect/en/tcmb+en/main+menu/announcements/calendar", dates: ["2026-12-10"] },
  { cc: "ID", name: "Bank Indonesia", short: "BI", imp: 2, url: "https://www.bi.go.id/en/publikasi/kalender/", dates: ["2026-11-18", "2026-12-16"] },
];

/** Upcoming decisions (and the last 60 days) as calendar events. */
export function cbCalendarEvents(now: Date): CalEvent[] {
  const from = new Date(now.getTime() - 60 * 864e5).toISOString().slice(0, 10);
  return CB_CALENDAR.flatMap((b) => b.dates.filter((d) => d >= from).map((date) => ({
    id: `cbcal-${b.cc.toLowerCase()}-${date}`, title: `${b.short}: monetary policy decision`, date, time: b.time, cc: b.cc, cat: "cb", imp: b.imp,
    srcName: `${b.name}, official meeting calendar`, url: b.url,
    notes: `Decision date as published by the ${b.name}${b.time ? `; announcement at about ${b.time} UTC` : ""}. Check the bank's calendar for changes.`,
  })));
}
