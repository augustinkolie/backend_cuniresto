import express from 'express'
import { Order } from '../models/index.js'
import { Op, literal } from 'sequelize'

const router = express.Router()

/**
 * Endpoint for Orange Money Web Payment notification (notif_url)
 */
router.post('/om-notification', async (req, res) => {
    try {
        const { status, notif_token, txnid } = req.body

        console.log('💳 OM Notification Received:', { status, notif_token, txnid })

        // Trouver la commande par notif_token dans le JSON paymentInfo
        const order = await Order.findOne({
            where: literal(`paymentInfo->'$.orangeMoney.notifToken' = '${notif_token}'`)
        })

        if (!order) {
            console.warn('⚠️ Aucun commande trouvée pour le token:', notif_token)
            return res.status(404).send('Order not found')
        }

        const paymentInfo = { ...order.paymentInfo }
        if (!paymentInfo.orangeMoney) paymentInfo.orangeMoney = {}

        // Mettre à jour le statut
        if (status === 'SUCCESS') {
            await order.update({
                status: 'confirmed',
                paymentInfo: {
                    ...paymentInfo,
                    orangeMoney: { ...paymentInfo.orangeMoney, orangeMoneyStatus: 'SUCCESS' }
                }
            })
        } else if (status === 'FAILED' || status === 'EXPIRED') {
            await order.update({
                status: 'cancelled',
                paymentInfo: {
                    ...paymentInfo,
                    orangeMoney: { ...paymentInfo.orangeMoney, orangeMoneyStatus: status }
                }
            })
        }

        console.log(`✅ Commande ${order.id} mise à jour: ${order.status}`)

        // Orange attend un 200 OK
        res.status(200).send('OK')
    } catch (error) {
        console.error('OM Notification handling error:', error)
        res.status(500).send('Internal Server Error')
    }
})

export default router
