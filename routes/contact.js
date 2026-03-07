import express from 'express'
import { sendEmail } from '../utils/email.js'

const router = express.Router()

// POST - Soumettre le formulaire de contact
router.post('/', async (req, res) => {
  try {
    const { nom, prenom, email, telephone, sujet, message } = req.body

    if (!nom || !prenom || !email || !telephone || !sujet || !message) {
      return res.status(400).json({
        success: false,
        message: 'Tous les champs sont requis'
      })
    }

    // Préparer l'email pour l'administrateur
    const adminEmail = 'augustinkolie54@gmail.com'
    const emailSubject = `Nouveau message de contact : ${sujet}`
    
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #fca311; color: white; padding: 20px; text-align: center;">
          <h2 style="margin: 0;">Nouveau Message de Contact</h2>
        </div>
        
        <div style="padding: 20px;">
          <h3 style="color: #333; margin-top: 0; border-bottom: 2px solid #fca311; padding-bottom: 10px;">Détails de l'expéditeur</h3>
          
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; width: 30%; font-weight: bold; color: #555;">Nom complet :</td>
              <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0;">${prenom} ${nom}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-weight: bold; color: #555;">Email :</td>
              <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0;"><a href="mailto:${email}" style="color: #fca311;">${email}</a></td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-weight: bold; color: #555;">Téléphone :</td>
              <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0;"><a href="tel:${telephone}" style="color: #fca311;">${telephone}</a></td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-weight: bold; color: #555;">Sujet :</td>
              <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0;">${sujet}</td>
            </tr>
          </table>
          
          <h3 style="color: #333; border-bottom: 2px solid #fca311; padding-bottom: 10px;">Message</h3>
          <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; color: #444; line-height: 1.6; white-space: pre-wrap;">${message}</div>
          
          <div style="margin-top: 30px; text-align: center;">
            <a href="mailto:${email}" style="display: inline-block; background-color: #fca311; color: white; text-decoration: none; padding: 10px 25px; border-radius: 5px; font-weight: bold;">Répondre à ${prenom}</a>
          </div>
        </div>
        
        <div style="background-color: #f5f5f5; padding: 15px; text-align: center; color: #888; font-size: 12px;">
          Cet email a été envoyé depuis le formulaire de contact du site CuniResto.
        </div>
      </div>
    `

    // Envoyer l'email
    console.log(`📧 Envoi du message de contact de ${email} vers ${adminEmail}...`)
    
    const emailResult = await sendEmail(adminEmail, emailSubject, message, emailHtml)

    if (!emailResult.success || emailResult.fallback) {
      console.error('❌ Echec envoi email contact:', emailResult.error || 'Mode développement fallback')
      return res.status(500).json({
        success: false,
        message: 'Erreur lors de l\'envoi de l\'email. Veuillez réessayer.'
      })
    }

    res.json({
      success: true,
      message: 'Votre message a été envoyé avec succès.'
    })
  } catch (error) {
    console.error('❌ Erreur lors de l\'envoi du message de contact:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'envoi du message. Veuillez réessayer plus tard.'
    })
  }
})

export default router
