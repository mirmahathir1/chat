# Phase 8 Manual Test Checklist

## Devices and networks

- Host on desktop browser, join from a phone on the same Wi-Fi network.
- Host on desktop browser, join from a phone on cellular or a different network.
- Repeat with two joiners connected at the same time.

## Core room flow

- Create a hosted room and scan the QR from another device.
- Open the shared room URL directly on another desktop browser.
- Reopen the current room from the lobby without creating a new one.
- Confirm invalid room links show the dedicated error state.

## Presence and chat

- Verify join notifications appear on host and joiners.
- Verify disconnect notifications appear on host and joiners.
- Send text messages from host to joiner and joiner to host.
- Send a message containing a URL and confirm it renders as a clickable link.

## File sharing

- Send a single small file from host to joiner.
- Send multiple files in one transfer.
- Send a file from a joiner and confirm the host relays it to other members.
- Confirm completed downloads expose working download links.
- Confirm oversized files or too many files are rejected cleanly.

## Relay fallback

- Leave the relay switch off and confirm failed direct transfers do not switch to backend relay.
- Enable the relay switch on the home page before joining and confirm that preference carries into the room.
- Enable the relay switch in-room and confirm the status pill still shows `WebRTC` while direct transfer works.
- Force a slow or unavailable direct transfer and confirm the transfer switches to `Backend relay`.
- Cancel a backend relay transfer from the sender and confirm the recipient stops polling cleanly.
- Cancel a backend relay transfer from the recipient and confirm the sender stops uploading cleanly.
- Interrupt recipient polling during backend relay and confirm the transfer fails with a clear message instead of hanging forever.
- Re-enable connectivity and retry a new transfer after a failed backend relay session.

## Recovery and failure states

- Disconnect the joiner network during chat and file upload.
- Reconnect the joiner network and verify the UI retries clearly.
- Open the same room in duplicate tabs and verify the app rotates to a fresh peer ID.
- Close the host tab and confirm the room surfaces host disconnect behavior clearly.
