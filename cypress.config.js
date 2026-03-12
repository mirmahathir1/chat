import { defineConfig } from 'cypress'
import {
  closeSecondaryBrowser,
  getSecondaryBrowserBodyText,
  openSecondaryBrowser,
  secondaryBrowserSendMessage,
  secondaryBrowserWaitForChatReady,
  secondaryBrowserWaitForText,
} from './cypress/secondary-browser.js'

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:4173',
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
        async 'secondaryBrowser:sendMessage'(payload) {
          await secondaryBrowserSendMessage(payload)

          return null
        },
        async 'secondaryBrowser:waitForChatReady'() {
          await secondaryBrowserWaitForChatReady()

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
  taskTimeout: 30000,
  defaultCommandTimeout: 15000,
})
