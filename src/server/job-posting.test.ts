import { describe, expect, it } from "vitest";
import { jobPostingData, jobPostingLd, type JobPostingJob, type JobPostingSettings } from "./job-posting";

const JOB: JobPostingJob = {
  slug: "senior-backend-engineer",
  title: "Senior Backend Engineer",
  employment_type: "FULL_TIME",
  workplace: "hybrid",
  location_city: "Berlin",
  location_region: "",
  location_country: "DE",
  location_postal: "10115",
  description_md: "Own the routing service.",
  requirements_md: "- Five years of backend work",
  benefits_md: "",
  salary_min: 80000,
  salary_max: 95000,
  salary_currency: "EUR",
  salary_unit: "YEAR",
  salary_public: 1,
  published_at: "2026-09-01 08:00:00",
  closes_at: null,
};

const EMPLOYER: JobPostingSettings = {
  company_name: "Northwind",
  company_url: "https://northwind.example",
  logo_key: "branding/logo-1",
  hiring_for_clients: 0,
};

const BASE = "https://careers.northwind.example";

describe("jobPostingData", () => {
  it("names the company as the employer when it hires for itself", () => {
    const ld = jobPostingData(JOB, EMPLOYER, BASE)!;
    expect(ld.hiringOrganization).toEqual({
      "@type": "Organization",
      name: "Northwind",
      sameAs: "https://northwind.example",
      logo: "https://careers.northwind.example/api/careers/logo",
    });
    expect(ld.datePosted).toBe("2026-09-01");
  });

  it("names the employer \"confidential\" for an agency, with no logo or link", () => {
    const ld = jobPostingData(JOB, { ...EMPLOYER, hiring_for_clients: 1 }, BASE)!;
    expect(ld.hiringOrganization).toEqual({ "@type": "Organization", name: "confidential" });
  });

  it("emits nothing for a role missing a required field", () => {
    expect(jobPostingData({ ...JOB, published_at: null }, EMPLOYER, BASE)).toBeNull();
    expect(jobPostingData({ ...JOB, location_country: "" }, EMPLOYER, BASE)).toBeNull();
  });

  it("states the salary only when it is public", () => {
    expect(jobPostingData(JOB, EMPLOYER, BASE)!.baseSalary).toEqual({
      "@type": "MonetaryAmount",
      currency: "EUR",
      value: { "@type": "QuantitativeValue", unitText: "YEAR", minValue: 80000, maxValue: 95000 },
    });
    expect(jobPostingData({ ...JOB, salary_public: 0 }, EMPLOYER, BASE)!.baseSalary).toBeUndefined();
  });

  it("leaves validThrough out unless the role has a closing date", () => {
    expect(jobPostingData(JOB, EMPLOYER, BASE)!.validThrough).toBeUndefined();
    expect(jobPostingData({ ...JOB, closes_at: "2026-12-31" }, EMPLOYER, BASE)!.validThrough).toBe("2026-12-31");
  });

  it("marks a remote role as telecommute, limited to its country", () => {
    const ld = jobPostingData({ ...JOB, workplace: "remote" }, EMPLOYER, BASE)!;
    expect(ld.jobLocationType).toBe("TELECOMMUTE");
    expect(ld.applicantLocationRequirements).toEqual({ "@type": "Country", name: "DE" });
  });
});

describe("jobPostingLd", () => {
  it("is safe inside a script tag and parses back to the same data", () => {
    const out = jobPostingLd(JOB, EMPLOYER, BASE)!;
    expect(out).not.toContain("</");
    expect(JSON.parse(out)).toEqual(jobPostingData(JOB, EMPLOYER, BASE));
  });
});
