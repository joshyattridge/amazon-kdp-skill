import XLSX from 'xlsx'

function rowsFromSheet(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][]
}

function headerRowIndex(rows: unknown[][]): number {
  return rows.findIndex((row) =>
    row.some((cell) => String(cell).trim().toLowerCase() === 'title'),
  )
}

/** Merge KDP monthly .xlsx exports into one workbook (append data rows per sheet). */
export function mergeWorkbookBuffers(buffers: Buffer[]): Buffer {
  if (buffers.length === 0) {
    throw new Error('No workbooks to merge.')
  }
  if (buffers.length === 1) {
    return buffers[0]!
  }

  const merged = XLSX.read(buffers[0]!, { type: 'buffer' })

  for (let i = 1; i < buffers.length; i++) {
    const wb = XLSX.read(buffers[i]!, { type: 'buffer' })
    for (const sheetName of wb.SheetNames) {
      const incomingRows = rowsFromSheet(wb.Sheets[sheetName]!)
      if (incomingRows.length === 0) continue

      if (!merged.Sheets[sheetName]) {
        XLSX.utils.book_append_sheet(
          merged,
          XLSX.utils.aoa_to_sheet(incomingRows),
          sheetName,
        )
        continue
      }

      const existingRows = rowsFromSheet(merged.Sheets[sheetName]!)
      const incomingHeaderIdx = headerRowIndex(incomingRows)
      const dataStart =
        incomingHeaderIdx >= 0 ? incomingHeaderIdx + 1 : Math.min(2, incomingRows.length)
      merged.Sheets[sheetName] = XLSX.utils.aoa_to_sheet([
        ...existingRows,
        ...incomingRows.slice(dataStart),
      ])
    }
  }

  return XLSX.write(merged, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
