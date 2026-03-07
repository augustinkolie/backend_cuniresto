import express from 'express'
import { Op } from 'sequelize'
import { Delivery, Order, User, sequelize } from '../models/index.js'
import { authenticate } from '../middleware/auth.js'
import { sendSMS, sendWhatsApp } from '../utils/notifications.js'

const router = express.Router()

// Calculer le temps estimé de livraison
const calculateEstimatedTime = (deliveryMode, distance = null) => {
  const baseTimes = {
    express: 15, // 15 minutes
    standard: 30, // 30 minutes
    click_collect: 20 // 20 minutes
  }

  let estimatedTime = baseTimes[deliveryMode] || 30

  // Ajuster selon la distance si disponible (1 minute par km supplémentaire)
  if (distance && distance > 5) {
    const extraMinutes = Math.ceil((distance - 5) * 1)
    estimatedTime += extraMinutes
  }

  return estimatedTime
}

// Calculer les frais de livraison
const calculateDeliveryFee = (deliveryMode, distance = null) => {
  const baseFees = {
    express: 5000, // 5000 GNF
    standard: 3000, // 3000 GNF
    click_collect: 0 // Gratuit
  }

  let fee = baseFees[deliveryMode] || 3000

  // Ajuster selon la distance si disponible
  if (distance && distance > 10) {
    const extraFee = Math.ceil((distance - 10) * 500) // 500 GNF par km supplémentaire
    fee += extraFee
  }

  return fee
}

// GET - Obtenir toutes les livraisons (admin) ou les livraisons de l'utilisateur
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, deliveryMode } = req.query
    const where = {}
    if (req.user.role !== 'admin') {
      where.userId = req.user.id
    }

    if (status) where.status = status
    if (deliveryMode) where.deliveryMode = deliveryMode

    const deliveries = await Delivery.findAll({
      where,
      include: [
        { model: Order, as: 'order' },
        { model: User, as: 'customer', attributes: ['nom', 'prenom', 'email', 'telephone'] },
        { model: User, as: 'driver', attributes: ['nom', 'prenom', 'email', 'telephone'] }
      ],
      order: [['createdAt', 'DESC']]
    })

    res.json({
      success: true,
      deliveries
    })
  } catch (error) {
    console.error('Erreur récupération livraisons:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des livraisons'
    })
  }
})

// GET - Obtenir une livraison spécifique
router.get('/:id', authenticate, async (req, res) => {
  try {
    const delivery = await Delivery.findByPk(req.params.id, {
      include: [
        { model: Order, as: 'order' },
        { model: User, as: 'customer', attributes: ['nom', 'prenom', 'email', 'telephone'] },
        { model: User, as: 'driver', attributes: ['nom', 'prenom', 'email', 'telephone'] }
      ]
    })

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: 'Livraison non trouvée'
      })
    }

    // Vérifier que l'utilisateur peut voir cette livraison
    if (req.user.role !== 'admin' && delivery.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé'
      })
    }

    res.json({
      success: true,
      delivery
    })
  } catch (error) {
    console.error('Erreur récupération livraison:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération de la livraison'
    })
  }
})

// POST - Créer une livraison (lors de la commande)
router.post('/', authenticate, async (req, res) => {
  try {
    const {
      orderId,
      deliveryMode,
      deliveryAddress,
      scheduledTime,
      distance
    } = req.body

    // Vérifier que la commande existe
    const order = await Order.findByPk(orderId)
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Commande non trouvée'
      })
    }

    // Vérifier que la commande appartient à l'utilisateur
    if (order.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé'
      })
    }

    // Calculer le temps estimé et les frais
    const estimatedTime = calculateEstimatedTime(deliveryMode, distance)
    const deliveryFee = calculateDeliveryFee(deliveryMode, distance)

    const delivery = await Delivery.create({
      orderId: orderId,
      userId: order.userId,
      deliveryMode: deliveryMode || 'standard',
      estimatedTime,
      deliveryFee,
      deliveryAddress,
      scheduledTime: scheduledTime ? new Date(scheduledTime) : null,
      status: 'pending',
      trackingHistory: [{
        status: 'pending',
        timestamp: new Date(),
        message: 'Commande créée, en attente de préparation'
      }]
    })

    const detailedDelivery = await Delivery.findByPk(delivery.id, {
      include: [
        { model: Order, as: 'order' },
        { model: User, as: 'customer', attributes: ['nom', 'prenom', 'email', 'telephone'] }
      ]
    })

    // Envoyer notification initiale
    try {
      if (req.user.telephone) {
        await sendSMS(
          req.user.telephone,
          `Votre commande #${orderId} a été créée. Temps estimé: ${estimatedTime} min. Mode: ${deliveryMode}`
        )
      }
    } catch (notifError) {
      console.error('Erreur envoi SMS:', notifError)
    }

    res.status(201).json({
      success: true,
      message: 'Livraison créée avec succès',
      delivery: detailedDelivery
    })
  } catch (error) {
    console.error('Erreur création livraison:', error)
    res.status(500).json({
      success: false,
      message: error.message || 'Erreur lors de la création de la livraison'
    })
  }
})

// PUT - Mettre à jour le statut d'une livraison
router.put('/:id/status', authenticate, async (req, res) => {
  try {
    const { status, location, message } = req.body

    const delivery = await Delivery.findByPk(req.params.id, {
      include: [{ model: User, as: 'customer' }]
    })

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: 'Livraison non trouvée'
      })
    }

    // Vérifier les permissions (admin ou livreur assigné)
    if (req.user.role !== 'admin' &&
      (!delivery.deliveryPersonId || delivery.deliveryPersonId !== req.user.id)) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé'
      })
    }

    // Ajouter un point de suivi
    const history = [...(delivery.trackingHistory || [])]
    history.push({
      status,
      location,
      message: message || `Statut mis à jour vers ${status}`,
      timestamp: new Date()
    })
    
    const updateData = {
        trackingHistory: history,
        status: status
    }

    // Mettre à jour les timestamps selon le statut
    if (status === 'picked_up') {
      updateData.pickedUpAt = new Date()
    } else if (status === 'delivered') {
      updateData.deliveredAt = new Date()
      if (delivery.pickedUpAt) {
        updateData.actualTime = Math.round((new Date() - new Date(delivery.pickedUpAt)) / 60000)
      }
    }

    await delivery.update(updateData)
    
    const updatedDelivery = await Delivery.findByPk(delivery.id, {
      include: [
        { model: Order, as: 'order' },
        { model: User, as: 'customer', attributes: ['nom', 'prenom', 'email', 'telephone'] }
      ]
    })

    // Envoyer notifications selon le statut
    if (delivery.customer?.telephone) {
      const statusMessages = {
        preparing: 'Votre commande est en préparation',
        ready: 'Votre commande est prête',
        assigned: 'Un livreur a été assigné à votre commande',
        picked_up: 'Votre commande a été récupérée par le livreur',
        in_transit: 'Votre commande est en route',
        arrived: 'Votre livreur est arrivé',
        delivered: 'Votre commande a été livrée avec succès !'
      }

      const notificationMessage = statusMessages[status] || `Statut de votre commande: ${status}`

      try {
        await sendSMS(delivery.customer.telephone, notificationMessage)
        await sendWhatsApp(delivery.customer.telephone, notificationMessage)
      } catch (notifError) {
        console.error('Erreur envoi notifications:', notifError)
      }
    }

    res.json({
      success: true,
      message: 'Statut mis à jour avec succès',
      delivery: updatedDelivery
    })
  } catch (error) {
    console.error('Erreur mise à jour statut:', error)
    res.status(500).json({
      success: false,
      message: error.message || 'Erreur lors de la mise à jour du statut'
    })
  }
})

// PUT - Assigner un livreur
router.put('/:id/assign', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Accès refusé' })
    }

    const { deliveryPersonId, deliveryPersonDetails } = req.body
    const delivery = await Delivery.findByPk(req.params.id, {
      include: [{ model: User, as: 'customer' }]
    })

    if (!delivery) return res.status(404).json({ success: false, message: 'Non trouvé' })

    const updateData = {
      deliveryPersonId: deliveryPersonId || delivery.deliveryPersonId,
      status: 'assigned'
    }

    const history = [...(delivery.trackingHistory || [])]
    history.push({
      status: 'assigned',
      timestamp: new Date(),
      message: 'Livreur assigné'
    })
    updateData.trackingHistory = history

    await delivery.update(updateData)

    if (deliveryPersonDetails) {
        await Order.update({
            deliveryStatus: {
                driver: {
                    name: deliveryPersonDetails.name,
                    phone: deliveryPersonDetails.phone,
                    vehicle: deliveryPersonDetails.vehicle,
                    avatar: deliveryPersonDetails.avatar || null
                }
            }
        }, { where: { id: delivery.orderId } })
    }

    res.json({ success: true, message: 'Assigné', delivery })
  } catch (error) {
    console.error('Erreur assignation:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// POST - Mettre à jour la position du livreur
router.post('/:id/tracking', authenticate, async (req, res) => {
  try {
    const { lat, lng, address } = req.body
    const delivery = await Delivery.findByPk(req.params.id)

    if (!delivery) return res.status(404).json({ success: false, message: 'Non trouvé' })

    if (req.user.role !== 'admin' && delivery.deliveryPersonId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Accès refusé' })
    }

    const history = [...(delivery.trackingHistory || [])]
    history.push({
      status: delivery.status,
      location: { lat, lng, address },
      timestamp: new Date(),
      message: 'Position mise à jour'
    })
    await delivery.update({ trackingHistory: history })

    res.json({ success: true, message: 'Position mise à jour' })
  } catch (error) {
    console.error('Erreur tracking:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// GET - Obtenir les livraisons en cours
router.get('/delivery-person/active', authenticate, async (req, res) => {
  try {
    const deliveries = await Delivery.findAll({
      where: {
        deliveryPersonId: req.user.id,
        status: { [Op.in]: ['assigned', 'picked_up', 'in_transit', 'arrived'] }
      },
      include: [
        { model: Order, as: 'order' },
        { model: User, as: 'customer', attributes: ['nom', 'prenom', 'telephone'] }
      ],
      order: [['createdAt', 'DESC']]
    })

    res.json({ success: true, deliveries })
  } catch (error) {
    console.error('Erreur livraisons actives:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// POST - Estimer le temps et les frais de livraison
router.post('/estimate', authenticate, async (req, res) => {
  try {
    const { deliveryMode, distance } = req.body
    const estimatedTime = calculateEstimatedTime(deliveryMode || 'standard', distance)
    const deliveryFee = calculateDeliveryFee(deliveryMode || 'standard', distance)

    res.json({
      success: true,
      estimate: { estimatedTime, deliveryFee, deliveryMode: deliveryMode || 'standard' }
    })
  } catch (error) {
    console.error('Erreur estimation:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

export default router
