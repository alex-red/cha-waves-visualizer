import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function ready(page: Page) {
  await expect(page.getByTestId('solver-status')).not.toContainText('Calculating', { timeout: 15000 })
  await expect(page.getByTestId('probe-value')).not.toContainText('—')
}

async function expectA11yClean(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const violations = results.violations.flatMap(({ id, impact, nodes }) => nodes.map(({ target, failureSummary }) => ({
    id,
    impact,
    target,
    summary: failureSummary?.split('\n').find(line => line.includes('Element has'))?.trim(),
  })))

  expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
}

test('primary workspace controls expose names and the plan has an accessible description', async ({ page }) => {
  await page.goto('/')
  await ready(page)

  await expect(page.getByRole('main')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled()
  const importButton = page.locator('button.export-button[aria-label="Import a project JSON file"]')
  await expect(importButton).toBeVisible()
  await expect(importButton).toHaveAccessibleName('Import a project JSON file')
  await expect(page.getByRole('button', { name: 'Method', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Layers', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Select an interior wall', exact: true })).toBeVisible()
  await expect(page.getByLabel('Interactive apartment plan')).toBeVisible()

  // These labeled controls cover both a labeled numeric input and the primary mode switch.
  await page.getByTestId('wall-select').click()
  await expect(page.getByRole('spinbutton', { name: 'Start X', exact: true })).toBeVisible()
  await expect(page.getByTestId('mode-acoustics')).toHaveAccessibleName(/Sound/)
  await expect(page.getByTestId('mode-radio')).toHaveAccessibleName(/Wi-Fi/)
})

test('workspace has no WCAG 2.1 A/AA accessibility violations', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await expectA11yClean(page)
})

test('Method dialog closes on Escape and returns keyboard focus to its trigger', async ({ page }) => {
  await page.goto('/')
  await ready(page)

  const trigger = page.getByRole('button', { name: 'Method', exact: true })
  await trigger.focus()
  await page.keyboard.press('Enter')

  const dialog = page.getByRole('dialog', { name: 'Model notes', exact: true })
  await expect(dialog).toBeVisible()
  const close = dialog.getByRole('button', { name: 'Close method notes', exact: true })
  await expect(close).toBeFocused()
  await expectA11yClean(page)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('guided study dialog is named, keyboard-dismissible, and returns focus to its trigger', async ({ page }) => {
  await page.goto('/')
  await ready(page)

  const trigger = page.getByRole('button', { name: 'Guided home study', exact: true })
  await trigger.focus()
  await page.keyboard.press('Enter')

  const dialog = page.getByRole('dialog', { name: 'Test one change at a time.', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Close guided home study', exact: true })).toBeFocused()
  await expectA11yClean(page)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('mobile object picker can select a scene object accessibly', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await ready(page)

  const picker = page.getByRole('combobox', { name: 'Select scene object', exact: true })
  await expect(picker).toBeVisible()
  const options = await picker.locator('option').evaluateAll(items => items.map(option => ({
    value: (option as HTMLOptionElement).value,
    text: (option as HTMLOptionElement).textContent?.trim() ?? '',
  })))
  expect(options.length).toBeGreaterThan(1)
  expect(options.every(option => option.value && option.text)).toBe(true)

  const initialValue = await picker.inputValue()
  const nextOption = options.find(option => option.value !== initialValue)
  expect(nextOption).toBeTruthy()
  await picker.selectOption(nextOption!.value)
  await expect(picker).toHaveValue(nextOption!.value)

  // Selection is reflected in the compact inspector, even while the desktop object list is hidden.
  await expect(page.getByTestId('selected-object-name')).toHaveText(nextOption!.text)
  await expectA11yClean(page)
})
