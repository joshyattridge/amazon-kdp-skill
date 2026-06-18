/**
 * Normalize a KDP “royalty date” cell to YYYY-MM-DD for historical FX.
 * KDP often uses YYYY-MM (accrual month) — we use the last day of that month
 * as the date for the ECB series Frankfurter exposes.
 */
export function parseRoyaltyDateToIsoForFx(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (v === '') return null

  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null
    return toYmd(v)
  }

  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    const asDate = new Date(
      (v - 25569) * 24 * 60 * 60 * 1000,
    )
    if (Number.isNaN(asDate.getTime())) return null
    return toYmd(utcYmdToLocalDate(asDate))
  }

  const s = String(v).trim()
  if (!s) return null

  const ym = /^(\d{4})[-/](\d{1,2})$/.exec(s)
  if (ym) {
    const y = Number(ym[1])
    const m = Number(ym[2])
    if (y < 1990 || y > 2100 || m < 1 || m > 12) return null
    const last = new Date(y, m, 0)
    if (Number.isNaN(last.getTime())) return null
    return toYmd(last)
  }

  const t = Date.parse(s)
  if (!Number.isNaN(t)) {
    return toYmd(new Date(t))
  }

  // "April 2026" from Summary-style KDP rollups
  const longMonth =
    /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})$/i.exec(
      s,
    )
  if (longMonth) {
    const t2 = new Date(`${longMonth[1]} 1, ${longMonth[2]}`)
    if (Number.isNaN(t2.getTime())) return null
    const y = t2.getFullYear()
    const m = t2.getMonth() + 1
    return toYmd(new Date(y, m, 0))
  }

  return null
}

function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Frankfurter only publishes rates through today. Month-only KDP dates are
 * normalized to month-end, which is in the future for the in-progress month.
 */
export function clampIsoDateForFxLookup(
  isoDate: string,
  asOf: Date = new Date(),
): string {
  const day = isoDate.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return isoDate
  const today = toYmd(asOf)
  return day <= today ? day : today
}

/** Avoid one-off UTC/local drift on parsed ISO strings. */
function utcYmdToLocalDate(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
