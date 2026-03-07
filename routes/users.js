import express from 'express'
import { Op } from 'sequelize'
import User from '../models/User.js'
import { authenticate, isAdmin } from '../middleware/auth.js'

const router = express.Router()

// Obtenir tous les utilisateurs (Admin uniquement)
router.get('/', authenticate, isAdmin, async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: ['password'] },
      order: [['createdAt', 'DESC']]
    })
    res.json({ success: true, users })
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des utilisateurs',
      error: error.message
    })
  }
})

// Obtenir un utilisateur par ID (Admin uniquement)
router.get('/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ['password'] }
    })
    if (!user) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' })
    }
    res.json({ success: true, user })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur lors de la récupération de l\'utilisateur' })
  }
})

// Supprimer un utilisateur (Admin uniquement)
router.delete('/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const userId = req.params.id
    if (userId === req.user.id) {
      return res.status(400).json({ success: false, message: 'Vous ne pouvez pas supprimer votre propre compte' })
    }
    const deleted = await User.destroy({ where: { id: userId } })
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' })
    }
    res.json({ success: true, message: 'Utilisateur supprimé avec succès' })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur lors de la suppression de l\'utilisateur' })
  }
})

// Mettre à jour le rôle d'un utilisateur (Admin uniquement)
router.put('/:id/role', authenticate, isAdmin, async (req, res) => {
  try {
    const { role } = req.body
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Rôle invalide' })
    }
    if (req.params.id === req.user.id) {
      return res.status(400).json({ success: false, message: 'Vous ne pouvez pas modifier votre propre rôle' })
    }
    const [updated] = await User.update({ role }, { where: { id: req.params.id } })
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' })
    }
    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ['password'] }
    })
    res.json({ success: true, message: 'Rôle mis à jour avec succès', user })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour du rôle' })
  }
})

// Bloquer un utilisateur
router.post('/block/:userId', authenticate, async (req, res) => {
  try {
    const userToBlock = await User.findByPk(req.params.userId);
    if (!userToBlock) {
      return res.status(404).json({ success: false, message: 'Utilisateur à bloquer non trouvé' });
    }
    const currentUser = await User.findByPk(req.user.id);
    const blockedUsers = [...(currentUser.blockedUsers || [])];
    if (!blockedUsers.includes(userToBlock.id)) {
      blockedUsers.push(userToBlock.id);
      await currentUser.update({ blockedUsers });
    }
    res.json({ success: true, message: 'Utilisateur bloqué' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Débloquer un utilisateur
router.post('/unblock/:userId', authenticate, async (req, res) => {
  try {
    const userToUnblock = await User.findByPk(req.params.userId);
    if (!userToUnblock) {
      return res.status(404).json({ success: false, message: 'Utilisateur à débloquer non trouvé' });
    }
    const currentUser = await User.findByPk(req.user.id);
    const blockedUsers = (currentUser.blockedUsers || []).filter(id => id !== userToUnblock.id);
    await currentUser.update({ blockedUsers });
    res.json({ success: true, message: 'Utilisateur débloqué' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Obtenir la liste des utilisateurs bloqués
router.get('/blocked', authenticate, async (req, res) => {
  try {
    const currentUser = await User.findByPk(req.user.id);
    const blockedUserIds = currentUser.blockedUsers || [];
    const blockedUsers = await User.findAll({
      where: { id: { [Op.in]: blockedUserIds } },
      attributes: ['id', 'nom', 'prenom', 'email']
    });
    res.json({ success: true, blockedUsers });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Basculer un utilisateur en favori
router.post('/favorites/toggle/:userId', authenticate, async (req, res) => {
  try {
    const userToFav = await User.findByPk(req.params.userId);
    if (!userToFav) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }
    const currentUser = await User.findByPk(req.user.id);
    let favoriteContacts = [...(currentUser.favoriteContacts || [])];
    const isFav = favoriteContacts.includes(userToFav.id);

    if (isFav) {
      favoriteContacts = favoriteContacts.filter(id => id !== userToFav.id);
    } else {
      favoriteContacts.push(userToFav.id);
    }

    await currentUser.update({ favoriteContacts });
    res.json({
      success: true,
      isFavorite: !isFav,
      message: isFav ? 'Retiré des favoris' : 'Ajouté aux favoris'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Obtenir la liste des favoris
router.get('/favorites', authenticate, async (req, res) => {
  try {
    const currentUser = await User.findByPk(req.user.id);
    const favoriteUserIds = currentUser.favoriteContacts || [];
    const favorites = await User.findAll({
      where: { id: { [Op.in]: favoriteUserIds } },
      attributes: ['id', 'nom', 'prenom', 'email', 'profileImage']
    });
    res.json({ success: true, favorites });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

export default router;
