# Refactor Plan

## Current State

The codebase is stable enough to refactor incrementally:

- `npm run lint` passes
- `npm --prefix backend run typecheck` passes

The cleanup pressure is concentrated in a few files with too many responsibilities:

- `src/stores/signaling.ts` (`3512` lines): PeerJS lifecycle, backend relay polling, chat protocol handling, transfer streaming, retry logic, browser event handling, and store orchestration all live together.
- `src/components/chat/ChatPanel.vue` (`1171` lines): transcript rendering, composer behavior, drag and drop, upload preparation, scroll management, and transfer actions are combined in one component.
- `src/stores/room.ts` (`847` lines): room state, message creation, member management, transfer bookkeeping, and unused persistence hooks are mixed together.
- `src/views/RoomView.vue` (`787` lines): route parsing, join/bootstrap flow, drawer state, connection UI, and container wiring are all in one file.
- Backend routes duplicate low-level HTTP helpers like `sendJson`, `readJsonBody`, and `normalizePathname`.

There is also a cleanup gap between UI-level Cypress coverage and the amount of domain logic in the frontend stores. The current repo has strong end-to-end checks, but the pure logic and state transitions are not isolated behind smaller testable modules yet.

## Refactor Goals

- Make each module have one clear responsibility.
- Keep behavior unchanged while the code is being split.
- Move domain logic into pure functions where possible.
- Keep Pinia stores and Vue views thin.
- Remove dead abstractions and empty stubs.
- Reduce the size of the largest files enough that ownership is obvious.

## Guardrails

- Do not rewrite the app in one pass.
- Land the refactor in small PR-sized slices.
- Keep the current Cypress transport flows green after each phase.
- Extract pure functions before changing orchestration.
- If persistence is not going to be implemented, delete the placeholder persistence API instead of carrying it forward.

## Suggested Target Structure

```text
src/
  domain/
    room/
    messaging/
    transfers/
    signaling/
  services/
    signaling/
    relay/
  composables/
    room/
    chat/
  components/
    chat/
    room/
  stores/
    room.ts
    signaling.ts
    session.ts
    notifications.ts

backend/src/
  http/
  routes/
  services/
  validators/
```

This does not need to happen all at once. The goal is to move toward this shape as files are split.

## Phase 0: Add Safety Nets

1. Add a unit test runner for frontend domain logic if you want this refactor to stay safe. `vitest` is the simplest fit with the current stack.
2. Cover the pure helpers that already exist or should exist soon:
   - `src/lib/messageSync.ts`
   - `src/lib/transferSync.ts`
   - room message validation and creation
   - transfer merge and normalization rules
   - route/query parsing for join links
3. Add focused tests around the most fragile store behavior:
   - host room bootstrap
   - join room preparation
   - retry state transitions
   - transfer cancel / fail / complete state transitions
4. Keep the existing Cypress flows as the top-level integration guardrail.

## Phase 1: Extract Shared Domain Logic

Start with code that is already mostly pure.

1. Move signaling message types and guards out of `src/stores/signaling.ts` into something like `src/domain/signaling/protocol.ts`.
2. Move room builders and validators out of `src/stores/room.ts`:
   - system message creation
   - text message creation
   - chat body validation
   - room naming and share-link helpers
3. Consolidate transfer rules into domain modules instead of leaving them split between the store and helper files.
4. Centralize constants such as retry counts, timeout values, max chat message bytes, and transfer timing windows.

Outcome: stores stop being the only place where business rules live.

## Phase 2: Shrink `room` Into a Real State Store

`src/stores/room.ts` should become a thin state container plus orchestration methods.

1. Split room concerns into small modules:
   - member roster updates
   - message drafting and status transitions
   - presence event creation
   - transfer state updates
2. Either implement persistence through an adapter or remove the dead persistence hooks:
   - `persistRoomState()`
   - `loadStoredRoom()`
   - `loadStoredMembers()`
   - `loadStoredMessages()`
   - `loadStoredPresenceEvents()`
3. Keep the store API stable while moving internals behind imported helpers.
4. Reduce direct array mutation logic inside the store by using pure update functions where possible.

Outcome: `room.ts` is no longer the place where every room-related rule is invented and stored.

## Phase 3: Split the `signaling` Store by Responsibility

This is the highest-value refactor.

`src/stores/signaling.ts` currently owns:

- peer bootstrap and teardown
- host and join flows
- backend relay polling
- protocol dispatch
- outgoing transfer orchestration
- incoming transfer reconstruction
- retry scheduling
- online/offline and duplicate-tab handling

Refactor it in this order:

1. Extract protocol definitions and message handlers first.
2. Separate connection lifecycle from message handling.
3. Move backend relay polling and publishing into a relay service module.
4. Split transfer logic into:
   - outgoing transfer coordinator
   - incoming transfer coordinator
   - replay / cancel helpers
5. Move browser event wiring into a dedicated lifecycle helper with explicit `bind` and `dispose`.
6. Keep the Pinia store as the public façade that wires these modules together.

Recommended internal modules:

- `src/services/signaling/peerLifecycle.ts`
- `src/services/signaling/memberConnections.ts`
- `src/services/signaling/relayRoomEvents.ts`
- `src/services/signaling/chatHandlers.ts`
- `src/services/signaling/outgoingTransfers.ts`
- `src/services/signaling/incomingTransfers.ts`
- `src/domain/signaling/protocol.ts`

Outcome: the signaling store becomes readable enough to reason about and safe enough to test.

## Phase 4: Decompose the Large Vue Containers

### `src/views/RoomView.vue`

Split it into:

- a route/bootstrap composable such as `useRoomRouteBootstrap`
- a layout state composable for drawer and modal behavior
- smaller presentational components for join banners and disconnected-state UI

### `src/components/chat/ChatPanel.vue`

Split it into:

- `ChatTranscript.vue`
- `ChatComposer.vue`
- `ChatTransferEntry.vue`
- `ChatMessageEntry.vue`
- `ChatUploadDropzone.vue`
- an upload-confirmation component if the zip/files choice stays

Rules for this phase:

- container components own store wiring
- leaf components are props/events only
- drag/drop and upload preparation should not live in the transcript renderer
- scroll management should be isolated from upload logic

Outcome: UI changes stop requiring edits to a thousand-line component.

## Phase 5: Clean Up Backend Structure

The backend is smaller, so keep this practical.

1. Extract shared HTTP helpers used by `backend/src/app.ts`, `backend/src/routes/transfers.ts`, and `backend/src/routes/room-events.ts`:
   - JSON response writer
   - JSON body reader
   - pathname normalization
2. Move request validation/parsing into small validator modules.
3. Keep blob-specific transfer operations behind a service layer instead of embedding them directly in route handlers.
4. Leave the simple Node HTTP setup in place unless it becomes a real blocker. There is no need to introduce a framework just to make the code look cleaner.

Outcome: route files read as request orchestration, not as a mix of transport, validation, and storage details.

## Phase 6: Naming and Folder Cleanup

Once the logic is split, clean up the folder semantics.

1. Reserve `domain` for business rules and pure logic.
2. Reserve `services` for side effects and external IO.
3. Reserve `composables` for Vue-specific stateful reuse.
4. Keep `lib` only for generic helpers that are not feature-specific.
5. Normalize naming so similar responsibilities use similar suffixes:
   - `*Service`
   - `*Store`
   - `*Validator`
   - `*Mapper`
   - `use*` for composables only

## Definition of Done

The refactor is in a good state when:

- no frontend store is carrying unrelated transport, domain, and browser lifecycle logic in one file
- the signaling protocol types live outside the store
- `ChatPanel.vue` and `RoomView.vue` are split into smaller focused pieces
- dead persistence placeholders are either implemented cleanly or removed
- backend route helpers are shared instead of duplicated
- pure domain logic has unit coverage
- Cypress transport tests still pass

## Recommended Delivery Order

1. Add unit test support and test the existing pure helpers.
2. Extract signaling protocol types and room domain helpers.
3. Refactor `src/stores/room.ts` into smaller internal modules.
4. Split `src/stores/signaling.ts` into services plus a thin public store.
5. Break down `src/views/RoomView.vue` and `src/components/chat/ChatPanel.vue`.
6. Clean up backend shared HTTP utilities.
7. Finish with naming and folder normalization.

This order keeps behavior risk lower and avoids mixing architecture cleanup with feature work.
