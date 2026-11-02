/**
 * Dependency-free PDF writer.
 *
 * Emits a minimal but valid PDF 1.4 with the base-14 Helvetica fonts, so the
 * app ships no PDF library and costs nothing. Text widths come from the
 * Helvetica AFM tables below, which is what lets columns line up and lines wrap
 * correctly instead of overflowing the page.
 *
 * Limitation (documented in the README): the base-14 fonts use WinAnsi
 * encoding, so Tamil and Devanagari glyphs cannot be drawn. Non-Latin text is
 * transliterated to a readable placeholder and the caller is told, rather than
 * emitting broken glyphs. CSV export keeps the original Unicode intact.
 */

// Helvetica advance widths (units/1000) for WinAnsi codepoints 32..126.
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]
// Helvetica-Bold advance widths for the same range.
const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
]

export type PdfFont = 'Helvetica' | 'Helvetica-Bold'

export function textWidth(text: string, size: number, font: PdfFont = 'Helvetica'): number {
  const table = font === 'Helvetica-Bold' ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS
  let total = 0
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    total += code >= 32 && code <= 126 ? table[code - 32] : 556
  }
  return (total / 1000) * size
}

/** Replace characters the base-14 fonts cannot draw. Returns a flag when lossy. */
export function sanitiseForPdf(text: string): { text: string; lossy: boolean } {
  let lossy = false
  const out = [...String(text ?? '')]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 32
      if (code === 0x20b9) return 'Rs.' // rupee sign is outside WinAnsi
      if (code >= 32 && code <= 126) return ch
      if (code === 0x2019 || code === 0x2018) return "'"
      if (code === 0x201c || code === 0x201d) return '"'
      if (code === 0x2013 || code === 0x2014) return '-'
      if (code === 0xa0) return ' '
      lossy = true
      return '?'
    })
    .join('')
  return { text: out, lossy }
}

function escapePdfString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

export interface PdfTable {
  headers: string[]
  rows: (string | number)[][]
  /** Column widths in points; omitted columns share the remainder equally. */
  widths?: number[]
  /** Right-align these column indices (money columns). */
  alignRight?: number[]
}

export interface PdfSection {
  heading?: string
  paragraphs?: string[]
  table?: PdfTable
  keyValues?: [string, string][]
}

export interface PdfDocSpec {
  title: string
  subtitle?: string
  footerNote?: string
  sections: PdfSection[]
}

const PAGE_W = 595.28 // A4 portrait
const PAGE_H = 841.89
const MARGIN = 48

/** Build a PDF and return it as a Blob. */
export function buildPdf(spec: PdfDocSpec): { blob: Blob; lossy: boolean } {
  let lossy = false
  const S = (s: string) => {
    const r = sanitiseForPdf(s)
    if (r.lossy) lossy = true
    return r.text
  }

  const pages: string[][] = []
  let ops: string[] = []
  let y = PAGE_H - MARGIN

  const newPage = () => {
    if (ops.length) pages.push(ops)
    ops = []
    y = PAGE_H - MARGIN
  }
  const ensure = (needed: number) => {
    if (y - needed < MARGIN + 28) newPage()
  }
  const draw = (text: string, x: number, size: number, font: PdfFont, color = '0 0 0') => {
    ops.push(
      `BT /${font === 'Helvetica-Bold' ? 'F2' : 'F1'} ${size} Tf ${color} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdfString(text)}) Tj ET`,
    )
  }
  const rect = (x: number, yy: number, w: number, h: number, color: string) => {
    ops.push(`${color} rg ${x.toFixed(2)} ${yy.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`)
  }
  const wrap = (text: string, size: number, maxW: number, font: PdfFont = 'Helvetica'): string[] => {
    const words = text.split(/\s+/)
    const lines: string[] = []
    let line = ''
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w
      if (textWidth(candidate, size, font) <= maxW) line = candidate
      else {
        if (line) lines.push(line)
        line = w
      }
    }
    if (line) lines.push(line)
    return lines
  }

  const contentW = PAGE_W - MARGIN * 2

  // ---- title block ----
  draw(S(spec.title), MARGIN, 20, 'Helvetica-Bold', '0.09 0.13 0.2')
  y -= 22
  if (spec.subtitle) {
    draw(S(spec.subtitle), MARGIN, 10, 'Helvetica', '0.28 0.33 0.41')
    y -= 16
  }
  rect(MARGIN, y, contentW, 1.2, '0.15 0.39 0.92')
  y -= 22

  // ---- sections ----
  for (const section of spec.sections) {
    if (section.heading) {
      ensure(30)
      draw(S(section.heading), MARGIN, 12.5, 'Helvetica-Bold', '0.09 0.13 0.2')
      y -= 18
    }

    for (const p of section.paragraphs ?? []) {
      const lines = wrap(S(p), 9.5, contentW)
      ensure(lines.length * 13 + 6)
      for (const l of lines) {
        draw(l, MARGIN, 9.5, 'Helvetica', '0.28 0.33 0.41')
        y -= 13
      }
      y -= 5
    }

    if (section.keyValues?.length) {
      for (const [k, v] of section.keyValues) {
        ensure(16)
        draw(S(k), MARGIN, 9.5, 'Helvetica', '0.4 0.45 0.52')
        const vs = S(v)
        draw(vs, PAGE_W - MARGIN - textWidth(vs, 9.5, 'Helvetica-Bold'), 9.5, 'Helvetica-Bold', '0.09 0.13 0.2')
        y -= 15
      }
      y -= 8
    }

    if (section.table) {
      const { headers, rows, alignRight = [] } = section.table
      const cols = headers.length
      const widths =
        section.table.widths ??
        Array.from({ length: cols }, () => contentW / cols)
      const rowH = 15

      const drawHeader = () => {
        ensure(rowH * 2)
        rect(MARGIN, y - 4, contentW, rowH, '0.94 0.96 0.98')
        let x = MARGIN + 4
        headers.forEach((h, i) => {
          const t = S(h)
          const w = widths[i]
          const tx = alignRight.includes(i) ? x + w - 8 - textWidth(t, 8.5, 'Helvetica-Bold') : x
          draw(t, tx, 8.5, 'Helvetica-Bold', '0.28 0.33 0.41')
          x += w
        })
        y -= rowH + 3
      }

      drawHeader()
      for (const row of rows) {
        if (y - rowH < MARGIN + 28) {
          newPage()
          drawHeader()
        }
        let x = MARGIN + 4
        row.forEach((cell, i) => {
          let t = S(String(cell ?? ''))
          const w = widths[i]
          // Truncate rather than overflow into the next column.
          while (t.length > 1 && textWidth(t, 8.5) > w - 10) t = t.slice(0, -1)
          if (t !== String(cell ?? '') && t.length > 1) t = `${t.slice(0, -1)}.`
          const tx = alignRight.includes(i) ? x + w - 8 - textWidth(t, 8.5) : x
          draw(t, tx, 8.5, 'Helvetica', '0.1 0.15 0.22')
          x += w
        })
        y -= rowH
        rect(MARGIN, y + 3, contentW, 0.4, '0.89 0.91 0.94')
      }
      y -= 14
    }
  }

  if (ops.length) pages.push(ops)
  if (!pages.length) pages.push([])

  // ---- footer on every page ----
  const stamped = pages.map((pageOps, i) => {
    const note = S(spec.footerNote ?? '')
    const pageLabel = `Page ${i + 1} of ${pages.length}`
    return [
      ...pageOps,
      `BT /F1 7.5 Tf 0.55 0.6 0.67 rg 1 0 0 1 ${MARGIN} ${MARGIN - 12} Tm (${escapePdfString(note)}) Tj ET`,
      `BT /F1 7.5 Tf 0.55 0.6 0.67 rg 1 0 0 1 ${(PAGE_W - MARGIN - textWidth(pageLabel, 7.5)).toFixed(2)} ${MARGIN - 12} Tm (${escapePdfString(pageLabel)}) Tj ET`,
    ]
  })

  // ---- assemble objects ----
  const objects: string[] = []
  const pageIds = stamped.map((_, i) => 5 + i * 2)

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${stamped.length} >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'

  stamped.forEach((pageOps, i) => {
    const pageId = pageIds[i]
    const contentId = pageId + 1
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`
    const stream = pageOps.join('\n')
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  })

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let i = 1; i < objects.length; i++) {
    if (!objects[i]) continue
    offsets[i] = pdf.length
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xrefOffset = pdf.length
  const maxId = objects.length
  pdf += `xref\n0 ${maxId}\n0000000000 65535 f \n`
  for (let i = 1; i < maxId; i++) {
    pdf += offsets[i] ? `${String(offsets[i]).padStart(10, '0')} 00000 n \n` : '0000000000 65535 f \n'
  }
  pdf += `trailer\n<< /Size ${maxId} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

  return { blob: new Blob([pdf], { type: 'application/pdf' }), lossy }
}
