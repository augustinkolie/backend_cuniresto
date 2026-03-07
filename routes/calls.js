import express from 'express'
import { Call, User } from '../models/index.js'
import { authenticate } from '../middleware/auth.js'

const router = express.Router()

// Toutes les routes nécessitent l'authentification
router.use(authenticate)

// Initier un appel
router.post('/initiate', async (req, res) => {
    try {
        const { conversationId, receiverId, callType } = req.body

        if (!conversationId || !receiverId || !callType) {
            return res.status(400).json({
                success: false,
                message: 'Conversation ID, receiver ID et type d\'appel requis'
            })
        }

        if (!['video', 'phone'].includes(callType)) {
            return res.status(400).json({
                success: false,
                message: 'Type d\'appel invalide'
            })
        }

        const call = await Call.create({
            callerId: req.user.id,
            recipientId: receiverId,
            conversationId: conversationId,
            callType,
            status: 'missed' // Par défaut, considéré comme manqué jusqu'à réponse
        })

        res.json({
            success: true,
            call
        })
    } catch (error) {
        console.error('Erreur création appel:', error)
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la création de l\'appel'
        })
    }
})

// Mettre à jour le statut d'un appel
router.patch('/:id/status', async (req, res) => {
    try {
        const { id } = req.params
        const { status, duration } = req.body

        if (!status) {
            return res.status(400).json({ success: false, message: 'Statut requis' })
        }

        if (!['missed', 'answered', 'rejected', 'cancelled'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Statut invalide'
            })
        }

        const call = await Call.findByPk(id)

        if (!call) {
            return res.status(404).json({ success: false, message: 'Appel non trouvé' })
        }

        // Vérifier que l'utilisateur est participant à l'appel
        if (call.callerId !== req.user.id && call.recipientId !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Non autorisé' })
        }

        await call.update({ status, duration: duration !== undefined ? duration : call.duration })

        res.json({
            success: true,
            call
        })
    } catch (error) {
        console.error('Erreur mise à jour appel:', error)
        res.status(500).json({ success: false, message: 'Erreur serveur' })
    }
})

// Récupérer l'historique des appels d'une conversation
router.get('/conversation/:conversationId', async (req, res) => {
    try {
        const { conversationId } = req.params

        const calls = await Call.findAll({
            where: { conversationId: conversationId },
            include: [
                { model: User, as: 'caller', attributes: ['nom', 'prenom', 'email', 'profileImage'] },
                { model: User, as: 'receiver', attributes: ['nom', 'prenom', 'email', 'profileImage'] }
            ],
            order: [['createdAt', 'DESC']]
        })

        res.json({ success: true, calls })
    } catch (error) {
        console.error('Erreur récupération historique appels:', error)
        res.status(500).json({ success: false, message: 'Erreur serveur' })
    }
})

// Supprimer un enregistrement d'appel
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params
        const call = await Call.findByPk(id)

        if (!call) return res.status(404).json({ success: false, message: 'Appel non trouvé' })

        // Vérifier que l'utilisateur est participant à l'appel
        if (call.callerId !== req.user.id && call.recipientId !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Non autorisé' })
        }

        await call.destroy()

        res.json({ success: true, message: 'Supprimé' })
    } catch (error) {
        console.error('Erreur suppression appel:', error)
        res.status(500).json({ success: false, message: 'Erreur serveur' })
    }
})

export default router
