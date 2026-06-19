(format, changes) => {
  const getFieldMap = (fmt) => {
    if (fmt === 'paperback') {
      return {
        title: ['data[print_book][title]'],
        subtitle: ['data[print_book][subtitle]'],
        description: ['data[print_book][description]'],
        seriesTitle: ['data[print_book][series_title]'],
        seriesNumber: ['data[print_book][series_number]'],
        keywords: (i) => [`data[print_book][keywords][${i}]`],
      }
    }
    if (fmt === 'hardcover') {
      return {
        title: ['data[hardcover_book][title]'],
        subtitle: ['data[hardcover_book][subtitle]'],
        description: ['data[hardcover_book][description]'],
        seriesTitle: ['data[series_title]'],
        seriesNumber: ['data[series_number]'],
        keywords: (i) => [`data[hardcover_book][keywords][${i}]`],
      }
    }
    return {
      title: ['data[title]'],
      subtitle: ['data[subtitle]'],
      description: ['data[description]'],
      seriesTitle: ['data[series_title]'],
      seriesNumber: ['data[series_number]'],
      keywords: (i) => [`data[keywords][${i}]`],
    }
  }

  const dispatchInput = (el) => {
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  const setByNames = (names, value) => {
    for (const name of names) {
      const el = document.querySelector(
        `input[name="${name}"], textarea[name="${name}"]`,
      )
      if (el) {
        el.value = value
        dispatchInput(el)
        return true
      }
    }
    return false
  }

  const setVisibleByIds = (ids, value) => {
    for (const id of ids) {
      const el = document.getElementById(id)
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        el.value = value
        dispatchInput(el)
        return true
      }
    }
    return false
  }

  const setTitle = (names, ids, value) =>
    setByNames(names, value) || setVisibleByIds(ids, value)

  const fields = getFieldMap(format)
  const filled = []
  const skipped = []

  if (changes.title !== undefined) {
    const ok = setTitle(
      fields.title,
      format === 'paperback'
        ? ['data-print-book-title']
        : format === 'hardcover'
          ? ['data-hardcover-book-title']
          : ['data-title'],
      changes.title,
    )
    if (ok) filled.push('title')
    else skipped.push('title')
  }

  if (changes.subtitle !== undefined) {
    const ok = setTitle(
      fields.subtitle,
      format === 'paperback'
        ? ['data-print-book-subtitle']
        : format === 'hardcover'
          ? ['data-hardcover-book-subtitle']
          : ['data-subtitle'],
      changes.subtitle,
    )
    if (ok) filled.push('subtitle')
    else skipped.push('subtitle')
  }

  if (changes.seriesTitle !== undefined) {
    const ok =
      setByNames(fields.seriesTitle, changes.seriesTitle) ||
      setVisibleByIds(['data-print-book-series-title', 'data-series-title'], changes.seriesTitle)
    if (ok) filled.push('seriesTitle')
    else skipped.push('seriesTitle')
  }

  if (changes.seriesNumber !== undefined) {
    const ok =
      setByNames(fields.seriesNumber, changes.seriesNumber) ||
      setVisibleByIds(['data-print-book-series-number', 'data-series-number'], changes.seriesNumber)
    if (ok) filled.push('seriesNumber')
    else skipped.push('seriesNumber')
  }

  if (changes.keywords !== undefined) {
    let any = false
    for (let i = 0; i < 7; i++) {
      const kw = changes.keywords[i] ?? ''
      const names = fields.keywords(i)
      const ids =
        format === 'paperback'
          ? [`data-print-book-keywords-${i}`]
          : format === 'hardcover'
            ? [`data-hardcover-book-keywords-${i}`]
            : [`data-keywords-${i}`]
      if (setByNames(names, kw) || setVisibleByIds(ids, kw)) any = true
    }
    if (any) filled.push('keywords')
    else skipped.push('keywords')
  }

  if (changes.descriptionHtml !== undefined) {
    const html = changes.descriptionHtml
    let ok = false

    const syncHiddenDescription = () => {
      for (const name of fields.description) {
        const el = document.querySelector(`input[name="${name}"], textarea[name="${name}"]`)
        if (el) {
          el.value = html
          dispatchInput(el)
          return true
        }
      }
      return false
    }

    const setViaCke = () => {
      const CK = window.CKEDITOR
      if (!CK?.instances) return false
      const keys = Object.keys(CK.instances)
      for (const key of keys) {
        const inst = CK.instances[key]
        if (!inst?.setData) continue
        const el = inst.element?.$ 
        const name = el?.getAttribute?.('name') || el?.name || ''
        const isDescription =
          fields.description.some((n) => name === n) ||
          /description/i.test(key) ||
          /description/i.test(name)
        if (isDescription || keys.length === 1) {
          inst.setData(html, {
            callback: () => {
              syncHiddenDescription()
              inst.updateElement()
            },
          })
          inst.updateElement()
          return true
        }
      }
      const first = CK.instances[keys[0]]
      if (first?.setData) {
        first.setData(html, { callback: () => first.updateElement() })
        first.updateElement()
        return true
      }
      return false
    }

    ok = setViaCke() || syncHiddenDescription()

    if (!ok) {
      const iframe = document.querySelector('iframe[id*="description"], iframe.cke_wysiwyg_frame')
      if (iframe?.contentDocument?.body) {
        iframe.contentDocument.body.innerHTML = html
        ok = syncHiddenDescription() || true
      }
    }

    const editable = document.querySelector('.cke_editable[contenteditable="true"], [contenteditable="true"]')
    if (editable && !ok) {
      editable.innerHTML = html
      editable.dispatchEvent(new Event('input', { bubbles: true }))
      ok = syncHiddenDescription() || true
    }

    if (ok) filled.push('description')
    else skipped.push('description')
  }

  const authorPrefix =
    format === 'paperback'
      ? 'print_book'
      : format === 'hardcover'
        ? 'hardcover_book'
        : null

  if (changes.primaryAuthor) {
    const firstNames = authorPrefix
      ? [`data[${authorPrefix}][primary_author][first_name]`, 'data[primary_author][first_name]']
      : ['data[primary_author][first_name]']
    const lastNames = authorPrefix
      ? [`data[${authorPrefix}][primary_author][last_name]`, 'data[primary_author][last_name]']
      : ['data[primary_author][last_name]']
    let any = false
    if (changes.primaryAuthor.firstName !== undefined) {
      if (
        setVisibleByIds(
          [
            'data-print-book-primary-author-first-name',
            'data-primary-author-first-name',
            'data-hardcover-book-primary-author-first-name',
          ],
          changes.primaryAuthor.firstName,
        ) ||
        setByNames(firstNames, changes.primaryAuthor.firstName)
      ) {
        any = true
      }
    }
    if (changes.primaryAuthor.lastName !== undefined) {
      if (
        setVisibleByIds(
          [
            'data-print-book-primary-author-last-name',
            'data-primary-author-last-name',
            'data-hardcover-book-primary-author-last-name',
          ],
          changes.primaryAuthor.lastName,
        ) ||
        setByNames(lastNames, changes.primaryAuthor.lastName)
      ) {
        any = true
      }
    }
    if (any) filled.push('primaryAuthor')
    else skipped.push('primaryAuthor')
  }

  if (changes.language !== undefined) {
    const selectIds =
      format === 'paperback'
        ? ['data-print-book-language-native']
        : format === 'hardcover'
          ? ['data-hardcover-book-language-native']
          : ['data-language-native']
    let ok = false
    for (const id of selectIds) {
      const el = document.getElementById(id)
      if (el && el.tagName === 'SELECT') {
        for (const opt of el.options) {
          const lang = String(changes.language).toLowerCase()
          if (
            opt.text.trim().toLowerCase() === lang ||
            opt.value.toLowerCase() === lang ||
            opt.text.trim() === changes.language ||
            opt.value === changes.language
          ) {
            el.value = opt.value
            dispatchInput(el)
            ok = true
            break
          }
        }
      }
    }
    if (ok) filled.push('language')
    else skipped.push('language')
  }

  if (changes.publisherLabel !== undefined) {
    const ok =
      setByNames(['data[publisher_label]'], changes.publisherLabel) ||
      setVisibleByIds(['data-publisher-label'], changes.publisherLabel)
    if (ok) filled.push('publisherLabel')
    else skipped.push('publisherLabel')
  }

  if (changes.editionNumber !== undefined) {
    const names =
      format === 'paperback'
        ? ['data[print_book][edition_number]']
        : format === 'hardcover'
          ? ['data[hardcover_book][edition_number]']
          : ['data[edition_number]']
    const ok =
      setByNames(names, changes.editionNumber) ||
      setVisibleByIds(
        ['data-print-book-edition-number', 'data-edition-number', 'data-hardcover-book-edition-number'],
        changes.editionNumber,
      )
    if (ok) filled.push('editionNumber')
    else skipped.push('editionNumber')
  }

  const setBoolHidden = (names, value) => {
    for (const name of names) {
      const el = document.querySelector(`input[name="${name}"]`)
      if (el) {
        el.value = value ? 'true' : 'false'
        dispatchInput(el)
        return true
      }
    }
    return false
  }

  if (changes.isPublicDomain !== undefined) {
    const names =
      format === 'paperback'
        ? ['data[print_book][is_public_domain]']
        : format === 'hardcover'
          ? ['data[hardcover_book][is_public_domain]']
          : ['data[is_public_domain]']
    if (setBoolHidden(names, changes.isPublicDomain)) filled.push('isPublicDomain')
    else skipped.push('isPublicDomain')
  }

  if (changes.isAdultContent !== undefined) {
    const radioName =
      format === 'paperback'
        ? 'data[print_book][is_adult_content]-radio'
        : format === 'hardcover'
          ? 'data[hardcover_book][is_adult_content]-radio'
          : 'data[is_adult_content]-radio'
    const radioVal = changes.isAdultContent ? 'true' : 'false'
    const radio = document.querySelector(
      `input[name="${radioName}"][value="${radioVal}"]`,
    )
    if (radio) {
      radio.checked = true
      dispatchInput(radio)
    }
    const names =
      format === 'paperback'
        ? ['data[print_book][is_adult_content]']
        : format === 'hardcover'
          ? ['data[hardcover_book][is_adult_content]']
          : ['data[is_adult_content]']
    if (setBoolHidden(names, changes.isAdultContent)) filled.push('isAdultContent')
    else skipped.push('isAdultContent')
  }

  if (changes.largePrint !== undefined && format === 'paperback') {
    if (setBoolHidden(['data[print_book][large_print]'], changes.largePrint)) {
      filled.push('largePrint')
    } else skipped.push('largePrint')
  }

  return { filled, skipped }
}
