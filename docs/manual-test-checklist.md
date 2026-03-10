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

## Recovery and failure states

- Disconnect the joiner network during chat and file upload.
- Reconnect the joiner network and verify the UI retries clearly.
- Open the same room in duplicate tabs and verify the app rotates to a fresh peer ID.
- Close the host tab and confirm the room surfaces host disconnect behavior clearly.
