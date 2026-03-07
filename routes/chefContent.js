import express from 'express'
import { Op } from 'sequelize'
import { ChefContent, Product, User, sequelize } from '../models/index.js'
import { authenticate } from '../middleware/auth.js'
import multer from 'multer'
import path from 'path'
import fs from 'fs'

const router = express.Router()

// Configuration Multer pour les uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = 'uploads/chef-content/'
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true })
    }
    cb(null, uploadPath)
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname))
  }
})

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase())
    const mimetype = allowedTypes.test(file.mimetype)
    if (mimetype && extname) return cb(null, true)
    cb(new Error('Seules les images sont autorisées'))
  }
})

// GET - Obtenir tous les contenus (public)
router.get('/', async (req, res) => {
  try {
    const { type, status, featured, isLive, limit = 20, page = 1 } = req.query
    const where = {}
    
    if (req.user?.role !== 'admin') {
      where.status = 'published'
    } else if (status) {
      where.status = status
    }
    
    if (type) where.type = type
    if (featured === 'true') where.featured = true
    if (isLive === 'true') where.isLive = true
    
    const limitNum = parseInt(limit)
    const offset = (parseInt(page) - 1) * limitNum
    
    const { count: total, rows: contents } = await ChefContent.findAndCountAll({
      where,
      include: [
        { model: Product, as: 'product', attributes: ['name', 'image'] },
        { model: User, as: 'publisher', attributes: ['nom', 'prenom', 'email'] }
      ],
      order: [['featured', 'DESC'], ['createdAt', 'DESC']],
      limit: limitNum,
      offset: offset
    })
    
    res.json({
      success: true,
      contents,
      pagination: {
        total,
        page: parseInt(page),
        limit: limitNum,
        pages: Math.ceil(total / limitNum)
      }
    })
  } catch (error) {
    console.error('Erreur récupération contenus:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// GET - Obtenir un contenu spécifique
router.get('/:id', async (req, res) => {
  try {
    const content = await ChefContent.findByPk(req.params.id, {
      include: [
        { model: Product, as: 'product', attributes: ['name', 'image', 'description'] },
        { model: User, as: 'publisher', attributes: ['nom', 'prenom', 'email'] }
      ]
    })
    
    if (!content) return res.status(404).json({ success: false, message: 'Non trouvé' })
    if (content.status !== 'published' && req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Non disponible' })
    }
    
    await content.increment('views')
    res.json({ success: true, content })
  } catch (error) {
    console.error('Erreur récupération contenu:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// POST - Créer un nouveau contenu (admin uniquement)
router.post('/', authenticate, upload.single('thumbnail'), async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Accès refusé' })
    
    const { title, description, type, chef, chefImage, videoUrl, streamUrl, isLive, liveStartTime, liveEndTime, duration, category, product, status, featured } = req.body
    
    let thumbnail = req.body.thumbnail
    if (req.file) thumbnail = `/uploads/chef-content/${req.file.filename}`
    
    if (!thumbnail) return res.status(400).json({ success: false, message: 'Miniature requise' })
    
    const content = await ChefContent.create({
      title, description, type: type || 'video', chef, chefImage: chefImage || null, thumbnail, videoUrl, streamUrl: streamUrl || null,
      isLive: isLive === 'true' || isLive === true,
      liveStartTime: liveStartTime ? new Date(liveStartTime) : null,
      liveEndTime: liveEndTime ? new Date(liveEndTime) : null,
      duration: duration ? parseInt(duration) : null,
      category: category || 'preparation',
      productId: product || null,
      status: status || 'draft',
      featured: featured === 'true' || featured === true,
      publishedById: req.user.id
    })

    const detailedContent = await ChefContent.findByPk(content.id, {
      include: [{ model: User, as: 'publisher', attributes: ['nom', 'prenom', 'email'] }]
    })
    
    res.status(201).json({ success: true, message: 'Créé', content: detailedContent })
  } catch (error) {
    console.error('Erreur création:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// PUT - Mettre à jour un contenu (admin uniquement)
router.put('/:id', authenticate, upload.single('thumbnail'), async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Accès refusé' })
    
    const content = await ChefContent.findByPk(req.params.id)
    if (!content) return res.status(404).json({ success: false, message: 'Non trouvé' })
    
    if (req.file) {
      if (content.thumbnail && content.thumbnail.startsWith('/uploads/')) {
        const oldPath = content.thumbnail.replace(/^\//, '')
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath)
      }
      req.body.thumbnail = `/uploads/chef-content/${req.file.filename}`
    }
    
    const updateData = { ...req.body }
    if (updateData.isLive) updateData.isLive = updateData.isLive === 'true' || updateData.isLive === true
    if (updateData.featured) updateData.featured = updateData.featured === 'true' || updateData.featured === true
    if (updateData.liveStartTime) updateData.liveStartTime = new Date(updateData.liveStartTime)
    if (updateData.liveEndTime) updateData.liveEndTime = new Date(updateData.liveEndTime)
    if (updateData.duration) updateData.duration = parseInt(updateData.duration)
    
    await content.update(updateData)
    
    const updatedContent = await ChefContent.findByPk(content.id, {
      include: [
        { model: Product, as: 'product', attributes: ['name', 'image'] },
        { model: User, as: 'publisher', attributes: ['nom', 'prenom', 'email'] }
      ]
    })
    
    res.json({ success: true, message: 'Mis à jour', content: updatedContent })
  } catch (error) {
    console.error('Erreur mise à jour:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// DELETE - Supprimer un contenu (admin uniquement)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Accès refusé' })
    
    const content = await ChefContent.findByPk(req.params.id)
    if (!content) return res.status(404).json({ success: false, message: 'Non trouvé' })
    
    if (content.thumbnail && content.thumbnail.startsWith('/uploads/')) {
      const imagePath = content.thumbnail.replace(/^\//, '')
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath)
    }
    
    await content.destroy()
    res.json({ success: true, message: 'Supprimé' })
  } catch (error) {
    console.error('Erreur suppression:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// POST - Liker un contenu
router.post('/:id/like', authenticate, async (req, res) => {
  try {
    const content = await ChefContent.findByPk(req.params.id)
    if (!content) return res.status(404).json({ success: false, message: 'Non trouvé' })
    
    let likes = Array.isArray(content.likes) ? [...content.likes] : []
    const index = likes.indexOf(req.user.id)
    
    if (index > -1) likes.splice(index, 1)
    else likes.push(req.user.id)
    
    await content.update({ likes })
    res.json({ success: true, likesCount: likes.length })
  } catch (error) {
    console.error('Erreur like:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

export default router


