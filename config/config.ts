import dotenv from "dotenv";
dotenv.config();

export const config = {
  app: {
    port: Number(process.env.PORT) || 3000,
  },
  mysql: {
    client: "mysql2",
    connection: {
      host: process.env.MYSQL_HOST || "127.0.0.1",
      user: process.env.MYSQL_USER || "root",
      password: process.env.MYSQL_PASSWORD || "",
      database: process.env.MYSQL_DATABASE || "lunerasilver",
      port: Number(process.env.MYSQL_PORT) || 3306,
    },
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET ?? "change-this-secret",
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
    apiKey: process.env.CLOUDINARY_API_KEY || "",
    apiSecret: process.env.CLOUDINARY_API_SECRET || "",
  },
  frontend: {
    baseUrl: process.env.FE_BASE_URL || "http://localhost:5173",
  },
  admin: {
    name: process.env.ADMIN_NAME || "Admin",
    email: process.env.ADMIN_EMAIL || "admin@lunerasilver.com",
    password: process.env.ADMIN_PASSWORD || "ChangeMe123!",
  },
  silverRateSync: {
    enabled: (process.env.SILVER_RATE_SYNC_ENABLED ?? "true") === "true",
    cron: process.env.SILVER_RATE_SYNC_CRON || "0 6,12,18 * * *",
    timezone: process.env.SILVER_RATE_SYNC_TZ || "Asia/Kathmandu",
  },
  currentEnv: process.env.NODE_ENV ?? "development",
};
