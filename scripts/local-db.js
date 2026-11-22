import fs from 'fs';
import os from 'os';
import path from 'path';
import { MongoMemoryServer } from 'mongodb-memory-server';

const dbPath = path.resolve('.local-mongo-data');
fs.mkdirSync(dbPath, { recursive: true });

const cachedExe = path.join(os.homedir(), '.cache', 'mongodb-binaries', 'mongod-x64-win32-7.0.24.exe');
const binaryConfig = fs.existsSync(cachedExe)
  ? { systemBinary: cachedExe }
  : { version: '7.0.24' };

const mongod = await MongoMemoryServer.create({
  binary: binaryConfig,
  instance: {
    port: 27017,
    ip: '127.0.0.1',
    dbPath,
    storageEngine: 'wiredTiger',
  },
});

const uri = mongod.getUri();
console.log(`Local MongoDB running at ${uri} (data: ${dbPath})`);

const shutdown = async () => {
  console.log('Stopping local MongoDB...');
  await mongod.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
