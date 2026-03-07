import axios from 'axios'
import dotenv from 'dotenv'

dotenv.config()

const OM_CLIENT_ID = process.env.OM_CLIENT_ID
const OM_CLIENT_SECRET = process.env.OM_CLIENT_SECRET
const OM_MERCHANT_KEY = process.env.OM_MERCHANT_KEY
const OM_ENV = process.env.OM_ENV || 'sandbox'
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'

const BASE_URL = OM_ENV === 'production'
    ? 'https://api.orange.com'
    : 'https://api.orange.com' // Orange often uses same base but different paths/credentials

/**
 * Get Access Token for Orange Money API
 */
const getAccessToken = async () => {
    try {
        const auth = Buffer.from(`${OM_CLIENT_ID}:${OM_CLIENT_SECRET}`).toString('base64')
        const response = await axios.post(
            `${BASE_URL}/oauth/v3/token`,
            'grant_type=client_credentials',
            {
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        )
        return response.data.access_token
    } catch (error) {
        console.error('OM Auth Error:', error.response?.data || error.message)
        throw new Error('Impossible de s\'authentifier auprès d\'Orange Money')
    }
}

/**
 * Initiate Orange Money Web Payment (Redirect Flow)
 */
export const initiatePayment = async (orderId, amount, phoneNumber = null) => {
    try {
        const accessToken = await getAccessToken()

        // In production, amount must be integer in GNF (OUV)
        const formattedAmount = Math.round(amount)

        const data = {
            merchant_key: OM_MERCHANT_KEY,
            currency: 'OUV', // GNF in Orange API
            order_id: orderId.toString(),
            amount: formattedAmount,
            return_url: `${FRONTEND_URL}/order-success`,
            cancel_url: `${FRONTEND_URL}/cart`,
            notif_url: `${process.env.BACKEND_URL || 'http://localhost:8000'}/api/payment/om-notification`,
            lang: 'fr',
            reference: `RE-ORDER-${orderId}`
        }

        // Si on a un numéro, on peut essayer de le pré-remplir
        if (phoneNumber) {
            data.subscriber_msisdn = phoneNumber.toString().replace(/\D/g, '')
        }

        const response = await axios.post(
            `${BASE_URL}/orange-money-webpay/guinea/v1/webpayment`,
            data,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        )

        return {
            success: true,
            payment_url: response.data.payment_url,
            pay_token: response.data.pay_token,
            notif_token: response.data.notif_token
        }
    } catch (error) {
        console.error('OM Payment Error:', error.response?.data || error.message)
        return {
            success: false,
            message: error.response?.data?.message || 'Erreur d\'initiation du paiement Orange Money'
        }
    }
}

/**
 * Initiate Orange Money Direct Payment (Push USSD Flow)
 * This sends a notification directly to the user's phone.
 */
export const initiateDirectPayment = async (orderId, amount, phoneNumber) => {
    try {
        const accessToken = await getAccessToken()

        // Remove '+' if present and ensure it's a string
        const cleanPhone = phoneNumber.toString().replace(/\D/g, '')

        // Note: The endpoint for Direct Push might vary. 
        // For Orange Guinea (Sonatel), it's often the 'mpayment' or 'payment' endpoint.
        const response = await axios.post(
            `${BASE_URL}/orange-money-guinea/v1/payment`,
            {
                merchant_id: OM_MERCHANT_KEY,
                amount: Math.round(amount),
                subscriber_msisdn: cleanPhone,
                order_id: orderId.toString(),
                description: `Paiement commande #${orderId}`,
                notif_url: `${process.env.BACKEND_URL || 'http://localhost:8000'}/api/payment/om-notification`
            },
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        )

        return {
            success: true,
            pay_token: response.data.pay_token || response.data.txnid,
            notif_token: response.data.notif_token || response.data.txnid
        }
    } catch (error) {
        console.error('OM Direct Payment Error:', error.response?.data || error.message)
        // If Direct Payment fails, we might want to fall back to WebPayment
        return {
            success: false,
            message: error.response?.data?.message || 'Échec de l\'envoi du message de confirmation sur le téléphone'
        }
    }
}

/**
 * Check Payment Status (Manual check)
 */
export const checkPaymentStatus = async (payToken) => {
    try {
        const accessToken = await getAccessToken()

        const response = await axios.get(
            `${BASE_URL}/orange-money-webpay/guinea/v1/transactionstatus/${payToken}`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            }
        )

        return response.data
    } catch (error) {
        console.error('OM Status Check Error:', error.response?.data || error.message)
        throw error
    }
}
