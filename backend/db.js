import mysql from 'mysql2/promise';
import 'dotenv/config';

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 30,
    queueLimit: 0,
    dateStrings: true, // avoids UTC/local Date-object conversion entirely — see backend/utils/dateRange.js
});

export default pool;