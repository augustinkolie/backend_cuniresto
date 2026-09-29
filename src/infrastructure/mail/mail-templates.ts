// Gabarits d'e-mails. Toute donnée utilisateur passe par escapeHtml (l'ancien code injectait
// les saisies brutes dans le HTML).

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function formatGnf(amount: number): string {
  return `${new Intl.NumberFormat('fr-FR').format(amount)} GNF`
}

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#F7F1E8;font-family:Arial,sans-serif;color:#14110F">
<div style="max-width:600px;margin:0 auto;padding:24px">
  <div style="background:#14110F;color:#F7F1E8;padding:20px 24px;border-radius:12px 12px 0 0">
    <div style="font-family:Georgia,serif;font-size:22px">Maison Braise</div>
    <div style="color:#F2A541;font-size:14px;margin-top:4px">${escapeHtml(title)}</div>
  </div>
  <div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;line-height:1.6">${body}</div>
</div></body></html>`
}

function rows(entries: Array<[string, string | number | null | undefined]>): string {
  return `<table style="width:100%;border-collapse:collapse">${entries
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#666;width:40%">${escapeHtml(k)}</td><td style="padding:8px 0;border-bottom:1px solid #eee">${escapeHtml(String(v))}</td></tr>`,
    )
    .join('')}</table>`
}

export const mailTemplates = {
  passwordResetCode(firstName: string, code: string) {
    return {
      subject: 'Votre code de réinitialisation',
      html: layout(
        'Réinitialisation du mot de passe',
        `<p>Bonjour ${escapeHtml(firstName)},</p>
<p>Voici votre code de vérification, valable 15 minutes :</p>
<p style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#F06A3F">${escapeHtml(code)}</p>
<p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.</p>`,
      ),
    }
  },

  reservationReceivedAdmin(r: {
    firstName: string
    lastName: string
    email: string
    phone: string
    date: string
    timeSlot: string
    partySize: number
    message?: string | null
  }) {
    return {
      subject: `Nouvelle réservation : ${r.firstName} ${r.lastName}`,
      html: layout(
        'Nouvelle demande de réservation',
        rows([
          ['Client', `${r.firstName} ${r.lastName}`],
          ['Date', r.date],
          ['Heure', r.timeSlot],
          ['Couverts', r.partySize],
          ['Téléphone', r.phone],
          ['E-mail', r.email],
          ['Message', r.message],
        ]),
      ),
    }
  },

  reservationStatus(firstName: string, date: string, timeSlot: string, status: string) {
    const label: Record<string, string> = {
      CONFIRMED: 'confirmée',
      CANCELLED: 'annulée',
      COMPLETED: 'terminée',
      PENDING: 'en attente de confirmation',
    }
    return {
      subject: `Votre réservation est ${label[status] ?? status}`,
      html: layout(
        'Votre réservation',
        `<p>Bonjour ${escapeHtml(firstName)},</p><p>Votre réservation du <strong>${escapeHtml(date)}</strong> à <strong>${escapeHtml(timeSlot)}</strong> est <strong>${escapeHtml(label[status] ?? status)}</strong>.</p>`,
      ),
    }
  },

  orderReceipt(o: {
    firstName: string
    number: number
    items: Array<{ name: string; quantity: number; unitPrice: number }>
    deliveryFee: number
    total: number
  }) {
    const lines = o.items
      .map(
        (i) =>
          `<tr><td style="padding:6px 0">${i.quantity} × ${escapeHtml(i.name)}</td><td style="text-align:right">${formatGnf(i.quantity * i.unitPrice)}</td></tr>`,
      )
      .join('')
    return {
      subject: `Reçu de votre commande n° ${o.number}`,
      html: layout(
        `Commande n° ${o.number}`,
        `<p>Merci ${escapeHtml(o.firstName)}, votre paiement est confirmé.</p>
<table style="width:100%">${lines}
<tr><td style="padding:6px 0;color:#666">Livraison</td><td style="text-align:right;color:#666">${formatGnf(o.deliveryFee)}</td></tr>
<tr><td style="padding-top:12px;font-weight:bold">Total</td><td style="text-align:right;font-weight:bold;color:#F06A3F">${formatGnf(o.total)}</td></tr></table>`,
      ),
    }
  },

  contactMessage(c: {
    firstName: string
    lastName: string
    email: string
    phone: string
    subject: string
    message: string
  }) {
    return {
      subject: `Contact : ${c.subject}`,
      html: layout(
        'Nouveau message de contact',
        `${rows([
          ['Nom', `${c.firstName} ${c.lastName}`],
          ['E-mail', c.email],
          ['Téléphone', c.phone],
          ['Sujet', c.subject],
        ])}<p style="white-space:pre-wrap;background:#F7F1E8;padding:12px;border-radius:8px">${escapeHtml(c.message)}</p>`,
      ),
    }
  },

  newsletterConfirm(confirmUrl: string) {
    return {
      subject: 'Confirmez votre inscription à la newsletter',
      html: layout(
        'Newsletter',
        `<p>Merci de votre intérêt pour Maison Braise !</p><p><a href="${escapeHtml(confirmUrl)}" style="display:inline-block;background:#F06A3F;color:#14110F;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:bold">Confirmer mon inscription</a></p>`,
      ),
    }
  },

  orderStatus(firstName: string, number: number, message: string) {
    return {
      subject: `Commande n° ${number} : ${message}`,
      html: layout(
        `Commande n° ${number}`,
        `<p>Bonjour ${escapeHtml(firstName)},</p><p>${escapeHtml(message)}</p>`,
      ),
    }
  },
}

/** Confirmation d'inscription à une formation, envoyée une fois le paiement reçu. */
export function enrollmentConfirmedMail(e: {
  firstName: string
  number: number
  courseTitle: string
  amount: number
  schedule?: string | null
  onSite: boolean
}) {
  return {
    subject: `Inscription confirmée — ${e.courseTitle}`,
    html: layout(
      'Inscription confirmée',
      `<p>Bonjour ${escapeHtml(e.firstName)},</p>
<p>Votre paiement est bien reçu : votre place est réservée.</p>
${rows([
  ['Formation', e.courseTitle],
  ['Inscription n°', e.number],
  ['Montant payé', formatGnf(e.amount)],
  ['Lieu', e.onSite ? 'Au restaurant Maison Braise' : 'En ligne'],
  ['Horaires', e.schedule],
])}
<p>Nous vous contacterons quelques jours avant la première séance. À très bientôt en cuisine !</p>`,
    ),
  }
}
