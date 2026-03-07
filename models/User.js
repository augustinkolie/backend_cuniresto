import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import bcrypt from 'bcryptjs';

const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  password: {
    type: DataTypes.STRING,
    allowNull: true // Permis pour auth sociale
  },
  googleId: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: true
  },
  facebookId: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: true
  },
  nom: {
    type: DataTypes.STRING,
    allowNull: false
  },
  prenom: {
    type: DataTypes.STRING,
    allowNull: false
  },
  role: {
    type: DataTypes.ENUM('user', 'admin'),
    defaultValue: 'user'
  },
  profileImage: {
    type: DataTypes.STRING,
    allowNull: true
  },
  coverImage: {
    type: DataTypes.STRING,
    allowNull: true
  },
  telephone: {
    type: DataTypes.STRING,
    defaultValue: ''
  },
  adresse: {
    type: DataTypes.STRING,
    defaultValue: ''
  },
  dateNaissance: {
    type: DataTypes.STRING,
    defaultValue: ''
  },
  avis: {
    type: DataTypes.TEXT,
    defaultValue: ''
  },
  resetPasswordToken: {
    type: DataTypes.STRING,
    allowNull: true
  },
  resetPasswordExpires: {
    type: DataTypes.DATE,
    allowNull: true
  },
  referralCode: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: true
  },
  orangeMoneyNumber: {
    type: DataTypes.STRING,
    defaultValue: ''
  },
  blockedUsers: {
    type: DataTypes.JSON,
    defaultValue: []
  },
  favoriteContacts: {
    type: DataTypes.JSON,
    defaultValue: []
  }
}, {
  paranoid: true,
  hooks: {
    beforeSave: async (user) => {
      if (user.changed('password') && user.password) {
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(user.password, salt);
      }
      
      if (!user.referralCode) {
        const prefix = user.prenom?.charAt(0).toUpperCase() || 'U';
        const random = Math.random().toString(36).substring(2, 8).toUpperCase();
        user.referralCode = `${prefix}${random}`;
      }
    }
  }
});

User.prototype.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return await bcrypt.compare(candidatePassword, this.password);
};

export default User;
