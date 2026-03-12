import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getRelayApp } from '../src/app.js'

const relayApp = getRelayApp()

export default async function handler(req: VercelRequest, res: VercelResponse) {
  await relayApp.handler(req, res)
}
