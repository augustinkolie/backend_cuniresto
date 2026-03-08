import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { createServer } from 'http'
import { Server } from 'socket.io'
import authRoutes from './routes/auth.js'
import productRoutes from './routes/products.js'
import cartRoutes from './routes/cart.js'
import commentRoutes from './routes/comments.js'
import reservationRoutes from './routes/reservations.js'
import categoryRoutes from './routes/categories.js'
import messageRoutes from './routes/messages.js'
import userRoutes from './routes/users.js'
import chatRoutes from './routes/chat.js'
import analyticsRoutes from './routes/analytics.js'
import tableRoutes from './routes/tables.js'
import loyaltyRoutes from './routes/loyalty.js'
import chefContentRoutes from './routes/chefContent.js'
import deliveryRoutes from './routes/delivery.js'
import companyRoutes from './routes/company.js'
import callRoutes from './routes/calls.js'
import paymentRoutes from './routes/payment.js'
import uploadRoutes from './routes/upload.js'
import notificationRoutes from './routes/notifications.js'
import contactRoutes from './routes/contact.js'
import path from 'path'
import { fileURLToPath } from 'url'
import { sequelize } from './models/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config()

const app = express()
const PORT = process.env.PORT || 8000

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Servir les fichiers uploadés
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

// Connexion à la base de données MySQL via Sequelize
sequelize.authenticate()
  .then(() => {
    console.log('✅ Connecté à PostgreSQL avec Sequelize')
    // Synchroniser les modèles (force: false pour ne pas supprimer les données existantes s'il y en a)
    // Note: Utiliser { force: true } uniquement pendant le dev pour recréer les tables
    return sequelize.sync({ force: false })
  })
  .then(() => {
    console.log('✅ Base de données synchronisée')
  })
  .catch((error) => {
    console.error('❌ Erreur de connexion/synchro PostgreSQL:', error)
  })

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'API Resto App',
    version: '1.0.0',
    status: 'running'
  })
})

// Route de test temporaire pour la base de données
app.get('/test-db', async (req, res) => {
  try {
    const [results] = await sequelize.query('SELECT NOW() as "database_time"')
    res.json({ 
      success: true, 
      message: 'Connexion à la base de données réussie !',
      data: results[0] 
    })
  } catch (error) {
    console.error('Erreur test-db:', error)
    res.status(500).json({ 
      success: false, 
      message: 'Erreur de connexion à la base de données',
      error: error.message 
    })
  }
})

// Configurer Socket.IO (avant les routes pour être sûr)
const httpServer = createServer(app)
const io = new Server(httpServer, {
  path: "/socket.io",
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
    methods: ["GET", "POST"]
  }
})

// Log des erreurs de connexion socket
io.on("connection_error", (err) => {
  console.log("❌ Erreur de connexion Socket.io sur le serveur:", err.message);
  console.log("Détails de l'erreur:", err.context);
});

app.use('/api/auth', authRoutes)
app.use('/api/products', productRoutes)
app.use('/api/cart', cartRoutes)
app.use('/api/comments', commentRoutes)
app.use('/api/reservations', reservationRoutes)
app.use('/api/categories', categoryRoutes)
app.use('/api/messages', messageRoutes)
app.use('/api/users', userRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/analytics', analyticsRoutes)
app.use('/api/tables', tableRoutes)
app.use('/api/loyalty', loyaltyRoutes)
app.use('/api/chef-content', chefContentRoutes)
app.use('/api/contact', contactRoutes)
app.use('/api/delivery', deliveryRoutes)
app.use('/api/company', companyRoutes)
app.use('/api/calls', callRoutes)
app.use('/api/calls', callRoutes)
app.use('/api/payment', paymentRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/notifications', notificationRoutes)

// Log pour vérifier que les routes sont chargées
if (loyaltyRoutes && loyaltyRoutes.stack) {
  console.log('✅ Routes loyalty chargées:', loyaltyRoutes.stack.length, 'routes')
  // Lister toutes les routes pour debug
  loyaltyRoutes.stack.forEach((route) => {
    if (route.route) {
      const methods = Object.keys(route.route.methods).join(', ').toUpperCase()
      console.log(`   ${methods} ${route.route.path}`)
    }
  })
} else {
  console.warn('⚠️ Routes loyalty non chargées correctement')
}

// Les routeurs (Messages, Calls, etc.)
// Les routeurs (Messages, Calls, etc.)
// ... déjà fait au dessus ...

// Stocker les utilisateurs connectés (userId -> socketId)
const connectedUsers = new Map()

// Événements Socket.IO
io.on('connection', (socket) => {
  console.log('🔌 Nouvelle connexion Socket.IO:', socket.id)

  // L'utilisateur s'identifie
  socket.on('user:register', (userId) => {
    connectedUsers.set(userId, socket.id)
    console.log(`👤 Utilisateur ${userId} enregistré avec socket ${socket.id}`)
  })

  // Initier un appel
  socket.on('call:initiate', ({ callerId, receiverId, callerName, callId, type }) => {
    const receiverSocketId = connectedUsers.get(receiverId)
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('call:incoming', {
        callerId,
        callerName,
        callId,
        type
      })
      console.log(`📞 Appel ${type || 'vocal'} initié de ${callerId} vers ${receiverId}`)
    } else {
      socket.emit('call:user-offline', { receiverId })
    }
  })

  // Offre WebRTC
  socket.on('call:offer', ({ callId, receiverId, offer }) => {
    const receiverSocketId = connectedUsers.get(receiverId)
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('call:offer', { callId, offer })
    }
  })

  // Réponse WebRTC
  socket.on('call:answer', ({ callId, callerId, answer }) => {
    const callerSocketId = connectedUsers.get(callerId)
    if (callerSocketId) {
      io.to(callerSocketId).emit('call:answer', { callId, answer })
    }
  })

  // ICE Candidate
  socket.on('call:ice-candidate', ({ recipientId, candidate }) => {
    const recipientSocketId = connectedUsers.get(recipientId)
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('call:ice-candidate', { candidate })
    }
  })

  // Accepter l'appel
  socket.on('call:accept', ({ callId, callerId }) => {
    const callerSocketId = connectedUsers.get(callerId)
    if (callerSocketId) {
      io.to(callerSocketId).emit('call:accepted', { callId })
    }
  })

  // Refuser l'appel
  socket.on('call:reject', ({ callId, callerId }) => {
    const callerSocketId = connectedUsers.get(callerId)
    if (callerSocketId) {
      io.to(callerSocketId).emit('call:rejected', { callId })
    }
  })

  // Terminer l'appel
  socket.on('call:end', ({ callId, recipientId }) => {
    const recipientSocketId = connectedUsers.get(recipientId)
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('call:ended', { callId })
    }
  })

  // Déconnexion
  socket.on('disconnect', () => {
    // Trouver et supprimer l'utilisateur
    for (const [userId, socketId] of connectedUsers.entries()) {
      if (socketId === socket.id) {
        connectedUsers.delete(userId)
        console.log(`👋 Utilisateur ${userId} déconnecté`)
        break
      }
    }
  })
})

// Gestion des erreurs (à mettre à la toute fin)
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Erreur serveur',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  })
})

// Route 404 (après toutes les autres routes)
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route non trouvée'
  })
})

httpServer.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`)
  console.log(`📡 API disponible sur http://localhost:${PORT}`)
  console.log(`🔌 WebSocket prêt pour les appels en temps réel`)
})

// Modification pour redémarrage serveur
