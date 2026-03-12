# Relay Backend

HTTP relay backend for the relay-selected transport described in [relay.md](/Users/mirmahathirmohammad/Documents/chat/relay.md).

## What This Backend Does

- stores relay chat and control events in memory for relay-selected rooms
- issues Vercel Blob upload tokens for relay file transfers
- lets senders upload each file once, in full, directly to private Blob storage
- lets recipients download each file once, in full, through the backend
- deletes uploaded Blob files after recipient acknowledgement or transfer cancellation
- exposes runtime diagnostics through `GET /api/health`

## Storage Mode

The current backend is mixed-mode:

- room events are still in-memory
- relay file payloads are stored in private Vercel Blob objects

That means:

- relay file payloads no longer depend on a single warm Vercel Function instance
- relay chat/control polling is still process-local and can still be disrupted by serverless instance changes

The health endpoint reports `storageMode: mixed`, `fileStorageMode: vercel-blob`, and `blobConfigured`.

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

4. Run backend checks:

```bash
npm run typecheck
npm run build
```

The repo-level relay e2e coverage still lives under Cypress:

```bash
cd ..
npm test
```

## Environment Variables

- `BLOB_READ_WRITE_TOKEN`
  - required for Vercel Blob upload, download, and delete operations
- `RELAY_PORT`
  - local HTTP port
- `RELAY_ALLOWED_ORIGINS`
  - comma-separated browser origins allowed to call the backend
- `RELAY_LOG_LEVEL`
  - one of `silent`, `error`, `info`, or `debug`
- `RELAY_SESSION_TTL_MS`
  - upload-token validity window
- `RELAY_MAX_FILE_BYTES`
  - maximum accepted relay file size for a single Blob upload token
  - `RELAY_MAX_CHUNK_BYTES` is still accepted as a legacy fallback name
- `RELAY_POLL_INTERVAL_MS`
  - suggested frontend relay poll interval for room events
- `RELAY_CLEANUP_INTERVAL_MS`
  - still reported in health for compatibility, but file cleanup is now driven by ack/cancel deletes instead of chunk sweeps

## Diagnostics

`GET /api/health` returns:

- `status`
- `storageMode`
- `fileStorageMode`
- `blobConfigured`
- `logLevel`
- `maxFileBytes`
- `pollIntervalMs`
- `cleanupIntervalMs`
- `sessionTtlMs`
- `roomEventStats`

## HTTP Contract

### `GET /api/health`

Returns backend health plus relay diagnostics.

### `POST /api/transfers/:transferId/files/:fileId/upload-token`

Generates a Vercel Blob client-upload token for one relay file.

### `GET /api/transfers/:transferId/files/:fileId?pathname=...`

Streams a private relay file back to the recipient.

### `POST /api/transfers/:transferId/files/:fileId/ack`

Deletes the uploaded Blob file after the recipient has finished downloading it.

Request body:

```json
{
  "pathname": "relay/transfers/..."
}
```

### `POST /api/transfers/:transferId/cancel`

Deletes any uploaded Blob files associated with the cancelled relay transfer.

Request body:

```json
{
  "pathnames": ["relay/transfers/..."],
  "peerId": "optional-peer-id",
  "reason": "optional reason"
}
```

## Deployment

The repo ships Vercel shell wrappers at the root:

```bash
./scripts/vercel-link-backend.sh
./scripts/vercel-sync-env.sh backend production
./scripts/deploy-vercel-backend.sh
```

For production you must attach a Blob store to the Vercel backend project so `BLOB_READ_WRITE_TOKEN` is available.

## Current Caveat

Relay-selected chat and control messages still use the in-memory room-event store. File payloads are now durable on Vercel Blob, but the room-event channel itself is not yet durable across all serverless instance changes.
