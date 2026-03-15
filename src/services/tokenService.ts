import jwt, { SignOptions } from 'jsonwebtoken';
import { JWT_EXPIRY } from '../config/constants';

function generateToken(user: object & { id?: string; email?: string; role?: string; company_id?: string; store_id?: string; permissions?: object }, userType: string = 'client'): string {
  const payload: Record<string, unknown> = {
    id: (user as Record<string, unknown>).id,
    email: (user as Record<string, unknown>).email,
    userType: userType
  };

  if (userType === 'super_admin') {
    payload.permissions = (user as Record<string, unknown>).permissions || {};
  } else if (userType === 'staff') {
    payload.role = (user as Record<string, unknown>).role;
    payload.company_id = (user as Record<string, unknown>).company_id;
    payload.store_id = (user as Record<string, unknown>).store_id;
  } else {
    payload.role = (user as Record<string, unknown>).role;
    payload.company_id = (user as Record<string, unknown>).company_id;
    payload.store_id = (user as Record<string, unknown>).store_id;
  }

  const options: SignOptions = { expiresIn: JWT_EXPIRY as unknown as number };
  return jwt.sign(payload, process.env.JWT_SECRET as string, options);
}

function verifyToken(token: string): unknown {
  return jwt.verify(token, process.env.JWT_SECRET as string);
}

export {
  generateToken,
  verifyToken
};
