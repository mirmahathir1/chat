# Deployment

## GitHub Pages

1. In the repository settings, open **Pages**.
2. Set **Build and deployment** to **GitHub Actions**.
3. Push to `main` or run the `Deploy to GitHub Pages` workflow manually.

The workflow builds the Vite app, uploads `dist`, and deploys it to GitHub Pages. The build also emits `dist/404.html` so direct `/room/:roomId` links still resolve after a refresh on GitHub Pages.

## Production configuration

Set these as GitHub repository variables or local `.env` values before building:

- `VITE_APP_BASE_PATH`: Optional override for the deployed base path. Use `/` for a custom domain or `/<repo>/` for a project site.
- `VITE_PEER_HOST`: PeerJS signaling host. GitHub Pages only serves the frontend, so signaling must live elsewhere.
- `VITE_PEER_PORT`: PeerJS signaling port.
- `VITE_PEER_PATH`: PeerJS signaling path.
- `VITE_PEER_SECURE`: `true` for TLS-enabled signaling.
- `VITE_PEER_DEBUG`: PeerJS debug level.
- `VITE_STUN_URLS`: Comma-separated STUN URLs.
- `VITE_TURN_URLS`: Comma-separated TURN URLs.
- `VITE_TURN_USERNAME`: TURN username.
- `VITE_TURN_CREDENTIAL`: TURN credential.

TURN credentials are shipped to the browser in the built app. Treat them as public client configuration and prefer time-limited or otherwise restricted credentials.

## Browser support

- Current Chrome, Edge, Firefox, and Safari releases with WebRTC data-channel support.
- iOS Safari works, but backgrounding the host tab can suspend the room.
- Camera-based QR scanning depends on the browser and OS permission model.

## Operating limits

- Rooms only exist while the original host tab stays open.
- Chat and file transfers are relayed by the host, so the host device is the main bandwidth and reliability bottleneck.
- GitHub Pages provides no server-side persistence, room recovery, or signaling service.
- Mixed-network connections usually need a working TURN server, especially for restrictive mobile or enterprise networks.
