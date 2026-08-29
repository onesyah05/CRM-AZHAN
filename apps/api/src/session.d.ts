import 'express-session';
import type { BrandContext, UserContext } from '@azhan-crm/contracts';

declare module 'express-session' {
  interface SessionData {
    user: UserContext;
    accessToken: string;
    refreshToken: string;
	accessTokenExpiresAt: number;
    availableBrands: BrandContext[];
  }
}
