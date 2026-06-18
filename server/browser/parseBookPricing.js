() => {
  const prices = {}
  for (const el of document.querySelectorAll('input[name^="price-input-"]')) {
    if (el.value) {
      prices[el.name.replace('price-input-', '').toUpperCase()] = el.value
    }
  }

  const usPaperbackPrice =
    document.getElementById('price-input-usd')?.value ||
    document.querySelector('input[name="price-input-usd"]')?.value
  if (usPaperbackPrice) prices.USD = usPaperbackPrice

  for (const el of document.querySelectorAll(
    'input[name*="[price_vat_inclusive]"]',
  )) {
    const match = el.name.match(/\[amazon\]\[([A-Z]{2})\]/)
    if (match && el.value) {
      prices[match[1]] = el.value
    }
  }

  if (!prices.USD) {
    const usKindlePrice = document.querySelector(
      'input[name="data[digital][channels][amazon][US][price_vat_inclusive]"]',
    )?.value
    if (usKindlePrice) prices.USD = usKindlePrice
  }

  const asinMatch = document.body.innerText.match(/ASIN:\s*(B0[A-Z0-9]+)/i)
  const asin = asinMatch ? asinMatch[1] : ''

  const territory =
    document.querySelector('input[name="territory-selection-type"]:checked')
      ?.value ||
    (document.querySelector('input[name="data[digital][worldwide_rights]"]')
      ?.value === 'true'
      ? 'worldwide'
      : '')

  const royaltyPlan =
    document.querySelector('input[name="data[digital][royalty_plan]"]:checked')
      ?.value ||
    readHidden('data[digital][royalty_plan]') ||
    ''

  function readHidden(name) {
    return document.querySelector(`input[name="${name}"]`)?.value?.trim() || ''
  }

  const fileSizeBytes = readHidden('data[digital][filesize_bytes]')
  const fileSizeKb = fileSizeBytes
    ? String(Math.round(Number(fileSizeBytes) / 1024))
    : ''

  return {
    asin,
    listPriceUsd: prices.USD || document.getElementById('price-input-usd')?.value || '',
    prices,
    territory,
    royaltyPlan,
    fileSizeKb,
    kdpSelect:
      readHidden('data[digital][kdp_select_enrolled]') === 'true' ||
      readHidden('data[is_select]') === 'true',
  }
}
