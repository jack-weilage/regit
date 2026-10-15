/// <reference lib="dom" />
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { fakeThreads } from './fake-remote.ts';
import ThreadPage from './ThreadPage.svelte';

type Ref = { id: string; number: number };

const { a, b } = fakeThreads;
let view: { open: (thread: Ref) => void };

beforeEach(async () => {
	await page.viewport(1280, 900);
	localStorage.setItem('regit:sidebar', JSON.stringify({ open: true, tab: 'services' }));
	view = mount(ThreadPage, { target: document.body, props: { thread: a } }) as typeof view;
	await expect.element(page.getByRole('heading', { name: 'Thread 1' })).toBeVisible();
});

afterEach(() => {
	unmount(view);
	localStorage.clear();
});

async function switchTo(thread: Ref) {
	view.open(thread);
	await expect
		.element(page.getByRole('heading', { name: `Thread ${thread.number}` }))
		.toBeVisible();
}

const composer = () => page.getByRole('textbox', { name: 'Message' });
const service = (name: string) => page.getByRole('button', { name: new RegExp(`^${name}\\b`) });
const serviceLogs = () => page.getByRole('log', { name: /^Logs of / });

test("an unsent draft doesn't follow you to the next thread", async () => {
	await userEvent.fill(composer(), 'Draft for thread 1');
	await switchTo(b);
	await expect.element(composer()).toHaveValue('');
	await switchTo(a);
	await expect.element(composer()).toHaveValue('Draft for thread 1');
});

test("the services panel shows the next thread's services, not the previous one's logs", async () => {
	await userEvent.click(service('worker'));
	await userEvent.click(page.getByRole('tab', { name: 'Logs' }));
	await expect.element(serviceLogs()).toHaveTextContent(`worker logs of ${a.id}`);
	await switchTo(b);
	await expect.element(service('web')).toHaveAttribute('aria-pressed', 'true');
	await expect.element(service('worker')).toHaveAttribute('aria-pressed', 'false');
	await expect
		.element(page.getByRole('tab', { name: 'Preview' }))
		.toHaveAttribute('aria-selected', 'true');
	await expect.element(serviceLogs()).not.toBeInTheDocument();
});

test('"Updating…" stays on the thread being brought up to date', async () => {
	await userEvent.click(page.getByRole('button', { name: 'Bring up to date' }));
	await expect.element(page.getByRole('button', { name: 'Updating…' })).toBeVisible();
	await switchTo(b);
	await expect.element(page.getByRole('button', { name: 'Bring up to date' })).toBeVisible();
	await switchTo(a);
	await expect.element(page.getByRole('button', { name: 'Updating…' })).toBeVisible();
});
