/**
 * Gate 0: 인증 경계.
 *
 * 실제 검증기(Google OAuth/세션)는 A가 제공한다. B는 `AuthVerifier` Port만 받는다.
 * `x-user-id` 우회는 production에서 절대 허용하지 않는다.
 */
import type { NextFunction, Request, Response } from 'express';

import type { Actor } from '../modules/application/dto.js';

export interface AuthVerifier {
  verify(token: string): Promise<Actor | null>;
}

export class AuthError extends Error {
  readonly status = 401;
  readonly code = 'UNAUTHENTICATED';

  constructor() {
    super('로그인이 필요합니다.');
    this.name = 'AuthError';
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    actor?: Actor;
  }
}

function bearer(request: Request): string | null {
  const header = request.header('authorization');
  if (header === undefined) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || token === undefined || token.length === 0) {
    return null;
  }
  return token;
}

export function requireActor(
  verifier: AuthVerifier,
): (request: Request, _response: Response, next: NextFunction) => Promise<void> {
  return async (request, _response, next) => {
    try {
      const token = bearer(request);
      if (token === null) throw new AuthError();
      const actor = await verifier.verify(token);
      if (actor === null) throw new AuthError();
      request.actor = actor;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** 테스트·로컬 전용. production에서는 호출하지 않는다. */
export function createDevAuthVerifier(
  users: readonly { readonly token: string; readonly actor: Actor }[],
): AuthVerifier {
  return {
    async verify(token) {
      return users.find((user) => user.token === token)?.actor ?? null;
    },
  };
}
