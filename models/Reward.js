import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const Reward = sequelize.define('Reward', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  pointsCost: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  type: {
    type: DataTypes.ENUM('discount', 'free_item', 'cashback', 'voucher'),
    allowNull: false
  },
  value: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  valueType: {
    type: DataTypes.ENUM('percentage', 'fixed', 'points'),
    defaultValue: 'fixed'
  },
  image: {
    type: DataTypes.STRING
  },
  category: {
    type: DataTypes.ENUM('food', 'drink', 'discount', 'cashback', 'special'),
    defaultValue: 'discount'
  },
  minLevel: {
    type: DataTypes.ENUM('bronze', 'silver', 'gold', 'platinum'),
    defaultValue: 'bronze'
  },
  stock: {
    type: DataTypes.INTEGER,
    defaultValue: -1
  },
  used: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  expiryDate: {
    type: DataTypes.DATE
  }
}, {
  timestamps: true
});

export default Reward;
