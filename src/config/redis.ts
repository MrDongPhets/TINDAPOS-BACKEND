import { createClient } from 'redis';

const redisClient = createClient({
  username: 'default',
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_HOST || 'redis-13967.c290.ap-northeast-1-2.ec2.cloud.redislabs.com',
    port: parseInt(process.env.REDIS_PORT || '13967'),
    reconnectStrategy: (retries) => {
      if (retries > 5) return false; // stop retrying after 5 attempts
      return Math.min(retries * 500, 3000);
    }
  }
});

redisClient.on('error', (err) => console.error('❌ Redis error:', err));
redisClient.on('connect', () => console.log('✅ Redis connected'));
redisClient.on('reconnecting', () => console.log('🔄 Redis reconnecting...'));

let isConnected = false;

export async function connectRedis(): Promise<void> {
  try {
    await redisClient.connect();
    isConnected = true;
  } catch (err) {
    console.error('❌ Redis connection failed (cache disabled):', err);
    isConnected = false;
  }
}

export async function cacheGet(key: string): Promise<string | null> {
  if (!isConnected) return null;
  try {
    return await redisClient.get(key);
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: string, ttlSeconds = 300): Promise<void> {
  if (!isConnected) return;
  try {
    await redisClient.set(key, value, { EX: ttlSeconds });
  } catch {
    // silently fail — cache is optional
  }
}

export async function cacheDel(pattern: string): Promise<void> {
  if (!isConnected) return;
  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  } catch {
    // silently fail
  }
}

export default redisClient;
