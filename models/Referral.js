import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const Referral = sequelize.define('Referral', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  referralCode: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  status: {
    type: DataTypes.ENUM('pending', 'completed', 'rewarded'),
    defaultValue: 'pending'
  },
  referrerReward: {
    type: DataTypes.JSON,
    defaultValue: {}
  },
  referredReward: {
    type: DataTypes.JSON,
    defaultValue: {}
  },
  firstOrderCompleted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  timestamps: true
});

export default Referral;
