import express from 'express'
import { Op, fn, col, literal } from 'sequelize'
import { Reservation, Product, Comment, User, Order, OrderItem, sequelize } from '../models/index.js'
import { authenticate } from '../middleware/auth.js'

const router = express.Router()

// Toutes les routes nécessitent une authentification admin
router.use(authenticate)

// Middleware pour vérifier le rôle admin
const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Accès refusé. Admin uniquement.'
    })
  }
  next()
}

// Statistiques de performance globales
router.get('/performance', isAdmin, async (req, res) => {
  try {
    const { period = '30' } = req.query // 7, 30, 90, 365 jours
    const days = parseInt(period)
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    // Statistiques de réservations
    const totalReservations = await Reservation.count({
      where: { createdAt: { [Op.gte]: startDate } }
    })
    
    const confirmedReservations = await Reservation.count({
      where: {
        status: 'confirmed',
        createdAt: { [Op.gte]: startDate }
      }
    })
    
    const cancelledReservations = await Reservation.count({
      where: {
        status: 'cancelled',
        createdAt: { [Op.gte]: startDate }
      }
    })

    // Taux de confirmation
    const confirmationRate = totalReservations > 0 
      ? ((confirmedReservations / totalReservations) * 100).toFixed(1)
      : 0

    // Statistiques de produits
    const totalProducts = await Product.count()
    const featuredProducts = await Product.count({ where: { featured: true } })
    const lowStockProducts = await Product.count({ where: { stock: { [Op.lt]: 10 } } })

    // Statistiques de commentaires
    const totalComments = await Comment.count({
      where: { createdAt: { [Op.gte]: startDate } }
    })
    const positiveComments = await Comment.count({
      where: {
        sentiment: 'positive',
        createdAt: { [Op.gte]: startDate }
      }
    })
    const negativeComments = await Comment.count({
      where: {
        sentiment: 'negative',
        createdAt: { [Op.gte]: startDate }
      }
    })

    // Taux de satisfaction
    const satisfactionRate = totalComments > 0
      ? ((positiveComments / totalComments) * 100).toFixed(1)
      : 0

    // Statistiques d'utilisateurs
    const totalUsers = await User.count({
      where: { createdAt: { [Op.gte]: startDate } }
    })
    const activeUsers = await User.count({
      where: { lastLogin: { [Op.gte]: startDate } }
    })

    res.json({
      success: true,
      period: days,
      statistics: {
        reservations: {
          total: totalReservations,
          confirmed: confirmedReservations,
          cancelled: cancelledReservations,
          confirmationRate: parseFloat(confirmationRate)
        },
        products: {
          total: totalProducts,
          featured: featuredProducts,
          lowStock: lowStockProducts
        },
        comments: {
          total: totalComments,
          positive: positiveComments,
          negative: negativeComments,
          satisfactionRate: parseFloat(satisfactionRate)
        },
        users: {
          total: totalUsers,
          active: activeUsers
        }
      }
    })
  } catch (error) {
    console.error('Erreur récupération statistiques performance:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des statistiques'
    })
  }
})

// Suivi des ventes (basé sur les réservations)
router.get('/sales', isAdmin, async (req, res) => {
  try {
    const { period = '30' } = req.query
    const days = parseInt(period)
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    // Réservations par jour
    const reservationsByDay = await Reservation.findAll({
      where: {
        status: 'confirmed',
        createdAt: { [Op.gte]: startDate }
      },
      attributes: [
        [fn('TO_CHAR', col('createdAt'), 'YYYY-MM-DD'), 'day'],
        [fn('COUNT', col('id')), 'count'],
        [fn('SUM', col('guests')), 'totalGuests']
      ],
      group: [fn('TO_CHAR', col('createdAt'), 'YYYY-MM-DD')],
      order: [[fn('TO_CHAR', col('createdAt'), 'YYYY-MM-DD'), 'ASC']],
      raw: true
    })
    
    // Reformater pour correspondre à l'ancien format Mongoose (_id)
    const formattedByDay = reservationsByDay.map(d => ({
      _id: d.day,
      count: parseInt(d.count),
      totalGuests: parseInt(d.totalGuests || 0)
    }))

    // Réservations par catégorie (basé sur les produits dans les réservations - Note: si stocké différemment, adapter)
    const reservationsByCategory = await Reservation.findAll({
      where: {
        status: 'confirmed',
        createdAt: { [Op.gte]: startDate }
      },
      attributes: [
        [fn('TO_CHAR', col('date'), 'YYYY-MM-DD'), 'day'],
        [fn('COUNT', col('id')), 'count']
      ],
      group: [fn('TO_CHAR', col('date'), 'YYYY-MM-DD')],
      raw: true
    })

    // Tendance des réservations
    const trend = reservationsByDay.length > 1
      ? ((reservationsByDay[reservationsByDay.length - 1].count - reservationsByDay[0].count) / reservationsByDay[0].count * 100).toFixed(1)
      : 0

    res.json({
      success: true,
      period: days,
      sales: {
        byDay: formattedByDay,
        trend: parseFloat(trend),
        totalReservations: formattedByDay.reduce((sum, day) => sum + day.count, 0),
        totalGuests: formattedByDay.reduce((sum, day) => sum + day.totalGuests, 0)
      }
    })
  } catch (error) {
    console.error('Erreur récupération ventes:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des ventes'
    })
  }
})

// Popularité des plats
router.get('/popularity', isAdmin, async (req, res) => {
  try {
    // Top produits par commentaires
    // Top produits par commentaires
    const popularByComments = await Comment.findAll({
      attributes: [
        'productId',
        [fn('COUNT', col('id')), 'totalComments'],
        [fn('AVG', col('rating')), 'avgRating'],
        [fn('SUM', literal("CASE WHEN sentiment = 'positive' THEN 1 ELSE 0 END")), 'positiveComments']
      ],
      include: [
        { model: Product, attributes: ['name', 'image', 'category'] }
      ],
      group: ['productId', 'Product.id'],
      order: [[literal("(COUNT(id) * 0.4) + (AVG(rating) * 10) + (SUM(CASE WHEN sentiment = 'positive' THEN 1 ELSE 0 END) * 0.6)"), 'DESC']],
      limit: 10
    })
    
    // Reformater pour correspondre à l'attendue
    const formattedPopular = popularByComments.map(c => ({
      _id: c.productId,
      productName: c.Product.name,
      productImage: c.Product.image,
      productCategory: c.Product.category,
      totalComments: parseInt(c.get('totalComments')),
      avgRating: parseFloat(parseFloat(c.get('avgRating')).toFixed(1)),
      positiveComments: parseInt(c.get('positiveComments')),
      popularityScore: (parseInt(c.get('totalComments')) * 0.4) + (parseFloat(c.get('avgRating')) * 10) + (parseInt(c.get('positiveComments')) * 0.6)
    }))

    // Top produits par stock (les moins en stock = supposés plus vendus)
    const popularByStock = await Product.findAll({
      order: [['stock', 'ASC'], ['rating', 'DESC']],
      limit: 10,
      attributes: ['id', 'name', 'image', 'category', 'rating', 'reviews', 'stock']
    })

    // Produits les mieux notés
    const topRated = await Product.findAll({
      where: { reviews: { [Op.gt]: 0 } },
      order: [['rating', 'DESC'], ['reviews', 'DESC']],
      limit: 10,
      attributes: ['id', 'name', 'image', 'category', 'rating', 'reviews']
    })

    res.json({
      success: true,
      popularity: {
        byComments: formattedPopular,
        byStock: popularByStock,
        topRated: topRated
      }
    })
  } catch (error) {
    console.error('Erreur récupération popularité:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération de la popularité'
    })
  }
})

// Heures de forte affluence
router.get('/peak-hours', isAdmin, async (req, res) => {
  try {
    const { period = '30' } = req.query
    const days = parseInt(period)
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    // Réservations par heure
    // Réservations par heure
    const reservationsByHour = await Reservation.findAll({
      where: {
        status: 'confirmed',
        createdAt: { [Op.gte]: startDate }
      },
      attributes: [
        [fn('EXTRACT', literal('HOUR FROM date')), 'hour'],
        [fn('COUNT', col('id')), 'totalReservations'],
        [fn('SUM', col('guests')), 'totalGuests'],
        [fn('AVG', col('guests')), 'avgGuests']
      ],
      group: [fn('EXTRACT', literal('HOUR FROM date'))],
      order: [[fn('EXTRACT', literal('HOUR FROM date')), 'ASC']],
      raw: true
    })

    // Reformater
    const formattedByHour = reservationsByHour.map(h => ({
      _id: h.hour,
      totalReservations: parseInt(h.totalReservations),
      totalGuests: parseInt(h.totalGuests),
      avgGuests: parseFloat(parseFloat(h.avgGuests).toFixed(1))
    }))

    // Réservations par jour de la semaine
    // Réservations par jour de la semaine
    const reservationsByDayOfWeek = await Reservation.findAll({
      where: {
        status: 'confirmed',
        createdAt: { [Op.gte]: startDate }
      },
      attributes: [
        [fn('EXTRACT', literal('DOW FROM date')), 'dayOfWeek'],
        [fn('COUNT', col('id')), 'count'],
        [fn('SUM', col('guests')), 'totalGuests']
      ],
      group: [fn('EXTRACT', literal('DOW FROM date'))],
      order: [[fn('EXTRACT', literal('DOW FROM date')), 'ASC']],
      raw: true
    })

    const formattedByDayOfWeek = reservationsByDayOfWeek.map(d => ({
      _id: d.dayOfWeek,
      count: parseInt(d.count),
      totalGuests: parseInt(d.totalGuests)
    }))

    const peakHours = formattedByHour
      .sort((a, b) => b.totalReservations - a.totalReservations)
      .slice(0, 3)
      .map(h => ({
        hour: h._id,
        reservations: h.totalReservations,
        guests: h.totalGuests
      }))

    res.json({
      success: true,
      period: days,
      peakHours: {
        byHour: formattedByHour,
        byDayOfWeek: formattedByDayOfWeek,
        topPeakHours: peakHours
      }
    })
  } catch (error) {
    console.error('Erreur récupération heures de pointe:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des heures de pointe'
    })
  }
})

// Analyse automatique pour optimiser le menu
router.get('/menu-optimization', isAdmin, async (req, res) => {
  try {
    // Produits avec peu de commentaires mais bon rating
    // Produits avec peu de commentaires mais bon rating (Sequelize simple)
    const underratedProducts = await Product.findAll({
      where: {
        rating: { [Op.gte]: 4 },
        reviews: { [Op.lt]: 5 }
      },
      order: [['rating', 'DESC']],
      limit: 5
    })

    // Produits avec beaucoup de commentaires négatifs
    // Produits avec beaucoup de commentaires négatifs
    const problematicProductsData = await Comment.findAll({
      attributes: [
        'productId',
        [fn('COUNT', literal("CASE WHEN sentiment = 'negative' THEN 1 END")), 'negativeCount'],
        [fn('COUNT', col('id')), 'totalComments'],
        [fn('AVG', col('rating')), 'avgRating']
      ],
      include: [
        { model: Product, attributes: ['name', 'image', 'category'] }
      ],
      group: ['productId', 'Product.id'],
      having: literal("COUNT(CASE WHEN sentiment = 'negative' THEN 1 END) >= 3 AND AVG(rating) < 3"),
      order: [[literal("COUNT(CASE WHEN sentiment = 'negative' THEN 1 END)"), 'DESC']]
    })

    const problematicProducts = problematicProductsData.map(p => ({
      productName: p.Product.name,
      productImage: p.Product.image,
      productCategory: p.Product.category,
      negativeCount: parseInt(p.get('negativeCount')),
      totalComments: parseInt(p.get('totalComments')),
      avgRating: parseFloat(parseFloat(p.get('avgRating')).toFixed(1))
    }))

    // Produits en rupture de stock fréquente
    // Produits en rupture de stock fréquente
    const lowStockProducts = await Product.findAll({
      where: { stock: { [Op.lt]: 10 } },
      order: [['stock', 'ASC']],
      limit: 10,
      attributes: ['name', 'category', 'image', 'stock', 'rating']
    })

    // Recommandations
    const recommendations = []

    if (underratedProducts.length > 0) {
      recommendations.push({
        type: 'promote',
        title: 'Produits sous-estimés',
        message: `${underratedProducts.length} produit(s) avec un bon rating mais peu de visibilité`,
        products: underratedProducts,
        action: 'Mettre en avant ces produits pour augmenter leur visibilité'
      })
    }

    if (problematicProducts.length > 0) {
      recommendations.push({
        type: 'review',
        title: 'Produits à améliorer',
        message: `${problematicProducts.length} produit(s) avec plusieurs commentaires négatifs`,
        products: problematicProducts,
        action: 'Réviser la qualité ou la préparation de ces plats'
      })
    }

    if (lowStockProducts.length > 0) {
      recommendations.push({
        type: 'restock',
        title: 'Stock faible',
        message: `${lowStockProducts.length} produit(s) avec un stock inférieur à 10`,
        products: lowStockProducts,
        action: 'Réapprovisionner ces produits rapidement'
      })
    }

    res.json({
      success: true,
      optimization: {
        underratedProducts,
        problematicProducts,
        lowStockProducts,
        recommendations
      }
    })
  } catch (error) {
    console.error('Erreur analyse optimisation menu:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse d\'optimisation'
    })
  }
})

// Historique et Rapports de Ventes (Basé sur les commandes réelles)
router.get('/sales-history', isAdmin, async (req, res) => {
  try {
    const { startDate, endDate, status, minAmount, maxAmount } = req.query
    const where = {}

    if (startDate || endDate) {
      where.createdAt = {}
      if (startDate) where.createdAt[Op.gte] = new Date(startDate)
      if (endDate) {
        const end = new Date(endDate)
        end.setHours(23, 59, 59, 999)
        where.createdAt[Op.lte] = end
      }
    }

    if (status && status !== 'all') {
      where.status = status
    }

    if (minAmount || maxAmount) {
      where.total = {}
      if (minAmount) where.total[Op.gte] = parseFloat(minAmount)
      if (maxAmount) where.total[Op.lte] = parseFloat(maxAmount)
    }

    // Récupérer les commandes avec détails
    const orders = await Order.findAll({
      where,
      include: [
        { model: User, attributes: ['nom', 'prenom', 'email'] },
        { model: OrderItem, as: 'items' }
      ],
      order: [['createdAt', 'DESC']]
    })

    // Calculer les statistiques pour cette période/filtre
    const totalRevenue = orders.reduce((sum, o) => sum + parseFloat(o.total), 0)
    const orderCount = orders.length
    const averageOrderValue = orderCount > 0 ? (totalRevenue / orderCount).toFixed(2) : 0

    // Répartition par méthode de paiement
    const paymentMethods = orders.reduce((acc, o) => {
      const method = o.paymentMethod || 'Autre'
      acc[method] = (acc[method] || 0) + 1
      return acc
    }, {})

    res.json({
      success: true,
      data: {
        orders,
        summary: {
          totalRevenue,
          orderCount,
          averageOrderValue: parseFloat(averageOrderValue),
          paymentMethods
        }
      }
    })
  } catch (error) {
    console.error('Erreur historique ventes:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération de l\'historique des ventes'
    })
  }
})

export default router



