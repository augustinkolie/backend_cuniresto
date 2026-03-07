import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const CorporateOrder = sequelize.define('CorporateOrder', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  items: {
    type: DataTypes.JSON,
    defaultValue: []
  },
  total: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  deliveryInfo: {
    type: DataTypes.JSON,
    defaultValue: {}
  },
  recurrence: {
    type: DataTypes.JSON,
    defaultValue: { enabled: false }
  },
  status: {
    type: DataTypes.ENUM('pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled'),
    defaultValue: 'pending'
  },
  orderDate: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  deliveryDate: {
    type: DataTypes.DATE
  },
  notes: {
    type: DataTypes.TEXT
  }
}, {
  timestamps: true
});

export default CorporateOrder;
