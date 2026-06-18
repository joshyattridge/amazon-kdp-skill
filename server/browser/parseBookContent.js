() => {
  const readHidden = (id, names) => {
    if (id) {
      const byId = document.getElementById(id)
      if (byId && byId.value) return byId.value.trim()
    }
    for (const name of names) {
      const el = document.querySelector(`input[name="${name}"]`)
      if (el && el.value) return el.value.trim()
    }
    return ''
  }

  const trimWidth = readHidden('', ['data[print_book][trim_size][width]'])
  const trimHeight = readHidden('', ['data[print_book][trim_size][height]'])
  const trimSize =
    trimWidth && trimHeight ? `${trimWidth}x${trimHeight}` : trimWidth || trimHeight

  const inkEl = document.querySelector(
    'input[name="data[print_book][ink_and_paper]"]:checked',
  )
  const inkAndPaper =
    inkEl?.value ||
    readHidden('', ['data[print_book][ink_and_paper]']) ||
    readHidden('', ['data[hardcover_book][ink_and_paper]'])

  const INK_LABELS = {
    BW_CREAM: 'Black & white interior, cream paper',
    BW_WHITE: 'Black & white interior, white paper',
    BW_GROUNDWOOD: 'Black & white interior, groundwood paper',
    COLOR_WHITE: 'Premium color interior, white paper',
    COLOR_COLOR: 'Premium color interior, color paper',
  }

  return {
    isbn:
      readHidden('print-isbn-free-isbn', ['data[view][free_isbn]']) ||
      readHidden('', ['data[print_book][owner_isbn]', 'data[print_book][csp_isbn]']),
    imprint:
      readHidden('print-isbn-free-imprint', ['data[view][free_imprint]']) ||
      readHidden('', [
        'data[print_book][imprint]',
        'data[print_book][csp_imprint]',
        'data[print_book][owner_imprint]',
      ]),
    trimSize,
    inkAndPaper: INK_LABELS[inkAndPaper] || inkAndPaper,
    interiorFileName: readHidden('', [
      'data[print_book][publisher_interior][source_file_name]',
      'data[hardcover_book][publisher_interior][source_file_name]',
    ]),
    coverFileName: readHidden('', [
      'data[print_book][publisher_cover][source_file_name]',
      'data[hardcover_book][publisher_cover][source_file_name]',
    ]),
    pageCount: readHidden('', [
      'data[print_book][page_count]',
      'data[hardcover_book][page_count]',
    ]),
    manuscriptStatus: readHidden('', [
      'data[print_book][publisher_interior][status]',
      'data[hardcover_book][publisher_interior][status]',
    ]),
    coverStatus: readHidden('', [
      'data[print_book][publisher_cover][status]',
      'data[hardcover_book][publisher_cover][status]',
    ]),
  }
}
