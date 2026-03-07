import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const ChefContent = sequelize.define('ChefContent', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  type: {
    type: DataTypes.ENUM('tutorial', 'live', 'video'),
    defaultValue: 'video'
  },
  chef: {
    type: DataTypes.STRING,
    allowNull: false
  },
  chefImage: {
    type: DataTypes.STRING
  },
  thumbnail: {
    type: DataTypes.STRING,
    allowNull: false
  },
  videoUrl: {
    type: DataTypes.STRING,
    allowNull: false
  },
  streamUrl: {
    type: DataTypes.STRING
  },
  isLive: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  liveStartTime: {
    type: DataTypes.DATE
  },
  liveEndTime: {
    type: DataTypes.DATE
  },
  duration: {
    type: DataTypes.INTEGER
  },
  category: {
    type: DataTypes.ENUM('preparation', 'cooking', 'plating', 'technique', 'recipe', 'other'),
    defaultValue: 'preparation'
  },
  views: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  likes: {
    type: DataTypes.JSON,
    defaultValue: []
  },
  status: {
    type: DataTypes.ENUM('draft', 'published', 'archived'),
    defaultValue: 'draft'
  },
  featured: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  timestamps: true
});

export default ChefContent;
