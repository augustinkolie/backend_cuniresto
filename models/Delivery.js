import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const Delivery = sequelize.define('Delivery', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  deliveryMode: {
    type: DataTypes.ENUM('express', 'standard', 'click_collect'),
    defaultValue: 'standard'
  },
  estimatedTime: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  actualTime: {
    type: DataTypes.INTEGER
  },
  status: {
    type: DataTypes.ENUM('pending', 'preparing', 'ready', 'assigned', 'picked_up', 'in_transit', 'arrived', 'delivered', 'cancelled'),
    defaultValue: 'pending'
  },
  deliveryAddress: {
    type: DataTypes.JSON,
    allowNull: false
  },
  trackingHistory: {
    type: DataTypes.JSON,
    defaultValue: []
  },
  notifications: {
    type: DataTypes.JSON,
    defaultValue: {}
  },
  deliveryFee: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  scheduledTime: {
    type: DataTypes.DATE
  },
  pickedUpAt: {
    type: DataTypes.DATE
  },
  deliveredAt: {
    type: DataTypes.DATE
  }
}, {
  timestamps: true
});

export default Delivery;
