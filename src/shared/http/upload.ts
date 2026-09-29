import { BadRequestException } from '@nestjs/common'
import { memoryStorage } from 'multer'
import type { UploadedFileLike } from '../../infrastructure/storage/storage.service'

/** Options multer : fichiers en mémoire, contrôlés ensuite par StorageService. */
export const memoryUpload = { storage: memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }

export function requireFile(file: UploadedFileLike | undefined): UploadedFileLike {
  if (!file) throw new BadRequestException('Fichier manquant')
  return file
}
