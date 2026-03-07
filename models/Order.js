import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

export const Order = sequelize.define('Order', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  total: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  address: {
    type: DataTypes.STRING,
    allowNull: false
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: false
  },
  city: {
    type: DataTypes.STRING
  },
  instructions: {
    type: DataTypes.TEXT
  },
  tastePreferences: {
    type: DataTypes.TEXT
  },
  paymentMethod: {
    type: DataTypes.ENUM('orange', 'carte', 'paypal'),
    allowNull: false
  },
  paymentStatus: {
    type: DataTypes.STRING,
    defaultValue: 'INITIATED'
  },
  status: {
    type: DataTypes.ENUM('pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'),
    defaultValue: 'pending'
  },
  deliveredAt: {
    type: DataTypes.DATE
  },
  cancelledAt: {
    type: DataTypes.DATE
  },
  trackingUrl: {
    type: DataTypes.STRING
  },
  paymentInfo: {
    type: DataTypes.JSON,
    defaultValue: {}
  },
  deliveryStatus: {
    type: DataTypes.JSON,
    defaultValue: {}
  }
}, {
  timestamps: true
});

export const OrderItem = sequelize.define('OrderItem', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  price: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  quantity: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  image: {
    type: DataTypes.STRING
  }
}, {
  timestamps: true
});

export default Order;
