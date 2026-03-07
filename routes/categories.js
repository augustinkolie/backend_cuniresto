import express from 'express'
import { fn, col } from 'sequelize'
import { Product } from '../models/index.js'

const router = express.Router()

// Obtenir toutes les catégories avec le nombre de produits
router.get('/', async (req, res) => {
  try {
    const categories = await Product.findAll({
      attributes: [
        'category',
        [fn('COUNT', col('id')), 'count']
      ],
      group: ['category'],
      order: [[fn('COUNT', col('id')), 'DESC']]
    })
    
    const categoriesWithNames = categories.map(cat => ({
      slug: cat.category,
      name: getCategoryName(cat.category),
      productCount: cat.get('count')
    }))
    
    res.json({
      success: true,
      categories: categoriesWithNames
    })
  } catch (error) {
    console.error('Erreur récupération catégories:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des catégories'
    })
  }
})

// Fonction helper pour obtenir le nom de la catégorie
function getCategoryName(slug) {
  const categoryNames = {
    'lapin': 'Lapin braisé',
    'atieke': 'Atiéké',
    'nouille': 'Nouille',
    'sandwich': 'Sandwich',
    'boissons': 'Boissons',
    'desserts': 'Desserts',
    'plats': 'Plats'
  }
  return categoryNames[slug] || slug
}

export default router





