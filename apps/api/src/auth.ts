import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from './db.js';
import { env } from './config.js';

const SESSION_COOKIE_NAME = 'atlas_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const GOOGLE_OAUTH_STATE_COOKIE_NAME = 'atlas_google_oauth_state';
const GOOGLE_OAUTH_STATE_TTL_SECONDS = 60 * 10;

type GoogleTokenPayload = {
  access_token?: string;
  id_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type GoogleUserInfoPayload = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  verified_email?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  locale?: string;
  hd?: string;
};

type UserWithRoles = Awaited<ReturnType<typeof findUserByIdentifier>>;

function normalizeIdentity(value: string) {
  return value.trim().toLowerCase();
}

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [salt, expectedHex] = storedHash.split(':');
  if (!salt || !expectedHex) return false;

  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');

  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function hashSessionToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getSessionExpiry() {
  return new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
}

function cookieIsSecure() {
  return env.APP_URL.startsWith('https://');
}

function toPublicUser(user: NonNullable<UserWithRoles>) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    fullName: user.fullName,
    roles: user.userRoles.map((entry) => entry.role.name)
  };
}

function getGoogleHostedDomain() {
  return normalizeIdentity(env.GOOGLE_HOSTED_DOMAIN || '');
}

function getConfiguredAdminEmails() {
  return new Set(
    [env.DEFAULT_ADMIN_EMAIL, env.LOCAL_SUPERADMIN_EMAIL]
      .filter(Boolean)
      .map((value) => normalizeIdentity(String(value)))
  );
}

function toGoogleUsernameSeed(email: string) {
  return normalizeIdentity(email)
    .split('@')[0]
    ?.replace(/[^a-z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'atlas_user';
}

function decodeJwtPayload<T extends Record<string, unknown>>(token?: string) {
  if (!token) return {} as T;
  const [, payload] = String(token).split('.');
  if (!payload) return {} as T;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as T;
  } catch {
    return {} as T;
  }
}

function buildGoogleOAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID || '',
    redirect_uri: env.GOOGLE_CALLBACK_URL || '',
    response_type: 'code',
    scope: 'openid email profile',
    include_granted_scopes: 'true',
    access_type: 'online',
    state
  });

  const hostedDomain = getGoogleHostedDomain();
  if (hostedDomain) {
    params.set('hd', hostedDomain);
  }

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeGoogleCodeForTokens(code: string) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID || '',
      client_secret: env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri: env.GOOGLE_CALLBACK_URL || '',
      grant_type: 'authorization_code'
    }).toString()
  });

  const payload = (await response.json().catch(() => ({}))) as GoogleTokenPayload;
  if (!response.ok || !payload.access_token) {
    const message =
      payload.error_description ||
      payload.error ||
      `Google token exchange failed with status ${response.status}.`;
    throw new Error(message);
  }

  return payload;
}

async function fetchGoogleUserInfo(accessToken: string) {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  const payload = (await response.json().catch(() => ({}))) as GoogleUserInfoPayload;
  if (!response.ok || !payload.email) {
    throw new Error(`Failed to load Google user profile (${response.status}).`);
  }

  return payload;
}

async function ensureUserRole(userId: string, roleName: string) {
  const role = await prisma.role.upsert({
    where: { name: roleName },
    update: {},
    create: { name: roleName }
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId,
        roleId: role.id
      }
    },
    update: {},
    create: {
      userId,
      roleId: role.id
    }
  });
}

async function generateUniqueUsername(email: string) {
  const base = toGoogleUsernameSeed(email);
  let candidate = base;
  let suffix = 1;

  // Keep username generation deterministic and low-risk for new Google-linked users.
  while (true) {
    const existing = await prisma.user.findFirst({
      where: {
        username: candidate
      },
      select: {
        id: true
      }
    });

    if (!existing) return candidate;
    suffix += 1;
    candidate = `${base}_${suffix}`;
  }
}

async function findUserByIdentifier(identifier: string) {
  const normalized = normalizeIdentity(identifier);

  return prisma.user.findFirst({
    where: {
      isActive: true,
      OR: [
        { email: normalized },
        { username: normalized }
      ]
    },
    include: {
      userRoles: {
        include: {
          role: true
        }
      }
    }
  });
}

async function findUserByEmail(email: string) {
  const normalized = normalizeIdentity(email);
  return prisma.user.findUnique({
    where: {
      email: normalized
    },
    include: {
      userRoles: {
        include: {
          role: true
        }
      }
    }
  });
}

export async function ensureLocalSuperAdmin() {
  if (env.LOCAL_AUTH_ENABLED !== 'true') return;
  if (!env.LOCAL_SUPERADMIN_USERNAME || !env.LOCAL_SUPERADMIN_PASSWORD) return;

  await prisma.session.deleteMany({
    where: {
      expiresAt: {
        lt: new Date()
      }
    }
  });

  const role = await prisma.role.upsert({
    where: { name: 'SUPER_ADMIN' },
    update: {},
    create: { name: 'SUPER_ADMIN' }
  });

  const email = normalizeIdentity(env.LOCAL_SUPERADMIN_EMAIL || env.DEFAULT_ADMIN_EMAIL);
  const username = normalizeIdentity(env.LOCAL_SUPERADMIN_USERNAME);
  const fullName = env.LOCAL_SUPERADMIN_NAME.trim() || 'Prayudhar';
  const passwordHash = hashPassword(env.LOCAL_SUPERADMIN_PASSWORD);

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { email },
        { username }
      ]
    }
  });

  const user = existingUser
    ? await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          email,
          username,
          fullName,
          isActive: true,
          passwordHash
        }
      })
    : await prisma.user.create({
        data: {
          email,
          username,
          fullName,
          isActive: true,
          passwordHash
        }
      });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: user.id,
        roleId: role.id
      }
    },
    update: {},
    create: {
      userId: user.id,
      roleId: role.id
    }
  });

  // Ensure ADMIN + USER roles exist
  await prisma.role.upsert({
    where: { name: 'ADMIN' },
    update: {},
    create: { name: 'ADMIN' }
  });

  await prisma.role.upsert({
    where: { name: 'USER' },
    update: {},
    create: { name: 'USER' }
  });
}

export function googleOAuthIsReady() {
  return env.GOOGLE_OAUTH_ENABLED === 'true' &&
    Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_CALLBACK_URL);
}

export function beginGoogleOAuth(reply: FastifyReply) {
  if (!googleOAuthIsReady()) {
    throw new Error('Google OAuth is not configured yet.');
  }

  const state = crypto.randomBytes(24).toString('base64url');
  reply.setCookie(GOOGLE_OAUTH_STATE_COOKIE_NAME, state, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieIsSecure(),
    maxAge: GOOGLE_OAUTH_STATE_TTL_SECONDS
  });

  return buildGoogleOAuthUrl(state);
}

export function getGoogleOAuthState(request: FastifyRequest) {
  return String(request.cookies[GOOGLE_OAUTH_STATE_COOKIE_NAME] || '').trim();
}

export function clearGoogleOAuthState(reply: FastifyReply) {
  reply.clearCookie(GOOGLE_OAUTH_STATE_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieIsSecure()
  });
}

export async function authenticateGoogleUser(code: string) {
  if (!googleOAuthIsReady()) {
    throw new Error('Google OAuth is not configured yet.');
  }

  const tokens = await exchangeGoogleCodeForTokens(code);
  const idClaims = decodeJwtPayload<Record<string, unknown>>(tokens.id_token);

  const tokenAudience = String(idClaims.aud || '').trim();
  if (tokenAudience && tokenAudience !== String(env.GOOGLE_CLIENT_ID || '').trim()) {
    throw new Error('Google token audience mismatch.');
  }

  const issuer = String(idClaims.iss || '').trim();
  if (issuer && issuer !== 'https://accounts.google.com' && issuer !== 'accounts.google.com') {
    throw new Error('Google token issuer mismatch.');
  }

  const profile = await fetchGoogleUserInfo(String(tokens.access_token || ''));
  const email = normalizeIdentity(String(profile.email || idClaims.email || ''));
  const fullName = String(profile.name || idClaims.name || '').trim();
  const hd = normalizeIdentity(String(profile.hd || idClaims.hd || ''));
  const emailVerified = Boolean(
    profile.email_verified ??
    profile.verified_email ??
    idClaims.email_verified
  );

  if (!email || !emailVerified) {
    throw new Error('Your Google account email is unavailable or not verified.');
  }

  const hostedDomain = getGoogleHostedDomain();
  if (hostedDomain && hd !== hostedDomain) {
    throw new Error(`Please sign in with your ${hostedDomain} Google Workspace account.`);
  }

  const adminEmails = getConfiguredAdminEmails();
  const employee = await prisma.employee.findFirst({
    where: {
      email,
      isActive: true
    }
  });

  let user = await findUserByEmail(email);
  if (!user) {
    if (!employee && !adminEmails.has(email)) {
      throw new Error('Your Google account is not authorized in ATLAS yet.');
    }

    user = await prisma.user.create({
      data: {
        email,
        username: await generateUniqueUsername(email),
        fullName: fullName || email.split('@')[0],
        isActive: true,
        employeeId: employee?.id
      },
      include: {
        userRoles: {
          include: {
            role: true
          }
        }
      }
    });
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        fullName: fullName || user.fullName,
        isActive: true,
        employeeId: user.employeeId || employee?.id,
        username: user.username || await generateUniqueUsername(email)
      },
      include: {
        userRoles: {
          include: {
            role: true
          }
        }
      }
    });
  }

  if (!user.userRoles.length) {
    if (adminEmails.has(email)) {
      await ensureUserRole(user.id, 'SUPER_ADMIN');
    } else if (employee) {
      await ensureUserRole(user.id, 'WFH_WFO');
    } else {
      throw new Error('Your ATLAS access role is not assigned yet.');
    }

    user = await findUserByEmail(email);
  }

  if (!user || !user.isActive) {
    throw new Error('Your ATLAS account is inactive.');
  }

  return toPublicUser(user);
}

export async function createSessionForUser(userId: string) {
  const token = crypto.randomBytes(48).toString('base64url');
  await prisma.session.create({
    data: {
      tokenHash: hashSessionToken(token),
      userId,
      expiresAt: getSessionExpiry()
    }
  });

  return token;
}

export async function destroySessionByToken(token?: string) {
  if (!token) return;
  await prisma.session.deleteMany({
    where: {
      tokenHash: hashSessionToken(token)
    }
  });
}

export async function getAuthenticatedUser(request: FastifyRequest) {
  const token = request.cookies[SESSION_COOKIE_NAME];
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: {
      tokenHash: hashSessionToken(token)
    },
    include: {
      user: {
        include: {
          userRoles: {
            include: {
              role: true
            }
          }
        }
      }
    }
  });

  if (!session) return null;
  if (session.expiresAt <= new Date() || !session.user.isActive) {
    await prisma.session.deleteMany({
      where: {
        id: session.id
      }
    });
    return null;
  }

  return {
    token,
    user: toPublicUser(session.user)
  };
}

export async function authenticateLocalUser(identifier: string, password: string) {
  const user = await findUserByIdentifier(identifier);
  if (!user || !user.passwordHash) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return toPublicUser(user);
}

export function applySessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieIsSecure(),
    maxAge: SESSION_TTL_SECONDS
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieIsSecure()
  });
}
