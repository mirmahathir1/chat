import { createServer } from 'node:http'
import { getRelayApp } from './app.js'

const relayApp = getRelayApp()

const server = createServer((req, res) => {
  void relayApp.handler(req, res)
})

server.listen(relayApp.config.port, () => {
  relayApp.logger.info(
    `Relay backend listening on http://localhost:${relayApp.config.port}`
  )
})

function shutdown(signal: string) {
  relayApp.logger.info(`Received ${signal}. Shutting down relay backend.`)
  relayApp.stopCleanup()
  server.close(() => {
    process.exit(0)
  })
}

process.on('SIGINT', () => {
  shutdown('SIGINT')
})

process.on('SIGTERM', () => {
  shutdown('SIGTERM')
})
