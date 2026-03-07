import express from 'express'
import { Op } from 'sequelize'
import { Product } from '../models/index.js'
import { GoogleGenerativeAI } from '@google/generative-ai'

const router = express.Router()

// Initialiser Gemini avec la clé API
const GEMINI_ENABLED = process.env.GEMINI_ENABLED === '1'
const GEMINI_KEY = process.env.GEMINI_API_KEY
const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash'

let genAI = null
let model = null

if (GEMINI_ENABLED && GEMINI_KEY && GEMINI_KEY !== 'your_gemini_api_key') {
  try {
    genAI = new GoogleGenerativeAI(GEMINI_KEY)
    model = genAI.getGenerativeModel({ model: modelName })
    console.log(`✅ Gemini AI activé avec le modèle: ${modelName}`)
  } catch (err) {
    console.error('❌ Erreur initialisation Gemini:', err.message)
  }
} else {
  if (!GEMINI_ENABLED) console.warn('⚠️  Gemini désactivé (GEMINI_ENABLED != 1)')
  else if (!GEMINI_KEY || GEMINI_KEY === 'your_gemini_api_key') console.warn('⚠️  Clé API Gemini manquante ou invalide — mode réponses prédéfinies')
}

// Catégories de plats avec descriptions
const categories = {
  'lapin': {
    name: 'Lapin',
    description: 'Plats de lapin braisés avec différentes sauces',
    keywords: ['lapin', 'rabbit', 'viande', 'braisé', 'sauce'],
    recommendations: ['Lapin Braisé Savoureux', 'Lapin aux Herbes']
  },
  'atieke': {
    name: 'Atiéké',
    description: 'Atiéké traditionnel avec accompagnements',
    keywords: ['atieke', 'atiéké', 'manioc', 'accompagnement'],
    recommendations: ['Atiéké Traditionnel', 'Atiéké Garni']
  },
  'spaghetti': {
    name: 'Spaghetti',
    description: 'Spaghetti et plats de pâtes',
    keywords: ['spaghetti', 'nouille', 'nouilles', 'pâtes', 'pasta'],
    recommendations: ['Spaghetti Carbonara', 'Spaghetti Bolognese']
  },
  'sandwichs': {
    name: 'Sandwich',
    description: 'Sandwichs frais et gourmands',
    keywords: ['sandwich', 'sandwichs', 'rapide', 'snack'],
    recommendations: ['Sandwich Gourmand', 'Sandwich Premium']
  },
  'boissons': {
    name: 'Boissons',
    description: 'Boissons fraîches et chaudes',
    keywords: ['boisson', 'boissons', 'jus', 'café', 'thé', 'eau', 'soda'],
    recommendations: ['Jus d\'Orange Frais', 'Café Expresso']
  },
  'desserts': {
    name: 'Desserts',
    description: 'Desserts maison et gourmands',
    keywords: ['dessert', 'desserts', 'sucré', 'gâteau', 'glace', 'tiramisu'],
    recommendations: ['Tiramisu Maison', 'Mousse au Chocolat']
  }
}

// Patterns de reconnaissance (améliorés pour mieux détecter les salutations)
const greetingPatterns = [
  /^(bonjour|salut|hello|hi|hey|bonsoir|bonne soirée|bonne journée|bon matin|good morning|good evening)/i,
  /^(ça va|comment allez|comment ça va|comment tu vas|comment vous allez|how are you|how do you do)/i,
  /(comment ça va|comment allez-vous|comment tu vas|how are you)/i,
  /^(bon|excellent|super|génial|parfait|ok|d'accord)/i,
  /^(allô|allo|yo|wesh|salam|salam alaikum)/i,
  /^(merci|thank you|thanks|merci beaucoup)/i,
  /^(au revoir|bye|à bientôt|à plus|see you|goodbye)/i
]

const foodQuestionPatterns = {
  recommandation: [
    /(recommand|suggér|conseill|meilleur|top|favori|préfér|idée|propos)/i,
    /(quoi|que|quel|quelle|quels|quelles).*(manger|commander|prendre|choisir|essayer|goûter)/i,
    /(je veux|j'aimerais|je cherche|je voudrais|je souhaite|donne|montre)/i,
  ],
  prix: [
    /(prix|coût|tarif|combien|cher|gratuit|payant|payer|facture)/i,
    /(€|euro|franc|f cfa|cfa|argent|budget)/i,
  ],
  ingrédients: [
    /(ingrédient|compos|contient|avec|sans|dans|recette)/i,
    /(viande|poisson|poulet|lapin|végétarien|végétal|boeuf|porc)/i,
  ],
  temps: [
    /(temps|durée|rapide|long|minute|heure|attendre|prêt)/i,
    /(combien de temps|préparation|cuisson|livraison|délai)/i
  ],
  menu: [
    /(menu|carte|plats|disponible|offre|spécialité)/i,
    /(quels plats|quelles options|liste|voir|afficher)/i
  ],
  réservation: [
    /(réserv|réserver|table|place|disponibilité|horaire)/i,
  ],
  adresse: [
    /(adresse|localisation|où|lieu|situé|trouver)/i,
  ],
  horaire: [
    /(horaire|heure|ouvert|fermé|ouverture|fermeture)/i,
  ]
}

const normalizeText = (text) => {
  return text.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

const isGreeting = (text) => {
  const normalized = normalizeText(text)
  const startsWithGreeting = greetingPatterns.some(pattern => pattern.test(normalized))

  const commonGreetings = [
    'comment ça va', 'comment allez-vous', 'comment tu vas', 'comment vous allez',
    'how are you', 'ça va', 'salut', 'bonjour', 'hello', 'hi', 'hey'
  ]

  const containsGreeting = commonGreetings.some(greeting =>
    normalized.includes(greeting) && normalized.length <= greeting.length + 5
  )

  return startsWithGreeting || containsGreeting
}

const isThankYou = (text) => {
  const normalized = normalizeText(text)
  return /(merci|thank|thanks|gratitude|apprécie|reconnaissant)/i.test(normalized)
}

const isGoodbye = (text) => {
  const normalized = normalizeText(text)
  return /(au revoir|bye|à bientôt|à plus|see you|goodbye)/i.test(normalized)
}

const detectQuestionType = (text) => {
  const normalized = normalizeText(text)
  for (const [type, patterns] of Object.entries(foodQuestionPatterns)) {
    if (patterns.some(pattern => pattern.test(normalized))) {
      return type
    }
  }
  return 'general'
}

const findMatchingProducts = async (text, preferences = []) => {
  try {
    const normalized = normalizeText(text)
    const matches = []

    const allProducts = await Product.findAll({ raw: true })

    for (const [categoryKey, category] of Object.entries(categories)) {
      if (category.keywords.some(keyword => normalized.includes(keyword))) {
        const categoryProducts = allProducts.filter(p =>
          p.category === categoryKey
        )
        matches.push(...categoryProducts)
      }
    }

    allProducts.forEach(product => {
      const productName = normalizeText(product.name)
      if (normalized.includes(productName) || productName.includes(normalized)) {
        matches.push(product)
      }
    })

    const unique = matches.filter((product, index, self) =>
      index === self.findIndex(p => p.id === product.id)
    )

    return unique.slice(0, 3)
  } catch (error) {
    console.error('Erreur recherche produits:', error)
    return []
  }
}

const generateResponse = async (userMessage, conversationHistory = []) => {
  const normalizedMessage = normalizeText(userMessage)

  if (isThankYou(userMessage)) {
    return {
      text: "De rien ! C'est un plaisir de vous aider. N'hésitez pas si vous avez d'autres questions !",
      suggestions: ['Autres questions', 'Voir le menu', 'Faire une réservation']
    }
  }

  if (isGoodbye(userMessage)) {
    return {
      text: "Au revoir ! À bientôt chez CuniResto. Bon appétit !",
      suggestions: []
    }
  }

  if (isGreeting(userMessage)) {
    const normalized = normalizeText(userMessage)
    if (normalized.includes('comment ça va') || normalized.includes('comment allez') ||
      normalized.includes('comment tu vas') || normalized.includes('how are you')) {
      return {
        text: "Ça va très bien, merci ! 😊 Je suis là pour vous aider à découvrir nos délicieux plats. Que souhaitez-vous commander aujourd'hui ?",
        suggestions: ['Recommandations', 'Voir le menu', 'Plats populaires', 'Informations']
      }
    }
    return {
      text: "Bonjour ! 👋 Je suis ravi de vous aider. Comment puis-je vous assister aujourd'hui ?",
      suggestions: ['Recommandations', 'Voir le menu', 'Plats populaires', 'Informations']
    }
  }

  const questionType = detectQuestionType(userMessage)

  switch (questionType) {
    case 'recommandation':
      const matchingProducts = await findMatchingProducts(userMessage)
      if (matchingProducts.length > 0) {
        const productList = matchingProducts.map(p =>
          `• ${p.name} (${p.price.toLocaleString()} GNF) - ${p.description || 'Délicieux plat'}`
        ).join('\n')
        return {
          text: `Voici mes recommandations :\n\n${productList}\n\nCes plats sont très appréciés par nos clients !`,
          suggestions: matchingProducts.slice(0, 3).map(p => p.name)
        }
      }
      const featured = await Product.findAll({ where: { featured: true }, limit: 3, raw: true })
      if (featured.length > 0) {
        return {
          text: `Voici nos plats les plus populaires :\n${featured.map(p => `• ${p.name} - ${p.description || 'Délicieux plat'} (${p.price.toLocaleString()} GNF)`).join('\n')}`,
          suggestions: featured.map(p => p.name)
        }
      }
      return {
        text: "Je peux vous recommander nos meilleurs plats ! Que préférez-vous : lapin, atiéké, spaghetti, sandwichs, boissons ou desserts ?",
        suggestions: ['Lapin', 'Atiéké', 'Spaghetti', 'Sandwichs']
      }

    case 'prix':
      const allProductsPrices = await Product.findAll({ attributes: ['price'], raw: true })
      if (allProductsPrices.length > 0) {
        const prices = allProductsPrices.map(p => p.price)
        const priceRange = {
          min: Math.min(...prices),
          max: Math.max(...prices)
        }
        return {
          text: `Nos prix varient entre ${priceRange.min.toLocaleString()} et ${priceRange.max.toLocaleString()} GNF. Nous avons des options pour tous les budgets !`,
          suggestions: ['Plats économiques', 'Plats premium', 'Voir le menu']
        }
      }
      return {
        text: "Nous avons des plats à tous les prix ! Consultez notre menu pour voir les tarifs détaillés.",
        suggestions: ['Voir le menu', 'Plats populaires']
      }

    case 'menu':
      const allCategories = Object.values(categories).map(cat => cat.name).join(', ')
      return {
        text: `Notre menu comprend : ${allCategories}. Nous avons aussi des boissons fraîches et des desserts maison. Que souhaitez-vous découvrir ?`,
        suggestions: ['Voir toutes les catégories', 'Plats populaires', 'Boissons', 'Desserts']
      }

    case 'réservation':
      return {
        text: "Pour réserver une table, vous pouvez utiliser notre système de réservation en ligne, nous appeler directement, ou passer au restaurant. Souhaitez-vous que je vous guide ?",
        suggestions: ['Faire une réservation', 'Voir les disponibilités', 'Contacter le restaurant']
      }

    case 'adresse':
      return {
        text: "Nous sommes situés dans le cœur de la ville. Consultez notre page Contact pour l'adresse exacte et les itinéraires.",
        suggestions: ['Voir la page Contact', 'Itinéraire GPS', 'Informations pratiques']
      }

    case 'horaire':
      return {
        text: "Nos horaires :\n• Lundi - Vendredi : 11h00 - 22h00\n• Samedi - Dimanche : 10h00 - 23h00\n\nNous sommes ouverts tous les jours !",
        suggestions: ['Faire une réservation', 'Voir le menu', 'Nous contacter']
      }

    default:
      const generalMatches = await findMatchingProducts(userMessage)
      if (generalMatches.length > 0) {
        const product = generalMatches[0]
        return {
          text: `Je vous recommande "${product.name}" ! ${product.description || 'Délicieux plat'}. Prix : ${product.price.toLocaleString()} GNF, temps : ${product.prepTime || '15 min'}.`,
          suggestions: ['Voir les détails', 'Autres recommandations', 'Faire une commande']
        }
      }
      return {
        text: "Je peux vous aider avec :\n• Des recommandations de plats\n• Des informations sur nos menus\n• Les prix et horaires\n• Les réservations\n\nQue souhaitez-vous savoir exactement ?",
        suggestions: ['Recommandations', 'Voir le menu', 'Informations pratiques', 'Faire une réservation']
      }
  }
}

router.get('/welcome', (req, res) => {
  try {
    const welcomeMessage = {
      text: "Bonjour ! 👋 Je suis votre assistant culinaire IA. Je peux vous aider à :\n\n• Trouver le plat parfait selon vos goûts\n• Répondre à vos questions sur nos plats\n• Vous donner des recommandations personnalisées\n\nQue souhaitez-vous découvrir aujourd'hui ?",
      suggestions: ['Recommandations', 'Voir le menu', 'Plats populaires', 'Informations']
    }
    res.json({
      success: true,
      message: welcomeMessage
    })
  } catch (error) {
    console.error('Erreur génération message bienvenue:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la génération du message de bienvenue'
    })
  }
})

const getProductsContext = async () => {
  try {
    const products = await Product.findAll({ limit: 20, raw: true })
    return products.map(p => ({
      name: p.name,
      description: p.description || '',
      price: p.price,
      category: p.category,
      prepTime: p.prepTime || '15 min'
    }))
  } catch (error) {
    console.error('Erreur récupération produits pour contexte:', error)
    return []
  }
}

const generateGeminiResponse = async (userMessage, conversationHistory = []) => {
  if (!model) {
    console.warn('⚠️  Gemini AI non configuré, utilisation du système de règles')
    return null
  }

  try {
    const products = await getProductsContext()
    const productsContext = products.length > 0
      ? `\n\n## Produits disponibles au restaurant CuniResto:\n${products.map(p =>
        `- **${p.name}**: ${p.description || 'Délicieux plat'} — Prix: ${p.price.toLocaleString()} GNF — Préparation: ${p.prepTime || 'rapide'}`
      ).join('\n')}`
      : '\n\n(Le menu complet est disponible sur le site)'

    const systemPrompt = `Tu es "CuniBot", le conseiller culinaire IA du restaurant **CuniResto** — un restaurant africain de prestige.

## Ton rôle
- Répondre aux questions des clients de manière **chaleureuse, professionnelle et naturelle**
- Recommander des plats selon les goûts du client
- Informer sur le menu, les prix, les horaires, les réservations
- Traiter chaque client avec courtoisie, comme un hôte de qualité

## Identité du restaurant
- Nom: CuniResto
- Spécialité: Cuisine africaine authentique (lapin braisé, atiéké, nouilles, sandwichs)
- Horaires: Lundi–Vendredi 11h–22h | Samedi–Dimanche 10h–23h
- Prise de commande et réservation disponibles sur le site
${productsContext}

## Règles de comportement
- Réponds toujours en **français clair et naturel** sauf si le client écrit en anglais
- Sois concis: 2-4 lignes max sauf si une liste est vraiment utile
- Utilise des emojis avec modération (1-2 max par réponse) pour rester chaleureux
- Ne jamais inventer de prix ou plats qui ne sont pas dans la liste
- Si tu ne sais pas, oriente gentiment le client vers le restaurant
- Propose toujours une action concrète à la fin (voir le menu, réserver, commander)

## Contexte de la conversation
${conversationHistory.length > 0 
  ? conversationHistory.map(msg => `${msg.role === 'user' ? 'Client' : 'CuniBot'}: ${msg.content}`).join('\n')
  : '(Début de conversation)'}

Client: ${userMessage}

Réponds directement au client sans répéter "CuniBot:" devant ta réponse.`

    const result = await model.generateContent(systemPrompt)
    const response = await result.response
    const text = response.text().trim()

    if (!text) return null

    // Extraire des suggestions intelligentes basées sur la réponse et les produits
    const suggestions = []
    const lowerText = text.toLowerCase()
    const lowerMsg = userMessage.toLowerCase()

    // Suggestions basées sur les produits mentionnés
    if (products.length > 0) {
      products.forEach(product => {
        if (lowerText.includes(product.name.toLowerCase()) || lowerMsg.includes(product.name.toLowerCase())) {
          if (suggestions.length < 2) suggestions.push(product.name)
        }
      })
    }

    // Suggestions contextuelles selon les mots-clés
    if (suggestions.length < 4) {
      if (lowerText.includes('réserv') || lowerMsg.includes('réserv') || lowerMsg.includes('table')) {
        suggestions.push('Faire une réservation')
      }
      if (lowerText.includes('menu') || lowerMsg.includes('menu') || lowerMsg.includes('plat')) {
        suggestions.push('Voir le menu complet')
      }
      if (lowerText.includes('prix') || lowerMsg.includes('prix') || lowerMsg.includes('combien')) {
        suggestions.push('Voir les prix')
      }
      if (!suggestions.some(s => s === 'Commander')) {
        suggestions.push('Commander')
      }
    }

    return {
      text,
      suggestions: [...new Set(suggestions)].slice(0, 4)
    }
  } catch (error) {
    console.error('❌ Erreur appel Gemini:', error.message || error)
    return null
  }
}

router.post('/message', async (req, res) => {
  try {
    const { message, conversationHistory = [] } = req.body

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Message requis'
      })
    }

    const trimmedMessage = message.trim()
    let response

    // Pour les salutations simples, utiliser le système de règles en priorité
    if (isGreeting(trimmedMessage) || isThankYou(trimmedMessage) || isGoodbye(trimmedMessage)) {
      response = await generateResponse(trimmedMessage, conversationHistory)
    } else {
      // Pour les autres messages, essayer d'abord avec Gemini si disponible
      if (model) {
        response = await generateGeminiResponse(trimmedMessage, conversationHistory)
      }

      // Si Gemini n'est pas disponible ou a échoué, utiliser le système de règles
      if (!response) {
        response = await generateResponse(trimmedMessage, conversationHistory)
      }
    }

    await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 500))

    res.json({
      success: true,
      response: {
        text: response.text,
        suggestions: response.suggestions || []
      }
    })
  } catch (error) {
    console.error('Erreur traitement message chat:', error)
    res.status(500).json({
      success: false,
      message: 'Erreur lors du traitement de votre message. Veuillez réessayer.'
    })
  }
})

export default router

