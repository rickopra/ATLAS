import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  API_PORT: z.coerce.number().default(4000),
  APP_NAME: z.string().default('ATLAS'),
  APP_URL: z.string().url(),
  APP_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SESSION_COOKIE_SECRET: z.string().min(1),
  GOOGLE_OAUTH_ENABLED: z.string().default('false'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_HOSTED_DOMAIN: z.string().default('yourdomain.com'),
  GOOGLE_CALLBACK_URL: z.string().optional(),
  GOOGLE_WORKSPACE_DIRECTORY_ENABLED: z.string().default('false'),
  GOOGLE_WORKSPACE_DIRECTORY_PROJECT_ID: z.string().optional(),
  GOOGLE_WORKSPACE_DIRECTORY_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_WORKSPACE_DIRECTORY_DELEGATED_ADMIN_EMAIL: z.string().email().optional(),
  GOOGLE_WORKSPACE_DIRECTORY_KEY_FILE: z.string().optional(),
  GOOGLE_WORKSPACE_DIRECTORY_CUSTOMER: z.string().default('my_customer'),
  GOOGLE_WORKSPACE_DIRECTORY_CUSTOM_SCHEMA: z.string().default('ATLAS'),
  DEFAULT_ADMIN_EMAIL: z.string().email(),
  LOCAL_AUTH_ENABLED: z.string().default('true'),
  LOCAL_SUPERADMIN_EMAIL: z.string().email().optional(),
  LOCAL_SUPERADMIN_NAME: z.string().default('Prayudhar'),
  LOCAL_SUPERADMIN_USERNAME: z.string().optional(),
  LOCAL_SUPERADMIN_PASSWORD: z.string().optional(),
  ATLAS_STORAGE_DIR: z.string().default('/atlas-data/storage'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  ATLAS_SCRIPT_PROPERTIES_JSON: z.string().optional()
});

export const env = envSchema.parse(process.env);

export const authReadiness = {
  googleEnabled: env.GOOGLE_OAUTH_ENABLED === 'true',
  googleClientReady: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  hostedDomain: env.GOOGLE_HOSTED_DOMAIN,
  localAuthEnabled: env.LOCAL_AUTH_ENABLED === 'true'
};

export const googleWorkspaceDirectoryReadiness = {
  enabled: env.GOOGLE_WORKSPACE_DIRECTORY_ENABLED === 'true',
  projectId: env.GOOGLE_WORKSPACE_DIRECTORY_PROJECT_ID || '',
  serviceAccountEmail: env.GOOGLE_WORKSPACE_DIRECTORY_SERVICE_ACCOUNT_EMAIL || '',
  delegatedAdminEmail: env.GOOGLE_WORKSPACE_DIRECTORY_DELEGATED_ADMIN_EMAIL || '',
  keyFile: env.GOOGLE_WORKSPACE_DIRECTORY_KEY_FILE || '',
  customer: env.GOOGLE_WORKSPACE_DIRECTORY_CUSTOMER || 'my_customer',
  customSchema: env.GOOGLE_WORKSPACE_DIRECTORY_CUSTOM_SCHEMA || 'ATLAS',
  clientReady: Boolean(
    env.GOOGLE_WORKSPACE_DIRECTORY_PROJECT_ID &&
    env.GOOGLE_WORKSPACE_DIRECTORY_SERVICE_ACCOUNT_EMAIL &&
    env.GOOGLE_WORKSPACE_DIRECTORY_DELEGATED_ADMIN_EMAIL &&
    env.GOOGLE_WORKSPACE_DIRECTORY_KEY_FILE
  )
};
