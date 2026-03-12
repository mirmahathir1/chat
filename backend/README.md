# Relay Backend

HTTP relay backend for the relay-selected transport described in [relay.md](/Users/mirmahathirmohammad/Documents/chat/relay.md).

## What This Backend Does

- creates a short-lived relay session when direct WebRTC transfer does not become ready
- stores lightweight room events for relay-selected chat and transfer-control messages
- accepts one chunk at a time from the sender
- lets the recipient poll for the next available chunk
- lets peers poll room events for relay-selected chat and transfer-control traffic
- deletes pending chunks on acknowledgement, cancellation, or expiry
- exposes a small diagnostics surface through `GET /api/health`

## Current Storage Mode

The current implementation uses in-memory session and chunk storage. That keeps the relay contract easy to test and reason about, but it also means:

- local development works
- a long-lived single-process deployment works
- stateless serverless deployment is not reliable for active relay sessions

The health endpoint reports `storageMode: memory` so this limitation is visible at runtime.

## Local Development

1. Install dependencies:

```bash
cd backend
npm install
```

2. Copy the env template if needed:

```bash
cp .env.example .env.local
```

3. Start the backend:

```bash
npm run dev
```

This uses `nodemon` to restart the backend when files under `backend/src/` change.

4. Run the backend checks:

```bash
npm run typecheck
npm run build
```

The relay e2e coverage now lives at the repo root under Cypress:

```bash
cd ..
npm test
```

## Environment Variables

- `RELAY_PORT`
  - local HTTP port
- `RELAY_ALLOWED_ORIGINS`
  - comma-separated browser origins allowed to call the backend
  - use `*` only when you understand the exposure
- `RELAY_LOG_LEVEL`
  - one of `silent`, `error`, `info`, or `debug`
  - `info` keeps startup and relay chat send messages visible
  - `debug` logs relay activity details
- `RELAY_SESSION_TTL_MS`
  - how long a relay session stays alive after activity
- `RELAY_CHUNK_TTL_MS`
  - how long an uploaded chunk stays available before expiry
- `RELAY_CLEANUP_INTERVAL_MS`
  - cleanup sweep interval for expired sessions and chunks
- `RELAY_MAX_CHUNK_BYTES`
  - maximum accepted upload size per chunk
- `RELAY_POLL_INTERVAL_MS`
  - suggested polling interval returned to clients

## Operational Limits

- The frontend currently slices files into `4 MiB` chunks, so `RELAY_MAX_CHUNK_BYTES` must stay at or above `4194304`.
- The default direct-to-relay fallback timeout is `4s` in the frontend.
- Relay chunk acknowledgement waits `15s` before failing the transfer.
- Relay sessions default to `15m` of inactivity.
- Relay chunks default to `5m` of availability before cleanup.
- Backend relay fallback currently activates only when exactly one recipient is connected. Multi-recipient room fanout still stays on WebRTC.

## Diagnostics

`GET /api/health` returns:

- `status`
- `storageMode`
- `logLevel`
- `maxChunkBytes`
- `pollIntervalMs`
- `cleanupIntervalMs`
- `sessionTtlMs`
- `chunkStats`
- `sessionStats`

This is the fastest way to confirm whether the backend is reachable and whether stale sessions or pending chunks are accumulating.

## HTTP Contract

### `GET /api/health`

Returns backend health plus relay diagnostics.

### `POST /api/transfers`

Creates a short-lived relay session.

### `POST /api/transfers/:transferId/chunks/:chunkIndex`

Uploads one raw binary chunk.

Required headers:

- `content-type: application/octet-stream`
- `x-relay-session-id`
- `x-relay-sender-peer-id`
- `x-relay-file-id`
- `x-relay-total-chunks`

Notes:

- `chunkIndex` is transfer-global and must increase monotonically for the transfer
- a request body larger than `RELAY_MAX_CHUNK_BYTES` now returns `413`

### `GET /api/transfers/:transferId/chunks/next`

Polls for the next available chunk.

Query parameters:

- `sessionId`
- `peerId`
- `after`

When no chunk is available yet, this returns `204 No Content` with `x-relay-transfer-state`.

### `POST /api/transfers/:transferId/chunks/:chunkIndex/ack`

Confirms recipient receipt and deletes the acknowledged chunk from the pending set.

### `POST /api/transfers/:transferId/complete`

Marks the sender side as complete.

### `POST /api/transfers/:transferId/cancel`

Cancels the relay session and removes pending chunks.

## Deployment

The repo ships Vercel shell wrappers at the root:

```bash
./scripts/vercel-link-backend.sh
./scripts/vercel-sync-env.sh backend production
./scripts/deploy-vercel-backend.sh
```

What those scripts currently guarantee:

- the backend project is linked through the Vercel CLI
- environment variables can be pulled into a local file
- tests, typecheck, and build run before deploy

What they do not change:

- the backend still reports `storageMode: memory`
- serverless cold starts or process replacement can interrupt active relay sessions

If you need reliable production relay delivery on Vercel, the next storage step is replacing the in-memory stores with a short-lived durable adapter while preserving the same route contract.

## Cost and Failure Notes

- Relay traffic moves bytes through your backend instead of direct peer transport, so bandwidth cost grows with every fallback transfer.
- Polling adds latency compared to a working direct WebRTC path.
- Cancellation, cleanup, and health diagnostics are implemented, but the storage mode remains process-local.
- If the room control channel dies entirely, backend relay cannot rescue the transfer because the app still uses the room channel for relay coordination.
