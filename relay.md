# Backend Relay Plan

## Objective

Add an optional backend relay path for file transfer. When the relay switch is off, transfers stay WebRTC-first and may fall back to backend relay if the direct path does not become available within a short connection window. When the relay switch is on, transfers use backend relay immediately. Preserve the current room interface and interaction model, with the only visible UI changes being the relay switch on the home page plus a clear indication that backend relay is active when WebRTC is not being used.

## Required Constraints

- WebRTC remains the default transport attempt.
- TURN is out of scope.
- Backend relay must be controlled by an explicit switch.
- The relay switch defaults to off, so the default behavior is WebRTC-first with backend relay fallback when available.
- Backend relay may use temporary chunk storage.
- Files must not be stored permanently on the backend.
- Backend application code must live under a top-level `backend/` folder.
- The frontend must show that backend relay is in use when WebRTC is not being used.
- Aside from the relay switch and relay status indication, the rest of the UI must remain visually and structurally unchanged.
- Vercel deployment must be executed through shell scripts, not manual-only dashboard steps.

## Scope

This plan focuses on a selectable backend relay transport. In relay-selected mode, chat and relay transfer control messages also move onto the backend relay path. Existing room creation and the WebRTC-first path stay in place unless backend relay is explicitly selected or a WebRTC-first transfer needs to fall back.

## Non-Goals

- Replacing PeerJS room signaling with a fully server-mediated chat stack.
- Adding TURN infrastructure.
- Adding end-to-end encryption for the relay path.
- Changing the current layout, panels, drawers, or primary room actions.
- Adding long-term file retention, history storage, or offline delivery.

## High-Level Approach

1. Keep the current WebRTC-first behavior for room connection and default transfer delivery.
2. Add a user-controlled relay switch that chooses between `WebRTC first` and `Backend relay`.
3. When WebRTC-first mode is selected, detect transfer transport failure or timeout after a short window and switch that transfer to backend relay.
4. When backend relay mode is selected, start the transfer on the backend relay immediately.
5. Stream the file in small chunks through temporary server-side storage.
6. Delete each chunk after recipient acknowledgment or expiration.
7. Surface both the selected transfer preference and the active transport in the existing room status area and transfer feedback copy without redesigning the interface.

## Proposed Transport Model

### Primary transport

- Continue using the existing WebRTC data path in `src/stores/signaling.ts`.
- Preserve the current room behavior when peers connect directly.

### Fallback transport

- Introduce a backend relay mode for chat plus relay-managed transfer control and payload delivery.
- Use plain HTTP request/response with polling instead of WebSocket for the fallback path.
- Relay only a small bounded set of chunks at any given time.
- Abort and clean up temporary data if the recipient stops polling or acknowledgment times out.

## Temporary Chunk Storage Rules

- Store chunks individually, never the entire file as one object.
- Keep only a small window of unacknowledged chunks in storage.
- Delete chunks immediately after recipient acknowledgment.
- Expire abandoned chunks and transfer metadata aggressively.
- Store only the metadata required to resume the next chunk within the same active transfer session.

## Proposed Backend Layout

```text
backend/
  package.json
  tsconfig.json
  vercel.json
  src/
    config.ts
    server.ts
    routes/
      transfers.ts
    services/
      chunk-store.ts
      relay-session-store.ts
      relay-cleanup.ts
    types/
      relay.ts
  scripts/
    dev.sh
```

## Proposed Frontend Changes

### Transport state

- Add a transfer transport mode concept such as `webrtc` or `backend-relay`.
- Track the transport used by each transfer.
- Track whether the current room has any active transfer using backend relay.
- Add a room-level preference for whether transfers should start on backend relay or start on WebRTC.

### UI behavior

- Keep the current panels and layout unchanged except for a minimal relay toggle control.
- Add the relay switch to the home page so the transport preference can be chosen before entering a room.
- Reuse the existing room status area in `src/components/room/RoomHeader.vue`.
- Add a switch that selects `WebRTC first` or `Backend relay`.
- Default the switch to `off`, which means the room uses WebRTC first and may fall back to backend relay when available.
- Keep the relay preference consistent between the home page and active room state.
- Add a status pill such as `Transport WebRTC` or `Transport Backend relay`.
- Add a second status pill that reflects the selected preference such as `Preference WebRTC first` or `Preference Backend relay`.
- Reuse existing notification patterns to announce immediate relay selection or fallback activation.
- Update transfer-level copy so a user can tell whether the file is moving through direct peer transport or backend relay.

### Frontend implementation areas

- `src/stores/signaling.ts`
  - keep WebRTC room behavior
  - respect the selected transport preference before starting a transfer
  - trigger fallback on transfer timeout or transport failure when WebRTC-first mode is selected
  - delegate backend relay transfer work to a backend relay client
- `src/components/room/RoomHeader.vue`
  - add a relay mode switch and transport status indication without changing layout structure
- `src/views/HomeView.vue`
  - add the relay mode switch before room creation or join flow begins
- `src/views/RoomView.vue`
  - thread relay preference and transport status into existing header props
- `src/stores/room.ts` or a dedicated settings store
  - hold the selected relay preference and make it available to both the home page and the active room session
- new frontend support files
  - `src/lib/backendRelayClient.ts`
  - `src/lib/backendRelayTypes.ts`
  - `src/lib/backendRelayPolling.ts`

## Proposed Backend Relay Flow

### Sender flow

1. If backend relay mode is selected, request a backend relay session immediately.
2. If WebRTC-first mode is selected, start transfer with the existing WebRTC path.
3. If the direct path does not become usable within the fallback timeout, request a backend relay session.
4. Slice the file into conservative chunk sizes suitable for Vercel request limits.
5. Upload one or a small batch of chunks.
6. Wait for recipient acknowledgment before advancing the window.

### Recipient flow

1. Receive transfer metadata as usual through the room channel.
2. If the transfer switches to backend relay, poll the backend for the next available chunk.
3. Write each chunk into the existing local transfer store.
4. Acknowledge chunk receipt.
5. Continue polling until transfer completion or cancellation.

### Backend flow

1. Create a short-lived relay session.
2. Accept chunk upload requests from the sender.
3. Make chunks available to the intended recipient only.
4. Delete each chunk after acknowledgment.
5. Cancel and clean up timed-out sessions.

## Suggested HTTP Endpoints

- `POST /api/transfers`
  - create relay session
- `POST /api/transfers/:transferId/chunks/:chunkIndex`
  - upload one chunk
- `GET /api/transfers/:transferId/chunks/next`
  - recipient polls for next chunk
- `POST /api/transfers/:transferId/chunks/:chunkIndex/ack`
  - confirm chunk receipt
- `POST /api/transfers/:transferId/complete`
  - sender marks transfer complete
- `POST /api/transfers/:transferId/cancel`
  - sender or recipient cancels transfer

## Storage Strategy

- Use private temporary object storage or a comparable short-lived backend store for chunk payloads.
- Keep relay session metadata separate from chunk payload storage.
- Apply strict TTL cleanup to both payloads and metadata.
- Avoid any backend feature that creates permanent transfer history.

## Timeout and Fallback Rules

- Use a short fallback threshold, for example 3 to 5 seconds, before switching a transfer away from WebRTC when WebRTC-first mode is selected.
- Switch immediately when the direct transfer path fails with a non-recoverable error.
- If backend relay mode is selected, skip the direct WebRTC transfer path and start on backend relay.
- Once a transfer has switched to backend relay, keep that transfer on the relay path instead of bouncing back and forth.

## Testing Requirements

- Same-network WebRTC transfer still works unchanged.
- With the relay switch off, transfers start on WebRTC and may fall back to backend relay when the backend relay path is available.
- With the relay switch on, transfers use backend relay immediately.
- UI clearly shows `Backend relay` when it is the active transport.
- UI exposes a relay mode switch and defaults it to WebRTC-first behavior.
- The home page exposes the relay switch before a room is created or joined.
- No broad UI redesign or layout drift is introduced.
- Relay chunks are deleted after acknowledgment.
- Abandoned relay sessions expire and are cleaned up.
- Existing tests continue to pass after the fallback transport is added.

## Deployment Plan

### Frontend deployment

- Keep the existing frontend deployment flow, but add a Vercel-oriented shell-script path.
- Add a deploy script for the frontend that wraps the Vercel CLI.

### Backend deployment

- Deploy the backend as a separate Vercel project rooted at `backend/`.
- Use shell scripts for repeatable deployment and environment bootstrapping.

### Shell scripts to add

```text
scripts/
  deploy-vercel-frontend.sh
  deploy-vercel-backend.sh
  vercel-link-frontend.sh
  vercel-link-backend.sh
  vercel-sync-env.sh
```

### Deployment expectations

- No manual dashboard-only deployment path should be required for normal releases.
- Shell scripts should cover linking, environment sync, build, and deploy commands.
- Backend and frontend environment variables should be documented separately.

## Milestones

### Phase 1

#### Goal

Stand up the backend foundation and lock the relay contract before frontend integration starts.

#### Work items

- Create the top-level `backend/` project structure, package metadata, TypeScript config, and Vercel project config.
- Choose the backend runtime shape for Vercel and define how request handlers map to the relay API surface.
- Define the transfer session model, chunk metadata model, acknowledgment model, and expiry semantics.
- Implement the initial HTTP contract for session creation, chunk upload, chunk polling, acknowledgment, completion, and cancellation.
- Add the storage abstraction for temporary chunk persistence and separate it from relay session metadata.
- Add cleanup hooks for expired chunks and expired relay sessions.
- Add shell scripts for local backend startup, Vercel linking, environment sync, and deploy commands.
- Document required backend environment variables and how they differ from frontend variables.

#### Exit criteria

- `backend/` can boot locally.
- Relay API routes are defined with stable request and response shapes.
- Temporary chunk storage and session cleanup strategy are implemented at the design level, even if not fully production-hardened.
- Vercel deployment scripts exist and are runnable from the shell.

### Phase 2

#### Goal

Introduce a frontend relay transport layer without disturbing the existing room flow or UI structure.

#### Work items

- Add dedicated frontend relay support modules such as `backendRelayClient`, relay types, and polling helpers.
- Refactor transfer-specific logic in `src/stores/signaling.ts` so WebRTC transport and backend relay transport can share the same higher-level transfer lifecycle.
- Add transport state to the frontend domain model so each transfer can explicitly report `webrtc` or `backend-relay`.
- Add a relay mode preference with a default value of `off`.
- Expose the relay preference on the home page and ensure that room creation and join preparation inherit that setting.
- Thread transport state into the room-level view model without changing panel composition or layout.
- Update `src/components/room/RoomHeader.vue` to expose the relay switch and display the active transport in the existing status area.
- Reuse current notification patterns so the app can announce that a transfer has switched to backend relay.
- Keep existing chat, presence, and room-join behavior untouched during this phase.

#### Exit criteria

- Frontend code can talk to the backend relay API through a dedicated abstraction instead of ad hoc fetch calls.
- The relay switch exists, defaults to off, and is wired into transfer mode selection.
- The home page can set the relay preference before the room flow starts.
- The room UI can display transport mode without any broader redesign.
- Same-network WebRTC-first flows still behave the same from the user’s perspective.

### Phase 3

#### Goal

Make backend relay transfers work end to end, including immediate relay mode, timeout-based switching from WebRTC, chunk progression, and cleanup.

#### Work items

- Add transfer fallback rules so a direct WebRTC transfer switches to backend relay after the configured timeout or on hard failure.
- Support immediate backend relay mode when the relay switch is enabled.
- Implement sender-side chunk slicing, bounded in-flight chunk upload, and acknowledgment-driven progression.
- Implement recipient-side polling, chunk consumption, local write integration, and transfer completion handling.
- Ensure cancellation is symmetric so sender and recipient can both stop relay transfers cleanly.
- Prevent transport flapping by keeping a transfer on backend relay once it has switched away from WebRTC.
- Add session-expiration and abandoned-transfer cleanup behavior to both frontend and backend flows.
- Make sure relay mode integrates with existing transfer status updates, notifications, and replay behavior where applicable.

#### Exit criteria

- A transfer can start with WebRTC, fail over to backend relay, and complete without a UI layout change.
- A transfer can also start on backend relay immediately when the relay switch is enabled.
- Relay chunks are deleted after acknowledgment or timeout.
- Cancelled or abandoned transfers do not leave stale active sessions behind.
- The frontend clearly indicates when backend relay is in use.

### Phase 4

#### Goal

Harden the implementation for deployment, verification, and operational use on Vercel.

#### Work items

- Add automated tests for fallback selection, relay upload/poll/ack flow, transfer cancellation, and cleanup timing.
- Add regression coverage for unchanged same-network WebRTC behavior.
- Add manual test steps for mixed-network transfers, slow-network fallback, and recovery from interrupted polling.
- Document chunk-size limits, timeout tuning, environment variables, and storage lifecycle assumptions.
- Finalize shell-script deployment flow for both frontend and backend Vercel projects, including link, env sync, and deploy commands.
- Document expected operational costs and failure modes for the relay path.
- Add basic logging or diagnostic hooks so relay failures can be debugged in production.

#### Exit criteria

- Test coverage exists for the main fallback path and cleanup path.
- Deployment to Vercel frontend and Vercel backend can be executed from shell scripts.
- The repository documentation explains how the relay path works, how to deploy it, and what limits remain.
- The final behavior matches the acceptance criteria in this document.

## Risks

- Vercel request and body limits require conservative chunk sizing.
- Polling fallback adds latency compared to direct peer transport.
- Temporary storage propagation and deletion timing must be validated carefully.
- A server relay path increases backend bandwidth cost relative to successful direct WebRTC transfers.
- Keeping current UI unchanged limits how much transport detail can be surfaced without careful copywriting.

## Acceptance Criteria

- A new `relay.md` plan exists and describes the fallback design.
- Backend runtime code is planned under `backend/`.
- WebRTC remains the default transport path when backend relay is not explicitly selected.
- A relay mode switch is planned, and it defaults to WebRTC-first behavior.
- The relay switch is planned for both the home page and the room view.
- Backend relay fallback uses temporary chunk storage only.
- The frontend indicates backend relay usage when active.
- No other UI layout changes are introduced beyond the relay switch and relay status indication.
- Vercel deployment is described as shell-script-driven for both frontend and backend.
