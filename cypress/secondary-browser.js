import path from 'node:path'
import puppeteer from 'puppeteer'

const chatDraftSelector = '[data-testid="chat-draft"]'
const fileInputSelector = '[data-testid="file-input"], .chat-panel__file-input'
const joinRoomButtonSelector =
  '[data-testid="join-room-button"], .home-view__manual-join-row button[type="submit"]'
const manualRoomCodeSelector = '[data-testid="manual-room-code"], #room-code'
const advancedOptionsSelector = '[data-testid="advanced-options"]'
const advancedOptionsToggleSelector =
  '[data-testid="advanced-options-toggle"], .relay-panel__summary'
const relaySwitchSelector = '[data-testid="relay-switch"], .relay-panel__switch'
const relayToggleSelector =
  '[data-testid="relay-toggle"], .relay-panel__switch input[type="checkbox"]'
const sendMessageSelector = '[data-testid="send-message"]'

let browser = null
let page = null

function getPage() {
  if (!page) {
    throw new Error('Secondary browser is not open.')
  }

  return page
}

async function waitForEnabledSelector(currentPage, selector, timeoutMs) {
  await currentPage.waitForFunction(
    (targetSelector) => {
      const element = document.querySelector(targetSelector)

      return element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLButtonElement
        ? !element.disabled
        : false
    },
    {
      timeout: timeoutMs,
    },
    selector
  )
}

async function waitForVisibleSelector(currentPage, selector, timeoutMs) {
  await currentPage.waitForSelector(selector, {
    timeout: timeoutMs,
    visible: true,
  })
}

async function waitForHomeReady(currentPage, timeoutMs) {
  await waitForVisibleSelector(currentPage, manualRoomCodeSelector, timeoutMs)
  await waitForVisibleSelector(currentPage, joinRoomButtonSelector, timeoutMs)
}

async function ensureAdvancedOptionsOpen(currentPage) {
  await waitForVisibleSelector(
    currentPage,
    advancedOptionsToggleSelector,
    20000
  )

  const isOpen = await currentPage.$eval(advancedOptionsSelector, (element) => {
    if (!(element instanceof HTMLDetailsElement)) {
      throw new Error('Advanced options container is not a details element.')
    }

    return element.open
  })

  if (!isOpen) {
    await currentPage.click(advancedOptionsToggleSelector)
  }
}

async function setRelayMode(currentPage, enabled) {
  await ensureAdvancedOptionsOpen(currentPage)
  await waitForVisibleSelector(currentPage, relaySwitchSelector, 20000)

  const isChecked = await currentPage.$eval(relayToggleSelector, (element) => {
    if (!(element instanceof HTMLInputElement)) {
      throw new Error('Relay toggle is not an input.')
    }

    return element.checked
  })

  if (isChecked === enabled) {
    return
  }

  await currentPage.click(relaySwitchSelector)
}

export async function closeSecondaryBrowser() {
  if (page) {
    await page.close()
    page = null
  }

  if (browser) {
    await browser.close()
    browser = null
  }
}

export async function openSecondaryBrowser(payload) {
  await closeSecondaryBrowser()

  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  page = await browser.newPage()
  await page.setViewport({
    width: 1440,
    height: 960,
  })
  await page.goto(payload.url, {
    waitUntil: 'domcontentloaded',
  })

  if (payload.waitFor === 'homeReady') {
    await waitForHomeReady(page, 20000)

    return
  }

  await waitForEnabledSelector(page, chatDraftSelector, 20000)
}

export async function getSecondaryBrowserBodyText() {
  const currentPage = getPage()

  return await currentPage.evaluate(() => document.body.textContent ?? '')
}

export async function secondaryBrowserSendMessage(payload) {
  const currentPage = getPage()

  await waitForEnabledSelector(currentPage, chatDraftSelector, 20000)
  await currentPage.click(chatDraftSelector, {
    clickCount: 3,
  })
  await currentPage.keyboard.press('Backspace')
  await currentPage.type(chatDraftSelector, payload.text)
  await waitForEnabledSelector(currentPage, sendMessageSelector, 20000)
  await currentPage.click(sendMessageSelector)
}

export async function secondaryBrowserWaitForChatReady() {
  const currentPage = getPage()

  await waitForEnabledSelector(currentPage, chatDraftSelector, 20000)
}

export async function secondaryBrowserJoinRoom(payload) {
  const currentPage = getPage()

  try {
    await waitForHomeReady(currentPage, 20000)

    if (payload.useRelay) {
      await setRelayMode(currentPage, true)
    }

    await currentPage.click(manualRoomCodeSelector, {
      clickCount: 3,
    })
    await currentPage.keyboard.press('Backspace')
    await currentPage.type(manualRoomCodeSelector, payload.roomCode)
    await currentPage.click(joinRoomButtonSelector)
    await secondaryBrowserWaitForChatReady()
  } catch (error) {
    const bodyText = await getSecondaryBrowserBodyText()

    throw new Error(
      [
        error instanceof Error ? error.message : 'Joining the room failed.',
        `Body text snapshot: ${bodyText.replace(/\s+/g, ' ').trim().slice(0, 500)}`,
      ].join('\n'),
      {
        cause: error,
      }
    )
  }
}

export async function secondaryBrowserSendFile(payload) {
  const currentPage = getPage()
  const absolutePath = path.resolve(payload.filePath)

  await waitForEnabledSelector(currentPage, chatDraftSelector, 20000)
  const fileInput = await currentPage.$(fileInputSelector)

  if (!fileInput) {
    throw new Error('Secondary browser file input was not found.')
  }

  await fileInput.uploadFile(absolutePath)
  await currentPage.$eval(fileInputSelector, (input) => {
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('Selected element is not a file input.')
    }

    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

export async function secondaryBrowserWaitForTransferProgress(payload) {
  const currentPage = getPage()

  try {
    await currentPage.waitForFunction(
      ({ fileName, minimumProgress }) => {
        const entries = Array.from(
          document.querySelectorAll('[data-testid="chat-entry"]')
        )
        const entry = entries.find((item) =>
          item.textContent?.includes(fileName)
        )

        if (!(entry instanceof HTMLElement)) {
          return false
        }

        const text = entry.textContent?.replace(/\s+/g, ' ').trim() ?? ''

        if (text.includes('completed')) {
          return true
        }

        if (text.includes('cancelled')) {
          return false
        }

        const fill = entry.querySelector('.chat-panel__transfer-progress-fill')
        const style = fill?.getAttribute('style') ?? ''
        const match = style.match(/width:\s*([0-9.]+)%/)
        const progress = match ? Number.parseFloat(match[1]) : 0

        return progress > minimumProgress
      },
      {
        timeout: payload.timeoutMs ?? 30000,
      },
      {
        fileName: payload.fileName,
        minimumProgress: payload.minimumProgress ?? 0,
      }
    )
  } catch (error) {
    const snapshot = await currentPage.evaluate((fileName) => {
      const entries = Array.from(
        document.querySelectorAll('[data-testid="chat-entry"]')
      )
      const entry = entries.find((item) => item.textContent?.includes(fileName))

      if (!(entry instanceof HTMLElement)) {
        return `Missing transfer entry for ${fileName}.`
      }

      const text = entry.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      const fill = entry.querySelector('.chat-panel__transfer-progress-fill')
      const style = fill?.getAttribute('style') ?? ''
      const match = style.match(/width:\s*([0-9.]+)%/)
      const progress = text.includes('completed')
        ? 100
        : match
          ? Number.parseFloat(match[1])
          : 0

      return `Transfer snapshot: ${text} (progress=${progress}%)`
    }, payload.fileName)

    throw new Error(
      [
        error instanceof Error
          ? error.message
          : 'Waiting for transfer progress failed.',
        snapshot,
      ].join('\n'),
      {
        cause: error,
      }
    )
  }
}

export async function secondaryBrowserWaitForTransferStatus(payload) {
  const currentPage = getPage()

  try {
    await currentPage.waitForFunction(
      ({ fileName, status }) => {
        const entries = Array.from(
          document.querySelectorAll('[data-testid="chat-entry"]')
        )
        const entry = entries.find((item) =>
          item.textContent?.includes(fileName)
        )

        if (!(entry instanceof HTMLElement)) {
          return false
        }

        const text = entry.textContent?.replace(/\s+/g, ' ').trim() ?? ''

        return text.includes(status)
      },
      {
        timeout: payload.timeoutMs ?? 30000,
      },
      payload
    )
  } catch (error) {
    const snapshot = await currentPage.evaluate((fileName) => {
      const entries = Array.from(
        document.querySelectorAll('[data-testid="chat-entry"]')
      )
      const entry = entries.find((item) => item.textContent?.includes(fileName))

      if (!(entry instanceof HTMLElement)) {
        return `Missing transfer entry for ${fileName}.`
      }

      return `Transfer snapshot: ${entry.textContent?.replace(/\s+/g, ' ').trim() ?? ''}`
    }, payload.fileName)

    throw new Error(
      [
        error instanceof Error
          ? error.message
          : 'Waiting for transfer status failed.',
        snapshot,
      ].join('\n'),
      {
        cause: error,
      }
    )
  }
}

export async function secondaryBrowserWaitForText(payload) {
  const currentPage = getPage()

  try {
    await currentPage.waitForFunction(
      ({ selector, text }) => {
        const element = selector ? document.querySelector(selector) : null
        const textSource = element ?? document.body

        return textSource.textContent?.includes(text) ?? false
      },
      {
        timeout: payload.timeoutMs ?? 20000,
      },
      payload
    )
  } catch (error) {
    const bodyText = await getSecondaryBrowserBodyText()

    throw new Error(
      [
        error instanceof Error ? error.message : 'Waiting for text failed.',
        `Body text snapshot: ${bodyText.replace(/\s+/g, ' ').trim().slice(0, 500)}`,
      ].join('\n'),
      {
        cause: error,
      }
    )
  }
}
