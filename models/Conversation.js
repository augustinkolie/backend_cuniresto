import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const Conversation = sequelize.define('Conversation', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING
  },
  isGroup: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  lastMessageAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  unreadCount: {
    type: DataTypes.JSON,
    defaultValue: {}
  },
  disappearingDuration: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
}, {
  timestamps: true
});

export default Conversation;
