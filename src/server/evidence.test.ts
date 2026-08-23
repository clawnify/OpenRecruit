import { describe, expect, it } from "vitest";
import { normalize, requiresEvidence, verifyEvidence, type PageText } from "./evidence";

const CV: PageText[] = [
  {
    attachment_id: "cv",
    page_no: 1,
    text: `MARIA SCHNEIDER
Senior Backend Engineer — Berlin, Germany

EXPERIENCE
Acme GmbH — Staff Engineer (2021–present)
• Led the migration of the billing platform to Kubernetes, cutting deploy time from 40 minutes to 6.
• Owned the Python services behind invoicing; 5 years of production Python in total.`,
  },
  {
    attachment_id: "cv",
    page_no: 2,
    text: `EDUCATION
TU Berlin — MSc Computer Science, 2016

LANGUAGES
German (native), English (fluent)`,
  },
  {
    attachment_id: "letter",
    page_no: 1,
    text: `Dear hiring team,

I am applying for the Lead Backend Engineer role. I have managed a team of four
engineers for the last two years and would like to keep growing in that direction.`,
  },
];

describe("normalize", () => {
  it("folds the noise a PDF extractor introduces", () => {
    expect(normalize("“Senior”  Engineer")).toBe('"senior" engineer');
    expect(normalize("engineer-\ning")).toBe("engineering");
    expect(normalize("• Led the  migration")).toBe("led the migration");
  });

  it("keeps everything that changes meaning", () => {
    expect(normalize("5 years")).not.toBe(normalize("8 years"));
    expect(normalize("no Python")).not.toBe(normalize("Python"));
  });
});

describe("verifyEvidence", () => {
  it("accepts a quote copied from the CV", () => {
    const r = verifyEvidence("5 years of production Python in total", { attachmentId: "cv", page: 1 }, CV);
    expect(r).toEqual({ ok: true, attachmentId: "cv", page: 1 });
  });

  it("adopts the real location when the caller names none", () => {
    const r = verifyEvidence("managed a team of four", {}, CV);
    expect(r).toEqual({ ok: true, attachmentId: "letter", page: 1 });
  });

  it("rejects a quote that is nowhere in the candidate's documents", () => {
    // Reads perfectly, appears in no file — the failure this app exists for.
    const r = verifyEvidence("8 years of hands-on Kubernetes at scale", { attachmentId: "cv" }, CV);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/does not appear/);
  });

  it("survives the spurious spaces per-character PDFs produce", () => {
    const spaced: PageText[] = [
      { attachment_id: "cv", page_no: 1, text: "S enior B ackend E ngineer at A cme G mbH" },
    ];
    expect(verifyEvidence("Senior Backend Engineer at Acme GmbH", {}, spaced).ok).toBe(true);
  });

  it("names the right page when only the page was wrong", () => {
    const r = verifyEvidence("MSc Computer Science, 2016", { attachmentId: "cv", page: 1 }, CV);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.foundIn).toEqual({ attachmentId: "cv", page: 2 });
      expect(r.reason).toMatch(/page 2/);
    }
  });

  it("names the right file when the quote is in the other document", () => {
    const r = verifyEvidence("managed a team of four", { attachmentId: "cv" }, CV);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.foundIn?.attachmentId).toBe("letter");
  });

  it("accepts a quote spanning a page break in one document", () => {
    const split: PageText[] = [
      { attachment_id: "cv", page_no: 1, text: "…led the migration of the billing" },
      { attachment_id: "cv", page_no: 2, text: "platform to Kubernetes in 2023." },
    ];
    expect(verifyEvidence("the billing platform to Kubernetes", {}, split).ok).toBe(true);
  });

  it("never joins two different documents into one passage", () => {
    const across: PageText[] = [
      { attachment_id: "cv", page_no: 1, text: "…led the migration of the billing" },
      { attachment_id: "letter", page_no: 1, text: "platform to Kubernetes in 2023." },
    ];
    expect(verifyEvidence("the billing platform to Kubernetes", {}, across).ok).toBe(false);
  });

  it("refuses a fragment too short to identify anything", () => {
    const r = verifyEvidence("Python", {}, CV);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/characters/);
  });

  it("explains itself when the candidate has no readable text", () => {
    const r = verifyEvidence("5 years of production Python", {}, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no readable document text/);
  });
});

describe("requiresEvidence", () => {
  it("demands a quote for a met requirement and for nothing else", () => {
    expect(requiresEvidence("met")).toBe(true);
    // You cannot quote an absence: requiring evidence here would force the
    // screener to invent it, which is the behaviour the check exists to stop.
    expect(requiresEvidence("not_met")).toBe(false);
    expect(requiresEvidence("unclear")).toBe(false);
  });
});
