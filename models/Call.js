import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const Call = sequelize.define('Call', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  callType: {
    type: DataTypes.ENUM('video', 'phone'),
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('missed', 'answered', 'rejected', 'cancelled'),
    defaultValue: 'missed'
  },
  duration: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
}, {
  timestamps: true
});

export default Call;
