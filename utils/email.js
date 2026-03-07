import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

/**
 * Utility to send emails
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} text - Plain text version
 * @param {string} html - HTML version
 */
export const sendEmail = async (to, subject, text, html) => {
  try {
    // Force reload environment variables to ensure we have the latest SMTP_PASS
    dotenv.config({ override: true });

    // Create transporter
    // For development, you can use ethereal.email or log to console if SMTP is not configured
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    // Send mail
    const info = await transporter.sendMail({
      from: `"CuniResto" <${process.env.SMTP_USER || 'no-reply@cuniresto.com'}>`,
      to,
      subject,
      text,
      html,
    });

    console.log('✉️ Email envoyé: %s', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Erreur lors de l\'envoi de l\'email:', error);
    
    // Fallback for development: log to console if sending fails or SMTP is not configured
    if (process.env.NODE_ENV === 'development') {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🛠️ MODE DÉVELOPPEMENT - EMAIL LOG 🛠️');
      console.log(`À: ${to}`);
      console.log(`Sujet: ${subject}`);
      console.log(`Contenu: ${text}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      return { success: true, fallback: true };
    }
    
    return { success: false, error: error.message };
  }
};

/**
 * Send 6-digit verification code email
 * @param {string} to - Recipient email
 * @param {string} code - 6-digit code
 * @param {string} userName - User's first name
 */
export const sendVerificationCodeEmail = async (to, code, userName) => {
  const subject = `${code} est votre code de récupération CuniResto`;
  
  const text = `Bonjour ${userName},\n\nVotre code de récupération de mot de passe est : ${code}\n\nCe code expirera dans 1 heure.\n\nSi vous n'avez pas demandé cette réinitialisation, veuillez ignorer cet email.\n\nL'équipe CuniResto`;
  
  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
      <h2 style="color: #3B82F6; text-align: center;">Récupération de mot de passe</h2>
      <p>Bonjour <strong>${userName}</strong>,</p>
      <p>Vous avez demandé la réinitialisation de votre mot de passe pour votre compte CuniResto.</p>
      <div style="background-color: #f8fafc; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
        <p style="font-size: 14px; color: #64748b; margin-bottom: 10px;">Votre code de vérification :</p>
        <h1 style="font-size: 32px; letter-spacing: 5px; color: #1e293b; margin: 0;">${code}</h1>
      </div>
      <p style="font-size: 14px; color: #64748b;">Ce code est valable pendant <strong>1 heure</strong>.</p>
      <p style="font-size: 14px; color: #64748b;">Si vous n'avez pas initié cette demande, vous pouvez ignorer cet email en toute sécurité.</p>
      <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
      <p style="font-size: 12px; color: #94a3b8; text-align: center;">© ${new Date().getFullYear()} CuniResto. Tous droits réservés.</p>
    </div>
  `;

  return await sendEmail(to, subject, text, html);
};
