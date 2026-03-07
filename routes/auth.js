import express from 'express'
import jwt from 'jsonwebtoken'
import axios from 'axios'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { Op } from 'sequelize'
import User from '../models/User.js'
import { upload } from '../middleware/upload.js'
import { authenticate } from '../middleware/auth.js'
import { OAuth2Client } from 'google-auth-library'
import { sendVerificationCodeEmail } from '../utils/email.js'

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)

const router = express.Router()

// Générer un token JWT
const generateToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    { expiresIn: '7d' }
  )
}

// Fonction helper pour générer un code de parrainage unique
const generateReferralCode = async (prenom) => {
  const prefix = prenom?.charAt(0).toUpperCase() || 'U'
  let code = `${prefix}${Math.random().toString(36).substring(2, 8).toUpperCase()}`
  let exists = true
  let attempts = 0

  while (exists && attempts < 20) {
    const existing = await User.findOne({ where: { referralCode: code } })
    if (!existing) {
      exists = false
    } else {
      code = `${prefix}${Math.random().toString(36).substring(2, 8).toUpperCase()}`
      attempts++
    }
  }

  return code
}

// Fonction helper pour s'assurer qu'un utilisateur a un code de parrainage
const ensureReferralCode = async (user) => {
  if (!user.referralCode) {
    user.referralCode = await generateReferralCode(user.prenom)
    await user.save()
    console.log(`✅ Code de parrainage généré pour ${user.email}: ${user.referralCode}`)
  }
  return user
}

// Inscription
router.post('/register', async (req, res) => {
  try {
    const { email, password, nom, prenom } = req.body

    // Validation
    if (!email || !password || !nom || !prenom) {
      return res.status(400).json({
        success: false,
        message: 'Tous les champs sont requis'
      })
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Le mot de passe doit contenir au moins 8 caractères'
      })
    }

    // Vérifier si l'utilisateur existe déjà (y compris ceux supprimés)
    const existingUser = await User.findOne({ where: { email }, paranoid: false })
    let user;

    if (existingUser) {
      if (existingUser.deletedAt) {
        // Restaurer le compte s'il a été soft-deleted
        await existingUser.restore();
        existingUser.nom = nom;
        existingUser.prenom = prenom;
        existingUser.password = password; // Hachage géré par le hook beforeSave
        await existingUser.save();
        user = existingUser;
      } else {
        return res.status(400).json({
          success: false,
          message: 'Cet email est déjà utilisé'
        })
      }
    } else {
      // Créer un nouvel utilisateur
      user = await User.create({
        email,
        password,
        nom,
        prenom
      })
    }

    // S'assurer que le code de parrainage est généré (en passant l'instance Sequelize)
    await ensureReferralCode(user)

    // Générer le token
    const token = generateToken(user.id)

    res.status(201).json({
      success: true,
      message: 'Inscription réussie',
      token,
      user: {
        id: user.id,
        email: user.email,
        nom: user.nom,
        prenom: user.prenom,
        role: user.role,
        profileImage: user.profileImage || null,
        coverImage: user.coverImage || null,
        telephone: user.telephone || '',
        adresse: user.adresse || '',
        dateNaissance: user.dateNaissance || '',
        avis: user.avis || '',
        referralCode: user.referralCode,
        createdAt: user.createdAt
      }
    })
  } catch (error) {
    console.error('Erreur inscription:', error)
    res.status(500).json({
      success: false,
      message: error.message || 'Erreur lors de l\'inscription'
    })
  }
})

// Connexion
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email et mot de passe requis'
      })
    }

    // Trouver l'utilisateur
    const user = await User.findOne({ where: { email } })
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Email ou mot de passe incorrect'
      })
    }

    // Vérifier si l'utilisateur utilise uniquement Google
    if (!user.password && user.googleId) {
      return res.status(401).json({
        success: false,
        message: 'Ce compte a été créé avec Google. Veuillez utiliser la connexion Google.'
      })
    }

    // Vérifier le mot de passe
    const isPasswordValid = await user.comparePassword(password)
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Email ou mot de passe incorrect'
      })
    }

    // S'assurer que le code de parrainage est généré
    await ensureReferralCode(user)

    // Générer le token
    const token = generateToken(user.id)

    res.json({
      success: true,
      message: 'Connexion réussie',
      token,
      user: {
        id: user.id,
        email: user.email,
        nom: user.nom,
        prenom: user.prenom,
        role: user.role,
        profileImage: user.profileImage || null,
        coverImage: user.coverImage || null,
        telephone: user.telephone || '',
        adresse: user.adresse || '',
        dateNaissance: user.dateNaissance || '',
        avis: user.avis || '',
        createdAt: user.createdAt
      }
    })
  } catch (error) {
    console.error('Erreur connexion:', error)
    res.status(500).json({
      success: false,
      message: error.message || 'Erreur lors de la connexion'
    })
  }
})

// Obtenir l'utilisateur actuel
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1] || req.headers.authorization

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token requis'
      })
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production')
    const user = await User.findByPk(decoded.userId)

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      })
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        nom: user.nom,
        prenom: user.prenom,
        role: user.role,
        profileImage: user.profileImage || null,
        coverImage: user.coverImage || null,
        telephone: user.telephone || '',
        adresse: user.adresse || '',
        dateNaissance: user.dateNaissance || '',
        avis: user.avis || '',
        createdAt: user.createdAt
      }
    })
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Token invalide'
    })
  }
})

// Upload de l'image de profil
router.post('/profile/upload-image', authenticate, (req, res, next) => {
  // Middleware pour gérer les erreurs de multer
  upload.single('profileImage')(req, res, (err) => {
    if (err) {
      console.error('Erreur multer:', err)
      return res.status(400).json({
        success: false,
        message: err.message || 'Erreur lors de l\'upload du fichier'
      })
    }
    next()
  })
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Aucun fichier fourni. Veuillez sélectionner une image.'
      })
    }

    console.log('Fichier reçu:', req.file.originalname, 'Taille:', req.file.size, 'Type:', req.file.mimetype)

    const user = await User.findByPk(req.user.id)
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      })
    }

    // Supprimer l'ancienne image si elle existe et n'est pas une URL externe
    if (user.profileImage && !user.profileImage.startsWith('http')) {
      try {
        const oldImagePath = path.join(process.cwd(), user.profileImage)
        if (fs.existsSync(oldImagePath)) {
          fs.unlinkSync(oldImagePath)
          console.log('Ancienne image supprimée:', oldImagePath)
        }
      } catch (deleteError) {
        console.warn('Impossible de supprimer l\'ancienne image:', deleteError.message)
        // On continue même si la suppression échoue
      }
    }

    // Sauvegarder le chemin de la nouvelle image
    const imagePath = `/uploads/images/${req.file.filename}`
    user.profileImage = imagePath
    await user.save()

    console.log('Image sauvegardée avec succès:', imagePath)

    res.json({
      success: true,
      message: 'Image de profil uploadée avec succès',
      profileImage: imagePath,
      user: {
        id: user.id,
        email: user.email,
        nom: user.nom,
        prenom: user.prenom,
        role: user.role,
        profileImage: user.profileImage || null,
        telephone: user.telephone || '',
        adresse: user.adresse || '',
        dateNaissance: user.dateNaissance || '',
        avis: user.avis || '',
        createdAt: user.createdAt
      }
    })
  } catch (error) {
    console.error('Erreur upload image profil:', error)
    res.status(500).json({
      success: false,
      message: error.message || 'Erreur lors de l\'upload de l\'image'
    })
  }
})

// Upload de l'image de couverture
router.post('/profile/upload-cover', authenticate, (req, res, next) => {
  upload.single('coverImage')(req, res, (err) => {
    if (err) {
      console.error('Erreur multer:', err)
      return res.status(400).json({
        success: false,
        message: err.message || 'Erreur lors de l\'upload du fichier'
      })
    }
    next()
  })
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Aucun fichier fourni.'
      })
    }

    const user = await User.findByPk(req.user.id)
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      })
    }

    // Supprimer l'ancienne image si elle existe
    if (user.coverImage && !user.coverImage.startsWith('http')) {
      try {
        const oldImagePath = path.join(process.cwd(), user.coverImage)
        if (fs.existsSync(oldImagePath)) {
          fs.unlinkSync(oldImagePath)
        }
      } catch (deleteError) {
        console.warn('Erreur suppression ancienne couverture:', deleteError.message)
      }
    }

    const imagePath = `/uploads/images/${req.file.filename}`
    user.coverImage = imagePath
    await user.save()

    res.json({
      success: true,
      message: 'Image de couverture mise à jour',
      coverImage: imagePath,
      user: {
        id: user.id,
        email: user.email,
        nom: user.nom,
        prenom: user.prenom,
        role: user.role,
        profileImage: user.profileImage || null,
        coverImage: user.coverImage || null,
        telephone: user.telephone || '',
        adresse: user.adresse || '',
        dateNaissance: user.dateNaissance || '',
        avis: user.avis || '',
        createdAt: user.createdAt
      }
    })
  } catch (error) {
    res.status(500).json({ success: false, message: error.message })
  }
})

// Mettre à jour le profil utilisateur
router.put('/profile', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id)

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      })
    }

    // Mettre à jour les champs autorisés
    const { nom, prenom, email, telephone, adresse, dateNaissance, avis, profileImage, coverImage } = req.body

    console.log('📝 Mise à jour du profil reçue:', req.body)
    console.log('👤 Utilisateur actuel (avant):', { id: user.id, telephone: user.telephone })

    if (nom) user.nom = nom
    if (prenom) user.prenom = prenom
    if (email && email !== user.email) {
      // Vérifier si le nouvel email est déjà utilisé
      const existingUser = await User.findOne({ where: { email } })
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Cet email est déjà utilisé'
        })
      }
      user.email = email
    }
    if (telephone !== undefined) {
      console.log('📱 Mise à jour du téléphone:', telephone)
      user.telephone = telephone
    }
    if (adresse !== undefined) user.adresse = adresse
    if (dateNaissance !== undefined) user.dateNaissance = dateNaissance
    if (avis !== undefined) user.avis = avis
    // Ne pas mettre à jour profileImage ici si c'est une URL (Google, etc.)
    // L'image doit être uploadée via la route /profile/upload-image
    if (profileImage !== undefined && !profileImage.startsWith('http')) {
      user.profileImage = profileImage
    }
    if (coverImage !== undefined && !coverImage.startsWith('http')) {
      user.coverImage = coverImage
    }

    await user.save()
    console.log('✅ Profil sauvegardé. Nouveau téléphone:', user.telephone)

    res.json({
      success: true,
      message: 'Profil mis à jour avec succès',
      user: {
        id: user.id,
        email: user.email,
        nom: user.nom,
        prenom: user.prenom,
        role: user.role,
        profileImage: user.profileImage || null,
        coverImage: user.coverImage || null,
        telephone: user.telephone || '',
        adresse: user.adresse || '',
        dateNaissance: user.dateNaissance || '',
        avis: user.avis || '',
        createdAt: user.createdAt
      }
    })
  } catch (error) {
    console.error('Erreur mise à jour profil:', error)
    res.status(500).json({
      success: false,
      message: error.message || 'Erreur lors de la mise à jour du profil'
    })
  }
})

// Vérifier si Google OAuth est configuré
router.get('/google/status', (req, res) => {
  const isConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  res.json({
    configured: isConfigured,
    message: isConfigured ? 'Google OAuth est configuré' : 'Google OAuth n\'est pas configuré'
  })
})

// Redirection vers Google OAuth
router.get('/google/redirect', async (req, res) => {
  try {
    console.log('🔵 Route /google/redirect appelée')
    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000'
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000'
    const redirectUri = `${backendUrl}/api/auth/google/callback`
    const scope = 'email profile'

    console.log('📋 Configuration:', {
      clientId: clientId ? 'Configuré' : 'Non configuré',
      clientSecret: clientSecret ? 'Configuré' : 'Non configuré',
      redirectUri,
      frontendUrl
    })

    // Si pas de Client ID ou Client Secret, utiliser une méthode alternative
    if (!clientId || !clientSecret) {
      console.warn('⚠️ Google OAuth non configuré. Utilisation de la méthode alternative.')
      // Rediriger vers le frontend avec instruction d'utiliser la méthode alternative
      return res.redirect(`${frontendUrl}/login?error=google_not_configured`)
    }

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent`

    console.log('🔗 Redirection vers Google OAuth')
    res.redirect(authUrl)
  } catch (error) {
    console.error('❌ Erreur redirection Google:', error)
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000'
    res.redirect(`${frontendUrl}/login?error=google_error`)
  }
})

// Callback Google OAuth
router.get('/google/callback', async (req, res) => {
  try {
    const { code } = req.query

    if (!code) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=no_code`)
    }

    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000'
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000'
    const redirectUri = `${backendUrl}/api/auth/google/callback`

    if (!clientId || !clientSecret) {
      console.error('❌ GOOGLE_CLIENT_ID ou GOOGLE_CLIENT_SECRET non configuré')
      return res.redirect(`${frontendUrl}/login?error=google_not_configured`)
    }

    try {
      // Échanger le code contre un token
      const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })

      const accessToken = tokenResponse.data.access_token

      // Obtenir les informations utilisateur
      const userInfoResponse = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      })

      const googleUser = userInfoResponse.data

      // Créer ou trouver l'utilisateur
      let user = await User.findOne({
        where: {
          [Op.or]: [
            { email: googleUser.email },
            { googleId: googleUser.sub }
          ]
        },
        paranoid: false
      })

      if (user) {
        if (user.deletedAt) {
           await user.restore();
        }
        if (!user.googleId) {
          user.googleId = googleUser.sub
          if (googleUser.picture && !user.profileImage) {
            user.profileImage = googleUser.picture
          }
        }
        await user.save()
      } else {
        const nameParts = (googleUser.name || '').split(' ')
        const prenom = nameParts[0] || 'Utilisateur'
        const nom = nameParts.slice(1).join(' ') || 'Google'

        user = await User.create({
          email: googleUser.email,
          nom: nom,
          prenom: prenom,
          googleId: googleUser.sub,
          profileImage: googleUser.picture || null,
          password: null
        })
      }

      // S'assurer que le code de parrainage est généré
      await ensureReferralCode(user)

      const token = generateToken(user.id)

      // Rediriger vers le frontend avec le token
      res.redirect(`${frontendUrl}/auth/google/success?token=${token}&user=${encodeURIComponent(JSON.stringify({
        id: user.id,
        email: user.email,
        nom: user.nom,
        prenom: user.prenom,
        role: user.role,
        profileImage: user.profileImage || null,
        coverImage: user.coverImage || null,
        telephone: user.telephone || '',
        adresse: user.adresse || '',
        dateNaissance: user.dateNaissance || '',
        avis: user.avis || '',
        createdAt: user.createdAt
      }))}`)
    } catch (tokenError) {
      console.error('Erreur échange token Google:', tokenError.response?.data || tokenError.message)
      return res.redirect(`${frontendUrl}/login?error=token_exchange_failed`)
    }
  } catch (error) {
    console.error('Erreur callback Google:', error)
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=google_callback_error`)
  }
})

// Authentification Google (Méthode sécurisée avec google-auth-library)
router.post('/google', async (req, res) => {
  try {
    const { token } = req.body

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token Google (idToken) requis'
      })
    }

    // Vérifier le token
    let ticket;
    const isJWT = token.includes('.') && token.split('.').length === 3;

    if (isJWT) {
      console.log('🔍 Token détecté comme JWT (idToken), vérification via library...');
      try {
        ticket = await client.verifyIdToken({
          idToken: token,
          audience: process.env.GOOGLE_CLIENT_ID,
        });
      } catch (verifyError) {
        console.error('❌ Erreur vérification idToken:', verifyError.message);
        // On continue pour tenter le fallback au cas où
      }
    }

    if (!ticket) {
      console.log('ℹ️ Token opaque ou échec idToken, tentative via userInfo API (accessToken)...');
      try {
        const googleResponse = await axios.get(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${token}`)
        const googleUser = googleResponse.data

        if (!googleUser.email) {
          console.error('❌ Email non récupéré via userInfo API');
          throw new Error('Email non récupéré via Google');
        }
        
        console.log('✅ Informations récupérées avec succès pour:', googleUser.email);
        
        // Simuler le ticket
        ticket = { getPayload: () => ({
          email: googleUser.email,
          sub: googleUser.sub,
          name: googleUser.name,
          picture: googleUser.picture,
          given_name: googleUser.given_name,
          family_name: googleUser.family_name
        }) };
      } catch (fallbackError) {
        console.error('❌ Échec critique de l\'authentification Google:', fallbackError.response?.data || fallbackError.message);
        return res.status(401).json({
          success: false,
          message: 'Authentification Google échouée: Token invalide ou expiré'
        });
      }
    }

    const payload = ticket.getPayload();
    const googleEmail = payload.email;
    const googleId = payload.sub;

    if (!googleEmail) {
      return res.status(400).json({
        success: false,
        message: 'Impossible de récupérer l\'email Google'
      });
    }

    // Chercher l'utilisateur par email ou googleId
    let user = await User.findOne({
      where: {
        [Op.or]: [
          { email: googleEmail },
          { googleId: googleId }
        ]
      },
      paranoid: false
    })

    if (user) {
      if (user.deletedAt) {
         await user.restore();
      }
      // Mettre à jour googleId si nécessaire
      if (!user.googleId) {
        user.googleId = googleId
        if (payload.picture && !user.profileImage) {
          user.profileImage = payload.picture
        }
      }
      await user.save()
    } else {
      // Créer un nouvel utilisateur
      user = await User.create({
        email: googleEmail,
        nom: payload.family_name || payload.name || 'Google',
        prenom: payload.given_name || 'Utilisateur',
        googleId: googleId,
        profileImage: payload.picture || null,
        password: null // Pas de mot de passe pour les utilisateurs Google
      })
    }

    // S'assurer que le code de parrainage est généré
    await ensureReferralCode(user)

    // Générer le token JWT
    const jwtToken = generateToken(user.id)

    res.json({
      success: true,
      message: 'Connexion Google réussie',
      token: jwtToken,
      user: {
        id: user.id,
        email: user.email,
        nom: user.nom,
        prenom: user.prenom,
        role: user.role,
        profileImage: user.profileImage || null,
        telephone: user.telephone || '',
        adresse: user.adresse || '',
        dateNaissance: user.dateNaissance || '',
        avis: user.avis || '',
        createdAt: user.createdAt
      }
    })
  } catch (error) {
    console.error('Erreur authentification Google:', error)
    res.status(500).json({
      success: false,
      message: error.message || 'Erreur lors de l\'authentification Google'
    })
  }
})


// Demander la réinitialisation du mot de passe
router.post('/forgot-password', async (req, res) => {
  try {
    console.log('🔵 Route /forgot-password appelée')
    const { email } = req.body
    console.log('📧 Email reçu:', email)

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email requis'
      })
    }

    // Trouver l'utilisateur
    const user = await User.findOne({ where: { email } })

    // Pour la sécurité, on ne révèle pas si l'email existe ou non
    if (!user) {
      return res.json({
        success: true,
        message: 'Si cet email existe, un lien de réinitialisation a été envoyé.'
      })
    }

    // Vérifier que l'utilisateur n'utilise pas uniquement Google OAuth
    if (user.googleId && !user.password) {
      return res.status(400).json({
        success: false,
        message: 'Ce compte utilise Google pour se connecter. Utilisez la connexion Google.'
      })
    }

    // Générer un code de réinitialisation à 6 chiffres
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString()

    // Sauvegarder le code (en clair ou hashé, ici hashé pour la sécurité)
    const resetCodeHash = crypto.createHash('sha256').update(resetCode).digest('hex')

    // Sauvegarder le token hashé et la date d'expiration (15 minutes pour un code OTP)
    user.resetPasswordToken = resetCodeHash
    user.resetPasswordExpires = new Date(Date.now() + 900000) // 15 minutes
    await user.save()

    // Envoyer l'email
    console.log(`🔐 Code de réinitialisation pour ${user.email}: ${resetCode}`)
    const emailResult = await sendVerificationCodeEmail(user.email, resetCode, user.prenom)

    if (!emailResult.success) {
      return res.status(500).json({
        success: false,
        message: "Erreur lors de l'envoi de l'email. Veuillez vérifier la configuration SMTP."
      })
    }

    res.json({
      success: true,
      message: 'Si cet email existe, un code de vérification a été envoyé.',
      // En développement seulement, retirer en production
      ...(process.env.NODE_ENV === 'development' && { resetCode })
    })
  } catch (error) {
    console.error('Erreur forgot-password:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la demande de réinitialisation'
    })
  }
})

// Vérifier le code de réinitialisation
router.post('/verify-code', async (req, res) => {
  try {
    const { email, code } = req.body

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: 'Email et code requis'
      })
    }

    // Hasher le code pour le comparer
    const codeHash = crypto.createHash('sha256').update(code).digest('hex')

    // Trouver l'utilisateur
    const user = await User.findOne({
      where: {
        email,
        resetPasswordToken: codeHash,
        resetPasswordExpires: { [Op.gt]: new Date() }
      }
    })

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Code invalide ou expiré'
      })
    }

    res.json({
      success: true,
      message: 'Code vérifié avec succès'
    })
  } catch (error) {
    console.error('Erreur verify-code:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la vérification du code'
    })
  }
})

// Réinitialiser le mot de passe
router.post('/reset-password', async (req, res) => {
  try {
    const { token, email, password } = req.body

    if (!token || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Token, email et nouveau mot de passe requis'
      })
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Le mot de passe doit contenir au moins 8 caractères'
      })
    }

    // Hasher le token pour le comparer
    const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex')

    // Trouver l'utilisateur avec le token valide et non expiré
    const user = await User.findOne({
      where: {
        email,
        resetPasswordToken: resetTokenHash,
        resetPasswordExpires: { [Op.gt]: new Date() }
      }
    })

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Token invalide ou expiré'
      })
    }

    // Mettre à jour le mot de passe
    user.password = password
    user.resetPasswordToken = null
    user.resetPasswordExpires = null
    await user.save()

    res.json({
      success: true,
      message: 'Mot de passe réinitialisé avec succès'
    })
  } catch (error) {
    console.error('Erreur reset-password:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la réinitialisation du mot de passe'
    })
  }
})

export default router

