import redis from './redisClient.js';

export async function getTicketState(channelId) {
  const data = await redis.get(`ticket:${channelId}`);
  console.log(`[Redis] GET ticket:${channelId} =>`, data);
  return data ? JSON.parse(data) : null;
}

export async function setTicketState(channelId, state) {
  await redis.set(`ticket:${channelId}`, JSON.stringify(state));
  console.log(`[Redis] SET ticket:${channelId} =>`, state);
}

export async function clearTicketState(channelId) {
  await redis.del(`ticket:${channelId}`);
  console.log(`[Redis] DEL ticket:${channelId}`);
} 