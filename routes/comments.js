import express from 'express'
import { Op, fn, col, literal } from 'sequelize'
import { Comment, Product, User, Notification, sequelize } from '../models/index.js'
import { authenticate } from '../middleware/auth.js'

const router = express.Router()

// Helper to validate UUID
const isValidUUID = (id) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
};

// Obtenir les commentaires d'un produit
router.get('/product/:productId', async (req, res) => {
  try {
    const productId = req.params.productId
    const { productName } = req.query

    let actualProductId = productId;

    // Handle non-UUID (mock product ID from frontend)
    if (!isValidUUID(productId)) {
      if (!productName) {
        return res.json({ success: true, comments: [] });
      }
      
      const product = await Product.findOne({ where: { name: productName } });
      if (!product) {
        return res.json({ success: true, comments: [] });
      }
      actualProductId = product.id;
    }

    const comments = await Comment.findAll({
      where: { productId: actualProductId },
      include: [
        { model: User, as: 'user', attributes: ['nom', 'prenom', 'email', 'profileImage'] }
      ],
      order: [['createdAt', 'DESC']]
    })

    res.json({
      success: true,
      comments
    })
  } catch (error) {
    console.error('Erreur récupération commentaires:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des commentaires'
    })
  }
})

// Ajouter un commentaire (nécessite authentification)
router.post('/product/:productId', authenticate, async (req, res) => {
  try {
    const { content, rating, productName, productData } = req.body
    const productId = req.params.productId

    if (!content || !rating) {
      return res.status(400).json({
        success: false,
        message: 'Contenu et note sont requis'
      })
    }

    let actualProductId = productId;

    // Handle non-UUID (mock product ID from frontend)
    if (!isValidUUID(productId)) {
      if (!productName) {
         return res.status(400).json({
          success: false,
          message: 'Nom du produit requis pour les produits non enregistrés'
        })
      }

      // Find by name, or create if it doesn't exist
      let product = await Product.findOne({ where: { name: productName } });
      
      if (!product) {
        product = await Product.create({
          name: productName,
          description: productData?.description || `${productName} - Produit ajouté automatiquement suite à un avis.`,
          price: productData?.price || 0,
          category: productData?.category || 'Non classé',
          image: productData?.image || '/images/placeholder.jpg',
        });
      }
      actualProductId = product.id;
    } else {
      // Check if product exists for valid UUID
      const product = await Product.findByPk(productId)
      if (!product) {
        return res.status(404).json({
          success: false,
          message: 'Produit non trouvé'
        })
      }
    }

    const sentiment = rating >= 4 ? 'positive' : (rating <= 2 ? 'negative' : 'neutral');

    const comment = await Comment.create({
      userId: req.user.id,
      productId: actualProductId,
      content,
      rating,
      sentiment
    })

    const detailedComment = await Comment.findByPk(comment.id, {
      include: [
        { model: User, as: 'user', attributes: ['nom', 'prenom', 'email'] },
        { model: Product, attributes: ['name', 'category', 'image'] }
      ]
    })

    res.status(201).json({
      success: true,
      message: 'Commentaire ajouté avec succès',
      comment: detailedComment
    })
  } catch (error) {
    console.error('Erreur ajout commentaire:', error)
    res.status(500).json({
      success: false,
      message: error.message || 'Erreur lors de l\'ajout du commentaire'
    })
  }
})

// Mettre à jour un commentaire (propriétaire uniquement)
router.put('/:id', authenticate, async (req, res) => {
  try {
    const commentId = req.params.id
    const comment = await Comment.findByPk(commentId)

    if (!comment) {
      return res.status(404).json({ success: false, message: 'Commentaire non trouvé' })
    }

    if (comment.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Non autorisé' })
    }

    const { content, rating } = req.body
    const sentiment = rating ? (rating >= 4 ? 'positive' : (rating <= 2 ? 'negative' : 'neutral')) : comment.sentiment;
    await comment.update({ content, rating, sentiment })

    const detailedComment = await Comment.findByPk(commentId, {
      include: [{ model: User, as: 'user', attributes: ['nom', 'prenom', 'email'] }]
    })

    res.json({
      success: true,
      message: 'Commentaire mis à jour',
      comment: detailedComment
    })
  } catch (error) {
    console.error('Erreur mise à jour commentaire:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour du commentaire'
    })
  }
})

// Supprimer un commentaire (propriétaire ou admin)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const comment = await Comment.findByPk(req.params.id)

    if (!comment) {
      return res.status(404).json({ success: false, message: 'Commentaire non trouvé' })
    }

    if (comment.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Non autorisé' })
    }

    await comment.destroy()

    res.json({
      success: true,
      message: 'Commentaire supprimé'
    })
  } catch (error) {
    console.error('Erreur suppression commentaire:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression du commentaire'
    })
  }
})

// Obtenir tous les commentaires avec pagination (admin uniquement)
router.get('/admin/all', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Accès refusé' })
    }

    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 10
    const offset = (page - 1) * limit
    const search = req.query.search || ''

    const where = {}
    if (search) {
      where[Op.or] = [
        { content: { [Op.iLike]: `%${search}%` } },
        { '$user.prenom$': { [Op.iLike]: `%${search}%` } },
        { '$user.nom$': { [Op.iLike]: `%${search}%` } },
        { '$Product.name$': { [Op.iLike]: `%${search}%` } }
      ]
    }

    const { count, rows: comments } = await Comment.findAndCountAll({
      where,
      include: [
        { model: User, as: 'user', attributes: ['id', 'nom', 'prenom', 'email', 'profileImage'] },
        { model: Product, attributes: ['id', 'name', 'category', 'image'] }
      ],
      limit,
      offset,
      order: [['createdAt', 'DESC']],
      distinct: true // Important for correct count with includes
    })

    res.json({
      success: true,
      comments,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      }
    })
  } catch (error) {
    console.error('Erreur récupération admin tous commentaires:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// Statistiques de commentaires (admin uniquement)
router.get('/admin/statistics', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Accès refusé' })
    }

    const totalComments = await Comment.count()
    
    // Use rating thresholds as fallback for older comments or more accurate stats
    const positiveCount = await Comment.count({ 
      where: { 
        [Op.or]: [
          { sentiment: 'positive' },
          { rating: { [Op.gte]: 4 } }
        ]
      } 
    })
    const negativeCount = await Comment.count({ 
      where: { 
        [Op.or]: [
          { sentiment: 'negative' },
          { rating: { [Op.lte]: 2 } }
        ]
      } 
    })
    const neutralCount = await Comment.count({ 
      where: { 
        [Op.and]: [
          { sentiment: 'neutral' },
          { rating: 3 }
        ]
      } 
    })

    const productStatsData = await Comment.findAll({
      attributes: [
        'productId',
        [fn('COUNT', col('Comment.id')), 'totalComments'],
        [fn('AVG', col('Comment.rating')), 'avgRating'],
        [literal(`SUM(CASE WHEN "Comment"."rating" >= 4 THEN 1 ELSE 0 END)`), 'positiveCount'],
        [literal(`SUM(CASE WHEN "Comment"."rating" <= 2 THEN 1 ELSE 0 END)`), 'negativeCount']
      ],
      include: [{ model: Product, attributes: ['id', 'name', 'category', 'image'] }],
      group: ['productId', 'Product.id'],
      order: [[fn('COUNT', col('Comment.id')), 'DESC']]
    })

    const formattedProductStats = productStatsData.map(stat => {
      const data = stat.toJSON()
      return {
        productId: data.productId,
        totalComments: parseInt(data.totalComments || 0, 10),
        avgRating: parseFloat(data.avgRating || 0),
        positiveCount: parseInt(data.positiveCount || 0, 10),
        negativeCount: parseInt(data.negativeCount || 0, 10),
        productName: data.Product ? data.Product.name : 'Produit inconnu',
        productCategory: data.Product ? data.Product.category : '',
        productImage: data.Product ? data.Product.image : null
      }
    })

    // Lister les plaintes détaillées
    const complaints = await Comment.findAll({
      where: { rating: { [Op.lte]: 2 } },
      include: [
        { model: Product, attributes: ['id', 'name', 'image'] },
        { model: User, as: 'user', attributes: ['prenom', 'nom', 'email'] }
      ],
      order: [['createdAt', 'DESC']],
      limit: 20
    })

    // Lister les commentaires positifs
    const positiveComments = await Comment.findAll({
      where: { rating: { [Op.gte]: 4 } },
      include: [
        { model: Product, attributes: ['id', 'name', 'image'] },
        { model: User, as: 'user', attributes: ['prenom', 'nom', 'email'] }
      ],
      order: [['createdAt', 'DESC']],
      limit: 20
    })

    res.json({
      success: true,
      statistics: {
        total: totalComments,
        positive: positiveCount,
        negative: negativeCount,
        neutral: neutralCount
      },
      productStats: formattedProductStats,
      complaints,
      positiveComments
    })
  } catch (error) {
    console.error('Erreur statistiques commentaires:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// Liker/Unliker un commentaire
router.post('/:id/like', authenticate, async (req, res) => {
  try {
    const comment = await Comment.findByPk(req.params.id)

    if (!comment) {
      return res.status(404).json({ success: false, message: 'Commentaire non trouvé' })
    }

    let likes = Array.isArray(comment.likes) ? [...comment.likes] : []
    const isLiked = likes.includes(req.user.id)

    if (isLiked) likes = likes.filter(id => id !== req.user.id)
    else likes.push(req.user.id)

    await comment.update({ likes })

    res.json({
      success: true,
      message: isLiked ? 'Like retiré' : 'Commentaire aimé',
      likes,
      likesCount: likes.length
    })
  } catch (error) {
    console.error('Erreur like commentaire:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// Répondre à un commentaire
router.post('/:id/reply', authenticate, async (req, res) => {
  try {
    const { content } = req.body
    if (!content) return res.status(400).json({ success: false, message: 'Contenu requis' })

    const comment = await Comment.findByPk(req.params.id)
    if (!comment) return res.status(404).json({ success: false, message: 'Commentaire non trouvé' })

    let replies = Array.isArray(comment.replies) ? [...comment.replies] : []
    const newReply = {
      id: Date.now().toString(), // Mock ID for JSON field
      user: req.user.id,
      content: content.trim(),
      createdAt: new Date()
    }
    replies.push(newReply)

    await comment.update({ replies })

    res.status(201).json({
      success: true,
      message: 'Réponse ajoutée',
      reply: newReply
    })
  } catch (error) {
    console.error('Erreur réponse commentaire:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

export default router




