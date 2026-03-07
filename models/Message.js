import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const Message = sequelize.define('Message', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  content: {
    type: DataTypes.TEXT,
    defaultValue: ''
  },
  attachments: {
    type: DataTypes.JSON, // Arrays are easier in JSON for MySQL if small
    defaultValue: []
  },
  read: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  readAt: {
    type: DataTypes.DATE
  },
  isStarred: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  replyToModel: {
    type: DataTypes.ENUM('Message', 'Call'),
    defaultValue: 'Message'
  },
  reactions: {
    type: DataTypes.JSON,
    defaultValue: []
  }
}, {
  timestamps: true
});

export default Message;
