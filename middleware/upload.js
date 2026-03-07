import multer from 'multer'
import path from 'path'
import fs from 'fs'

// Créer le dossier uploads s'il n'existe pas
const uploadsDir = path.join(process.cwd(), 'uploads')
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

// Configuration du stockage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = uploadsDir
    
    // Organiser les fichiers par type
    if (file.mimetype.startsWith('image/')) {
      uploadPath = path.join(uploadsDir, 'images')
    } else if (file.mimetype.startsWith('video/')) {
      uploadPath = path.join(uploadsDir, 'videos')
    } else if (file.mimetype.startsWith('audio/')) {
      uploadPath = path.join(uploadsDir, 'audios')
    } else {
      uploadPath = path.join(uploadsDir, 'files')
    }
    
    // Créer le dossier s'il n'existe pas
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true })
    }
    
    cb(null, uploadPath)
  },
  filename: (req, file, cb) => {
    // Générer un nom de fichier unique
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    const ext = path.extname(file.originalname)
    const name = path.basename(file.originalname, ext)
    cb(null, `${name}-${uniqueSuffix}${ext}`)
  }
})

// Filtre pour les types de fichiers acceptés
const fileFilter = (req, file, cb) => {
  // Images
  if (file.mimetype.startsWith('image/')) {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Type d\'image non supporté. Utilisez JPEG, PNG, GIF ou WebP'))
    }
  }
  // Vidéos
  else if (file.mimetype.startsWith('video/')) {
    const allowedTypes = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Type de vidéo non supporté. Utilisez MP4, WebM, OGG ou QuickTime'))
    }
  }
  // Audio
  else if (file.mimetype.startsWith('audio/')) {
    const allowedTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/aac', 'audio/m4a']
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Type d\'audio non supporté. Utilisez MP3, WAV, OGG, WebM, AAC ou M4A'))
    }
  }
  // Fichiers
  else {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain'
    ]
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Type de fichier non supporté'))
    }
  }
}

// Configuration de multer
export const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB max
  },
  fileFilter: fileFilter
})

// Export du chemin des uploads pour servir les fichiers statiques
export const uploadsPath = uploadsDir

