import express from 'express'
import { Op } from 'sequelize'
import { Product } from '../models/index.js'
import { authenticate, isAdmin } from '../middleware/auth.js'

const router = express.Router()

// Obtenir tous les produits
router.get('/', async (req, res) => {
  try {
    const { category, search, featured, limit, page } = req.query
    
    const where = {}
    
    if (category) {
      where.category = category
    }
    
    if (featured === 'true') {
      where.featured = true
    }
    
    if (search) {
      where.name = { [Op.like]: `%${search}%` }
    }
    
    const pageNum = parseInt(page) || 1
    const limitNum = parseInt(limit) || 20
    const offset = (pageNum - 1) * limitNum
    
    const { count, rows: products } = await Product.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: limitNum,
      offset
    })
    
    res.json({
      success: true,
      products,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count,
        pages: Math.ceil(count / limitNum)
      }
    })
  } catch (error) {
    console.error('Erreur récupération produits:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des produits'
    })
  }
})

// Obtenir un produit par ID
router.get('/:id', async (req, res) => {
  try {
    const productId = req.params.id
    
    const product = await Product.findByPk(productId)
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Produit non trouvé'
      })
    }
    
    res.json({
      success: true,
      product
    })
  } catch (error) {
    console.error('Erreur récupération produit:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du produit'
    })
  }
})

// Obtenir les produits par catégorie
router.get('/category/:category', async (req, res) => {
  try {
    const products = await Product.findAll({ 
      where: { category: req.params.category },
      order: [['createdAt', 'DESC']]
    })
    
    res.json({
      success: true,
      products
    })
  } catch (error) {
    console.error('Erreur récupération produits par catégorie:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des produits'
    })
  }
})

// Créer un produit (Admin uniquement)
router.post('/', authenticate, isAdmin, async (req, res) => {
  try {
    const { name, description, price, category, image, prepTime, featured, stock } = req.body
    
    if (!name || !price || !category) {
      return res.status(400).json({
        success: false,
        message: 'Nom, prix et catégorie sont requis'
      })
    }
    
    const product = await Product.create({
      name,
      description,
      price,
      category,
      image,
      prepTime,
      featured,
      stock
    })
    
    res.status(201).json({
      success: true,
      message: 'Produit créé avec succès',
      product
    })
  } catch (error) {
    console.error('Erreur création produit:', error)
    res.status(500).json({
      success: false,
      message: error.message || 'Erreur lors de la création du produit'
    })
  }
})

// Mettre à jour un produit (Admin uniquement)
router.put('/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const productId = req.params.id
    
    const [updated] = await Product.update(req.body, {
      where: { id: productId }
    })
    
    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'Produit non trouvé'
      })
    }

    const product = await Product.findByPk(productId)
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Produit non trouvé'
      })
    }
    
    res.json({
      success: true,
      message: 'Produit mis à jour avec succès',
      product
    })
  } catch (error) {
    console.error('Erreur mise à jour produit:', error)
    
    // Gérer spécifiquement l'erreur de conversion ObjectId
    if (error.name === 'CastError' && error.path === '_id') {
      return res.status(400).json({
        success: false,
        message: 'ID de produit invalide'
      })
    }
    
    res.status(500).json({
      success: false,
      message: error.message || 'Erreur lors de la mise à jour du produit'
    })
  }
})

// Supprimer un produit (Admin uniquement)
router.delete('/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const productId = req.params.id
    
    const deleted = await Product.destroy({
      where: { id: productId }
    })
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Produit non trouvé'
      })
    }
    
    res.json({
      success: true,
      message: 'Produit supprimé avec succès'
    })
  } catch (error) {
    console.error('Erreur suppression produit:', error)
    
    // Gérer spécifiquement l'erreur de conversion ObjectId
    if (error.name === 'CastError' && error.path === '_id') {
      return res.status(400).json({
        success: false,
        message: 'ID de produit invalide'
      })
    }
    
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression du produit'
    })
  }
})

export default router




