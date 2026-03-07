// Utilitaires pour envoyer des notifications SMS et WhatsApp

/**
 * Envoyer un SMS (simulation - à remplacer par un vrai service SMS)
 * @param {string} phoneNumber - Numéro de téléphone
 * @param {string} message - Message à envoyer
 */
export const sendSMS = async (phoneNumber, message) => {
  try {
    // TODO: Intégrer un vrai service SMS (Twilio, Orange SMS API, etc.)
    // Pour l'instant, on simule l'envoi
    
    console.log(`📱 SMS envoyé à ${phoneNumber}: ${message}`)
    
    // Exemple d'intégration avec Twilio (décommenter et configurer):
    /*
    const twilio = require('twilio')
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    )
    
    await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phoneNumber
    })
    */
    
    // Exemple d'intégration avec Orange SMS API:
    /*
    const axios = require('axios')
    await axios.post('https://api.orange.com/smsmessaging/v1/outbound/...', {
      outboundSMSMessageRequest: {
        address: phoneNumber,
        senderAddress: process.env.ORANGE_SENDER,
        outboundSMSTextMessage: {
          message: message
        }
      }
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.ORANGE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    })
    */
    
    return { success: true }
  } catch (error) {
    console.error('Erreur envoi SMS:', error)
    throw error
  }
}

/**
 * Envoyer un message WhatsApp (simulation - à remplacer par WhatsApp Business API)
 * @param {string} phoneNumber - Numéro de téléphone
 * @param {string} message - Message à envoyer
 */
export const sendWhatsApp = async (phoneNumber, message) => {
  try {
    // TODO: Intégrer WhatsApp Business API (Twilio, Meta, etc.)
    // Pour l'instant, on simule l'envoi
    
    console.log(`💬 WhatsApp envoyé à ${phoneNumber}: ${message}`)
    
    // Exemple d'intégration avec Twilio WhatsApp:
    /*
    const twilio = require('twilio')
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    )
    
    await client.messages.create({
      body: message,
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: `whatsapp:${phoneNumber}`
    })
    */
    
    // Exemple d'intégration avec Meta WhatsApp Business API:
    /*
    const axios = require('axios')
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phoneNumber,
        type: 'text',
        text: { body: message }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    )
    */
    
    return { success: true }
  } catch (error) {
    console.error('Erreur envoi WhatsApp:', error)
    throw error
  }
}

/**
 * Formater un numéro de téléphone pour l'international
 * @param {string} phoneNumber - Numéro de téléphone
 * @param {string} countryCode - Code pays (défaut: +225 pour Côte d'Ivoire)
 */
export const formatPhoneNumber = (phoneNumber, countryCode = '+225') => {
  // Supprimer les espaces et caractères spéciaux
  let cleaned = phoneNumber.replace(/\s+/g, '').replace(/[^\d+]/g, '')
  
  // Si le numéro commence déjà par +, le retourner tel quel
  if (cleaned.startsWith('+')) {
    return cleaned
  }
  
  // Si le numéro commence par 0, le remplacer par le code pays
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1)
  }
  
  // Ajouter le code pays si nécessaire
  if (!cleaned.startsWith('+')) {
    cleaned = countryCode + cleaned
  }
  
  return cleaned
}


