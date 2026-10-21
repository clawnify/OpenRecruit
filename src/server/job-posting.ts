// The JobPosting structured data for one open role.
//
// This is the free half of "multiposting": a posting Google can read appears in
// job search without an ad budget or a contract, and the fields below are the
// ones its documentation names. `title`, `description`, `datePosted`,
// `hiringOrganization` and `jobLocation` are required. A posting missing any of
// them is not eligible, so the builder declines to emit the block at all rather
// than emitting an invalid one.
//
// `validThrough` is set only when the role has a closing date: Google asks for it
// to be left out when a posting has no known expiry. A closed role is withdrawn
// by the 410 its page returns.
//
// Pure on purpose (no database, no request): the careers page embeds it, the
// job-detail API returns it to sites that render their own job pages, and the
// tests call it directly.

import { renderMarkdown } from "./markdown.js";

export interface JobPostingJob {
  slug: string;
  title: string;
  employment_type: string;
  workplace: string;
  location_city: string;
  location_region: string;
  location_country: string;
  location_postal: string;
  description_md: string;
  requirements_md: string;
  benefits_md: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  salary_unit: string;
  salary_public: number;
  published_at: string | null;
  closes_at: string | null;
}

export interface JobPostingSettings {
  company_name: string;
  company_url: string;
  logo_key: string;
  /** 1 when the org recruits on behalf of clients it does not name. */
  hiring_for_clients: number;
}

export function jobPostingData(
  job: JobPostingJob,
  s: JobPostingSettings,
  base: string,
): Record<string, unknown> | null {
  const description = renderMarkdown([job.description_md, job.requirements_md, job.benefits_md].filter(Boolean).join("\n\n"));
  if (!job.title || !description || !job.published_at || !s.company_name || !job.location_country) return null;

  const ld: Record<string, unknown> = {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    title: job.title,
    description,
    datePosted: job.published_at.slice(0, 10),
    identifier: { "@type": "PropertyValue", name: s.company_name, value: job.slug },
    // An agency posting for a client it does not name: Google's guidelines ask
    // for the literal name "confidential" ("a staffing agency on behalf of an
    // anonymous employer"). Naming the agency would claim it is the employer.
    hiringOrganization: s.hiring_for_clients
      ? { "@type": "Organization", name: "confidential" }
      : {
          "@type": "Organization",
          name: s.company_name,
          ...(s.company_url ? { sameAs: s.company_url } : {}),
          ...(s.logo_key ? { logo: `${base}/api/careers/logo` } : {}),
        },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        ...(job.location_city ? { addressLocality: job.location_city } : {}),
        ...(job.location_region ? { addressRegion: job.location_region } : {}),
        ...(job.location_postal ? { postalCode: job.location_postal } : {}),
        addressCountry: job.location_country,
      },
    },
    employmentType: job.employment_type,
    directApply: true,
  };

  if (job.closes_at) ld.validThrough = job.closes_at.slice(0, 10);
  if (job.workplace === "remote") {
    ld.jobLocationType = "TELECOMMUTE";
    // Only the country is safe to assert: the free-text region field holds
    // things like "EU, UTC±2", and a made-up AdministrativeArea is worse than
    // none. Google reads an absent requirement as "anywhere".
    if (job.location_country) {
      ld.applicantLocationRequirements = { "@type": "Country", name: job.location_country };
    }
  }
  if (job.salary_public && (job.salary_min || job.salary_max)) {
    const value: Record<string, unknown> = { "@type": "QuantitativeValue", unitText: job.salary_unit };
    if (job.salary_min && job.salary_max) {
      value.minValue = job.salary_min;
      value.maxValue = job.salary_max;
    } else {
      value.value = job.salary_min ?? job.salary_max;
    }
    ld.baseSalary = { "@type": "MonetaryAmount", currency: job.salary_currency, value };
  }

  return ld;
}

/** The same markup as a string that is safe inside an inline JSON-LD script tag. */
export function jobPostingLd(job: JobPostingJob, s: JobPostingSettings, base: string): string | null {
  const ld = jobPostingData(job, s, base);
  // `</script>` inside a JSON string closes the block in an HTML parser even
  // though it is valid JSON. Escaping the slash keeps the JSON identical and the
  // page intact: it is the one escape a JSON-LD block always needs.
  return ld ? JSON.stringify(ld).replace(/<\//g, "<\\/") : null;
}
