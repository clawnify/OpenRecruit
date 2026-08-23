// Evidence verification — the rule this app is built around.
//
// Ask any capable model to screen a CV against a job's requirements and most of
// the answers will be right. The problem is the rest: a fluent, confident
// "8 years of Kubernetes in production" about someone whose CV says nothing of
// the kind. In most domains a hallucination is an annoyance. Here it decides
// whether a person gets an interview, which is why recruitment AI is classified
// as high-risk in the EU — and why an unverifiable claim is worse than a blank
// cell. It survives review: nobody re-reads the requirement that already has a
// quote next to it.
//
// So the API does not ask the screener to cite the CV, it *checks* the citation.
// A `met` verdict is only stored once its quote has been located in the text the
// candidate actually submitted. Anything else is stored as `rejected` and
// rendered as unverified, never as a qualification. The check is mechanical, so
// no amount of prompt drift can weaken it.

/** Shorter than this and a "quote" isn't evidence — it's a coincidence. */
export const MIN_QUOTE_CHARS = 12;

/**
 * Fold the cosmetic differences between what a PDF extractor emits and what a
 * model transcribes, without folding away anything that changes meaning.
 *
 * Deliberately NOT folded: digits, letters, negations — "5 years" must never
 * match "8 years". Only characters that PDF and Word mangle in transit: smart
 * quotes, dash variants, ligatures, soft hyphens, whitespace, and case.
 *
 * NFKC does most of the invisible work — it collapses exotic spaces (NBSP,
 * thin, narrow-NBSP) to a plain space and expands ligatures (ﬁ → "fi"), which
 * is exactly the noise PDF extraction introduces. CVs are unusually rich in it:
 * they are laid out in columns, in tables, with bullet glyphs, by design tools.
 */
export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    // A hyphen at end of line is the extractor breaking a word, not a real
    // hyphen: "engineer-\ning" is one word. Undo it before whitespace is
    // collapsed, while the line break is still there to identify it.
    .replace(/(\p{L})[-­]\s*\n\s*(\p{L})/gu, "$1$2")
    // Soft hyphens anywhere else are invisible and carry no meaning.
    .replace(/­/g, "")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    // Bullet glyphs differ between every CV template and carry no meaning; a
    // quoted bullet line should not fail because the extractor emitted "▪".
    .replace(/[•‣▪●◦·⁃]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * `normalize`, with every space removed as well.
 *
 * This is what containment is actually tested against, because PDF text
 * extraction does not preserve word boundaries reliably: pdf.js emits
 * "in accordanc\ne with" for text laid out across a line break, and inserts
 * spurious spaces inside words whenever a PDF uses per-character positioning
 * ("S enior E ngineer"). CVs are the worst case for this — most are typeset in
 * a design tool and exported, and a two-column layout interleaves text in ways
 * no word-boundary rule survives. A screener quoting the CV correctly would be
 * told the quote was invented, which is the false rejection that teaches people
 * to switch verification off.
 *
 * Ignoring spaces costs almost nothing in strictness: every other character
 * must still match in order, so two genuinely different passages of quotable
 * length cannot collide.
 */
function fingerprint(text: string): string {
  return normalize(text).replace(/ /g, "");
}

export interface PageText {
  attachment_id: string;
  page_no: number;
  text: string;
}

export type VerifyResult =
  | { ok: true; attachmentId: string; page: number }
  | { ok: false; reason: string; foundIn?: { attachmentId: string; page: number } };

/**
 * Is `quote` actually present in this candidate's own documents?
 *
 * Unlike a contract review, the caller is not required to say *which* file it
 * came from. A candidate arrives with a CV and often a cover letter, and which
 * of them a line sits in is bookkeeping the screener should not have to carry —
 * so if the claim is left open, the located file is adopted and recorded. What
 * is not optional is that the line exists somewhere in what the person actually
 * submitted.
 *
 * When the quote is real but the claimed location is wrong, say where it is
 * rather than just failing. An off-by-one page or the wrong file of two is the
 * commonest honest mistake, and an error that names the right place turns a
 * retry loop into one correction.
 */
export function verifyEvidence(
  quote: string,
  claim: { attachmentId?: string | null; page?: number | null },
  pages: PageText[],
): VerifyResult {
  const trimmed = quote.trim();
  if (!trimmed) {
    return { ok: false, reason: "evidence is empty — quote the line of the CV this verdict comes from" };
  }
  if (trimmed.length < MIN_QUOTE_CHARS) {
    return {
      ok: false,
      reason: `evidence is ${trimmed.length} characters; at least ${MIN_QUOTE_CHARS} are needed for it to identify a passage`,
    };
  }
  if (pages.length === 0) {
    return {
      ok: false,
      reason:
        "this candidate has no readable document text — check the attachment's extract_status, " +
        "and screen from the application answers instead if there is no CV",
    };
  }

  const hits = locate(fingerprint(trimmed), pages);
  if (hits.length === 0) {
    return {
      ok: false,
      reason:
        "evidence does not appear anywhere in this candidate's documents. Copy the line verbatim " +
        "from the CV — do not paraphrase it, and do not stitch two lines together.",
    };
  }

  // Both parts of the claim are optional and are checked independently, so a
  // right file with a wrong page still says so precisely.
  const wanted = hits.filter(
    (h) =>
      (!claim.attachmentId || h.attachmentId === claim.attachmentId) &&
      (claim.page == null || h.page === claim.page),
  );
  if (wanted.length > 0) {
    return { ok: true, attachmentId: wanted[0].attachmentId, page: wanted[0].page };
  }

  const inSameFile = claim.attachmentId ? hits.filter((h) => h.attachmentId === claim.attachmentId) : [];
  if (inSameFile.length > 0) {
    return {
      ok: false,
      reason: `evidence was not found on page ${claim.page} of that document — it is on page ${inSameFile[0].page}`,
      foundIn: inSameFile[0],
    };
  }
  return {
    ok: false,
    reason: "evidence is real but not in the document you named — it appears in another of this candidate's files",
    foundIn: hits[0],
  };
}

/**
 * Every place the quote occurs, allowing it to straddle a page break within one
 * document.
 *
 * A CV's "Experience" section running off the foot of page 1 and continuing on
 * page 2 is ordinary, not an edge case, and a quote spanning that break is a
 * correct citation — so both pages are accepted. Pages of *different* documents
 * are never joined: a sentence half in a CV and half in a cover letter is not a
 * sentence anyone wrote.
 */
function locate(needle: string, pages: PageText[]): { attachmentId: string; page: number }[] {
  const prints = pages.map((p) => ({ ...p, print: fingerprint(p.text) }));

  const hits = prints
    .filter((p) => p.print.includes(needle))
    .map((p) => ({ attachmentId: p.attachment_id, page: p.page_no }));
  if (hits.length) return hits;

  const spanning: { attachmentId: string; page: number }[] = [];
  for (let i = 0; i < prints.length - 1; i++) {
    const a = prints[i];
    const b = prints[i + 1];
    if (a.attachment_id !== b.attachment_id) continue;
    if ((a.print + b.print).includes(needle)) {
      spanning.push({ attachmentId: a.attachment_id, page: a.page_no });
    }
  }
  return spanning;
}

/**
 * Which verdicts have to carry evidence.
 *
 * Only `met`. The asymmetry is deliberate and it is the whole ethic of the
 * feature: you cannot quote an absence, so demanding a citation for "the CV does
 * not mention Kubernetes" would force the screener to invent one — the exact
 * behaviour the check exists to prevent. And the two errors are not equally
 * costly. A fabricated qualification puts someone in an interview they cannot
 * hold and, worse, launders a machine's guess into the record as a fact about a
 * person. A missed one is caught by the human who reads the CV next to the grid,
 * which is why the CV is on that screen at all.
 */
export function requiresEvidence(verdict: string): boolean {
  return verdict === "met";
}
