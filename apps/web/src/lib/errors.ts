const titles: Record<number, string> = { 403: 'No access', 404: 'Not found' };

export function errorTitle(status: number) {
	return titles[status] ?? 'Something went wrong';
}

export function errorDetail(status: number, error: App.Error | null) {
	return status < 500 ? error?.message : undefined;
}
