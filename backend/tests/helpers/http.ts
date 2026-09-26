import request from 'supertest';
import { createApp } from '../../src/app.js';
import { TEST_PASSWORD } from './factories.js';

export const app = createApp({ healthProbes: {} });

export async function login(tenantSlug: string, email: string, password = TEST_PASSWORD) {
  const res = await request(app).post('/api/auth/login').send({ tenantSlug, email, password });
  if (res.status !== 200) throw new Error(`login failed ${res.status}: ${JSON.stringify(res.body)}`);
  const cookie = res.headers['set-cookie'] as unknown as string[];
  return { token: res.body.accessToken as string, cookie, body: res.body };
}

/** Supertest agent-like helper with a bearer token pre-applied. */
export function as(token: string) {
  return {
    get: (url: string) => request(app).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => request(app).post(url).set('Authorization', `Bearer ${token}`),
    patch: (url: string) => request(app).patch(url).set('Authorization', `Bearer ${token}`),
    put: (url: string) => request(app).put(url).set('Authorization', `Bearer ${token}`),
    delete: (url: string) => request(app).delete(url).set('Authorization', `Bearer ${token}`),
  };
}
