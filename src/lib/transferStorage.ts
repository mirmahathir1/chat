const transferStorageDirectory = 'chat-transfers'

type TransferStorageScope = 'incoming' | 'outgoing'

interface MemoryTransferStore {
  mode: 'memory'
  chunks: BlobPart[]
}

interface DiskTransferStore {
  mode: 'disk'
  directoryHandle: FileSystemDirectoryHandle
  fileHandle: FileSystemFileHandle
  writable: FileSystemWritableFileStream | null
  tempName: string
}

export type TransferWritableStore = MemoryTransferStore | DiskTransferStore

function hasOriginPrivateFileSystem() {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory
}

function sanitizeTransferFileName(name: string, fallback = 'file') {
  const trimmed = name.trim()

  return (trimmed || fallback).replace(/[^a-zA-Z0-9._-]+/g, '_')
}

async function getTransferScopeDirectory(
  scope: TransferStorageScope,
  create = true
) {
  if (!hasOriginPrivateFileSystem()) {
    return null
  }

  const root = await navigator.storage.getDirectory()
  const transferRoot = await root.getDirectoryHandle(transferStorageDirectory, {
    create,
  })

  return transferRoot.getDirectoryHandle(scope, {
    create,
  })
}

async function createTransferStore(
  scope: TransferStorageScope,
  key: string,
  fileName: string
): Promise<TransferWritableStore> {
  if (!hasOriginPrivateFileSystem()) {
    return {
      mode: 'memory',
      chunks: [],
    }
  }

  try {
    const directoryHandle = await getTransferScopeDirectory(scope)

    if (!directoryHandle) {
      return {
        mode: 'memory',
        chunks: [],
      }
    }

    const tempName = `${key}-${sanitizeTransferFileName(fileName)}`
    const fileHandle = await directoryHandle.getFileHandle(tempName, {
      create: true,
    })
    const writable = await fileHandle.createWritable()

    return {
      mode: 'disk',
      directoryHandle,
      fileHandle,
      writable,
      tempName,
    }
  } catch (error) {
    console.warn('Falling back to memory-backed transfer storage.', error)

    return {
      mode: 'memory',
      chunks: [],
    }
  }
}

export function supportsDiskTransferStorage() {
  return hasOriginPrivateFileSystem()
}

export function buildTransferArchiveName(itemCount: number, noun: string) {
  const now = new Date()
  const timestamp =
    `${now.getFullYear()}` +
    `${String(now.getMonth() + 1).padStart(2, '0')}` +
    `${String(now.getDate()).padStart(2, '0')}` +
    `-${String(now.getHours()).padStart(2, '0')}` +
    `${String(now.getMinutes()).padStart(2, '0')}` +
    `${String(now.getSeconds()).padStart(2, '0')}`
  const safeNoun = sanitizeTransferFileName(noun, 'files')

  return `chat-${Math.max(1, itemCount)}-${safeNoun}-${timestamp}.zip`
}

export function buildNamedTransferArchiveName(name: string) {
  return `${sanitizeTransferFileName(name, 'folder')}.zip`
}

export async function createIncomingTransferStore(fileId: string, fileName: string) {
  return createTransferStore('incoming', fileId, fileName)
}

export async function createOutgoingArchiveStore(
  archiveId: string,
  archiveName: string
) {
  return createTransferStore('outgoing', archiveId, archiveName)
}

export async function writeTransferStoreChunk(
  store: TransferWritableStore,
  chunk: BlobPart
) {
  if (store.mode === 'disk') {
    if (!store.writable) {
      throw new Error('The disk-backed transfer stream is already closed.')
    }

    await store.writable.write(chunk)

    return
  }

  store.chunks.push(chunk)
}

export async function closeTransferStore(
  store: TransferWritableStore,
  options: {
    fileName: string
    mimeType: string
    lastModified?: number
  }
) {
  if (store.mode === 'disk') {
    if (store.writable) {
      await store.writable.close()
      store.writable = null
    }

    const diskFile = await store.fileHandle.getFile()

    return new File([diskFile], options.fileName, {
      type: options.mimeType || diskFile.type || 'application/octet-stream',
      lastModified: options.lastModified ?? diskFile.lastModified ?? Date.now(),
    })
  }

  return new File(store.chunks, options.fileName, {
    type: options.mimeType || 'application/octet-stream',
    lastModified: options.lastModified ?? Date.now(),
  })
}

export async function abortTransferStore(store: TransferWritableStore) {
  if (store.mode === 'disk') {
    try {
      if (store.writable) {
        await store.writable.abort()
        store.writable = null
      }
    } catch (error) {
      void error
    }

    try {
      await store.directoryHandle.removeEntry(store.tempName)
    } catch (error) {
      void error
    }

    return
  }

  store.chunks.length = 0
}

export async function cleanupTransferStore(store: TransferWritableStore) {
  if (store.mode === 'disk') {
    try {
      if (store.writable) {
        await store.writable.abort()
        store.writable = null
      }
    } catch (error) {
      void error
    }

    try {
      await store.directoryHandle.removeEntry(store.tempName)
    } catch (error) {
      void error
    }

    return
  }

  store.chunks.length = 0
}
