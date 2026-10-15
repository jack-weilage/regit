export const preferenceCookies = {
	locale: 'regit-locale',
	timeZone: 'regit-time-zone',
	archivedOpen: 'regit-archived-open'
};

export interface TimeOptions {
	locale?: string;
	timeZone?: string;
}

export interface Preferences {
	time: TimeOptions;
	archivedOpen?: boolean;
}

const maxLength = 100;

function text(value: string | undefined) {
	return value && value.length <= maxLength ? value : undefined;
}

export function readPreferences(get: (name: string) => string | undefined): Preferences {
	const archived = get(preferenceCookies.archivedOpen);
	return {
		time: {
			locale: text(get(preferenceCookies.locale)),
			timeZone: text(get(preferenceCookies.timeZone))
		},
		archivedOpen: archived === 'true' ? true : archived === 'false' ? false : undefined
	};
}

export function browserTimeOptions(): TimeOptions {
	const { locale, timeZone } = Intl.DateTimeFormat().resolvedOptions();
	return { locale, timeZone };
}

export function remember(name: string, value: string) {
	document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
}
