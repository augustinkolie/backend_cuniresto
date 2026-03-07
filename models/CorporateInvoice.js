import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const CorporateInvoice = sequelize.define('CorporateInvoice', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  invoiceNumber: {
    type: DataTypes.STRING,
    unique: true
  },
  billingPeriod: {
    type: DataTypes.JSON,
    allowNull: false
  },
  items: {
    type: DataTypes.JSON,
    defaultValue: []
  },
  subtotal: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  discount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  tax: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  total: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('draft', 'sent', 'paid', 'overdue', 'cancelled'),
    defaultValue: 'draft'
  },
  dueDate: {
    type: DataTypes.DATE,
    allowNull: false
  },
  paidDate: {
    type: DataTypes.DATE
  },
  paymentMethod: {
    type: DataTypes.ENUM('invoice', 'credit_card', 'bank_transfer')
  },
  notes: {
    type: DataTypes.TEXT
  }
}, {
  hooks: {
    beforeCreate: async (invoice) => {
      if (!invoice.invoiceNumber) {
        const year = new Date().getFullYear();
        const month = String(new Date().getMonth() + 1).padStart(2, '0');
        const count = await CorporateInvoice.count();
        invoice.invoiceNumber = `INV-${year}${month}-${String(count + 1).padStart(5, '0')}`;
      }
    }
  },
  timestamps: true
});

export default CorporateInvoice;
