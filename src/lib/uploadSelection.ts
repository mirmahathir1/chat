import { BlobReader, ZipWriter } from '@zip.js/zip.js'
import {
  buildNamedTransferArchiveName,
  buildTransferArchiveName,
  cleanupTransferStore,
  closeTransferStore,
  createOutgoingArchiveStore,
} from '@/lib/transferStorage'

export interface UploadSelectionEntry {
  file: File
  archivePath: string
  label: string
}

export interface UploadSelection {
  entries: UploadSelectionEntry[]
  directories: string[]
  itemCount: number
  folderCount: number
  looseFileCount: number
  topLevelNames: string[]
  isSinglePlainFile: boolean
  isSingleFolder: boolean
}

export interface PreparedUpload {
  files: File[]
  cleanup?: () => Promise<void>
}

function normalizeArchiveSegment(name: string, fallback: string) {
  const sanitized = Array.from(String(name))
    .filter((character) => {
      const code = character.charCodeAt(0)

      return code >= 32 && code !== 127
    })
    .join('')
  const normalized = sanitized.replace(/[\\/]+/g, ' ').trim()

  return normalized || fallback
}

function normalizeArchivePath(path: string, fallback: string) {
  const normalized = String(path)
    .split('/')
    .map((part) => normalizeArchiveSegment(part, ''))
    .filter(Boolean)
    .join('/')

  return normalized || normalizeArchiveSegment(fallback, 'file')
}

function ensureUniqueArchiveEntryName(
  name: string,
  usedNames: Record<string, true>
) {
  const safeName = normalizeArchivePath(name, 'file')

  if (!usedNames[safeName]) {
    usedNames[safeName] = true

    return safeName
  }

  const slashIndex = safeName.lastIndexOf('/')
  const directory = slashIndex >= 0 ? safeName.slice(0, slashIndex + 1) : ''
  const fileName = slashIndex >= 0 ? safeName.slice(slashIndex + 1) : safeName
  const extensionIndex = fileName.lastIndexOf('.')
  const baseName =
    extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : ''
  let suffix = 2
  let candidate = `${directory}${baseName}-${suffix}${extension}`

  while (usedNames[candidate]) {
    suffix += 1
    candidate = `${directory}${baseName}-${suffix}${extension}`
  }

  usedNames[candidate] = true

  return candidate
}

function finalizeSelection(selection: Omit<UploadSelection, 'isSingleFolder' | 'isSinglePlainFile'>) {
  return {
    ...selection,
    isSinglePlainFile:
      selection.folderCount === 0 &&
      selection.looseFileCount === 1 &&
      selection.itemCount === 1 &&
      selection.entries.length === 1,
    isSingleFolder:
      selection.folderCount === 1 &&
      selection.looseFileCount === 0 &&
      selection.itemCount === 1,
  } satisfies UploadSelection
}

function readFileEntry(entry: FileSystemFileEntry) {
  return new Promise<File>((resolve, reject) => {
    entry.file(resolve, reject)
  })
}

function readDirectoryEntries(reader: FileSystemDirectoryReader) {
  return new Promise<FileSystemEntry[]>((resolve, reject) => {
    const entries: FileSystemEntry[] = []

    function readBatch() {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(entries)

            return
          }

          entries.push(...batch)
          readBatch()
        },
        (error) => reject(error)
      )
    }

    readBatch()
  })
}

async function collectDroppedEntry(
  entry: FileSystemEntry,
  parentPath: string,
  selection: Omit<UploadSelection, 'isSingleFolder' | 'isSinglePlainFile'>
) {
  const nextPath = parentPath ? `${parentPath}/${entry.name}` : entry.name

  if (entry.isDirectory) {
    selection.directories.push(normalizeArchivePath(nextPath, entry.name))

    const children = await readDirectoryEntries(
      (entry as FileSystemDirectoryEntry).createReader()
    )

    for (const child of children) {
      await collectDroppedEntry(child, nextPath, selection)
    }

    return
  }

  if (!entry.isFile) {
    return
  }

  const file = await readFileEntry(entry as FileSystemFileEntry)

  selection.entries.push({
    file,
    archivePath: normalizeArchivePath(nextPath, file.name),
    label: nextPath,
  })
}

export function describeUploadSelection(selection: UploadSelection) {
  if (selection.folderCount === 1 && selection.itemCount === 1) {
    return '1 folder'
  }

  if (selection.folderCount > 0) {
    return `${selection.itemCount} items`
  }

  return `${selection.itemCount} file${selection.itemCount === 1 ? '' : 's'}`
}

export function buildSelectionFromFileList(fileList: FileList | File[]) {
  const files = Array.from(fileList).filter(
    (file): file is File =>
      file instanceof File &&
      typeof file.name === 'string' &&
      typeof file.size === 'number'
  )
  const selection = {
    entries: [] as UploadSelectionEntry[],
    directories: [] as string[],
    itemCount: 0,
    folderCount: 0,
    looseFileCount: 0,
    topLevelNames: [] as string[],
  }
  const folderRoots: Record<string, true> = {}

  for (const file of files) {
    const relativePath = file.webkitRelativePath || ''

    if (relativePath.includes('/')) {
      const archivePath = normalizeArchivePath(relativePath, file.name)
      const rootName = archivePath.split('/')[0] ?? file.name

      selection.entries.push({
        file,
        archivePath,
        label: relativePath,
      })

      if (!folderRoots[rootName]) {
        folderRoots[rootName] = true
        selection.folderCount += 1
        selection.itemCount += 1
        selection.topLevelNames.push(rootName)
      }

      continue
    }

    selection.entries.push({
      file,
      archivePath: normalizeArchivePath(file.name, file.name),
      label: file.name,
    })
    selection.looseFileCount += 1
    selection.itemCount += 1
    selection.topLevelNames.push(file.name)
  }

  return finalizeSelection(selection)
}

export async function buildSelectionFromDrop(dataTransfer: DataTransfer) {
  const items = Array.from(dataTransfer.items ?? []).filter(
    (item) => item.kind === 'file'
  )
  const droppedEntries = items
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => !!entry)

  if (droppedEntries.length === 0) {
    return buildSelectionFromFileList(dataTransfer.files)
  }

  const selection = {
    entries: [] as UploadSelectionEntry[],
    directories: [] as string[],
    itemCount: 0,
    folderCount: 0,
    looseFileCount: 0,
    topLevelNames: [] as string[],
  }

  for (const entry of droppedEntries) {
    selection.itemCount += 1
    selection.topLevelNames.push(entry.name || 'item')

    if (entry.isDirectory) {
      selection.folderCount += 1
    } else {
      selection.looseFileCount += 1
    }

    await collectDroppedEntry(entry, '', selection)
  }

  return finalizeSelection(selection)
}

export async function prepareSelectionForUpload(
  selection: UploadSelection,
  mode: 'files' | 'zip'
) {
  if (mode === 'files') {
    if (selection.folderCount > 0) {
      throw new Error('Folders must be zipped before they can be uploaded.')
    }

    return {
      files: selection.entries.map((entry) => entry.file),
    } satisfies PreparedUpload
  }

  const archiveName = selection.isSingleFolder
    ? buildNamedTransferArchiveName(selection.topLevelNames[0] ?? 'folder')
    : buildTransferArchiveName(
        selection.itemCount || selection.entries.length || 1,
        selection.folderCount > 0 ? 'items' : 'files'
      )
  const usedNames: Record<string, true> = {}
  const archiveStore = await createOutgoingArchiveStore(
    crypto.randomUUID(),
    archiveName
  )

  try {
    if (archiveStore.mode === 'disk') {
      const zipWriter = new ZipWriter(archiveStore.writable!)

      for (const directory of [...selection.directories].sort((left, right) => left.length - right.length)) {
        await zipWriter.add(directory, undefined, {
          directory: true,
        })
      }

      for (const entry of selection.entries) {
        await zipWriter.add(
          ensureUniqueArchiveEntryName(entry.archivePath, usedNames),
          new BlobReader(entry.file),
          {
            lastModDate: new Date(entry.file.lastModified),
            uncompressedSize: entry.file.size,
          }
        )
      }

      await zipWriter.close()
      archiveStore.writable = null

      const archiveFile = await closeTransferStore(archiveStore, {
        fileName: archiveName,
        mimeType: 'application/zip',
        lastModified: Date.now(),
      })

      return {
        files: [archiveFile],
        cleanup: () => cleanupTransferStore(archiveStore),
      } satisfies PreparedUpload
    }

    const archiveStream = new TransformStream<Uint8Array, Uint8Array>()
    const archiveBlobPromise = new Response(archiveStream.readable).blob()
    const zipWriter = new ZipWriter(archiveStream.writable)

    for (const directory of [...selection.directories].sort((left, right) => left.length - right.length)) {
      await zipWriter.add(directory, undefined, {
        directory: true,
      })
    }

    for (const entry of selection.entries) {
      await zipWriter.add(
        ensureUniqueArchiveEntryName(entry.archivePath, usedNames),
        new BlobReader(entry.file),
        {
          lastModDate: new Date(entry.file.lastModified),
          uncompressedSize: entry.file.size,
        }
      )
    }

    await zipWriter.close()
    const archiveBlob = await archiveBlobPromise

    return {
      files: [
        new File([archiveBlob], archiveName, {
          type: 'application/zip',
          lastModified: Date.now(),
        }),
      ],
    } satisfies PreparedUpload
  } catch (error) {
    await cleanupTransferStore(archiveStore)
    throw error
  }
}
