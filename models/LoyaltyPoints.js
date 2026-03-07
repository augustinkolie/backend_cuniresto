import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const LoyaltyPoints = sequelize.define('LoyaltyPoints', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  totalPoints: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  availablePoints: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  usedPoints: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  transactions: {
    type: DataTypes.JSON,
    defaultValue: []
  },
  level: {
    type: DataTypes.ENUM('bronze', 'silver', 'gold', 'platinum'),
    defaultValue: 'bronze'
  },
  nextLevelPoints: {
    type: DataTypes.INTEGER,
    defaultValue: 100
  },
  rewards: {
    type: DataTypes.JSON,
    defaultValue: []
  }
}, {
  timestamps: true
});

export default LoyaltyPoints;
