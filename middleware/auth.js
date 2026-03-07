import jwt from 'jsonwebtoken'
import User from '../models/User.js'

export const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1] || req.headers.authorization

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token d\'authentification requis'
      })
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production')
    const user = await User.findByPk(decoded.userId)

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Utilisateur non trouvé'
      })
    }

    req.user = user
    next()
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Token invalide'
      })
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expiré'
      })
    }
    res.status(500).json({
      success: false,
      message: 'Erreur d\'authentification'
    })
  }
}

export const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next()
  } else {
    res.status(403).json({
      success: false,
      message: 'Accès refusé. Admin requis.'
    })
  }
}





