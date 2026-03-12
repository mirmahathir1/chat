import puppeteer from 'puppeteer'

const chatDraftSelector = '[data-testid="chat-draft"]'
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

      return (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLButtonElement
      )
        ? !element.disabled
        : false
    },
    {
      timeout: timeoutMs,
    },
    selector
  )
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
  await page.waitForSelector(chatDraftSelector, {
    timeout: 20000,
  })
}

export async function getSecondaryBrowserBodyText() {
  const currentPage = getPage()

  return await currentPage.evaluate(() => document.body.textContent ?? '')
}

export async function secondaryBrowserSendMessage(payload) {
  const currentPage = getPage()

  await waitForEnabledSelector(currentPage, chatDraftSelector, 20000)
  await waitForEnabledSelector(currentPage, sendMessageSelector, 20000)
  await currentPage.click(chatDraftSelector, {
    clickCount: 3,
  })
  await currentPage.keyboard.press('Backspace')
  await currentPage.type(chatDraftSelector, payload.text)
  await currentPage.click(sendMessageSelector)
}

export async function secondaryBrowserWaitForChatReady() {
  const currentPage = getPage()

  await waitForEnabledSelector(currentPage, chatDraftSelector, 20000)
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
