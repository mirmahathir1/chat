describe('backend relay chat', () => {
  afterEach(() => {
    cy.task('secondaryBrowser:close')
  })

  it('sends relay chat messages between two live browser instances', () => {
    cy.intercept('POST', 'http://localhost:8788/api/rooms/*/events').as(
      'publishRoomEvent'
    )

    cy.visit('/')
    cy.get('[data-testid="relay-toggle"]').check({
      force: true,
    })
    cy.get('[data-testid="relay-mode-label"]').should(
      'contain',
      'Backend relay'
    )

    cy.get('[data-testid="copy-join-link"]')
      .invoke('attr', 'data-share-url')
      .should('include', 'transport=backend-relay')
      .then((shareUrl) => {
        cy.task('secondaryBrowser:open', {
          url: shareUrl,
        })
      })

    cy.task('secondaryBrowser:waitForChatReady')
    cy.url().should('include', '/room/')
    cy.get('[data-testid="chat-draft"]').should('be.visible').type('hello from host')
    cy.get('[data-testid="send-message"]').click()

    cy.wait('@publishRoomEvent').then(({ request }) => {
      const body =
        typeof request.body === 'string'
          ? JSON.parse(request.body)
          : request.body

      expect(body.message.type).to.equal('chat-broadcast')
      expect(body.message.message.body).to.equal('hello from host')
    })

    cy.task('secondaryBrowser:waitForText', {
      selector: '',
      text: 'hello from host',
    })
  })
})
