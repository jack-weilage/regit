import type { LayoutServerLoad } from './$types';
import { readPreferences } from '#lib/preferences.ts';

export const load: LayoutServerLoad = ({ cookies }) => readPreferences((name) => cookies.get(name));
