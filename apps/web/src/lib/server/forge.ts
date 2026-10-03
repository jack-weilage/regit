import { env } from 'cloudflare:workers';
import type { ForgeApi } from '@regit/core';

export const forge = env.FORGE as unknown as ForgeApi;
