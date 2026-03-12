/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_BASE_PATH?: string
  readonly VITE_PEER_HOST?: string
  readonly VITE_PEER_PORT?: string
  readonly VITE_PEER_PATH?: string
  readonly VITE_PEER_SECURE?: string
  readonly VITE_PEER_DEBUG?: string
  readonly VITE_STUN_URLS?: string
  readonly VITE_TURN_URLS?: string
  readonly VITE_TURN_URL?: string
  readonly VITE_TURN_USERNAME?: string
  readonly VITE_TURN_CREDENTIAL?: string
  readonly VITE_RELAY_BACKEND_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
