import express from 'express'
import { Op } from 'sequelize'
import jwt from 'jsonwebtoken'
import { Reservation, User } from '../models/index.js'
import { authenticate } from '../middleware/auth.js'
import { sendEmail } from '../utils/email.js'

const router = express.Router()

// Créer une réservation (authentification optionnelle)
router.post('/', async (req, res) => {
  try {
    // Essayer d'authentifier l'utilisateur si un token est fourni
    let userId = null
    if (req.headers.authorization) {
      try {
        const token = req.headers.authorization.split(' ')[1] || req.headers.authorization
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production')
        const user = await User.findByPk(decoded.userId)
        if (user) {
          userId = user.id
          console.log('✅ Utilisateur authentifié pour réservation:', user.email)
        }
      } catch (authError) {
        console.log('ℹ️  Authentification optionnelle échouée, réservation anonyme')
      }
    }

    const { nom, prenom, email, telephone, date, time, guests, message } = req.body
    
    // Fonction helper pour vérifier si une valeur est vide
    const isEmpty = (value) => {
      if (value === null || value === undefined) return true
      if (typeof value === 'string') {
        const trimmed = value.trim()
        return trimmed === '' || trimmed === 'undefined' || trimmed === 'null'
      }
      return false
    }
    
    // Validation des champs requis
    const missingFields = []
    if (isEmpty(nom)) missingFields.push('nom')
    if (isEmpty(prenom)) missingFields.push('prenom')
    if (isEmpty(email)) missingFields.push('email')
    if (isEmpty(telephone)) missingFields.push('telephone')
    if (isEmpty(date)) missingFields.push('date')
    if (isEmpty(time)) missingFields.push('time')
    if (guests === null || guests === undefined || guests === '') missingFields.push('guests')
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Les champs suivants sont requis: ${missingFields.join(', ')}`
      })
    }
    
    const cleanNom = nom.trim()
    const cleanPrenom = prenom.trim()
    const cleanEmail = email.trim().toLowerCase()
    const cleanTelephone = telephone.trim()
    const cleanDate = date.trim()
    const cleanTime = time.trim()
    
    const numGuests = typeof guests === 'number' ? guests : parseInt(String(guests).trim())
    if (isNaN(numGuests) || numGuests < 1 || numGuests > 20) {
      return res.status(400).json({ success: false, message: 'Le nombre de personnes doit être entre 1 et 20' })
    }
    
    const fullDateTime = new Date(cleanDate)
    const [h, m] = cleanTime.split(':').map(Number)
    fullDateTime.setHours(h, m, 0, 0)
    
    if (fullDateTime < new Date()) {
      return res.status(400).json({ success: false, message: 'La date et l\'heure ne peuvent pas être dans le passé' })
    }
    
    const reservation = await Reservation.create({
      userId: userId,
      nom: cleanNom,
      prenom: cleanPrenom,
      email: cleanEmail,
      telephone: cleanTelephone,
      date: fullDateTime,
      time: cleanTime,
      guests: numGuests,
      message: message && message.trim() !== '' ? message.trim() : null,
      status: 'pending'
    })
    
    // Envoyer l'email de notification à l'admin
    try {
      const adminEmail = 'augustinkolie54@gmail.com'
      const emailSubject = `Nouvelle réservation : ${cleanPrenom} ${cleanNom}`
      
      const formattedDate = new Date(cleanDate).toLocaleDateString('fr-FR', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      })

      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
          <div style="background-color: #fca311; color: white; padding: 20px; text-align: center;">
            <h2 style="margin: 0;">Nouvelle Demande de Réservation</h2>
          </div>
          
          <div style="padding: 20px;">
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; width: 40%; font-weight: bold; color: #555;">Client :</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0;">${cleanPrenom} ${cleanNom}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-weight: bold; color: #555;">Date :</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0;">${formattedDate}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-weight: bold; color: #555;">Heure :</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0;">${cleanTime}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-weight: bold; color: #555;">Nombre de personnes :</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0;">${numGuests}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-weight: bold; color: #555;">Téléphone :</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0;"><a href="tel:${cleanTelephone}" style="color: #fca311;">${cleanTelephone}</a></td>
              </tr>
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-weight: bold; color: #555;">Email :</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0;"><a href="mailto:${cleanEmail}" style="color: #fca311;">${cleanEmail}</a></td>
              </tr>
              ${message ? `
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-weight: bold; color: #555;">Message spécial :</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; white-space: pre-wrap;">${message.trim()}</td>
              </tr>
              ` : ''}
            </table>
            
            <div style="margin-top: 30px; text-align: center;">
              <a href="mailto:${cleanEmail}" style="display: inline-block; background-color: #fca311; color: white; text-decoration: none; padding: 10px 25px; border-radius: 5px; font-weight: bold; margin-right: 10px;">Contacter le client</a>
            </div>
          </div>
          
          <div style="background-color: #f5f5f5; padding: 15px; text-align: center; color: #888; font-size: 12px;">
            Cet email a été envoyé depuis le système de réservation du site CuniResto. Connectez-vous à votre tableau de bord administrateur pour gérer cette réservation.
          </div>
        </div>
      `
      
      console.log(`📧 Envoi de l'email de réservation pour ${cleanPrenom} ${cleanNom}...`)
      await sendEmail(adminEmail, emailSubject, 'Nouvelle réservation', emailHtml)
    } catch (emailError) {
      console.error('❌ Erreur envoi email réservation (non bloquant):', emailError)
    }

    res.status(201).json({
      success: true,
      message: 'Réservation créée avec succès',
      reservation
    })
  } catch (error) {
    console.error('❌ Erreur création réservation:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    })
  }
})

// Obtenir les réservations de l'utilisateur (nécessite authentification)
router.get('/my-reservations', authenticate, async (req, res) => {
  try {
    const reservations = await Reservation.findAll({ 
      where: { userId: req.user.id },
      order: [['date', 'DESC'], ['time', 'DESC']]
    })
    
    res.json({ success: true, reservations })
  } catch (error) {
    console.error('❌ Erreur récupération réservations:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// Obtenir toutes les réservations (Admin uniquement)
router.get('/', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Accès refusé' })
    
    const { status, date, page = 1, limit = 50 } = req.query
    const where = {}
    
    if (status) where.status = status
    if (date) {
      const startDate = new Date(date)
      startDate.setHours(0, 0, 0, 0)
      const endDate = new Date(date)
      endDate.setHours(23, 59, 59, 999)
      where.date = { [Op.between]: [startDate, endDate] }
    }
    
    const limitNum = parseInt(limit)
    const offset = (parseInt(page) - 1) * limitNum
    
    const { count: total, rows: reservations } = await Reservation.findAndCountAll({
      where,
      include: [{ model: User, as: 'user', attributes: ['nom', 'prenom', 'email'] }],
      order: [['date', 'DESC'], ['time', 'DESC']],
      offset,
      limit: limitNum
    })
    
    res.json({
      success: true,
      reservations,
      pagination: {
        page: parseInt(page),
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    })
  } catch (error) {
    console.error('❌ Erreur récupération réservations:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// Mettre à jour le statut d'une réservation (Admin uniquement)
router.put('/:id/status', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Accès refusé' })
    
    const { status } = req.body
    const validStatuses = ['pending', 'confirmed', 'cancelled', 'completed']
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Statut invalide' })
    }
    
    const reservation = await Reservation.findByPk(req.params.id)
    if (!reservation) return res.status(404).json({ success: false, message: 'Non trouvé' })
    
    await reservation.update({ status })
    
    res.json({ success: true, message: 'Statut mis à jour', reservation })
  } catch (error) {
    console.error('❌ Erreur mise à jour réservation:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// Supprimer une réservation (Admin uniquement)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Accès refusé' })
    
    const deleted = await Reservation.destroy({ where: { id: req.params.id } })
    if (!deleted) return res.status(404).json({ success: false, message: 'Non trouvé' })
    
    res.json({ success: true, message: 'Supprimée' })
  } catch (error) {
    console.error('❌ Erreur suppression réservation:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

export default router
