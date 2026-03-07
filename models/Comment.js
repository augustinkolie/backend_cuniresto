import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const Comment = sequelize.define('Comment', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  rating: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 1,
      max: 5
    }
  },
  sentiment: {
    type: DataTypes.ENUM('positive', 'negative', 'neutral'),
    defaultValue: 'neutral'
  },
  likes: {
    type: DataTypes.JSON,
    defaultValue: []
  },
  replies: {
    type: DataTypes.JSON,
    defaultValue: []
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  productId: {
    type: DataTypes.UUID,
    allowNull: false
  }
}, {
  timestamps: true
});

// For replies, we can use a self-referencing association in the association file
export default Comment;
