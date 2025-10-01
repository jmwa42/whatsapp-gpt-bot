// models/db.js
import { Sequelize, DataTypes } from "sequelize";

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: "postgres",
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false,
    },
  },
  logging: false,
});

// Users
export const User = sequelize.define("User", {
  phone: { type: DataTypes.STRING, unique: true },
  role: { type: DataTypes.STRING, defaultValue: "student" },
});

// Fees
export const Fee = sequelize.define("Fee", {
  className: { type: DataTypes.STRING },
  term1: { type: DataTypes.INTEGER, defaultValue: 0 },
  term2: { type: DataTypes.INTEGER, defaultValue: 0 },
  term3: { type: DataTypes.INTEGER, defaultValue: 0 },
  total: { type: DataTypes.INTEGER, defaultValue: 0 },
});

// Chat logs
export const ChatLog = sequelize.define("ChatLog", {
  userPhone: { type: DataTypes.STRING },
  message: { type: DataTypes.TEXT },
  response: { type: DataTypes.TEXT },
});

await sequelize.sync();
export default sequelize;

