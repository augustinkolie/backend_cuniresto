import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const Company = sequelize.define('Company', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: false
  },
  address: {
    type: DataTypes.JSON,
    defaultValue: {}
  },
  contactPerson: {
    type: DataTypes.JSON,
    defaultValue: {}
  },
  corporatePricing: {
    type: DataTypes.JSON,
    defaultValue: { enabled: true, discountPercentage: 0 }
  },
  billing: {
    type: DataTypes.JSON,
    defaultValue: {}
  },
  status: {
    type: DataTypes.ENUM('active', 'suspended', 'inactive'),
    defaultValue: 'active'
  },
  employees: {
    type: DataTypes.JSON,
    defaultValue: []
  },
  recurringOrders: {
    type: DataTypes.JSON,
    defaultValue: []
  },
  adminId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  subscriptionStartDate: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  subscriptionEndDate: {
    type: DataTypes.DATE
  }
}, {
  timestamps: true
});

export default Company;
