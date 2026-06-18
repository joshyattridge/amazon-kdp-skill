(changes) => {
  const filled = []
  const skipped = []

  const dispatch = (el) => {
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  const clickRadio = (name, value) => {
    const el = document.querySelector(`input[name="${name}"][value="${value}"]`)
    if (el) {
      el.checked = true
      dispatch(el)
      return true
    }
    return false
  }

  const setHidden = (name, value) => {
    const el = document.querySelector(`input[name="${name}"]`)
    if (el) {
      el.value = String(value)
      dispatch(el)
      return true
    }
    return false
  }

  if (changes.trimWidthIn !== undefined && changes.trimHeightIn !== undefined) {
    const w = Math.round(Number(changes.trimWidthIn) * 100)
    const h = Math.round(Number(changes.trimHeightIn) * 100)
    const label = `${changes.trimWidthIn} x ${changes.trimHeightIn}`
    let ok =
      setHidden('data[print_book][trim_size][width]', w) &&
      setHidden('data[print_book][trim_size][height]', h)
    for (const el of document.querySelectorAll('button, a, label, span')) {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
      if (text.includes(label) || text === `${changes.trimWidthIn}" x ${changes.trimHeightIn}"`) {
        el.click()
        ok = true
        break
      }
    }
    if (ok) filled.push('trimSize')
    else skipped.push('trimSize')
  }

  if (changes.inkAndPaper !== undefined) {
    if (clickRadio('data[print_book][ink_and_paper]', changes.inkAndPaper)) {
      filled.push('inkAndPaper')
    } else skipped.push('inkAndPaper')
  }

  if (changes.interiorHasBleed !== undefined) {
    if (
      clickRadio(
        'data[print_book][interior_has_bleed]',
        changes.interiorHasBleed ? 'true' : 'false',
      )
    ) {
      filled.push('interiorHasBleed')
    } else skipped.push('interiorHasBleed')
  }

  if (changes.coverFinish !== undefined) {
    if (clickRadio('data[print_book][cover_finish]', changes.coverFinish)) {
      filled.push('coverFinish')
    } else skipped.push('coverFinish')
  }

  if (changes.hasPublisherBarcode !== undefined) {
    const val = changes.hasPublisherBarcode ? 'true' : 'false'
    setHidden('data[print_book][has_publisher_barcode]', val)
    const check = document.getElementById('data-print-book-has-publisher-barcode')
    if (check) {
      check.checked = changes.hasPublisherBarcode
      dispatch(check)
    }
    filled.push('hasPublisherBarcode')
  }

  const setSelectById = (id, value) => {
    const el = document.getElementById(id)
    if (!el) return false
    el.value = value
    dispatch(el)
    return true
  }

  if (changes.aiTextAmount !== undefined) {
    setSelectById('generative-ai-questionnaire-text', changes.aiTextAmount)
    setHidden(
      'data[print_book][generative_ai_questionnaire][text][amount_and_editing]',
      changes.aiTextAmount,
    )
    filled.push('aiTextAmount')
  }
  if (changes.aiTextTool !== undefined) {
    setHidden(
      'data[print_book][generative_ai_questionnaire][text][tools][0]',
      changes.aiTextTool,
    )
    filled.push('aiTextTool')
  }
  if (changes.aiImagesAmount !== undefined) {
    setSelectById('generative-ai-questionnaire-images', changes.aiImagesAmount)
    setHidden(
      'data[print_book][generative_ai_questionnaire][images][amount_and_editing]',
      changes.aiImagesAmount,
    )
    filled.push('aiImagesAmount')
  }
  if (changes.aiImagesTool !== undefined) {
    setHidden(
      'data[print_book][generative_ai_questionnaire][images][tools][0]',
      changes.aiImagesTool,
    )
    filled.push('aiImagesTool')
  }
  if (changes.aiTranslationsAmount !== undefined) {
    setSelectById('generative-ai-questionnaire-translations', changes.aiTranslationsAmount)
    setHidden(
      'data[print_book][generative_ai_questionnaire][translations][amount_and_editing]',
      changes.aiTranslationsAmount,
    )
    filled.push('aiTranslationsAmount')
  }
  if (changes.containsAiContent !== undefined) {
    setHidden(
      'data[print_book][generative_ai_questionnaire][contains_ai_content]',
      changes.containsAiContent ? 'YES' : 'NO',
    )
    filled.push('containsAiContent')
  }

  if (changes.assignFreeIsbn) {
    filled.push('assignFreeIsbn')
  }

  return { filled, skipped }
}
