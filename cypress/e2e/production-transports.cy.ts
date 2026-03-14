const transcriptSelector = '[data-testid="chat-transcript"]'
const transferEntrySelector = '[data-testid="chat-entry"]'
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
const uploadFixtureDirectory = 'tmp/cypress-upload-fixtures'
const replayFixtureSizeBytes = 250 * 1024 * 1024
const cancelSyncTimeoutMs = 60000
const replayProgressTimeoutMs = 30000
const replayPollIntervalMs = 1000
const webRtcReplayTimeoutMs = 8 * 60 * 1000
const relayReplayTimeoutMs = 20 * 60 * 1000
const relayBlobIt = Cypress.env('relayBlobConfigured') ? it : it.skip

function visitHostHome(
  relay = false,
  options: Cypress.VisitOptions = {}
) {
  cy.visit('/', options)
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

function createReplayUploadFixture(label: string) {
  const fileName = `${label}-250mb.bin`
  const filePath = `${uploadFixtureDirectory}/${fileName}`
  const startValue = `START:${label}:0123456789`
  const middleValue = `MIDDLE:${label}:abcdefghijklmnopqrstuvwxyz`
  const endValue = `END:${label}:ZYXWVUTSRQPONMLKJIHGFEDCBA`
  const samples = [
    {
      offset: 0,
      value: startValue,
    },
    {
      offset: Math.floor(replayFixtureSizeBytes / 2),
      value: middleValue,
    },
    {
      offset: replayFixtureSizeBytes - endValue.length,
      value: endValue,
    },
  ]

  return {
    fileName,
    filePath,
    samples,
    sizeBytes: replayFixtureSizeBytes,
  }
}

function ensureReplayUploadFixture(
  upload: ReturnType<typeof createReplayUploadFixture>
) {
  cy.task('testFile:createDummyTransferFile', upload, {
    log: false,
    timeout: 120000,
  })
}

function findTransferEntry(fileName: string, timeoutMs: number) {
  return cy.contains(transferEntrySelector, fileName, {
    timeout: timeoutMs,
  })
}

function cancelIncomingTransfer(fileName: string, timeoutMs: number) {
  findTransferEntry(fileName, timeoutMs)
    .find('button[aria-label="Cancel download"]', {
      timeout: timeoutMs,
    })
    .should('be.visible')
    .click()

  findTransferEntry(fileName, timeoutMs)
    .should('contain', 'cancelled')
    .find('button[aria-label="Download files"]', {
      timeout: timeoutMs,
    })
    .should('be.visible')
}

function requestTransferReplay(fileName: string, timeoutMs: number) {
  findTransferEntry(fileName, timeoutMs)
    .find('button[aria-label="Download files"]', {
      timeout: timeoutMs,
    })
    .click()
}

function waitForSenderTransferStatus(fileName: string, status: string) {
  cy.task('secondaryBrowser:waitForTransferStatus', {
    fileName,
    status,
    timeoutMs: cancelSyncTimeoutMs,
  })
}

function monitorReceiverTransferProgress(fileName: string, timeoutMs: number) {
  const startedAt = Date.now()
  let lastProgress = -1
  let lastSnapshot = ''
  let lastProgressAt = Date.now()

  const readState = (root: ParentNode) => {
    const entries = Array.from(
      root.querySelectorAll<HTMLElement>(transferEntrySelector)
    )
    const entry = entries.find((item) => item.textContent?.includes(fileName))

    if (!entry) {
      return {
        completed: false,
        progress: 0,
        snapshot: `Missing transfer entry for ${fileName}.`,
      }
    }

    const snapshot = entry.textContent?.replace(/\s+/g, ' ').trim() ?? ''

    if (snapshot.includes('completed')) {
      return {
        completed: true,
        progress: 100,
        snapshot,
      }
    }

    const fill = entry.querySelector('.chat-panel__transfer-progress-fill')
    const style = fill?.getAttribute('style') ?? ''
    const match = style.match(/width:\s*([0-9.]+)%/)
    const progress = match ? Number.parseFloat(match[1]) : 0

    return {
      completed: false,
      progress,
      snapshot,
    }
  }

  const poll = (): Cypress.Chainable<void> =>
    cy.get('body', { log: false }).then(($body) => {
      const state = readState($body[0])

      if (state.completed) {
        return
      }

      if (
        state.progress > lastProgress ||
        (state.snapshot !== lastSnapshot && !state.snapshot.includes('queued'))
      ) {
        lastProgress = state.progress
        lastSnapshot = state.snapshot
        lastProgressAt = Date.now()
      }

      const now = Date.now()

      if (now - lastProgressAt >= replayProgressTimeoutMs) {
        throw new Error(
          `Transfer stalled for ${replayProgressTimeoutMs}ms: ${state.snapshot} (progress=${state.progress}%)`
        )
      }

      if (now - startedAt >= timeoutMs) {
        throw new Error(
          `Transfer did not complete within ${timeoutMs}ms: ${state.snapshot} (progress=${state.progress}%)`
        )
      }

      return cy.wait(replayPollIntervalMs, { log: false }).then(() => poll())
    })

  return cy.wrap(null, { log: false }).then(() => poll())
}

function verifyDownloadedTransfer(
  upload: ReturnType<typeof createReplayUploadFixture>,
  timeoutMs: number
) {
  findTransferEntry(upload.fileName, timeoutMs)
    .should('contain', 'completed')
    .find(`a[download="${upload.fileName}"]`, {
      timeout: timeoutMs,
    })
    .should('have.attr', 'href')
    .then((href) => {
      expect(href).to.match(/^blob:/)

      cy.window({ log: false })
        .then((win) => win.fetch(href).then((response) => response.blob()))
        .then(async (blob) => {
          expect(blob.size).to.equal(upload.sizeBytes)

          for (const sample of upload.samples) {
            const actualValue = await blob
              .slice(sample.offset, sample.offset + sample.value.length)
              .text()

            expect(actualValue).to.equal(sample.value)
          }
        })
    })
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

  relayBlobIt('test 4: uploads a file over backend relay', () => {
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

  it('test 5: cancels and re-downloads a WebRTC file from the receiver', () => {
    const upload = createReplayUploadFixture('webrtc-cancel-replay')

    ensureReplayUploadFixture(upload)

    visitHostHome(false)
    joinSecondaryBrowser(false)

    cy.task('secondaryBrowser:sendFile', {
      filePath: upload.filePath,
    })

    cancelIncomingTransfer(upload.fileName, webRtcReplayTimeoutMs)
    waitForSenderTransferStatus(upload.fileName, 'cancelled')
    requestTransferReplay(upload.fileName, webRtcReplayTimeoutMs)
    monitorReceiverTransferProgress(upload.fileName, webRtcReplayTimeoutMs)
    verifyDownloadedTransfer(upload, webRtcReplayTimeoutMs)
  })

  relayBlobIt(
    'test 6: cancels and re-downloads a backend relay file from the receiver',
    () => {
      const upload = createReplayUploadFixture('relay-cancel-replay')

      ensureReplayUploadFixture(upload)

      visitHostHome(true)
      joinSecondaryBrowser(true)

      cy.task('secondaryBrowser:sendFile', {
        filePath: upload.filePath,
      })

      cancelIncomingTransfer(upload.fileName, relayReplayTimeoutMs)
      requestTransferReplay(upload.fileName, relayReplayTimeoutMs)
      monitorReceiverTransferProgress(upload.fileName, relayReplayTimeoutMs)
      verifyDownloadedTransfer(upload, relayReplayTimeoutMs)
    }
  )
})
