export interface GlyphEntry {
  col: number;
  row: number;
  advance: number;
}

export interface GlyphAtlasData {
  version: number;
  grid: number;
  cellSize: number;
  atlasSize: number;
  fallback: [number, number, number];
  space: [number, number, number];
  glyphs: Record<string, [number, number, number]>;
}

export interface BubbleChunk {
  text: string;
  startCp: number;
  endCp: number;
  line1Len: number;
  len: number;
  glyphs: GlyphEntry[];
}

export const MAX_CHARS_PER_BUBBLE = 24;
export const MAX_LINE_ADVANCE = 12.0;

const NO_LINE_START = new Set(Array.from("，。！？、；：”’）》】」』.!?,;:)]}~—…·"));
const NO_LINE_END = new Set(Array.from("“‘（《【「『([{"));
const ASCII_WORD_CHAR = /^[A-Za-z0-9'\-]$/;

export class GlyphLookup {
  private readonly map = new Map<string, GlyphEntry>();
  readonly fallback: GlyphEntry;
  readonly space: GlyphEntry;

  constructor(data: GlyphAtlasData) {
    this.fallback = {
      col: data.fallback[0],
      row: data.fallback[1],
      advance: data.fallback[2],
    };
    this.space = {
      col: data.space[0],
      row: data.space[1],
      advance: data.space[2],
    };
    for (const [ch, [col, row, advance]] of Object.entries(data.glyphs)) {
      this.map.set(ch, { col, row, advance });
    }
  }

  get(ch: string): GlyphEntry {
    if (ch === " ") return this.space;
    return this.map.get(ch) ?? this.fallback;
  }
}

interface IndexedChar {
  ch: string;
  cp: number;
  glyph: GlyphEntry;
}

interface LayoutAtom {
  items: IndexedChar[];
  advance: number;
  newline?: boolean;
  isSpace?: boolean;
  isAsciiWord?: boolean;
}

function tokenizeForLayout(text: string, lookup: GlyphLookup): LayoutAtom[] {
  const codePoints = Array.from(text);
  const atoms: LayoutAtom[] = [];
  let i = 0;

  while (i < codePoints.length) {
    const ch = codePoints[i];
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      atoms.push({ items: [], advance: 0, newline: true });
      i++;
      continue;
    }
    if (ch === " " || ch === "\t") {
      const normalized = " ";
      const g = lookup.get(normalized);
      atoms.push({
        items: [{ ch: normalized, cp: i, glyph: g }],
        advance: g.advance,
        isSpace: true,
      });
      i++;
      continue;
    }
    // Keep short ASCII words/numbers together when wrapping if they fit within a line.
    if (ASCII_WORD_CHAR.test(ch)) {
      let j = i;
      const items: IndexedChar[] = [];
      let adv = 0;
      while (j < codePoints.length && ASCII_WORD_CHAR.test(codePoints[j])) {
        const c = codePoints[j];
        const g = lookup.get(c);
        if (items.length > 0 && adv + g.advance > MAX_LINE_ADVANCE) break;
        items.push({ ch: c, cp: j, glyph: g });
        adv += g.advance;
        j++;
      }
      atoms.push({ items, advance: adv, isAsciiWord: items.length > 1 });
      i = j;
      continue;
    }
    // Control chars ignored cleanly
    if (ch.codePointAt(0)! < 0x20) {
      i++;
      continue;
    }
    const g = lookup.get(ch);
    atoms.push({
      items: [{ ch, cp: i, glyph: g }],
      advance: g.advance,
    });
    i++;
  }

  return atoms;
}

export function layoutVrcBubbles(text: string, lookup: GlyphLookup): BubbleChunk[] {
  const atoms = tokenizeForLayout(text, lookup);
  const out: BubbleChunk[] = [];

  let line = 0; // 0 or 1
  let line0: IndexedChar[] = [];
  let line1: IndexedChar[] = [];
  let w0 = 0;
  let w1 = 0;

  const flushBubble = () => {
    const all = [...line0, ...line1];
    if (all.length === 0) return;
    const line1Len = line1.length > 0 ? line0.length : all.length;
    out.push({
      text: all.map((x) => x.ch).join(""),
      startCp: all[0].cp,
      endCp: all[all.length - 1].cp + 1,
      line1Len,
      len: all.length,
      glyphs: all.map((x) => x.glyph),
    });
    line = 0;
    line0 = [];
    line1 = [];
    w0 = 0;
    w1 = 0;
  };

  for (let idx = 0; idx < atoms.length; idx++) {
    const atom = atoms[idx];
    if (atom.newline) {
      if (line === 0 && line0.length > 0) {
        line = 1;
      } else if (line === 1 && (line0.length > 0 || line1.length > 0)) {
        flushBubble();
      }
      continue;
    }

    const totalNow = line0.length + line1.length;

    if (line === 0) {
      if (atom.isSpace && line0.length === 0) continue;
      if (
        line0.length + atom.items.length <= MAX_CHARS_PER_BUBBLE &&
        w0 + atom.advance <= MAX_LINE_ADVANCE + 1e-6
      ) {
        line0.push(...atom.items);
        w0 += atom.advance;
        continue;
      }

      // Line 0 full -> wrap to Line 1.
      // Kinsoku: avoid leading punctuation on Line 1 by pulling 1 non-ASCII char from Line 0 end if helpful,
      // or avoid trailing opening bracket at Line 0 end.
      if (
        atom.items.length === 1 &&
        NO_LINE_START.has(atom.items[0].ch) &&
        line0.length >= 2 &&
        line0.length + atom.items.length <= MAX_CHARS_PER_BUBBLE
      ) {
        const last = line0[line0.length - 1];
        if (
          !NO_LINE_END.has(last.ch) &&
          !ASCII_WORD_CHAR.test(last.ch) &&
          last.glyph.advance + atom.advance <= MAX_LINE_ADVANCE + 1e-6
        ) {
          line0.pop();
          w0 -= last.glyph.advance;
          line = 1;
          line1.push(last, ...atom.items);
          w1 += last.glyph.advance + atom.advance;
          continue;
        }
      }
      if (line0.length >= 2 && NO_LINE_END.has(line0[line0.length - 1].ch)) {
        const last = line0[line0.length - 1];
        if (atom.isSpace) {
          line0.pop();
          w0 -= last.glyph.advance;
          line = 1;
          line1.push(last);
          w1 += last.glyph.advance;
          continue;
        }
        if (
          line0.length + atom.items.length <= MAX_CHARS_PER_BUBBLE &&
          last.glyph.advance + atom.advance <= MAX_LINE_ADVANCE + 1e-6
        ) {
          line0.pop();
          w0 -= last.glyph.advance;
          line = 1;
          line1.push(last, ...atom.items);
          w1 += last.glyph.advance + atom.advance;
          continue;
        }
        if (
          1 + atom.items.length <= MAX_CHARS_PER_BUBBLE &&
          last.glyph.advance + atom.advance <= MAX_LINE_ADVANCE + 1e-6
        ) {
          // Move opening bracket + atom together to next bubble instead of orphaning it on Bubble 1.
          line0.pop();
          w0 -= last.glyph.advance;
          flushBubble();
          line0.push(last, ...atom.items);
          w0 += last.glyph.advance + atom.advance;
          continue;
        }
      }

      line = 1;
      if (atom.isSpace) continue;
      if (
        line0.length + line1.length + atom.items.length <= MAX_CHARS_PER_BUBBLE &&
        w1 + atom.advance <= MAX_LINE_ADVANCE + 1e-6
      ) {
        line1.push(...atom.items);
        w1 += atom.advance;
        continue;
      }
      // If even a single atom won't fit Line 1 after Line 0 (e.g. char limit already hit), flush bubble.
      flushBubble();
      line0.push(...atom.items);
      w0 += atom.advance;
      continue;
    }

    // Currently on Line 1
    if (atom.isSpace && line1.length === 0) continue;
    if (
      totalNow + atom.items.length <= MAX_CHARS_PER_BUBBLE &&
      w1 + atom.advance <= MAX_LINE_ADVANCE + 1e-6
    ) {
      line1.push(...atom.items);
      w1 += atom.advance;
      continue;
    }

    // Bubble is full -> start a new bubble!
    flushBubble();
    if (!atom.isSpace) {
      line0.push(...atom.items);
      w0 += atom.advance;
    }
  }

  flushBubble();
  return out;
}
