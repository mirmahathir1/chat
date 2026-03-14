import type { IncomingMessage, ServerResponse } from 'node:http'

export async function readJsonBody(req: IncomingMessage, maxBytes: number) {
  const body = await readBufferBody(req, maxBytes)

  if (body.byteLength === 0) {
    return {}
  }

  return JSON.parse(body.toString('utf8')) as unknown
}

export function sendJson(
  res: ServerResponse<IncomingMessage>,
  statusCode: number,
  payload: unknown
) {
  const body = Buffer.from(JSON.stringify(payload))

  res.writeHead(statusCode, {
    'Content-Length': body.byteLength,
    'Content-Type': 'application/json; charset=utf-8',
  })
  res.end(body)
}

async function readBufferBody(req: IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = []
  let totalBytes = 0

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)

    totalBytes += buffer.byteLength

    if (totalBytes > maxBytes) {
      throw new Error(`Request body exceeded ${maxBytes} bytes.`)
    }

    chunks.push(buffer)
  }

  return Buffer.concat(chunks, totalBytes)
}
