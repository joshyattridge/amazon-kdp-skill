(format, changes) => {
  const dispatchInput = (el) => {
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  const setByName = (name, value) => {
    const el = document.querySelector(`input[name="${name}"]`)
    if (el) {
      el.value = value
      dispatchInput(el)
      return true
    }
    return false
  }

  const setPriceById = (currencyCode, value) => {
    const id = `price-input-${currencyCode.toLowerCase()}`
    const el = document.getElementById(id)
    if (el) {
      el.value = value
      dispatchInput(el)
      return true
    }
    return false
  }

  const kindleMarketCodes = {
    USD: 'US',
    US: 'US',
    GBP: 'UK',
    UK: 'UK',
    EUR: 'DE',
    DE: 'DE',
    FR: 'FR',
    ES: 'ES',
    IT: 'IT',
    NL: 'NL',
    JP: 'JP',
    CA: 'CA',
    AU: 'AU',
    IN: 'IN',
    BR: 'BR',
    MX: 'MX',
  }

  const setKindlePrice = (market, value) => {
    const name = `data[digital][channels][amazon][${market}][price_vat_inclusive]`
    const el = document.querySelector(`input[name="${name}"]`)
    if (el) {
      el.value = value
      dispatchInput(el)
      return true
    }
    return false
  }

  const setHidden = (name, value) => {
    const el = document.querySelector(`input[name="${name}"]`)
    if (el) {
      el.value = value
      dispatchInput(el)
      return true
    }
    return false
  }

  const setRadio = (name, value) => {
    const el = document.querySelector(`input[name="${name}"][value="${value}"]`)
    if (el) {
      el.checked = true
      dispatchInput(el)
      return true
    }
    return false
  }

  const filled = []
  const skipped = []

  if (changes.listPriceUsd !== undefined) {
    let ok = setPriceById('usd', changes.listPriceUsd)
    if (!ok && format === 'kindle') {
      ok = setKindlePrice('US', changes.listPriceUsd)
    }
    if (ok) filled.push('listPriceUsd')
    else skipped.push('listPriceUsd')
  }

  if (changes.prices && typeof changes.prices === 'object') {
    let any = false
    for (const [code, value] of Object.entries(changes.prices)) {
      const upper = code.toUpperCase()
      if (setPriceById(code, value)) {
        any = true
        continue
      }
      const market = kindleMarketCodes[upper]
      if (market && setKindlePrice(market, value)) any = true
    }
    if (any) filled.push('prices')
    else skipped.push('prices')
  }

  if (changes.territory !== undefined) {
    const val = changes.territory === 'worldwide' ? 'worldwide' : 'individual'
    if (setRadio('territory-selection-type', val)) filled.push('territory')
    else skipped.push('territory')
  }

  if (changes.royaltyPlan !== undefined && format === 'kindle') {
    const plan = String(changes.royaltyPlan).includes('70') ? '70_PERCENT' : '35_PERCENT'
    let ok =
      setRadio('data[digital][royalty_rate]-radio', plan) ||
      setRadio('data[digital][royalty_plan]', changes.royaltyPlan) ||
      setHidden('data[digital][royalty_rate]', plan) ||
      setHidden('data[digital][royalty_plan]', changes.royaltyPlan)
    if (ok) filled.push('royaltyPlan')
    else skipped.push('royaltyPlan')
  }

  if (changes.kdpSelect !== undefined && format === 'kindle') {
    const val = changes.kdpSelect ? 'true' : 'false'
    const checkbox =
      document.querySelector('input[name="data[is_select]-check"]') ||
      document.querySelector('input[name="data[digital][kdp_select_enrolled]"]')
    if (checkbox) {
      checkbox.checked = changes.kdpSelect
      dispatchInput(checkbox)
      setHidden('data[is_select]', val)
      filled.push('kdpSelect')
    } else if (
      setHidden('data[is_select]', val) ||
      setHidden('data[digital][kdp_select_enrolled]', val)
    ) {
      filled.push('kdpSelect')
    } else {
      skipped.push('kdpSelect')
    }
  }

  return { filled, skipped }
}
