() => {
  const readInput = (id, names) => {
    if (id) {
      const byId = document.getElementById(id)
      if (byId && byId.value) return byId.value.trim()
    }
    for (const name of names) {
      const el = document.querySelector(
        `input[name="${name}"], textarea[name="${name}"]`,
      )
      if (el && el.value) return el.value.trim()
    }
    return ''
  }

  const readSelect = (id, names) => {
    if (id) {
      const byId = document.getElementById(id)
      if (byId && byId.tagName === 'SELECT') {
        const text = byId.options[byId.selectedIndex]?.text?.trim()
        if (text && text !== 'Select one' && text !== 'Select') return text
      }
    }
    for (const name of names) {
      const el = document.querySelector(`select[name="${name}"]`)
      if (el) {
        const text = el.options[el.selectedIndex]?.text?.trim()
        if (text && text !== 'Select one' && text !== 'Select') return text
      }
    }
    return ''
  }

  const readHidden = (names) => {
    for (const name of names) {
      const el = document.querySelector(`input[name="${name}"]`)
      if (el && el.value) return el.value.trim()
    }
    return ''
  }

  const readBool = (names) => readHidden(names) === 'true'

  const title =
    readInput('data-print-book-title', ['data[print_book][title]']) ||
    readInput('data-title', ['data[title]']) ||
    readInput('data-hardcover-book-title', ['data[hardcover_book][title]'])

  const subtitle =
    readInput('data-print-book-subtitle', ['data[print_book][subtitle]']) ||
    readInput('data-subtitle', ['data[subtitle]']) ||
    readInput('data-hardcover-book-subtitle', ['data[hardcover_book][subtitle]'])

  const description =
    readHidden([
      'data[print_book][description]',
      'data[description]',
      'data[hardcover_book][description]',
    ]) ||
    readInput('', [
      'data[print_book][description]',
      'data[description]',
      'data[hardcover_book][description]',
    ])

  const language =
    readSelect('data-print-book-language-native', ['data[print_book][language]']) ||
    readSelect('data-language-native', ['data[language]']) ||
    readSelect('data-hardcover-book-language-native', ['data[hardcover_book][language]'])

  const primaryAuthorFirstName =
    readInput('data-print-book-primary-author-first-name', [
      'data[print_book][primary_author][first_name]',
    ]) ||
    readInput('data-primary-author-first-name', ['data[primary_author][first_name]']) ||
    readInput('data-hardcover-book-primary-author-first-name', [
      'data[hardcover_book][primary_author][first_name]',
    ])

  const primaryAuthorLastName =
    readInput('data-print-book-primary-author-last-name', [
      'data[print_book][primary_author][last_name]',
    ]) ||
    readInput('data-primary-author-last-name', ['data[primary_author][last_name]']) ||
    readInput('data-hardcover-book-primary-author-last-name', [
      'data[hardcover_book][primary_author][last_name]',
    ])

  const publisherLabel = readInput('data-publisher-label', ['data[publisher_label]'])

  const editionNumber =
    readInput('data-print-book-edition-number', ['data[print_book][edition_number]']) ||
    readInput('data-edition-number', ['data[edition_number]']) ||
    readInput('data-hardcover-book-edition-number', ['data[hardcover_book][edition_number]'])

  const seriesTitle =
    readInput('data-print-book-series-title', ['data[print_book][series_title]']) ||
    readInput('data-series-title', ['data[series_title]'])

  const seriesNumber =
    readInput('data-print-book-series-number', ['data[print_book][series_number]']) ||
    readInput('data-series-number', ['data[series_number]'])

  const homeMarketplace =
    readSelect('', [
      'data[print_book][home_marketplace]',
      'data[home_marketplace]',
      'data[digital][home_marketplace]',
      'data[hardcover_book][home_marketplace]',
    ]) || readHidden(['data[print_book][home_marketplace]', 'data[home_marketplace]'])

  const readingInterestAgeMin =
    readSelect('data-print-book-reading-interest-age-start-input-native', [
      'data[print_book][reading_interest_age][min]',
      'data[reading_interest_age][min]',
    ]) ||
    readSelect('data-reading-interest-age-start-input-native', [
      'data[reading_interest_age][min]',
    ])

  const readingInterestAgeMax =
    readSelect('data-print-book-reading-interest-age-end-input-native', [
      'data[print_book][reading_interest_age][max]',
      'data[reading_interest_age][max]',
    ]) ||
    readSelect('data-reading-interest-age-end-input-native', [
      'data[reading_interest_age][max]',
    ])

  const publishingStatus = readHidden([
    'data[publishing_status_value]',
    'data[print_book][publishing_status]',
  ])

  const keywords = []
  for (let i = 0; i < 7; i++) {
    const value =
      readInput(`data-print-book-keywords-${i}`, [
        `data[print_book][keywords][${i}]`,
      ]) ||
      readInput(`data-keywords-${i}`, [`data[keywords][${i}]`]) ||
      readInput(`data-hardcover-book-keywords-${i}`, [
        `data[hardcover_book][keywords][${i}]`,
      ])
    if (value) keywords.push(value)
  }

  const contributors = []
  for (let i = 0; i < 10; i++) {
    const role =
      readSelect(`data-print-book-contributors-${i}-role-native`, [
        `data[print_book][contributors][${i}][role]`,
      ]) ||
      readSelect(`data-contributors-${i}-role-native`, [
        `data[contributors][${i}][role]`,
      ])
    const firstName =
      readInput(`data-print-book-contributors-${i}-first-name`, [
        `data[print_book][contributors][${i}][first_name]`,
      ]) ||
      readInput(`data-contributors-${i}-first-name`, [
        `data[contributors][${i}][first_name]`,
      ])
    const lastName =
      readInput(`data-print-book-contributors-${i}-last-name`, [
        `data[print_book][contributors][${i}][last_name]`,
      ]) ||
      readInput(`data-contributors-${i}-last-name`, [
        `data[contributors][${i}][last_name]`,
      ])
    if (!role && !firstName && !lastName) {
      if (i > 0) break
      continue
    }
    if (firstName || lastName) {
      contributors.push({ role: role || 'Contributor', firstName, lastName })
    }
  }

  const categories = []
  const seenCategories = new Set()
  for (const el of document.querySelectorAll('span, a')) {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
    if (
      (text.startsWith('Books ›') || text.startsWith('Kindle Books ›')) &&
      text.split('›').length >= 3 &&
      text.length < 220
    ) {
      const cleaned = text.replace(/\s*↗.*$/, '').trim()
      if (cleaned && !seenCategories.has(cleaned)) {
        seenCategories.add(cleaned)
        categories.push(cleaned)
      }
    }
  }

  return {
    title,
    subtitle,
    description,
    language,
    primaryAuthorFirstName,
    primaryAuthorLastName,
    publisherLabel,
    editionNumber,
    seriesTitle,
    seriesNumber,
    homeMarketplace,
    readingInterestAgeMin,
    readingInterestAgeMax,
    publishingStatus,
    isPublicDomain: readBool([
      'data[print_book][is_public_domain]',
      'data[is_public_domain]',
      'data[hardcover_book][is_public_domain]',
    ]),
    isAdultContent: readBool([
      'data[print_book][is_adult_content]',
      'data[is_adult_content]',
      'data[hardcover_book][is_adult_content]',
    ]),
    largePrint: readBool(['data[print_book][large_print]']),
    keywords,
    categories,
    contributors,
  }
}
