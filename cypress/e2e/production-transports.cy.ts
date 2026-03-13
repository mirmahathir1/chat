const transcriptSelector = '[data-testid="chat-transcript"]'
const roomCodeSelector =
  '[data-testid="room-code-value"], .share-panel__room-code code'
const advancedOptionsToggleSelector =
  '[data-testid="advanced-options-toggle"], .relay-panel__summary'
const relayModeLabelSelector =
  '[data-testid="relay-mode-label"], .relay-panel__switch-label'
const relayToggleSelector =
  '[data-testid="relay-toggle"], .relay-panel__switch input[type="checkbox"]'
const attachFilesSelector =
  '[data-testid="attach-files"], button[aria-label="Attach files"]'
const fileInputSelector = '[data-testid="file-input"], .chat-panel__file-input'

function visitHostHome(relay = false) {
  cy.visit('/')
  cy.get(roomCodeSelector, {
    timeout: 30000,
  }).should('be.visible')

  cy.get(advancedOptionsToggleSelector).then(($toggle) => {
    const details = $toggle.closest('details')[0]

    if (details instanceof HTMLDetailsElement && !details.open) {
      cy.wrap($toggle).click()
    }
  })

  if (relay) {
    cy.get(relayToggleSelector).check({
      force: true,
    })
    cy.get(relayModeLabelSelector).should('contain', 'Backend relay')
  } else {
    cy.get(relayModeLabelSelector).should('contain', 'WebRTC first')
  }
}

function joinSecondaryBrowser(relay = false) {
  cy.get(roomCodeSelector)
    .invoke('text')
    .then((roomCode) => {
      const trimmedRoomCode = roomCode.trim()

      expect(trimmedRoomCode).to.match(/^[a-z]+-[a-z]+-\d+$/)

      cy.task('secondaryBrowser:open', {
        url: Cypress.config('baseUrl'),
        waitFor: 'homeReady',
      })
      cy.task('secondaryBrowser:joinRoom', {
        roomCode: trimmedRoomCode,
        useRelay: relay,
      })
    })

  cy.url({
    timeout: 30000,
  }).should('include', '/room/')
  cy.get('[data-testid="chat-draft"]', {
    timeout: 30000,
  }).should('be.visible')
}

describe('production transport flows', () => {
  afterEach(() => {
    cy.task('secondaryBrowser:close')
  })

  it('test 1: sends chat over WebRTC', () => {
    const message = `webrtc-chat-${Date.now()}`

    visitHostHome(false)
    joinSecondaryBrowser(false)

    cy.get('[data-testid="chat-draft"]').should('be.enabled').type(message)
    cy.get('[data-testid="send-message"]').click()

    cy.contains('[data-testid="chat-entry"]', message, {
      timeout: 30000,
    }).should('be.visible')

    cy.task('secondaryBrowser:waitForText', {
      selector: transcriptSelector,
      text: message,
      timeoutMs: 30000,
    })
  })

  it('test 2: sends chat over backend relay', () => {
    const message = `relay-chat-${Date.now()}`

    visitHostHome(true)
    joinSecondaryBrowser(true)

    cy.task('secondaryBrowser:sendMessage', {
      text: message,
    })

    cy.contains('[data-testid="chat-entry"]', message, {
      timeout: 30000,
    }).should('be.visible')
    cy.get('[data-testid="chat-transcript"]').should('contain', message)
  })

  it('test 3: uploads a file over WebRTC', () => {
    const fileName = 'webrtc-upload.txt'

    visitHostHome(false)
    joinSecondaryBrowser(false)

    cy.get(attachFilesSelector).click({
      force: true,
    })
    cy.get(fileInputSelector).selectFile('cypress/fixtures/webrtc-upload.txt', {
      force: true,
    })

    cy.contains('[data-testid="chat-entry"]', fileName, {
      timeout: 60000,
    })
      .should('contain', 'WebRTC')
      .and('contain', 'completed')

    cy.task('secondaryBrowser:waitForText', {
      selector: transcriptSelector,
      text: fileName,
      timeoutMs: 60000,
    })
    cy.task('secondaryBrowser:waitForText', {
      selector: transcriptSelector,
      text: 'Download',
      timeoutMs: 60000,
    })
    cy.task('secondaryBrowser:waitForText', {
      selector: transcriptSelector,
      text: 'WebRTC',
      timeoutMs: 60000,
    })
  })

  it('test 4: uploads a file over backend relay', () => {
    const fileName = 'relay-upload.txt'

    visitHostHome(true)
    joinSecondaryBrowser(true)

    cy.task('secondaryBrowser:sendFile', {
      filePath: 'cypress/fixtures/relay-upload.txt',
    })

    cy.contains('[data-testid="chat-entry"]', fileName, {
      timeout: 60000,
    })
      .should('contain', 'Backend relay')
      .and('contain', 'Download')

    cy.get('[data-testid="chat-transcript"]').should('contain', fileName)
  })
})
