import { Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import sharp from 'sharp'
import { ValidationError } from '../../shared/domain/domain-error'
import { AppConfig } from '../config/app-config.service'

export type MediaKind = 'image' | 'video' | 'audio' | 'file'

export interface StoredFile {
  url: string
  kind: MediaKind
  filename: string
  mimeType: string
  size: number
}

export interface UploadedFileLike {
  buffer: Buffer
  mimetype: string
  originalname: string
  size: number
}

const ALLOWED: Record<MediaKind, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'],
  video: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
  audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/aac', 'audio/mp4'],
  file: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
  ],
}

const MAX_SIZE: Record<MediaKind, number> = {
  image: 10 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
  file: 20 * 1024 * 1024,
}

/**
 * Stockage des médias sur disque, servi sous /uploads.
 * Les images sont réencodées en WebP (suppression des métadonnées EXIF, poids réduit).
 */
@Injectable()
export class StorageService {
  private readonly root: string

  constructor(config: AppConfig) {
    this.root = resolve(config.get('UPLOAD_DIR'))
  }

  kindOf(mimeType: string): MediaKind | null {
    const entry = (Object.entries(ALLOWED) as Array<[MediaKind, string[]]>).find(([, types]) =>
      types.includes(mimeType),
    )
    return entry ? entry[0] : null
  }

  async save(file: UploadedFileLike, allowedKinds: MediaKind[] = ['image']): Promise<StoredFile> {
    const kind = this.kindOf(file.mimetype)
    if (!kind || !allowedKinds.includes(kind)) {
      throw new ValidationError('Type de fichier non autorisé')
    }
    if (file.size > MAX_SIZE[kind]) {
      throw new ValidationError('Fichier trop volumineux')
    }

    const folder = `${kind}s`
    await mkdir(join(this.root, folder), { recursive: true })

    let data = file.buffer
    let ext = extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')
    let mimeType = file.mimetype
    if (kind === 'image' && file.mimetype !== 'image/gif') {
      data = await sharp(file.buffer)
        .rotate()
        .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer()
      ext = '.webp'
      mimeType = 'image/webp'
    }

    const name = `${randomUUID()}${ext}`
    await writeFile(join(this.root, folder, name), data)
    return {
      url: `/uploads/${folder}/${name}`,
      kind,
      filename: file.originalname,
      mimeType,
      size: data.length,
    }
  }

  async remove(url: string | null | undefined): Promise<void> {
    if (!url?.startsWith('/uploads/')) return
    const target = resolve(this.root, url.slice('/uploads/'.length))
    if (!target.startsWith(this.root)) return
    await unlink(target).catch(() => undefined)
  }
}
