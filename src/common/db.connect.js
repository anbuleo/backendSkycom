import mongoose from 'mongoose';

let isConnected = false;

export const connectDB = async () => {
  if (isConnected || mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  const url = process.env.DB_URL;
  const dbName = process.env.DB_NAME;

  if (!url) {
    throw new Error('DB_URL environment variable is not defined');
  }

  try {
    const options = dbName ? { dbName } : {};
    await mongoose.connect(url, options);
    isConnected = true;
    console.log(`DB connected successfully${dbName ? ` (${dbName})` : ''}`);
    return mongoose.connection;
  } catch (error) {
    console.error('DB connection error:', error.message);
    throw error;
  }
};

mongoose.connection.on('disconnected', () => {
  isConnected = false;
});

export default mongoose;
