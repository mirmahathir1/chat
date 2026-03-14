import fs from 'node:fs/promises'
import path from 'node:path'
import { defineConfig } from 'cypress'
import {
  closeSecondaryBrowser,
  getSecondaryBrowserBodyText,
  secondaryBrowserJoinRoom,
  openSecondaryBrowser,
  secondaryBrowserSendFile,
  secondaryBrowserSendMessage,
  secondaryBrowserWaitForChatReady,
  secondaryBrowserWaitForTransferProgress,
  secondaryBrowserWaitForTransferStatus,
  secondaryBrowserWaitForText,
} from './cypress/secondary-browser.js'

async function createDummyTransferFile(payload) {
  const absolutePath = path.resolve(payload.filePath)
  await fs.mkdir(path.dirname(absolutePath), {
    recursive: true,
  })
  const handle = await fs.open(absolutePath, 'w')

  try {
    await handle.truncate(payload.sizeBytes)

    for (const sample of payload.samples) {
      const buffer = Buffer.from(sample.value, 'utf8')

      await handle.write(buffer, 0, buffer.length, sample.offset)
    }
  } finally {
    await handle.close()
  }

  return absolutePath
}

export default defineConfig({
  env: {
    relayBlobConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim()),
  },
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL ?? 'http://localhost:4173',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
    setupNodeEvents(on) {
      on('after:run', async () => {
        await closeSecondaryBrowser()
      })

      on('task', {
        async 'secondaryBrowser:close'() {
          await closeSecondaryBrowser()

          return null
        },
        async 'secondaryBrowser:open'(payload) {
          await openSecondaryBrowser(payload)

          return null
        },
        async 'secondaryBrowser:getBodyText'() {
          return await getSecondaryBrowserBodyText()
        },
        async 'secondaryBrowser:joinRoom'(payload) {
          await secondaryBrowserJoinRoom(payload)

          return null
        },
        async 'secondaryBrowser:sendMessage'(payload) {
          await secondaryBrowserSendMessage(payload)

          return null
        },
        async 'secondaryBrowser:sendFile'(payload) {
          await secondaryBrowserSendFile(payload)

          return null
        },
        async 'testFile:createDummyTransferFile'(payload) {
          return await createDummyTransferFile(payload)
        },
        async 'testFile:remove'(payload) {
          await fs.rm(path.resolve(payload.filePath), {
            force: true,
          })

          return null
        },
        async 'secondaryBrowser:waitForChatReady'() {
          await secondaryBrowserWaitForChatReady()

          return null
        },
        async 'secondaryBrowser:waitForTransferProgress'(payload) {
          await secondaryBrowserWaitForTransferProgress(payload)

          return null
        },
        async 'secondaryBrowser:waitForTransferStatus'(payload) {
          await secondaryBrowserWaitForTransferStatus(payload)

          return null
        },
        async 'secondaryBrowser:waitForText'(payload) {
          await secondaryBrowserWaitForText(payload)

          return null
        },
      })
    },
  },
  screenshotOnRunFailure: true,
  video: false,
  taskTimeout: 90000,
  defaultCommandTimeout: 20000,
})
