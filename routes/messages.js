import express from 'express'
import { Op, fn, col, literal } from 'sequelize'
import { Conversation, Message, User, sequelize } from '../models/index.js'
import { authenticate } from '../middleware/auth.js'
import { upload } from '../middleware/upload.js'

const router = express.Router()

// Obtenir toutes les conversations de l'utilisateur
router.get('/conversations', authenticate, async (req, res) => {
  try {
    const conversations = await Conversation.findAll({
      where: {
        id: {
          [Op.in]: literal(`(
            SELECT "ConversationId" 
            FROM "UserConversations" 
            WHERE "UserId" = '${req.user.id}'
          )`)
        }
      },
      include: [
        {
          model: User,
          as: 'participants',
          attributes: ['id', 'nom', 'prenom', 'email', 'role', 'profileImage', 'telephone']
        },
        {
          model: Message,
          as: 'lastMessage'
        }
      ],
      order: [['lastMessageAt', 'DESC']]
    })

    const conversationsWithUnread = await Promise.all(
      conversations.map(async (conv) => {
        const unreadCount = await Message.count({
          where: {
            conversationId: conv.id,
            senderId: { [Op.ne]: req.user.id },
            read: false
          }
        })
        const plainConv = conv.get({ plain: true })
        return {
          ...plainConv,
          unreadCount
        }
      })
    )

    res.json({
      success: true,
      conversations: conversationsWithUnread
    })
  } catch (error) {
    console.error('Erreur récupération conversations:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des conversations'
    })
  }
})

// Créer ou obtenir une conversation avec un utilisateur
router.post('/conversations', authenticate, async (req, res) => {
  try {
    const { participantId } = req.body

    if (!participantId) {
      return res.status(400).json({
        success: false,
        message: 'ID du participant requis'
      })
    }

    const currentUser = await User.findByPk(req.user.id)
    const otherUser = await User.findByPk(participantId)

    if (!otherUser) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' })
    }

    // Gestion des blocages
    const currentUserBlocked = Array.isArray(currentUser.blockedUsers) ? currentUser.blockedUsers : []
    const otherUserBlocked = Array.isArray(otherUser.blockedUsers) ? otherUser.blockedUsers : []

    if (otherUserBlocked.includes(currentUser.id)) {
      return res.status(403).json({ success: false, message: 'Vous ne pouvez pas démarrer de conversation avec cet utilisateur.' })
    }

    if (currentUserBlocked.includes(otherUser.id)) {
      return res.status(403).json({ success: false, message: 'Vous avez bloqué cet utilisateur.' })
    }

    // Trouver une conversation privée existante
    const userConversations = await Conversation.findAll({
      where: { isGroup: false },
      include: [
        {
          model: User,
          as: 'participants',
          where: { id: [req.user.id, participantId] }
        }
      ]
    })

    let conversation = userConversations.find(c => c.participants.length === 2)

    if (!conversation) {
      conversation = await Conversation.create({ isGroup: false })
      await conversation.addParticipants([currentUser.id, otherUser.id])
      conversation = await Conversation.findByPk(conversation.id, {
        include: [{ model: User, as: 'participants', attributes: ['id', 'nom', 'prenom', 'email', 'role', 'profileImage', 'telephone'] }]
      })
    }

    res.json({
      success: true,
      conversation
    })
  } catch (error) {
    console.error('Erreur création conversation:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la création de la conversation'
    })
  }
})

// Créer une conversation de groupe
router.post('/conversations/group', authenticate, async (req, res) => {
  try {
    const { name, participants } = req.body

    if (!name || !participants || !Array.isArray(participants) || participants.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Le nom du groupe et au moins un participant sont requis.'
      })
    }

    const allParticipants = [...new Set([req.user.id, ...participants])]

    const conversation = await Conversation.create({
      name,
      isGroup: true,
      admins: [req.user.id]
    })

    await conversation.addParticipants(allParticipants)
    
    const detailedConv = await Conversation.findByPk(conversation.id, {
      include: [{ model: User, as: 'participants', attributes: ['id', 'nom', 'prenom', 'email', 'role', 'profileImage', 'telephone'] }]
    })

    res.status(201).json({
      success: true,
      conversation: detailedConv
    })
  } catch (error) {
    console.error('Erreur création groupe:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la création du groupe'
    })
  }
})

// Obtenir les messages d'une conversation
router.get('/conversations/:conversationId/messages', authenticate, async (req, res) => {
  try {
    const { conversationId } = req.params
    const { page = 1, limit = 50 } = req.query

    const messages = await Message.findAll({
      where: { conversationId },
      include: [
        { model: User, as: 'sender', attributes: ['id', 'nom', 'prenom', 'email', 'role', 'profileImage', 'telephone'] }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit)
    })

    await Message.update(
      { read: true, readAt: new Date() },
      {
        where: {
          conversationId,
          senderId: { [Op.ne]: req.user.id },
          read: false
        }
      }
    )

    res.json({
      success: true,
      messages: messages.reverse()
    })
  } catch (error) {
    console.error('Erreur récupération messages:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des messages'
    })
  }
})

// Envoyer un message
router.post('/conversations/:conversationId/messages', authenticate, upload.array('attachments', 10), async (req, res) => {
  try {
    const { conversationId } = req.params
    const { content, replyTo, replyToModel } = req.body

    const attachments = []
    if (req.files && req.files.length > 0) {
      req.files.forEach(file => {
        let fileType = 'file'
        let subDir = 'files'
        if (file.mimetype.startsWith('image/')) { fileType = 'image'; subDir = 'images' }
        else if (file.mimetype.startsWith('video/')) { fileType = 'video'; subDir = 'videos' }
        else if (file.mimetype.startsWith('audio/')) { fileType = 'audio'; subDir = 'audios' }
        
        attachments.push({
          type: fileType,
          url: `/uploads/${subDir}/${file.filename}`,
          filename: file.originalname,
          size: file.size,
          mimeType: file.mimetype,
        })
      })
    }

    const message = await Message.create({
      conversationId,
      senderId: req.user.id,
      content: content || '',
      attachments,
      replyToId: replyTo || null,
      replyToModel: replyToModel || 'Message'
    })

    await Conversation.update(
      { lastMessageId: message.id, lastMessageAt: new Date() },
      { where: { id: conversationId } }
    )

    res.status(201).json({
      success: true,
      message
    })
  } catch (error) {
    console.error('Erreur envoi message:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'envoi du message'
    })
  }
})

// Obtenir la liste des utilisateurs
router.get('/users', authenticate, async (req, res) => {
  try {
    const users = await User.findAll({
      where: { id: { [Op.ne]: req.user.id } },
      attributes: ['id', 'nom', 'prenom', 'email', 'role', 'profileImage', 'telephone']
    })

    res.json({
      success: true,
      users
    })
  } catch (error) {
    console.error('Erreur récupération utilisateurs:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des utilisateurs'
    })
  }
})

// Marquer un message comme lu
router.put('/messages/:messageId/read', authenticate, async (req, res) => {
  try {
    const { messageId } = req.params
    const message = await Message.findByPk(messageId)
    
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message non trouvé' })
    }

    await message.update({ read: true, readAt: new Date() })

    res.json({
      success: true,
      message
    })
  } catch (error) {
    console.error('Erreur marquage message lu:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors du marquage du message'
    })
  }
})

// Supprimer un message
router.delete('/messages/:messageId', authenticate, async (req, res) => {
  try {
    const { messageId } = req.params
    const message = await Message.findByPk(messageId)

    if (!message) {
      return res.status(404).json({ success: false, message: 'Message non trouvé' })
    }

    if (message.senderId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Non autorisé' })
    }

    await message.destroy()

    res.json({
      success: true,
      message: 'Message supprimé avec succès'
    })
  } catch (error) {
    console.error('Erreur suppression message:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression du message'
    })
  }
})

// Supprimer une conversation
router.delete('/conversations/:conversationId', authenticate, async (req, res) => {
  try {
    const { conversationId } = req.params
    const conversation = await Conversation.findByPk(conversationId)

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation non trouvée' })
    }

    // Supprimer les messages
    await Message.destroy({ where: { conversationId } })
    // Supprimer la conversation
    await conversation.destroy()

    res.json({
      success: true,
      message: 'Conversation supprimée avec succès'
    })
  } catch (error) {
    console.error('Erreur suppression conversation:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression de la conversation'
    })
  }
})

// Star / Unstar un message
router.put('/messages/:messageId/star', authenticate, async (req, res) => {
  try {
    const { messageId } = req.params
    const message = await Message.findByPk(messageId)
    
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message non trouvé' })
    }

    await message.update({ isStarred: !message.isStarred })

    res.json({
      success: true,
      message: message.isStarred ? 'Message marqué comme important' : 'Message retiré des importants',
      isStarred: message.isStarred
    })
  } catch (error) {
    console.error('Erreur star message:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

// Réagir à un message
router.put('/messages/:messageId/react', authenticate, async (req, res) => {
  try {
    const { messageId } = req.params
    const { emoji } = req.body
    const message = await Message.findByPk(messageId)

    if (!message) {
      return res.status(404).json({ success: false, message: 'Message non trouvé' })
    }

    let reactions = Array.isArray(message.reactions) ? [...message.reactions] : []
    const existingIndex = reactions.findIndex(r => r.user === req.user.id)

    if (existingIndex > -1) {
      if (reactions[existingIndex].emoji === emoji) reactions.splice(existingIndex, 1)
      else reactions[existingIndex].emoji = emoji
    } else {
      reactions.push({ user: req.user.id, emoji })
    }

    await message.update({ reactions })
    res.json({ success: true, reactions })
  } catch (error) {
    console.error('Erreur réaction message:', error)
    res.status(500).json({ success: false, message: 'Erreur serveur' })
  }
})

export default router


