import express from 'express'
import { Op, literal } from 'sequelize'
import { Company, CorporateOrder, CorporateInvoice, User, sequelize } from '../models/index.js'
import { authenticate } from '../middleware/auth.js'

const router = express.Router()

// GET - Obtenir toutes les entreprises (admin) ou l'entreprise de l'utilisateur
router.get('/', authenticate, async (req, res) => {
  try {
    const companies = await Company.findAll({
      where: (req.user.role !== 'admin') ? {
        [Op.or]: [
          { adminId: req.user.id },
          literal(`JSON_CONTAINS(Company.employees, '"${req.user.id}"', '$.user')`)
        ]
      } : {},
      include: [
        { model: User, as: 'admin', attributes: ['nom', 'prenom', 'email'] }
      ],
      order: [['createdAt', 'DESC']]
    })
    
    res.json({
      success: true,
      companies
    })
  } catch (error) {
    console.error('Erreur récupération entreprises:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des entreprises'
    })
  }
})

// GET - Obtenir une entreprise spécifique
router.get('/:id', authenticate, async (req, res) => {
  try {
    const company = await Company.findByPk(req.params.id, {
      include: [
        { model: User, as: 'admin', attributes: ['nom', 'prenom', 'email'] }
      ]
    })
    
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Entreprise non trouvée'
      })
    }
    
    // Vérifier que l'utilisateur peut voir cette entreprise
    const employees = Array.isArray(company.employees) ? company.employees : []
    const isEmployee = employees.some(emp => emp.user === req.user.id)
    
    if (req.user.role !== 'admin' && 
        company.adminId !== req.user.id &&
        !isEmployee) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé'
      })
    }
    
    res.json({
      success: true,
      company
    })
  } catch (error) {
    console.error('Erreur récupération entreprise:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération de l\'entreprise'
    })
  }
})

// POST - Créer une nouvelle entreprise
router.post('/', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Accès refusé. Admin uniquement.' })
    }
    
    const { name, email, phone, address, contactPerson, adminId, corporatePricing, billing } = req.body
    
    const admin = await User.findByPk(adminId)
    if (!admin) {
      return res.status(404).json({ success: false, message: 'Utilisateur admin non trouvé' })
    }
    
    const company = await Company.create({
      name, email, phone, address, contactPerson, adminId,
      corporatePricing: corporatePricing || { enabled: true, discountPercentage: 0 },
      billing: billing || { billingCycle: 'monthly', paymentMethod: 'invoice' }
    })
    
    res.status(201).json({ success: true, message: 'Entreprise créée avec succès', company })
  } catch (error) {
    console.error('Erreur création entreprise:', error)
    // Sequelize unique constraint error handling (example for email)
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({
        success: false,
        message: 'Une entreprise avec cet email existe déjà'
      })
    }
    res.status(500).json({ success: false, message: error.message || 'Erreur lors de la création de l\'entreprise' })
  }
})

// PUT - Mettre à jour une entreprise
router.put('/:id', authenticate, async (req, res) => {
  try {
    const company = await Company.findByPk(req.params.id)
    if (!company) return res.status(404).json({ success: false, message: 'Entreprise non trouvée' })
    
    if (req.user.role !== 'admin' && company.adminId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Accès refusé' })
    }
    
    const { name, email, phone, address, contactPerson, corporatePricing, billing, status } = req.body
    
    await company.update({
      name, email, phone, address, contactPerson, status,
      corporatePricing: corporatePricing ? { ...company.corporatePricing, ...corporatePricing } : company.corporatePricing,
      billing: billing ? { ...company.billing, ...billing } : company.billing
    })
    
    res.json({ success: true, message: 'Entreprise mise à jour avec succès', company })
  } catch (error) {
    console.error('Erreur mise à jour entreprise:', error)
    res.status(500).json({ success: false, message: error.message || 'Erreur lors de la mise à jour de l\'entreprise' })
  }
})

// POST - Ajouter un employé
router.post('/:id/employees', authenticate, async (req, res) => {
  try {
    const company = await Company.findByPk(req.params.id)
    if (!company) return res.status(404).json({ success: false, message: 'Entreprise non trouvée' })
    
    // Permissions check: admin or company admin
    if (req.user.role !== 'admin' && company.adminId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Accès refusé' })
    }
    
    const { userId, employeeId, department, position } = req.body
    const user = await User.findByPk(userId)
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' })
    
    const employees = Array.isArray(company.employees) ? [...company.employees] : []
    if (employees.some(emp => emp.user === userId)) {
      return res.status(400).json({ success: false, message: 'Cet employé est déjà ajouté' })
    }
    
    employees.push({ user: userId, employeeId, department, position })
    await company.update({ employees })
    
    res.json({ success: true, message: 'Employé ajouté avec succès', company })
  } catch (error) {
    console.error('Erreur ajout employé:', error)
    res.status(500).json({ success: false, message: 'Erreur lors de l\'ajout de l\'employé' })
  }
})

// DELETE - Retirer un employé
router.delete('/:id/employees/:userId', authenticate, async (req, res) => {
  try {
    const company = await Company.findByPk(req.params.id)
    if (!company) return res.status(404).json({ success: false, message: 'Entreprise non trouvée' })
    
    // Permissions check: admin or company admin
    if (req.user.role !== 'admin' && company.adminId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Accès refusé' })
    }
    
    const employees = Array.isArray(company.employees) ? company.employees.filter(emp => emp.user !== req.params.userId) : []
    await company.update({ employees })
    
    res.json({ success: true, message: 'Employé retiré avec succès', company })
  } catch (error) {
    console.error('Erreur retrait employé:', error)
    res.status(500).json({ success: false, message: 'Erreur lors du retrait de l\'employé' })
  }
})

// GET - Obtenir les commandes d'une entreprise
router.get('/:id/orders', authenticate, async (req, res) => {
  try {
    const company = await Company.findByPk(req.params.id)
    if (!company) return res.status(404).json({ success: false, message: 'Entreprise non trouvée' })
    
    const employees = Array.isArray(company.employees) ? company.employees : []
    if (req.user.role !== 'admin' && company.adminId !== req.user.id && !employees.some(emp => emp.user === req.user.id)) {
      return res.status(403).json({ success: false, message: 'Accès refusé' })
    }
    
    const { status, startDate, endDate } = req.query
    let where = { companyId: req.params.id }
    if (status) where.status = status
    if (startDate || endDate) {
      where.orderDate = {}
      if (startDate) where.orderDate[Op.gte] = new Date(startDate)
      if (endDate) where.orderDate[Op.lte] = new Date(endDate)
    }
    
    const orders = await CorporateOrder.findAll({
      where,
      include: [{ model: User, as: 'employee', attributes: ['nom', 'prenom', 'email'] }],
      order: [['orderDate', 'DESC']]
    })
    
    res.json({ success: true, orders })
  } catch (error) {
    console.error('Erreur récupération commandes:', error)
    res.status(500).json({ success: false, message: 'Erreur lors de la récupération des commandes' })
  }
})

// GET - Obtenir les factures d'une entreprise
router.get('/:id/invoices', authenticate, async (req, res) => {
  try {
    const company = await Company.findByPk(req.params.id)
    if (!company) return res.status(404).json({ success: false, message: 'Entreprise non trouvée' })
    
    // Permissions check: admin or company admin
    if (req.user.role !== 'admin' && company.adminId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Accès refusé' })
    }
    
    const { status, startDate, endDate } = req.query
    let where = { companyId: req.params.id }
    if (status) where.status = status
    if (startDate || endDate) {
      where['billingPeriod.startDate'] = {} // This syntax might need adjustment for JSONB fields depending on DB
      if (startDate) where['billingPeriod.startDate'][Op.gte] = new Date(startDate)
      if (endDate) where['billingPeriod.endDate'][Op.lte] = new Date(endDate)
    }
    
    const invoices = await CorporateInvoice.findAll({
      where,
      order: [[literal('billingPeriod->>\'startDate\''), 'DESC']] // Order by JSONB field
    })
    
    res.json({ success: true, invoices })
  } catch (error) {
    console.error('Erreur récupération factures:', error)
    res.status(500).json({ success: false, message: 'Erreur lors de la récupération des factures' })
  }
})

// POST - Créer une commande corporate
router.post('/:id/orders', authenticate, async (req, res) => {
  try {
    const company = await Company.findByPk(req.params.id)
    if (!company) return res.status(404).json({ success: false, message: 'Entreprise non trouvée' })
    
    const employees = Array.isArray(company.employees) ? company.employees : []
    if (req.user.role !== 'admin' && company.adminId !== req.user.id && !employees.some(emp => emp.user === req.user.id)) {
      return res.status(403).json({ success: false, message: 'Accès refusé. Vous devez être un employé de cette entreprise.' })
    }
    
    const { items, deliveryInfo, recurrence, notes } = req.body
    
    // Calculate total with corporate pricing
    let total = 0
    const processedItems = items.map(item => {
      let price = item.price
      
      // Apply custom prices or discount percentage
      if (company.corporatePricing && company.corporatePricing.customPrices) {
        const customPrice = company.corporatePricing.customPrices.find(
          cp => cp.product === item.productId
        )
        if (customPrice) {
          price = customPrice.price
        } else if (company.corporatePricing.enabled && company.corporatePricing.discountPercentage > 0) {
          price = item.price * (1 - company.corporatePricing.discountPercentage / 100)
        }
      } else if (company.corporatePricing && company.corporatePricing.enabled && company.corporatePricing.discountPercentage > 0) {
        price = item.price * (1 - company.corporatePricing.discountPercentage / 100)
      }
      
      const itemTotal = price * item.quantity
      total += itemTotal
      
      return {
        product: item.productId || null,
        name: item.name,
        price: price,
        quantity: item.quantity,
        image: item.image
      }
    })
    
    const order = await CorporateOrder.create({
      companyId: req.params.id,
      employeeId: req.user.id,
      items: processedItems,
      total,
      deliveryInfo: deliveryInfo || {},
      recurrence: recurrence || { enabled: false },
      notes
    })
    
    // Add the order ID to the company's recurringOrders (if applicable)
    const recurringOrders = Array.isArray(company.recurringOrders) ? [...company.recurringOrders] : []
    recurringOrders.push(order.id)
    await company.update({ recurringOrders })
    
    res.status(201).json({ success: true, message: 'Commande corporate créée avec succès', order })
  } catch (error) {
    console.error('Erreur création commande corporate:', error)
    res.status(500).json({ success: false, message: error.message || 'Erreur lors de la création de la commande' })
  }
})

// Fonction pour calculer la prochaine date de livraison (not used in the provided routes, but kept for context)
function calculateNextDeliveryDate(recurrence) {
  const now = new Date()
  const nextDate = new Date(now)
  
  if (recurrence.frequency === 'daily') {
    nextDate.setDate(nextDate.getDate() + 1)
  } else if (recurrence.frequency === 'weekly') {
    // Trouver le prochain jour de la semaine spécifié
    if (recurrence.daysOfWeek && recurrence.daysOfWeek.length > 0) {
      const currentDay = now.getDay()
      const nextDay = recurrence.daysOfWeek.find(day => day > currentDay) || recurrence.daysOfWeek[0]
      const daysUntilNext = nextDay > currentDay ? nextDay - currentDay : (7 - currentDay) + nextDay
      nextDate.setDate(nextDate.getDate() + daysUntilNext)
    } else {
      nextDate.setDate(nextDate.getDate() + 7)
    }
  } else if (recurrence.frequency === 'monthly') {
    nextDate.setMonth(nextDate.getMonth() + 1)
  }
  
  return nextDate
}

// POST - Générer une facture mensuelle
router.post('/:id/invoices/generate', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin uniquement' })
    
    const company = await Company.findByPk(req.params.id)
    if (!company) return res.status(404).json({ success: false, message: 'Entreprise non trouvée' })
    
    const { startDate, endDate } = req.body
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'Les dates de début et de fin sont requises.' });
    }

    const orders = await CorporateOrder.findAll({
      where: {
        companyId: req.params.id,
        orderDate: { [Op.between]: [new Date(startDate), new Date(endDate)] },
        status: { [Op.ne]: 'cancelled' }
      }
    })
    
    if (orders.length === 0) return res.status(400).json({ success: false, message: 'Aucune commande trouvée pour cette période' })
    
    const subtotal = orders.reduce((sum, o) => sum + o.total, 0)
    const discount = (company.corporatePricing && company.corporatePricing.discountPercentage > 0)
      ? subtotal * (company.corporatePricing.discountPercentage / 100)
      : 0
    const tax = (subtotal - discount) * 0.18 // 18% de TVA
    const total = subtotal - discount + tax
    
    // Create invoice items from orders
    const invoiceItems = []
    orders.forEach(order => {
      order.items.forEach(item => {
        invoiceItems.push({
          description: item.name,
          quantity: item.quantity,
          unitPrice: item.price,
          total: item.price * item.quantity
        })
      })
    })

    const dueDate = new Date(endDate)
    dueDate.setDate(dueDate.getDate() + 30)
    
    const invoice = await CorporateInvoice.create({
      companyId: req.params.id,
      billingPeriod: { startDate: new Date(startDate), endDate: new Date(endDate) },
      orders: orders.map(o => o.id),
      items: invoiceItems, // Use the generated invoice items
      subtotal, discount, tax, total,
      dueDate,
      paymentMethod: (company.billing && company.billing.paymentMethod) || 'invoice',
      status: 'sent'
    })
    
    if (company.billing) {
      company.billing.currentBalance = (company.billing.currentBalance || 0) + total
      await company.update({ billing: company.billing })
    }
    
    // Sequelize does not have a direct populate like Mongoose. If 'orders' need to be populated,
    // it would require another query or include in the initial fetch.
    // For now, we return the created invoice.
    
    res.status(201).json({ success: true, message: 'Facture générée avec succès', invoice })
  } catch (error) {
    console.error('Erreur génération facture:', error)
    res.status(500).json({ success: false, message: error.message || 'Erreur lors de la génération de la facture' })
  }
})

export default router
