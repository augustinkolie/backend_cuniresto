import sequelize from '../config/database.js';
import User from './User.js';
import Product from './Product.js';
import Order, { OrderItem } from './Order.js';
import Cart, { CartItem } from './Cart.js';
import Reservation from './Reservation.js';
import Comment from './Comment.js';
import Message from './Message.js';
import Conversation from './Conversation.js';
import Notification from './Notification.js';
import Table from './Table.js';
import TableOrder from './TableOrder.js';
import Company from './Company.js';
import CorporateOrder from './CorporateOrder.js';
import CorporateInvoice from './CorporateInvoice.js';
import LoyaltyPoints from './LoyaltyPoints.js';
import Referral from './Referral.js';
import Reward from './Reward.js';
import ChefContent from './ChefContent.js';
import Call from './Call.js';
import Delivery from './Delivery.js';

// --- Associations ---

// User & Loyalty
User.hasOne(LoyaltyPoints, { foreignKey: 'userId', as: 'loyalty' });
LoyaltyPoints.belongsTo(User, { foreignKey: 'userId' });

// User & Referral
User.hasMany(Referral, { foreignKey: 'referrerId', as: 'referrals' });
Referral.belongsTo(User, { foreignKey: 'referrerId', as: 'referrer' });
Referral.belongsTo(User, { foreignKey: 'referredId', as: 'referred' });

// User & Cart
User.hasOne(Cart, { foreignKey: 'userId', as: 'cart' });
Cart.belongsTo(User, { foreignKey: 'userId' });

Cart.hasMany(CartItem, { foreignKey: 'cartId', as: 'items' });
CartItem.belongsTo(Cart, { foreignKey: 'cartId' });
CartItem.belongsTo(Product, { foreignKey: 'productId', as: 'product' });

// User & Order
User.hasMany(Order, { foreignKey: 'userId', as: 'orders' });
Order.belongsTo(User, { foreignKey: 'userId' });

Order.hasMany(OrderItem, { foreignKey: 'orderId', as: 'items' });
OrderItem.belongsTo(Order, { foreignKey: 'orderId' });
OrderItem.belongsTo(Product, { foreignKey: 'productId', as: 'product' });

// User & Reservation
User.hasMany(Reservation, { foreignKey: 'userId', as: 'reservations' });
Reservation.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Product & Comment
Product.hasMany(Comment, { foreignKey: 'productId', as: 'comments' });
Comment.belongsTo(Product, { foreignKey: 'productId' });
Comment.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Chat Associations
User.belongsToMany(Conversation, { through: 'UserConversations', as: 'conversations' });
Conversation.belongsToMany(User, { through: 'UserConversations', as: 'participants' });

Conversation.hasMany(Message, { foreignKey: 'conversationId', as: 'messages' });
Conversation.belongsTo(Message, { foreignKey: 'lastMessageId', as: 'lastMessage' });
Message.belongsTo(Conversation, { foreignKey: 'conversationId' });
Message.belongsTo(User, { foreignKey: 'senderId', as: 'sender' });

Conversation.hasMany(Call, { foreignKey: 'conversationId' });
Call.belongsTo(Conversation, { foreignKey: 'conversationId' });
Call.belongsTo(User, { foreignKey: 'callerId', as: 'caller' });
Call.belongsTo(User, { foreignKey: 'receiverId', as: 'receiver' });

// Notifications
User.hasMany(Notification, { foreignKey: 'recipientId', as: 'notifications' });
Notification.belongsTo(User, { foreignKey: 'recipientId', as: 'recipient' });
Notification.belongsTo(User, { foreignKey: 'senderId', as: 'sender' });

// Tables
Table.hasOne(TableOrder, { foreignKey: 'tableId', as: 'currentOrder' });
TableOrder.belongsTo(Table, { foreignKey: 'tableId' });

// Corporate
Company.belongsTo(User, { foreignKey: 'adminId', as: 'admin' });
Company.hasMany(CorporateOrder, { foreignKey: 'companyId', as: 'orders' });
CorporateOrder.belongsTo(Company, { foreignKey: 'companyId' });
CorporateOrder.belongsTo(User, { foreignKey: 'employeeId', as: 'employee' });

Company.hasMany(CorporateInvoice, { foreignKey: 'companyId', as: 'invoices' });
CorporateInvoice.belongsTo(Company, { foreignKey: 'companyId' });

// Content
User.hasMany(ChefContent, { foreignKey: 'publishedById' });
ChefContent.belongsTo(User, { foreignKey: 'publishedById', as: 'publisher' });
ChefContent.belongsTo(Product, { foreignKey: 'productId', as: 'product' });

// Delivery
Order.hasOne(Delivery, { foreignKey: 'orderId' });
Delivery.belongsTo(Order, { foreignKey: 'orderId' });
Delivery.belongsTo(User, { foreignKey: 'userId', as: 'customer' });
Delivery.belongsTo(User, { foreignKey: 'deliveryPersonId', as: 'driver' });

export {
  sequelize,
  User,
  Product,
  Order,
  OrderItem,
  Cart,
  CartItem,
  Reservation,
  Comment,
  Message,
  Conversation,
  Notification,
  Table,
  TableOrder,
  Company,
  CorporateOrder,
  CorporateInvoice,
  LoyaltyPoints,
  Referral,
  Reward,
  ChefContent,
  Call,
  Delivery
};
