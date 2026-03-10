# Hosted P2P Vue Chat Build Plan

## Recommendation

For version 1, use a hosted room model:

- QR contains host identity
- everyone joins through the host
- host manages membership and notifications
- text chat ships first
- file transfer comes after the join flow is stable

This is the most realistic way to ship the app quickly.

## Feasibility

Yes, this app is buildable with this hosted model.

Important constraint:

- The app can still be frontend-only in the sense of no database and no stored chat history.
- WebRTC still needs signaling and usually STUN/TURN to connect across real networks.
- The host is not a backend server. The host is just the first peer in the room.
- If the host disconnects, the room ends in version 1.

## Recommended V1 Architecture

- Framework: Vue 3 + Vite + TypeScript
- State: Pinia
- Transport: WebRTC data channels
- Signaling: PeerJS with PeerServer, or equivalent signaling layer
- NAT traversal: public STUN, plus TURN for reliability
- Room identity: `roomId`
- Host identity: `hostPeerId`
- Join flow: QR encodes app URL with `roomId` and `hostPeerId`

## Room Model

- The first user creates the room and becomes the host
- The host generates a shareable room URL and QR code
- Every joining peer connects to the host first
- The host tracks connected members
- The host emits join and disconnect events
- The host can relay chat messages in v1 for simplicity
- Later, peers can optionally upgrade to direct peer-to-peer links for file transfer

## Product Constraints

- No database
- No persistent message history
- No room survives after the host leaves in v1
- Best initial target is small rooms, such as 2-6 users
- File transfer works only while sender and receiver are online

## Phase 1: Project Scaffold

Goal: create the Vue app foundation and developer workflow.

Tasks:

- Initialize Vite with Vue 3 + TypeScript
- Add Pinia, Vue Router, ESLint, Prettier, and Vitest
- Create app shell for room view, chat panel, member list, notifications, and share controls
- Define shared types for room, peer, message, membership event, and file transfer state

Exit criteria:

- App runs locally
- Project structure is typed and testable
- Core state containers exist

## Phase 2: Host Room Creation And QR Flow

Goal: allow one user to create a room and invite others by QR.

Tasks:

- Generate a `roomId` on room creation
- Create a host peer identity on startup
- Build a shareable room URL containing `roomId` and `hostPeerId`
- Render that room URL as a QR code
- Add actions to copy link and re-open QR at any time
- Support opening the app directly from a scanned room URL

Exit criteria:

- A host can create a room
- A second device can scan the QR and load the correct room join screen
- The host can reopen and reshare the QR without recreating the room

## Phase 3: Signaling And Host Connection

Goal: connect joiners to the host reliably.

Tasks:

- Integrate PeerJS or equivalent signaling client
- Connect the host to the signaling service
- Connect joiners to the host using `hostPeerId`
- Establish WebRTC data channels
- Handle connection retry and disconnect cleanup
- Configure STUN and TURN settings

Exit criteria:

- A joiner can connect to the host from another device
- The host sees connected peers in real time
- Connection failures are surfaced clearly in the UI

## Phase 4: Host-Managed Membership And Notifications

Goal: make the host the authority for room presence.

Tasks:

- Maintain the canonical member list on the host
- Broadcast join events to all connected peers
- Broadcast disconnect events to all connected peers
- Show in-app notifications for member joins and leaves
- Display active member count and names or peer labels

Exit criteria:

- All users see the same member list
- Join and disconnect notifications appear consistently

## Phase 5: Text Chat First

Goal: ship the simplest useful chat experience.

Tasks:

- Implement text message send and receive
- Relay messages through the host for v1 simplicity
- Add optimistic local echo
- Render sender label and timestamp
- Detect URLs and render them as clickable links
- Add basic message validation and size limits

Exit criteria:

- Two or more connected users can exchange messages
- Shared links are clickable
- Chat remains stable under normal room activity

## Phase 6: Join Flow Hardening

Goal: stabilize the core room lifecycle before adding file transfer.

Tasks:

- Improve error handling for invalid room links and offline hosts
- Add reconnect messaging and retry behavior
- Handle duplicate tabs and duplicate joins
- Improve mobile layout for scan-to-join flow
- Add loading, connecting, reconnecting, and disconnected states
- Verify the hosted flow on real devices and mixed networks

Exit criteria:

- QR join works reliably on phones and desktop browsers
- Failure states are understandable and recoverable
- Core room creation and join flow is stable enough for broader testing

## Phase 7: File Sharing

Goal: add peer-to-peer file transfer after chat is stable.

Tasks:

- Add file picker and drag/drop support
- Support single-file and multi-file sends
- Send file metadata before binary data
- Transfer file chunks over WebRTC data channels
- Show upload and download progress
- Reassemble files on the receiver and make them available automatically
- Enforce file size limits and handle transfer failures cleanly

Exit criteria:

- Users can send one or many files in the room
- Receivers get completed files without any server storage
- Failed transfers do not break chat

## Phase 8: Testing

Goal: verify the hosted room model under realistic conditions.

Tasks:

- Unit test message formatting, URL detection, and room state reducers
- Unit test file chunk assembly and transfer state transitions
- Add browser-level tests for create-room, join-room, and chat flows
- Run manual tests across two phones and desktop browsers
- Test same-network and different-network cases
- Test host disconnect behavior explicitly

Exit criteria:

- Core flows are covered by automated tests
- Manual test scenarios are documented and pass
- Host disconnect behavior is understood and consistent

## Phase 9: Deployment

Goal: ship the frontend and document operating assumptions.

Tasks:

- Build and deploy the static Vue app
- Configure signaling service settings for production
- Configure STUN and TURN endpoints for production
- Add environment-based config
- Document browser support and room lifetime limitations

Exit criteria:

- Production build works from a public URL
- Users can create a room, join by QR, chat, and share files

## Future Phase: Host Migration

Not part of version 1, but this is the path to remove the single point of failure later.

Possible follow-up work:

- elect a new host when the original host disconnects
- replicate enough room state to transfer authority
- reissue room metadata or maintain a stable room identity
- move from host-relayed chat to a more distributed topology

## Suggested Milestones

1. Finish Phases 1-3 to prove QR creation and host-based join.
2. Finish Phases 4-5 to ship a usable chat room.
3. Finish Phase 6 before adding file transfer.
4. Add Phase 7 only after the room lifecycle is stable.
5. Finish with testing and deployment.

## Recommended First Prototype Scope

- 2 users only
- hosted room model
- QR join flow
- text chat only
- clickable links
- no file transfer yet
- no persistence

Once that works reliably on two real devices, expand to more peers and add file transfer.
