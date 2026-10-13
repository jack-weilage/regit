<script module lang="ts">
	export interface ServiceView {
		name: string;
		command: string;
		port: number;
		saved: boolean;
		status: 'stopped' | 'starting' | 'running' | 'exited';
		exitCode?: number | null;
		preview: string;
	}

	export type ServiceAction = 'start' | 'stop' | 'restart';
</script>

<script lang="ts">
	import Button from '../Button.svelte';

	interface Props {
		services: ServiceView[];
		selected?: string | null;
		logs?: string | null;
		busy?: string | null;
		error?: string | null;
		onaction: (action: ServiceAction, name: string) => void;
		onlogs?: (name: string) => void;
		onclose?: () => void;
	}

	let {
		services,
		selected = $bindable(null),
		logs = null,
		busy = null,
		error = null,
		onaction,
		onlogs,
		onclose
	}: Props = $props();

	const id = $props.id();

	let tab = $state<'preview' | 'logs'>('preview');
	let current = $derived(
		services.find((service) => service.name === selected) ??
			services.find((service) => service.status === 'running') ??
			services[0]
	);

	const label = (service: ServiceView) =>
		service.status === 'exited' ? `exited (${service.exitCode ?? '?'})` : service.status;

	function show(next: 'preview' | 'logs') {
		tab = next;
		if (next === 'logs' && current) onlogs?.(current.name);
	}
</script>

<section class="panel" aria-labelledby="{id}-title">
	<header>
		<h2 id="{id}-title">Services</h2>
		{#if onclose}
			<Button variant="ghost" size="sm" icon aria-label="Close services" onclick={onclose}>
				<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>
			</Button>
		{/if}
	</header>

	{#if services.length}
		<ul class="list" aria-label="Services">
			{#each services as service (service.name)}
				<li class={{ current: service.name === current?.name }}>
					<button
						type="button"
						class="pick"
						aria-pressed={service.name === current?.name}
						onclick={() => (selected = service.name)}
					>
						<span class={['dot', service.status]} aria-hidden="true"></span>
						<span class="name">{service.name}</span>
						<span class="meta"
							>:{service.port} · {label(service)}{service.saved ? '' : ' · one-off'}</span
						>
					</button>
					<span class="buttons">
						{#if service.status === 'running' || service.status === 'starting'}
							<Button
								size="xs"
								variant="ghost"
								disabled={busy === service.name}
								aria-label="Restart {service.name}"
								onclick={() => onaction('restart', service.name)}>Restart</Button
							>
							<Button
								size="xs"
								disabled={busy === service.name}
								aria-label="Stop {service.name}"
								onclick={() => onaction('stop', service.name)}>Stop</Button
							>
						{:else}
							<Button
								size="xs"
								variant="primary"
								disabled={busy === service.name}
								aria-label="Start {service.name}"
								onclick={() => onaction('start', service.name)}
								>{busy === service.name ? 'Starting' : 'Start'}</Button
							>
						{/if}
					</span>
				</li>
			{/each}
		</ul>

		{#if error}<p class="error" role="alert">{error}</p>{/if}

		{#if current}
			<div class="view">
				<div class="bar">
					<div class="tabs" role="tablist" aria-label="View">
						<button
							type="button"
							role="tab"
							aria-selected={tab === 'preview'}
							onclick={() => show('preview')}>Preview</button
						>
						<button
							type="button"
							role="tab"
							aria-selected={tab === 'logs'}
							onclick={() => show('logs')}>Logs</button
						>
					</div>
					{#if tab === 'preview' && current.status === 'running'}
						<a href={current.preview} target="_blank" rel="noreferrer">Open in new tab</a>
					{:else if tab === 'logs'}
						<button type="button" class="link" onclick={() => onlogs?.(current.name)}
							>Refresh</button
						>
					{/if}
				</div>
				{#if tab === 'logs'}
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<pre class="logs" role="log" aria-label="Logs of {current.name}" tabindex="0">{logs ||
							'No output yet.'}</pre>
				{:else if current.status === 'running'}
					<iframe
						src={current.preview}
						title="Preview of {current.name}"
						sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
					></iframe>
				{:else}
					<p class="empty">Start {current.name} to preview it.</p>
				{/if}
			</div>
		{/if}
	{:else}
		<p class="empty">No services yet. Save them in <code>.agents/services.yml</code>.</p>
	{/if}
</section>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		block-size: 100%;
		min-inline-size: 0;
		background: var(--color-bg);
		font-size: var(--text-chat);
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-5) var(--space-5) var(--space-5) var(--space-6);
		border-block-end: 1px solid var(--color-border);

		svg {
			inline-size: 1.1em;
			block-size: 1.1em;
			fill: none;
			stroke: currentColor;
			stroke-width: 1.5;
			stroke-linecap: round;
		}
	}

	h2 {
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.list {
		display: grid;
		margin: 0;
		padding: var(--space-3);
		border-block-end: 1px solid var(--color-border);
		list-style: none;

		li {
			display: flex;
			align-items: center;
			gap: var(--space-4);
			padding-inline-end: var(--space-3);
			border-radius: var(--radius);

			&.current {
				background: var(--color-surface);
			}
		}
	}

	.pick {
		display: flex;
		flex: 1;
		align-items: baseline;
		gap: var(--space-4);
		min-inline-size: 0;
		padding: var(--space-4);
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-align: start;
		cursor: pointer;

		&:focus-visible {
			outline: 2px solid var(--color-accent);
			outline-offset: -2px;
			border-radius: var(--radius);
		}
	}

	.dot {
		flex: none;
		inline-size: 0.55rem;
		block-size: 0.55rem;
		border-radius: 50%;
		background: color-mix(in oklab, var(--color-muted) 55%, transparent);

		&.running {
			background: var(--color-added);
		}

		&.starting {
			background: var(--color-accent);
		}

		&.exited {
			background: var(--color-removed);
		}
	}

	.name {
		font-family: var(--font-mono);
	}

	.meta {
		overflow: hidden;
		color: var(--color-muted);
		font-size: var(--text-meta);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.buttons {
		display: flex;
		flex: none;
		gap: var(--space-2);
	}

	.error {
		margin: 0;
		padding: var(--space-4) var(--space-6);
		border-block-end: 1px solid var(--color-border);
		color: var(--color-danger-text);
		white-space: pre-wrap;
		font-family: var(--font-mono);
		font-size: var(--text-meta);
	}

	.view {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-block-size: 0;
	}

	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-5);
		border-block-end: 1px solid var(--color-border);
		font-size: var(--text-meta);

		a,
		.link {
			padding: 0;
			border: 0;
			background: none;
			color: var(--color-muted);
			font: inherit;
			text-decoration: underline;
			text-underline-offset: 2px;
			cursor: pointer;
		}
	}

	.tabs {
		display: flex;
		gap: var(--space-2);

		button {
			padding: var(--space-2) var(--space-4);
			border: 0;
			border-radius: var(--radius);
			background: none;
			color: var(--color-muted);
			font: inherit;
			cursor: pointer;

			&[aria-selected='true'] {
				background: var(--color-surface);
				color: var(--color-fg);
			}
		}
	}

	iframe {
		flex: 1;
		inline-size: 100%;
		border: 0;
		background: white;
	}

	.logs {
		flex: 1;
		margin: 0;
		padding: var(--space-5) var(--space-6);
		overflow: auto;
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		line-height: 1.5;
		white-space: pre-wrap;
	}

	.empty {
		margin: 0;
		padding: var(--space-7) var(--space-6);
		color: var(--color-muted);

		code {
			font-family: var(--font-mono);
		}
	}
</style>
