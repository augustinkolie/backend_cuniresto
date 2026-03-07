import express from 'express'
import { Op } from 'sequelize'
import { Table, TableOrder, Product, User, sequelize } from '../models/index.js'
import { authenticate } from '../middleware/auth.js'
import { awardPointsForOrder } from './loyalty.js'

const router = express.Router()

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

// Générer un code QR unique pour une table
const generateQRCode = (tableNumber) => {
  return `T${tableNumber}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

// Obtenir toutes les tables (Admin uniquement)
router.get('/', authenticate, isAdmin, async (req, res) => {
  try {
    const tables = await Table.findAll({
      include: [{ model: TableOrder, as: 'currentOrder' }],
      order: [['tableNumber', 'ASC']]
    })
    
    res.json({ success: true, tables })
  } catch (error) {
    console.error('Erreur récupération tables:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// Créer une nouvelle table (Admin uniquement)
router.post('/', authenticate, isAdmin, async (req, res) => {
  try {
    const { tableNumber, capacity, location } = req.body
    if (!tableNumber) return res.status(400).json({ success: false, message: 'Numéro requis' })

    const existingTable = await Table.findOne({ where: { tableNumber } })
    if (existingTable) return res.status(400).json({ success: false, message: 'Déjà existante' })

    const qrCode = generateQRCode(tableNumber)
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000'
    const qrCodeUrl = `${baseUrl}/table/${qrCode}`

    const table = await Table.create({
      tableNumber, qrCode, qrCodeUrl, capacity: capacity || 4, location: location || 'indoor'
    })

    res.status(201).json({ success: true, message: 'Créée', table })
  } catch (error) {
    console.error('Erreur création table:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// Générer/Regénérer QR Code pour une table (Admin uniquement)
router.post('/:id/qrcode', authenticate, isAdmin, async (req, res) => {
  try {
    const table = await Table.findByPk(req.params.id)
    if (!table) return res.status(404).json({ success: false, message: 'Non trouvé' })

    const qrCode = generateQRCode(table.tableNumber)
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000'
    const qrCodeUrl = `${baseUrl}/table/${qrCode}`

    await table.update({ qrCode, qrCodeUrl })
    res.json({ success: true, qrCode, qrCodeUrl })
  } catch (error) {
    console.error('Erreur QR Code:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// Obtenir une table par QR Code (Public)
router.get('/qrcode/:qrCode', async (req, res) => {
  try {
    const table = await Table.findOne({ 
      where: { qrCode: req.params.qrCode },
      include: [{ model: TableOrder, as: 'currentOrder' }]
    })
    
    if (!table) return res.status(404).json({ success: false, message: 'Non trouvé' })

    res.json({ success: true, table })
  } catch (error) {
    console.error('Erreur récupération table:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// Créer une commande depuis une table (Public)
router.post('/:qrCode/order', async (req, res) => {
  try {
    const { items, customerName, customerPhone, specialRequests } = req.body
    if (!items?.length) return res.status(400).json({ success: false, message: 'Articles requis' })

    const table = await Table.findOne({ where: { qrCode: req.params.qrCode } })
    if (!table) return res.status(404).json({ success: false, message: 'Non trouvé' })

    const orderItems = []
    let total = 0
    for (const item of items) {
      const product = await Product.findByPk(item.productId)
      if (!product) return res.status(400).json({ success: false, message: `Produit ${item.productId} non trouvé` })
      if (product.stock < item.quantity) return res.status(400).json({ success: false, message: `Stock insuffisant pour ${product.name}` })

      orderItems.push({
        productId: product.id,
        name: product.name,
        price: product.price,
        quantity: item.quantity,
        image: product.image,
        notes: item.notes || ''
      })
      total += product.price * item.quantity
    }

    const order = await TableOrder.create({
      tableId: table.id,
      tableNumber: table.tableNumber,
      items: orderItems,
      total,
      customerName: customerName || '',
      customerPhone: customerPhone || '',
      specialRequests: specialRequests || '',
      status: 'pending'
    })

    await table.update({ status: 'occupied' })

    for (const item of orderItems) {
      await Product.decrement('stock', { by: item.quantity, where: { id: item.productId } })
    }

    if (customerPhone) {
      const user = await User.findOne({ where: { telephone: customerPhone } })
      if (user) await awardPointsForOrder(user.id, total, order.id).catch(console.error)
    }

    res.status(201).json({ success: true, order })
  } catch (error) {
    console.error('Erreur commande:', error)
    res.status(500).json({ success: false, message: error.message })
  }
})

// Appeler un serveur (Public)
router.post('/:qrCode/call-waiter', async (req, res) => {
  try {
    const table = await Table.findOne({ where: { qrCode: req.params.qrCode } })
    if (!table) return res.status(404).json({ success: false, message: 'Non trouvé' })

    const order = await TableOrder.findOne({
      where: { tableId: table.id, status: { [Op.not]: 'completed' } },
      order: [['createdAt', 'DESC']]
    })
    
    if (order) {
      await order.update({ waiterCall: true, waiterCallTime: new Date() })
    }

    res.json({ success: true, tableNumber: table.tableNumber })
  } catch (error) {
    console.error('Erreur appel serveur:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// Obtenir les commandes d'une table (Admin uniquement)
router.get('/:id/orders', authenticate, isAdmin, async (req, res) => {
  try {
    const orders = await TableOrder.findAll({ 
      where: { tableId: req.params.id },
      order: [['createdAt', 'DESC']]
    })
    res.json({ success: true, orders })
  } catch (error) {
    console.error('Erreur récupération commandes:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// Mettre à jour le statut d'une commande (Admin uniquement)
router.put('/orders/:orderId/status', authenticate, isAdmin, async (req, res) => {
  try {
    const { status } = req.body
    const order = await TableOrder.findByPk(req.params.orderId)
    if (!order) return res.status(404).json({ success: false, message: 'Non trouvé' })

    if (status === 'completed') {
      await order.update({ status: 'completed', completedAt: new Date() })
      const table = await Table.findByPk(order.tableId)
      if (table) await table.update({ status: 'available' })
    } else {
      await order.update({ status, servedAt: status === 'served' ? new Date() : order.servedAt })
    }

    res.json({ success: true, order })
  } catch (error) {
    console.error('Erreur mise à jour statut:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// Obtenir tous les appels serveur (Admin uniquement)
router.get('/waiter/calls', authenticate, isAdmin, async (req, res) => {
  try {
    const calls = await TableOrder.findAll({
      where: {
        waiterCall: true,
        waiterCallTime: { [Op.gte]: new Date(Date.now() - 30 * 60 * 1000) }
      },
      order: [['waiterCallTime', 'DESC']]
    })
    res.json({ success: true, calls })
  } catch (error) {
    console.error('Erreur récupération appels:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// Marquer un appel comme traité (Admin uniquement)
router.put('/waiter/calls/:orderId/acknowledge', authenticate, isAdmin, async (req, res) => {
  try {
    const order = await TableOrder.findByPk(req.params.orderId)
    if (!order) return res.status(404).json({ success: false, message: 'Non trouvé' })
    await order.update({ waiterCall: false })
    res.json({ success: true, message: 'Traité' })
  } catch (error) {
    console.error('Erreur traitement appel:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// Supprimer une table (Admin uniquement)
router.delete('/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const table = await Table.findByPk(req.params.id, {
      include: [{ model: TableOrder, as: 'currentOrder' }]
    })
    if (!table) return res.status(404).json({ success: false, message: 'Non trouvé' })

    if (table.currentOrder) {
      return res.status(400).json({ success: false, message: 'Commande en cours' })
    }

    await table.destroy()
    res.json({ success: true, message: 'Supprimée' })
  } catch (error) {
    console.error('Erreur suppression table:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

export default router
