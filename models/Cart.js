import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

export const Cart = sequelize.define('Cart', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  }
}, {
  timestamps: true
});

export const CartItem = sequelize.define('CartItem', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  quantity: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
    allowNull: false,
    validate: {
      min: 1
    }
  }
}, {
  timestamps: true
});

// Associations will be defined in a central place or after all models are loaded
export default Cart;
