import { KdpAuthError, KdpClientError } from './kdpClient.js'
import {
  type KdpCategorySpec,
  updateCategoriesOnPage,
} from './kdpCategories.js'
import { completePrintContentOnPage, uploadBookContentOnPage, type KdpPrintContentSettings } from './kdpContentUpdate.js'
import {
  createTitleOnPage,
  openSetupStep,
  resolveTitleIdAfterSave,
  setReleaseNow,
} from './kdpCreateTitle.js'
import { withKdpPage } from './kdpMetadata.js'
import {
  type KdpMetadataChanges,
  updateBookMetadataOnPage,
} from './kdpMetadataUpdate.js'
import {
  type KdpPricingChanges,
  updateBookPricingOnPage,
  waitForPricingPageReady,
} from './kdpPricingUpdate.js'
import type { KdpBookFormat } from './metadataStore.js'
import {
  clickPublish,
  clickSaveAsDraft,
  clickSaveAndContinue,
  collectPageErrors,
  titleIdFromUrl,
} from './kdpWizard.js'

export type PublishContentSpec = {
  interiorPath?: string
  coverPath?: string
  printSettings?: KdpPrintContentSettings
}

export type PublishBookRequest = {
  format: KdpBookFormat
  /** Existing title; omit when create=true */
  titleId?: string
  /** Start a new draft on /en_US/create */
  create?: boolean
  dryRun?: boolean
  /** Click Publish at end — only when dryRun=false and user explicitly opts in */
  publish?: boolean
  details?: KdpMetadataChanges
  categories?: KdpCategorySpec[]
  content?: PublishContentSpec
  pricing?: KdpPricingChanges
}

export type PublishStepResult = {
  step: string
  success: boolean
  detail?: unknown
  errors: string[]
}

export type PublishBookResult = {
  titleId: string | null
  format: KdpBookFormat
  dryRun: boolean
  published: boolean
  steps: PublishStepResult[]
  errors: string[]
}

function hasMetadata(changes?: KdpMetadataChanges): boolean {
  if (!changes) return false
  return Object.keys(changes).length > 0
}

export async function publishBook(
  request: PublishBookRequest,
): Promise<PublishBookResult> {
  const format = request.format
  const dryRun = request.dryRun ?? false
  const shouldCreate = request.create === true || (!request.titleId && request.create !== false)

  if (!shouldCreate && !request.titleId?.trim()) {
    throw new KdpClientError('titleId is required unless create=true.')
  }
  if (request.publish && dryRun) {
    throw new KdpClientError('Cannot publish with dryRun=true.')
  }

  return withKdpPage(async (page) => {
    const steps: PublishStepResult[] = []
    const errors: string[] = []
    let titleId = request.titleId?.trim() || 'new'
    let onDetailsPage = false

    if (shouldCreate) {
      titleId = await createTitleOnPage(page, format)
      onDetailsPage = true
      steps.push({
        step: 'create',
        success: true,
        detail: { titleId, url: page.url() },
        errors: [],
      })
    } else if (titleId) {
      await openSetupStep(page, format, titleId, 'details')
      onDetailsPage = true
    }

    if (hasMetadata(request.details)) {
      try {
        const result = await updateBookMetadataOnPage(
          page,
          titleId,
          format,
          request.details!,
          true,
          { skipOpen: onDetailsPage },
        )
        onDetailsPage = true
        steps.push({
          step: 'details',
          success: result.filled.length > 0,
          detail: { filled: result.filled, skipped: result.skipped },
          errors: result.errors,
        })
        if (result.errors.length) errors.push(...result.errors)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Details step failed.'
        steps.push({ step: 'details', success: false, errors: [msg] })
        errors.push(msg)
        if (e instanceof KdpAuthError) throw e
      }
    }

    if (request.categories?.length) {
      try {
        const result = await updateCategoriesOnPage(
          page,
          titleId,
          format,
          request.categories,
          { isAdultContent: request.details?.isAdultContent ?? false },
        )
        onDetailsPage = true
        steps.push({
          step: 'categories',
          success: result.browseNodeIds.length > 0 || result.applied > 0,
          detail: { browseNodeIds: result.browseNodeIds, applied: result.applied },
          errors: result.errors.filter((e) => !/Add at least one new category/i.test(e)),
        })
        if (result.errors.length) errors.push(...result.errors)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Categories step failed.'
        steps.push({ step: 'categories', success: false, errors: [msg] })
        errors.push(msg)
      }
    }

    if (request.publish && !dryRun) {
      await setReleaseNow(page)
    } else if (!dryRun) {
      await setReleaseNow(page)
    }

    if (!dryRun && (hasMetadata(request.details) || request.categories?.length)) {
      try {
        if (titleId === 'new') {
          await clickSaveAsDraft(page)
        } else {
          await clickSaveAndContinue(page)
        }
        await page.waitForTimeout(3000)
        let resolved: string | null = null
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            resolved = await resolveTitleIdAfterSave(page, format)
            break
          } catch {
            await page.waitForTimeout(2000)
          }
        }
        if (resolved) titleId = resolved
        const fromUrl = titleIdFromUrl(page.url())
        if (fromUrl) titleId = fromUrl
        onDetailsPage = false
        const pageErrors = await collectPageErrors(page)
        const gotId = titleIdFromUrl(page.url())
        if (gotId) titleId = gotId
        const blocking = pageErrors.filter(
          (e) => !/language that was entered|release date is either in the past/i.test(e),
        )
        if (blocking.length > 0 && !gotId) {
          steps.push({
            step: 'save-details',
            success: false,
            detail: { titleId },
            errors: blocking,
          })
          errors.push(...blocking)
        } else {
          steps.push({
            step: 'save-details',
            success: true,
            detail: { titleId },
            errors: [],
          })
        }
      } catch (e) {
        const pageErrors = await collectPageErrors(page)
        const msg = e instanceof Error ? e.message : 'Save details failed.'
        steps.push({
          step: 'save-details',
          success: false,
          errors: pageErrors.length ? pageErrors : [msg],
        })
        errors.push(...(pageErrors.length ? pageErrors : [msg]))
      }
    } else if (dryRun && onDetailsPage) {
      steps.push({
        step: 'save-details',
        success: true,
        detail: { skipped: true, reason: 'dryRun' },
        errors: [],
      })
    }

    const content = request.content
    const detailsSaved = steps.find((s) => s.step === 'save-details')?.success !== false
    if ((content?.interiorPath || content?.coverPath) && detailsSaved && !dryRun) {
      try {
        const result = await completePrintContentOnPage(page, titleId, format, {
          interiorPath: content.interiorPath || '',
          coverPath: content.coverPath || '',
          printSettings: content.printSettings,
        })
        const contentOk =
          (!content.interiorPath || result.interiorUploaded) &&
          (!content.coverPath || result.coverUploaded)
        steps.push({
          step: 'content',
          success: contentOk,
          detail: {
            isbn: result.isbn,
            interiorUploaded: result.interiorUploaded,
            coverUploaded: result.coverUploaded,
          },
          errors: result.errors,
        })
        if (content.interiorPath && !result.interiorUploaded) {
          errors.push('Interior upload could not be verified.')
        }
        if (content.coverPath && !result.coverUploaded) {
          errors.push('Cover upload could not be verified.')
        }
        if (result.errors.length) errors.push(...result.errors)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Content step failed.'
        steps.push({ step: 'content', success: false, errors: [msg] })
        errors.push(msg)
      }
    } else if ((content?.interiorPath || content?.coverPath) && dryRun) {
      steps.push({ step: 'content', success: true, detail: { dryRun: true }, errors: [] })
    }

    const contentStep = steps.find((s) => s.step === 'content')
    const contentSaved =
      !request.content?.interiorPath && !request.content?.coverPath
        ? true
        : contentStep?.success === true

    if (request.pricing && detailsSaved && contentSaved && !dryRun) {
      const pricingReady = await waitForPricingPageReady(page, format, titleId, {
        timeoutMs: 600_000,
      })
      if (!pricingReady) {
        steps.push({
          step: 'pricing',
          success: false,
          errors: [
            'KDP pricing page did not become available — manuscript/cover may still be processing.',
          ],
        })
        errors.push(
          'KDP pricing page did not become available — manuscript/cover may still be processing.',
        )
      } else {
        try {
          const result = await updateBookPricingOnPage(
            page,
            titleId,
            format,
            request.pricing,
            false,
            { skipOpen: true },
          )
          steps.push({
            step: 'pricing',
            success: result.saved,
            detail: { filled: result.filled, saved: result.saved },
            errors: result.errors,
          })
          if (result.errors.length) errors.push(...result.errors)
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Pricing step failed.'
          steps.push({ step: 'pricing', success: false, errors: [msg] })
          errors.push(msg)
        }
      }
    } else if (request.pricing && detailsSaved && dryRun) {
      if (titleId !== 'new') {
        await openSetupStep(page, format, titleId, 'pricing')
      }
      try {
        const result = await updateBookPricingOnPage(
          page,
          titleId,
          format,
          request.pricing,
          true,
          { skipOpen: titleId === 'new' },
        )
        steps.push({
          step: 'pricing',
          success: result.filled.length > 0,
          detail: { filled: result.filled, saved: result.saved },
          errors: result.errors,
        })
        if (result.errors.length) errors.push(...result.errors)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Pricing step failed.'
        steps.push({ step: 'pricing', success: false, errors: [msg] })
        errors.push(msg)
      }
    }

    let published = false
    if (request.publish && !dryRun) {
      try {
        const action = await clickPublish(page)
        published = true
        steps.push({ step: 'publish', success: true, detail: { action }, errors: [] })
      } catch (e) {
        const pageErrors = await collectPageErrors(page)
        const msg = e instanceof Error ? e.message : 'Publish failed.'
        steps.push({
          step: 'publish',
          success: false,
          errors: pageErrors.length ? pageErrors : [msg],
        })
        errors.push(...(pageErrors.length ? pageErrors : [msg]))
      }
    }

    let resolvedTitleId: string | null = titleId === 'new' ? null : titleId
    if (titleId === 'new') {
      resolvedTitleId = titleIdFromUrl(page.url())
    }

    return {
      titleId: resolvedTitleId === 'new' ? null : resolvedTitleId,
      format,
      dryRun,
      published,
      steps,
      errors,
    }
  })
}

export async function createTitle(format: KdpBookFormat): Promise<{ titleId: string; url: string }> {
  return withKdpPage(async (page) => {
    const titleId = await createTitleOnPage(page, format)
    return { titleId, url: page.url() }
  })
}

export async function updateCategories(
  titleId: string,
  format: KdpBookFormat,
  categories: KdpCategorySpec[],
  options: { isAdultContent?: boolean } = {},
) {
  return withKdpPage(async (page) =>
    updateCategoriesOnPage(page, titleId, format, categories, options),
  )
}
