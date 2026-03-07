import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const Product = sequelize.define('Product', {
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
    defaultValue: ''
  },
  price: {
    type: DataTypes.INTEGER, // Stocké en centimes/unité de compte
    allowNull: false
  },
  category: {
    type: DataTypes.STRING,
    allowNull: false
  },
  image: {
    type: DataTypes.STRING,
    defaultValue: '/images/placeholder.jpg'
  },
  rating: {
    type: DataTypes.FLOAT,
    defaultValue: 0
  },
  reviews: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  prepTime: {
    type: DataTypes.STRING,
    defaultValue: '15 min'
  },
  featured: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  stock: {
    type: DataTypes.INTEGER,
    defaultValue: 100
  }
}, {
  timestamps: true
});

export default Product;
