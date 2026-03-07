import express from 'express'
import { Op, fn, col } from 'sequelize'
import { LoyaltyPoints, Referral, Reward, User, TableOrder, sequelize } from '../models/index.js'
import { authenticate } from '../middleware/auth.js'

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

// Configuration des points
const POINTS_PER_ORDER = 10 
const POINTS_PER_1000_FCFA = 1 
const REFERRER_POINTS = 500 
const REFERRED_POINTS = 300 

// Obtenir les points de fidélité de l'utilisateur
router.get('/points', authenticate, async (req, res) => {
  try {
    let loyalty = await LoyaltyPoints.findOne({ where: { userId: req.user.id } })
    
    if (!loyalty) {
      loyalty = await LoyaltyPoints.create({
        userId: req.user.id,
        totalPoints: 0,
        availablePoints: 0,
        usedPoints: 0
      })
    }
    
    const detailedLoyalty = await LoyaltyPoints.findOne({
      where: { userId: req.user.id },
      include: [{ model: User, as: 'user', attributes: ['nom', 'prenom', 'email', 'referralCode'] }]
    })
    
    res.json({
      success: true,
      loyalty: detailedLoyalty || loyalty
    })
  } catch (error) {
    console.error('Erreur récupération points:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des points'
    })
  }
})

// Obtenir l'historique des transactions
router.get('/transactions', authenticate, async (req, res) => {
  try {
    const loyalty = await LoyaltyPoints.findOne({ where: { userId: req.user.id } })
    
    if (!loyalty || !loyalty.transactions) {
      return res.json({
        success: true,
        transactions: []
      })
    }
    
    res.json({
      success: true,
      transactions: loyalty.transactions
    })
  } catch (error) {
    console.error('Erreur récupération transactions:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des transactions'
    })
  }
})

// Obtenir les récompenses disponibles
router.get('/rewards', authenticate, async (req, res) => {
  try {
    const loyalty = await LoyaltyPoints.findOne({ where: { userId: req.user.id } })
    const userLevel = loyalty?.level || 'bronze'
    
    const levelOrder = { bronze: 0, silver: 1, gold: 2, platinum: 3 }
    const userLevelOrder = levelOrder[userLevel]
    
    const rewards = await Reward.findAll({
      where: {
        active: true,
        [Op.or]: [
          { expiryDate: { [Op.gte]: new Date() } },
          { expiryDate: null }
        ]
      },
      order: [['pointsCost', 'ASC']]
    })
    
    const availableRewards = rewards.filter(reward => {
      const rewardLevelOrder = levelOrder[reward.minLevel] || 0
      return userLevelOrder >= rewardLevelOrder
    })
    
    res.json({
      success: true,
      rewards: availableRewards,
      userLevel
    })
  } catch (error) {
    console.error('Erreur récupération récompenses:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des récompenses'
    })
  }
})

// Échanger des points contre une récompense
router.post('/rewards/:rewardId/redeem', authenticate, async (req, res) => {
  try {
    const { rewardId } = req.params
    
    const reward = await Reward.findByPk(rewardId)
    if (!reward || !reward.active) {
      return res.status(404).json({ success: false, message: 'Récompense non trouvée' })
    }
    
    let loyalty = await LoyaltyPoints.findOne({ where: { userId: req.user.id } })
    if (!loyalty) {
      loyalty = await LoyaltyPoints.create({ userId: req.user.id })
    }
    
    // Vérifier les points disponibles
    if (loyalty.availablePoints < reward.pointsCost) {
      return res.status(400).json({ success: false, message: 'Points insuffisants' })
    }
    
    // Utiliser les points
    const transactions = Array.isArray(loyalty.transactions) ? [...loyalty.transactions] : []
    transactions.push({
      type: 'redemption',
      points: -reward.pointsCost,
      description: `Échange: ${reward.name}`,
      createdAt: new Date()
    })
    
    const rewardsList = Array.isArray(loyalty.rewards) ? [...loyalty.rewards] : []
    rewardsList.push({
      rewardId: reward.id,
      redeemedAt: new Date()
    })

    await loyalty.update({
      availablePoints: loyalty.availablePoints - reward.pointsCost,
      usedPoints: (loyalty.usedPoints || 0) + reward.pointsCost,
      transactions,
      rewards: rewardsList
    })
    
    res.json({
      success: true,
      message: 'Récompense échangée avec succès',
      loyalty,
      reward
    })
  } catch (error) {
    console.error('Erreur échange récompense:', error)
    res.status(500).json({
      success: false,
      message: error.message || 'Erreur lors de l\'échange de la récompense'
    })
  }
})

// Enregistrer un code de parrainage
router.post('/referral/use', authenticate, async (req, res) => {
  try {
    const { referralCode } = req.body
    if (!referralCode) return res.status(400).json({ success: false, message: 'Code requis' })
    
    const codeToUse = referralCode.trim().toUpperCase()
    
    const existingReferral = await Referral.findOne({ where: { referredId: req.user.id } })
    if (existingReferral) {
      return res.status(400).json({ success: false, message: 'Déjà parrainé' })
    }
    
    const referrer = await User.findOne({ where: { referralCode: codeToUse } })
    if (!referrer || referrer.id === req.user.id) {
      return res.status(400).json({ success: false, message: 'Code invalide' })
    }
    
    const referral = await Referral.create({
      referrerId: referrer.id,
      referredId: req.user.id,
      referralCode: codeToUse,
      status: 'pending'
    })
      
    res.json({
      success: true,
      message: 'Code enregistré ! Bonus après votre première commande.',
      referral
    })
  } catch (error) {
    console.error('Erreur parrainage:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// Obtenir les informations de parrainage
router.get('/referral', authenticate, async (req, res) => {
  try {
    let user = await User.findByPk(req.user.id)
    if (!user) return res.status(404).json({ success: false, message: 'User not found' })
    
    if (!user.referralCode) {
      const random = Math.random().toString(36).substring(2, 8).toUpperCase()
      const code = `${user.prenom ? user.prenom.charAt(0).toUpperCase() : 'U'}${random}`
      await user.update({ referralCode: code })
    }
    
    const referralsAsReferrer = await Referral.findAll({ 
      where: { referrerId: req.user.id },
      include: [{ model: User, as: 'referred', attributes: ['nom', 'prenom', 'email', 'createdAt'] }]
    })
    
    const referralAsReferred = await Referral.findOne({ 
      where: { referredId: req.user.id },
      include: [{ model: User, as: 'referrer', attributes: ['nom', 'prenom', 'email'] }]
    })
    
    res.json({
      success: true,
      referralCode: user.referralCode,
      referralsAsReferrer,
      referralAsReferred,
      totalReferrals: referralsAsReferrer.length,
      completedReferrals: referralsAsReferrer.filter(r => r.status === 'completed').length
    })
  } catch (error) {
    console.error('Erreur info parrainage:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// Demander un cashback
router.post('/cashback/request', authenticate, async (req, res) => {
  try {
    const { amount, orangeMoneyNumber } = req.body
    if (!amount || amount <= 0 || !orangeMoneyNumber) {
      return res.status(400).json({ success: false, message: 'Infos invalides' })
    }
    
    let loyalty = await LoyaltyPoints.findOne({ where: { userId: req.user.id } })
    if (!loyalty) loyalty = await LoyaltyPoints.create({ userId: req.user.id })
    
    const pointsNeeded = Math.ceil(amount / 10)
    if (loyalty.availablePoints < pointsNeeded) {
      return res.status(400).json({ success: false, message: 'Points insuffisants' })
    }
    
    const transactions = Array.isArray(loyalty.transactions) ? [...loyalty.transactions] : []
    transactions.push({
      type: 'cashback',
      points: -pointsNeeded,
      description: `Cashback Orange Money: ${amount} FCFA`,
      createdAt: new Date()
    })

    await loyalty.update({
      availablePoints: loyalty.availablePoints - pointsNeeded,
      usedPoints: (loyalty.usedPoints || 0) + pointsNeeded,
      transactions
    })
    
    await User.update({ orangeMoneyNumber }, { where: { id: req.user.id } })
    
    res.json({
      success: true,
      message: `Demande de cashback envoyée`,
      cashback: { amount, pointsUsed: pointsNeeded, status: 'pending' }
    })
  } catch (error) {
    console.error('Erreur cashback:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// Award points (internal)
export const awardPointsForOrder = async (userId, orderTotal, orderId) => {
  try {
    let loyalty = await LoyaltyPoints.findOne({ where: { userId } })
    if (!loyalty) loyalty = await LoyaltyPoints.create({ userId })
    
    const totalPoints = POINTS_PER_ORDER + (Math.floor(orderTotal / 1000) * POINTS_PER_1000_FCFA)
    
    const transactions = Array.isArray(loyalty.transactions) ? [...loyalty.transactions] : []
    transactions.push({
      type: 'order',
      points: totalPoints,
      description: `Points commande #${orderId}`,
      createdAt: new Date()
    })

    await loyalty.update({
      totalPoints: (loyalty.totalPoints || 0) + totalPoints,
      availablePoints: (loyalty.availablePoints || 0) + totalPoints,
      transactions
    })
    
    // Check referral
    const referral = await Referral.findOne({ where: { referredId: userId, status: 'pending' } })
    if (referral) {
      await referral.update({ status: 'completed', firstOrderId: orderId })
      
      // Referrer bonus
      let referrerLoyalty = await LoyaltyPoints.findOne({ where: { userId: referral.referrerId } })
      if (!referrerLoyalty) referrerLoyalty = await LoyaltyPoints.create({ userId: referral.referrerId })
      
      const refTransactions = Array.isArray(referrerLoyalty.transactions) ? [...referrerLoyalty.transactions] : []
      refTransactions.push({
        type: 'referral',
        points: REFERRER_POINTS,
        description: `Bonus parrainage`,
        createdAt: new Date()
      })
      await referrerLoyalty.update({
        totalPoints: (referrerLoyalty.totalPoints || 0) + REFERRER_POINTS,
        availablePoints: (referrerLoyalty.availablePoints || 0) + REFERRER_POINTS,
        transactions: refTransactions
      })
    }
    
    return { points: totalPoints, loyalty }
  } catch (error) {
    console.error('Error awarding points:', error)
    return null
  }
}

// Admin stats
router.get('/admin/statistics', authenticate, isAdmin, async (req, res) => {
  try {
    const totalLoyaltyAccounts = await LoyaltyPoints.count()
    const totalPointsSum = await LoyaltyPoints.sum('totalPoints')
    const totalReferrals = await Referral.count()
    const completedReferrals = await Referral.count({ where: { status: 'completed' } })
    
    res.json({
      success: true,
      statistics: {
        totalLoyaltyAccounts,
        totalPointsIssued: totalPointsSum || 0,
        totalReferrals,
        completedReferrals
      }
    })
  } catch (error) {
    console.error('Erreur stats fidélité:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// Get all referrals (Admin)
router.get('/admin/referrals', authenticate, isAdmin, async (req, res) => {
  try {
    const referrals = await Referral.findAll({
      include: [
        { model: User, as: 'referrer', attributes: ['nom', 'prenom', 'email', 'referralCode'] },
        { model: User, as: 'referred', attributes: ['nom', 'prenom', 'email'] }
      ],
      order: [['createdAt', 'DESC']]
    })
    
    const stats = {
      total: referrals.length,
      pending: referrals.filter(r => r.status === 'pending').length,
      completed: referrals.filter(r => r.status === 'completed').length
    }
    
    res.json({
      success: true,
      referrals,
      stats
    })
  } catch (error) {
    console.error('Erreur récupération parrainages:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

export default router
