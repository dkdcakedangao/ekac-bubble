export const MAX_SUFFIX_LENGTH = 16;

const SENTENCE_SPLIT_RE =
  /([。！？!?]+[~～…]*[”’）》】」』)"'\]]*|\.(?![A-Za-z0-9.])[~～…]*[”’）》】」』)"'\]]*)([ \t]*)/gu;

const TRAILING_MARKS_RE = /([.。!！?？…~～]+[”’）》】」』)"'\]]*)$/u;
const SUFFIX_END_PUNCT_RE = /[.。!！?？…~～]$/u;
const PURE_MARKS_OR_SPACE_RE = /^[\s,，、;；:：.。!！?？…~～“”‘’（）()《》〈〉【】\[\]「」『』"'—\-·]+$/u;

export function normalizeSuffixText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw.replace(/[\x00-\x1f\x7f]/g, "");
  return Array.from(cleaned).slice(0, MAX_SUFFIX_LENGTH).join("");
}

function mergeClosingMarks(suffix: string, closingMarks: string): string {
  if (!closingMarks) return "";
  if (!SUFFIX_END_PUNCT_RE.test(suffix)) return closingMarks;

  // Suffix already carries its own tone/end mark (e.g. "喵～", "喵！"):
  // drop redundant plain periods ("。", ".") and collapse identical boundary marks.
  let merged = closingMarks.replace(/^[.。]+/u, "");
  const suffixLast = Array.from(suffix).at(-1) ?? "";
  while (suffixLast && merged.startsWith(suffixLast)) {
    merged = merged.slice(suffixLast.length);
  }
  return merged;
}

function appendSuffixToSegment(segment: string, suffix: string, suffixCore: string): string {
  const leadMatch = segment.match(/^[ \t]*/u);
  const leadingWs = leadMatch ? leadMatch[0] : "";
  const body = segment.slice(leadingWs.length).replace(/[ \t]+$/u, "");
  if (!body || PURE_MARKS_OR_SPACE_RE.test(body)) return segment;

  let stem = body;
  let closingMarks = "";
  const tailMatch = body.match(TRAILING_MARKS_RE);
  if (tailMatch && tailMatch.index !== undefined) {
    stem = body.slice(0, tailMatch.index);
    closingMarks = tailMatch[1];
  }

  if (!stem || PURE_MARKS_OR_SPACE_RE.test(stem)) return segment;

  // Deduplicate if the spoken/typed stem already ends with the suffix (or its punctuation-free core)
  if (stem.endsWith(suffix)) {
    return leadingWs + stem + mergeClosingMarks(suffix, closingMarks);
  }
  if (suffixCore.length > 0 && stem.endsWith(suffixCore)) {
    stem = stem.slice(0, stem.length - suffixCore.length);
  }

  return leadingWs + stem + suffix + mergeClosingMarks(suffix, closingMarks);
}

function transformLine(line: string, suffix: string, suffixCore: string): string {
  if (!line.trim()) return line;
  let out = "";
  let lastIndex = 0;
  SENTENCE_SPLIT_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = SENTENCE_SPLIT_RE.exec(line)) !== null) {
    const segEnd = match.index + match[1].length;
    const seg = line.slice(lastIndex, segEnd);
    const trailingSpaces = match[2] ?? "";
    out += appendSuffixToSegment(seg, suffix, suffixCore) + trailingSpaces;
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < line.length) {
    out += appendSuffixToSegment(line.slice(lastIndex), suffix, suffixCore);
  }
  return out;
}

export function applySentenceSuffix(
  text: string,
  suffixEnabled: boolean,
  suffixText: string,
): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (!suffixEnabled) return trimmed;

  const suffix = normalizeSuffixText(suffixText).trim();
  if (!suffix) return trimmed;

  const suffixCore = suffix.replace(/[.。!！?？…~～]+$/u, "");
  const parts = trimmed.split(/(\n+)/);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = transformLine(parts[i], suffix, suffixCore);
  }
  return parts.join("");
}
