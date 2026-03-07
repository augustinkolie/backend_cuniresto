import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { authenticate } from '../middleware/auth.js'

const router = express.Router()

// Configuration de Multer pour le stockage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // S'assurer que le dossier uploads existe
        const uploadDir = 'uploads'
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true })
        }
        cb(null, uploadDir)
    },
    filename: (req, file, cb) => {
        // Générer un nom de fichier unique
        const uniqueSuffix = uuidv4()
        const ext = path.extname(file.originalname)
        cb(null, `${uniqueSuffix}${ext}`)
    }
})

// Filtre pour n'accepter que les images
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true)
    } else {
        cb(new Error('Format de fichier non supporté. Utilisez JPEG, PNG, GIF ou WebP.'), false)
    }
}

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // Limite à 5MB
    }
})

// Route POST /api/upload
router.post('/', authenticate, upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Aucun fichier uploadé'
            })
        }

        // Construire l'URL du fichier accessible publiquement
        // Note: server/index.js doit servir 'uploads' en statique
        const fileUrl = `/uploads/${req.file.filename}`

        res.json({
            success: true,
            message: 'Fichier uploadé avec succès',
            url: fileUrl,
            filename: req.file.filename,
            mimetype: req.file.mimetype,
            size: req.file.size
        })
    } catch (error) {
        console.error('Erreur upload:', error)
        res.status(500).json({
            success: false,
            message: 'Erreur lors de l\'upload du fichier'
        })
    }
})

export default router
