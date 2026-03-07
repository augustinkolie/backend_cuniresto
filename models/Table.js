import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const Table = sequelize.define('Table', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  tableNumber: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true
  },
  qrCode: {
    type: DataTypes.STRING,
    unique: true
  },
  qrCodeUrl: {
    type: DataTypes.STRING
  },
  capacity: {
    type: DataTypes.INTEGER,
    defaultValue: 4
  },
  status: {
    type: DataTypes.ENUM('available', 'occupied', 'reserved', 'cleaning'),
    defaultValue: 'available'
  },
  location: {
    type: DataTypes.ENUM('indoor', 'outdoor', 'vip'),
    defaultValue: 'indoor'
  },
  active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  timestamps: true
});

export default Table;
