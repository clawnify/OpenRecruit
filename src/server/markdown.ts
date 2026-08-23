// A very small markdown renderer for the public careers pages.
//
// Job descriptions are written by people in the dashboard and rendered on a page
// strangers read, so the order of operations is the whole story: **escape
// first, then add markup**. Anything that reaches the output as a tag got there
// because this file put it there, which means there is no path from a job
// description to a script on the careers site.
//
// It supports what a job description actually uses — headings, bold, italic,
// links, bullet and numbered lists, paragraphs — and nothing else. Adding raw
// HTML passthrough would undo the paragraph above, and pulling in a real
// markdown library to get tables would too, unless it were configured to
// sanitise. This is the smaller, safer half of that trade.

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Inline spans, applied to already-escaped text. */
function inline(text: string): string {
  return (
    text
      // Links: only http(s), so a description cannot smuggle in `javascript:`.
      // The escape pass already turned the URL's quotes into entities.
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="nofollow noopener" target="_blank">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
  );
}

export function renderMarkdown(source: string): string {
  const lines = escapeHtml(source ?? "").split(/\r?\n/);
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${inline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      // Job descriptions start their sections at the same visual level whatever
      // hashes the author used; the page's own <h1> is the job title.
      const level = Math.min(4, heading[1].length + 1);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || numbered) {
      flushParagraph();
      const wanted = bullet ? "ul" : "ol";
      if (list !== wanted) {
        flushList();
        out.push(`<${wanted}>`);
        list = wanted;
      }
      out.push(`<li>${inline((bullet ?? numbered)![1])}</li>`);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return out.join("\n");
}

/**
 * Plain text from markdown, for the feed and the meta description.
 *
 * A job feed wants readable prose, not markup, and a meta description that
 * contains `**` reads as broken rather than as emphasis.
 */
export function toPlainText(source: string): string {
  return (source ?? "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\r?\n{2,}/g, "\n\n")
    .trim();
}
