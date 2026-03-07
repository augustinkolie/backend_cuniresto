import express from 'express'
import { Cart, CartItem, Product, Order, OrderItem, Delivery, sequelize } from '../models/index.js'
import { authenticate } from '../middleware/auth.js'
import { awardPointsForOrder } from './loyalty.js'
import { initiatePayment, initiateDirectPayment } from '../utils/orangeMoney.js'

const router = express.Router()

// Toutes les routes nécessitent une authentification
router.use(authenticate)

// Obtenir le panier de l'utilisateur
router.get('/', async (req, res) => {
  try {
    let cart = await Cart.findOne({ 
      where: { userId: req.user.id },
      include: [
        { 
          model: CartItem, 
          as: 'items',
          include: [{ model: Product, as: 'product' }]
        }
      ]
    })

    if (!cart) {
      cart = await Cart.create({ userId: req.user.id })
      cart.items = [] // Pour la consistance
    }

    // Calculer le total et le nombre d'articles
    const items = cart.items || []
    const total = items.reduce((sum, item) => {
      const price = item.product?.price || 0
      return sum + (price * item.quantity)
    }, 0)
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0)

    res.json({
      success: true,
      cart: {
        items,
        total,
        itemCount
      }
    })
  } catch (error) {
    console.error('Erreur récupération panier:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du panier'
    })
  }
})

// Ajouter un produit au panier
router.post('/items', async (req, res) => {
  try {
    const { productId, quantity = 1 } = req.body

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: 'ID produit requis'
      })
    }

    // Vérifier que le produit existe
    const product = await Product.findByPk(productId)
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Produit non trouvé'
      })
    }

    // Trouver ou créer le panier
    let [cart] = await Cart.findOrCreate({
      where: { userId: req.user.id }
    })

    // Vérifier si le produit est déjà dans le panier
    let cartItem = await CartItem.findOne({
      where: { 
        cartId: cart.id,
        productId: productId
      }
    })

    if (cartItem) {
      cartItem.quantity += parseInt(quantity)
      await cartItem.save()
    } else {
      await CartItem.create({
        cartId: cart.id,
        productId: productId,
        quantity: parseInt(quantity)
      })
    }

    // Recharger le panier avec les items
    const updatedCart = await Cart.findByPk(cart.id, {
      include: [
        { 
          model: CartItem, 
          as: 'items',
          include: [{ model: Product, as: 'product' }]
        }
      ]
    })

    const items = updatedCart.items || []
    const total = items.reduce((sum, item) => sum + ((item.product?.price || 0) * item.quantity), 0)
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0)

    res.json({
      success: true,
      message: 'Produit ajouté au panier',
      cart: {
        items,
        total,
        itemCount
      }
    })
  } catch (error) {
    console.error('Erreur ajout au panier:', error)
    res.status(500).json({
      success: false,
      message: error.message || 'Erreur lors de l\'ajout au panier'
    })
  }
})

// Mettre à jour la quantité d'un article
router.put('/items/:itemId', async (req, res) => {
  try {
    const { quantity } = req.body
    const { itemId } = req.params

    const cart = await Cart.findOne({ where: { userId: req.user.id } })
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Panier non trouvé'
      })
    }

    const item = await CartItem.findOne({
      where: { id: itemId, cartId: cart.id }
    })

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Article non trouvé dans le panier'
      })
    }

    if (quantity <= 0) {
      await item.destroy()
    } else {
      item.quantity = quantity
      await item.save()
    }

    // Recharger le panier
    const updatedCart = await Cart.findByPk(cart.id, {
      include: [{ model: CartItem, as: 'items', include: [{ model: Product, as: 'product' }] }]
    })

    const items = updatedCart.items || []
    const total = items.reduce((sum, item) => sum + ((item.product?.price || 0) * item.quantity), 0)
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0)

    res.json({
      success: true,
      message: 'Panier mis à jour',
      cart: {
        items,
        total,
        itemCount
      }
    })
  } catch (error) {
    console.error('Erreur mise à jour panier:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour du panier'
    })
  }
})

// Supprimer un article du panier
router.delete('/items/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params
    const cart = await Cart.findOne({ where: { userId: req.user.id } })

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Panier non trouvé'
      })
    }

    const deleted = await CartItem.destroy({
      where: { id: itemId, cartId: cart.id }
    })

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Article non trouvé dans le panier'
      })
    }

    // Recharger le panier
    const updatedCart = await Cart.findByPk(cart.id, {
      include: [{ model: CartItem, as: 'items', include: [{ model: Product, as: 'product' }] }]
    })

    const items = updatedCart.items || []
    const total = items.reduce((sum, item) => sum + ((item.product?.price || 0) * item.quantity), 0)
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0)

    res.json({
      success: true,
      message: 'Article supprimé du panier',
      cart: {
        items,
        total,
        itemCount
      }
    })
  } catch (error) {
    console.error('Erreur suppression article:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression de l\'article'
    })
  }
})

// Vider le panier
router.delete('/', async (req, res) => {
  try {
    const cart = await Cart.findOne({ where: { userId: req.user.id } })

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Panier non trouvé'
      })
    }

    await CartItem.destroy({ where: { cartId: cart.id } })

    res.json({
      success: true,
      message: 'Panier vidé'
    })
  } catch (error) {
    console.error('Erreur vidage panier:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors du vidage du panier'
    })
  }
})

// Checkout - Créer une commande depuis le panier
router.post('/checkout', async (req, res) => {
  const transaction = await sequelize.transaction()
  try {
    const { deliveryInfo, paymentMethod, paymentInfo } = req.body

    // Validation des données
    if (!deliveryInfo || !deliveryInfo.address || !deliveryInfo.phone) {
      await transaction.rollback()
      return res.status(400).json({
        success: false,
        message: 'Les informations de livraison sont requises'
      })
    }

    if (!paymentMethod || !['orange', 'carte', 'paypal'].includes(paymentMethod)) {
      await transaction.rollback()
      return res.status(400).json({
        success: false,
        message: 'Méthode de paiement invalide'
      })
    }

    // Validation des informations de paiement (inchangé en logique métier, mais on prépare l'erreur)
    if (paymentMethod === 'orange' && (!paymentInfo?.orangeMoney?.phoneNumber || paymentInfo.orangeMoney.phoneNumber.trim().length < 9)) {
      await transaction.rollback()
      return res.status(400).json({
        success: false,
        message: 'Numéro Orange Money requis'
      })
    }

    // Récupérer les items depuis le body (panier local) ou depuis MySQL
    let orderItemsData = []
    const { items: cartItems } = req.body

    if (cartItems && Array.isArray(cartItems) && cartItems.length > 0) {
      for (const item of cartItems) {
        const productId = item.productId || item.id || item._id
        if (!productId) {
          await transaction.rollback()
          return res.status(400).json({ success: false, message: 'ID produit manquant' })
        }

        const product = await Product.findByPk(productId, { transaction })
        if (!product) {
          // Si produit non trouvé mais qu'on accepte les produits mock (ex: prix direct), adapt
          // Pour CuniResto, on s'attend à ce que le produit existe
          await transaction.rollback()
          return res.status(400).json({ success: false, message: `Produit ${productId} non trouvé` })
        }

        if (product.stock < item.quantity) {
          await transaction.rollback()
          return res.status(400).json({ success: false, message: `Stock insuffisant pour ${product.name}` })
        }

        orderItemsData.push({
          productId: product.id,
          name: product.name,
          price: product.price,
          quantity: item.quantity,
          image: product.image
        })

        // Mettre à jour le stock
        await product.decrement('stock', { by: item.quantity, transaction })
      }
    } else {
      const cart = await Cart.findOne({
        where: { userId: req.user.id },
        include: [{ model: CartItem, as: 'items', include: [{ model: Product, as: 'product' }] }],
        transaction
      })

      if (!cart || !cart.items || cart.items.length === 0) {
        await transaction.rollback()
        return res.status(400).json({ success: false, message: 'Le panier est vide' })
      }

      for (const item of cart.items) {
        if (!item.product) {
          await transaction.rollback()
          return res.status(400).json({ success: false, message: 'Produit non trouvé pour un article' })
        }

        if (item.product.stock < item.quantity) {
          await transaction.rollback()
          return res.status(400).json({ success: false, message: `Stock insuffisant pour ${item.product.name}` })
        }

        orderItemsData.push({
          productId: item.productId,
          name: item.product.name,
          price: item.product.price,
          quantity: item.quantity,
          image: item.product.image
        })

        // Mettre à jour le stock
        await item.product.decrement('stock', { by: item.quantity, transaction })
      }
    }

    const total = orderItemsData.reduce((sum, item) => sum + (item.price * item.quantity), 0)

    // Préparer les infos de paiement sécurisées
    const securePaymentInfo = {}
    if (paymentMethod === 'orange') {
      securePaymentInfo.orangeMoney = { phoneNumber: paymentInfo.orangeMoney.phoneNumber }
    } else if (paymentMethod === 'carte') {
      const cardNumber = paymentInfo.carte.cardNumber.replace(/\s/g, '')
      securePaymentInfo.carte = {
        cardNumber: `****${cardNumber.slice(-4)}`,
        expiryDate: paymentInfo.carte.expiryDate,
        cardName: paymentInfo.carte.cardName
      }
    } else if (paymentMethod === 'paypal') {
      securePaymentInfo.paypal = { email: paymentInfo.paypal.email }
    }

    // Créer la commande
    const order = await Order.create({
      userId: req.user.id,
      total,
      address: deliveryInfo.address,
      phone: deliveryInfo.phone,
      city: deliveryInfo.city || '',
      instructions: deliveryInfo.instructions || '',
      tastePreferences: deliveryInfo.tastePreferences || '',
      status: 'pending',
      paymentMethod,
      paymentInfo: securePaymentInfo
    }, { transaction })

    // Créer les items de commande
    await OrderItem.bulkCreate(
      orderItemsData.map(item => ({
        orderId: order.id,
        productId: item.productId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        image: item.image
      })),
      { transaction }
    )

    // Créer la livraison
    const deliveryMode = deliveryInfo.deliveryMode || 'standard'
    const estimatedTime = deliveryInfo.estimatedTime || 30
    const deliveryFee = deliveryInfo.deliveryFee || 0

    const delivery = await Delivery.create({
      orderId: order.id,
      userId: req.user.id,
      deliveryMode,
      estimatedTime,
      deliveryFee,
      street: deliveryInfo.address,
      city: deliveryInfo.city || '',
      status: 'pending',
      trackingHistory: [{
        status: 'pending',
        timestamp: new Date(),
        message: 'Commande créée, en attente de préparation'
      }]
    }, { transaction })

    // Vider le panier
    await CartItem.destroy({
      where: {
        cartId: (await Cart.findOne({ where: { userId: req.user.id }, transaction }))?.id
      },
      transaction
    })

    // Attribuer les points de fidélité (en dehors de la transaction ou avec handle d'erreur)
    try {
      await awardPointsForOrder(req.user.id, total, order.id)
    } catch (e) {
      console.warn('Erreur attribution points:', e)
    }

    // Commit de la transaction
    await transaction.commit()

    // --- INTEGRATION ORANGE MONEY ---
    if (paymentMethod === 'orange') {
      try {
        const orangeMoneyPhone = paymentInfo.orangeMoney.phoneNumber
        let omResponse = await initiateDirectPayment(order.id, total, orangeMoneyPhone)

        if (!omResponse.success) {
          omResponse = await initiatePayment(order.id, total)
        }

        if (omResponse.success) {
          // Mettre à jour les tokens OM (sans transaction globale pour l'instant car déjà commit)
          await order.update({
            paymentInfo: {
              ...order.paymentInfo,
              orangeMoney: {
                ...order.paymentInfo.orangeMoney,
                payToken: omResponse.pay_token,
                notifToken: omResponse.notif_token,
                status: 'PENDING'
              }
            }
          })

          return res.status(201).json({
            success: true,
            message: omResponse.payment_url ? 'Paiement initié' : 'Confirmation envoyée',
            order,
            payment_url: omResponse.payment_url,
            delivery
          })
        } else {
          await order.update({ status: 'cancelled' })
          return res.status(400).json({ success: false, message: omResponse.message || 'Échec paiement Orange Money' })
        }
      } catch (omError) {
        console.error('Erreur OM Checkout:', omError)
        return res.status(500).json({ success: false, message: 'Erreur paiement Orange Money' })
      }
    }

    res.status(201).json({
      success: true,
      message: 'Commande créée avec succès',
      order,
      delivery
    })
  } catch (error) {
    if (transaction) await transaction.rollback()
    console.error('Erreur checkout:', error)
    res.status(500).json({
      success: false,
      message: error.message || 'Erreur lors de la création de la commande'
    })
  }
})

// Obtenir les commandes de l'utilisateur
router.get('/orders', async (req, res) => {
  try {
    const orders = await Order.findAll({
      where: { userId: req.user.id },
      include: [{ 
        model: OrderItem, 
        as: 'items',
        include: [{ model: Product, as: 'product' }]
      }],
      order: [['createdAt', 'DESC']]
    })

    res.json({
      success: true,
      orders
    })
  } catch (error) {
    console.error('Erreur récupération commandes:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des commandes'
    })
  }
})

export default router




