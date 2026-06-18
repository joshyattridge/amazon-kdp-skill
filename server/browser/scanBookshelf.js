() => {
  const refs = new Map()
  const titleIds = new Set()

  const addRef = (format, titleId) => {
    if (!/^[A-Z0-9]{10,14}$/.test(titleId)) return
    if (format !== 'kindle' && format !== 'paperback' && format !== 'hardcover') return
    refs.set(`${titleId}:${format}`, { titleId, format })
  }

  for (const tr of document.querySelectorAll('tr[id]')) {
    if (/^[A-Z0-9]{10,14}$/.test(tr.id)) {
      titleIds.add(tr.id)
    }
  }

  for (const anchor of document.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href') ?? ''
    let match = href.match(/title-setup\/(paperback|kindle|hardcover)\/([A-Z0-9]{10,14})/i)
    if (match) {
      addRef(match[1].toLowerCase(), match[2])
      continue
    }
    match = href.match(
      /edit(?:paperback|kindle|hardcover)details.*?title-setup\/(paperback|kindle|hardcover)\/([A-Z0-9]{10,14})/i,
    )
    if (match) {
      addRef(match[1].toLowerCase(), match[2])
    }
  }

  for (const tr of document.querySelectorAll('tr[id]')) {
    const id = tr.id
    if (!/^[A-Z0-9]{10,14}$/.test(id)) continue

    const text = tr.textContent ?? ''
    const hasEditLink = tr.querySelector(
      'a[href*="editpaperback"], a[href*="editkindle"], a[href*="edithardcover"]',
    )

    if (
      /Paperback/i.test(text) &&
      hasEditLink &&
      !/Create paperback/i.test(text)
    ) {
      addRef('paperback', id)
    }
    if (
      /Kindle eBook/i.test(text) &&
      hasEditLink &&
      !/Create Kindle eBook/i.test(text)
    ) {
      addRef('kindle', id)
    }
    if (
      /Hardcover/i.test(text) &&
      hasEditLink &&
      !/Create hardcover/i.test(text)
    ) {
      addRef('hardcover', id)
    }
  }

  const bookshelfRows = document.querySelectorAll(
    '#bookshelftable tbody tr, table tbody tr',
  ).length

  return {
    bookshelfRows,
    titleIds: [...titleIds],
    refs: [...refs.values()],
  }
}
