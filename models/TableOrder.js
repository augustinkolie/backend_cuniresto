import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const TableOrder = sequelize.define('TableOrder', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  tableNumber: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  items: {
    type: DataTypes.JSON,
    defaultValue: []
  },
  total: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('pending', 'confirmed', 'preparing', 'ready', 'served', 'completed', 'cancelled'),
    defaultValue: 'pending'
  },
  customerName: {
    type: DataTypes.STRING
  },
  customerPhone: {
    type: DataTypes.STRING
  },
  specialRequests: {
    type: DataTypes.TEXT
  },
  waiterCall: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  waiterCallTime: {
    type: DataTypes.DATE
  },
  servedAt: {
    type: DataTypes.DATE
  },
  completedAt: {
    type: DataTypes.DATE
  }
}, {
  timestamps: true
});

export default TableOrder;
