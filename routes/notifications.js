import express from 'express'
import { Notification, User } from '../models/index.js'
import { authenticate } from '../middleware/auth.js'

const router = express.Router()

// Récupérer les notifications de l'utilisateur connecté
router.get('/', authenticate, async (req, res) => {
    try {
        const notifications = await Notification.findAll({
            where: { recipientId: req.user.id },
            include: [{ model: User, as: 'sender', attributes: ['nom', 'prenom', 'profileImage'] }],
            order: [['createdAt', 'DESC']],
            limit: 50
        })

        const unreadCount = await Notification.count({
            where: {
                recipientId: req.user.id,
                read: false
            }
        })

        res.json({
            success: true,
            notifications,
            unreadCount
        })
    } catch (error) {
        console.error('Erreur récupération notifications:', error)
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération des notifications'
        })
    }
})

// Marquer une notification comme lue
router.put('/:id/read', authenticate, async (req, res) => {
    try {
        const notification = await Notification.findOne({
            where: {
                id: req.params.id,
                recipientId: req.user.id
            }
        })

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'Notification non trouvée'
            })
        }

        notification.read = true
        await notification.save()

        res.json({
            success: true,
            message: 'Notification marquée comme lue',
            notification
        })
    } catch (error) {
        console.error('Erreur mise à jour notification:', error)
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la mise à jour de la notification'
        })
    }
})

// Marquer toutes les notifications comme lues
router.put('/read-all', authenticate, async (req, res) => {
    try {
        await Notification.update(
            { read: true },
            { where: { recipientId: req.user.id, read: false } }
        )

        res.json({
            success: true,
            message: 'Toutes les notifications marquées comme lues'
        })
    } catch (error) {
        console.error('Erreur mise à jour notifications:', error)
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la mise à jour des notifications'
        })
    }
})

export default router
