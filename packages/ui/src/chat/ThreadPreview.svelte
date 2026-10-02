<script module lang="ts">
	import type { Author } from './types.ts';

	export interface ThreadPreviewProps {
		headline: string;
		purpose: string;
		mode: string;
		doneWhen: string[];
		checkpoint?: { sha: string; count: number; href?: string };
		people?: Author[];
	}
</script>

<script lang="ts">
	import Avatar from '../Avatar.svelte';

	let { headline, purpose, mode, doneWhen, checkpoint, people = [] }: ThreadPreviewProps = $props();
</script>

<div class="preview">
	<div class="summary">
		<div class="title">
			<p class="headline">{headline}</p>
			<span class="badge">{mode}</span>
		</div>
		<p class="purpose">{purpose}</p>
	</div>
	<div class="facts">
		<span class="fact">
			<svg viewBox="0 0 16 16" aria-hidden="true"
				><circle cx="8" cy="8" r="5.5" /><path d="m5.75 8.25 1.5 1.5 3-3.25" /></svg
			>
			{doneWhen.length}
			{doneWhen.length === 1 ? 'check' : 'checks'}
		</span>
		{#if checkpoint}
			<span class="fact">
				<svg viewBox="0 0 16 16" aria-hidden="true"
					><circle cx="8" cy="8" r="2.5" /><path d="M2 8h3.5M10.5 8H14" /></svg
				>
				<svelte:element this={checkpoint.href ? 'a' : 'span'} href={checkpoint.href} class="sha"
					>{checkpoint.sha.slice(0, 7)}</svelte:element
				>
				<span>· {checkpoint.count} {checkpoint.count === 1 ? 'checkpoint' : 'checkpoints'}</span>
			</span>
		{/if}
		{#if people.length}
			<span class="avatars" aria-label={people.map((person) => person.name).join(', ')} role="img">
				{#each people as person (person.name)}
					<Avatar name={person.name} src={person.avatar} />
				{/each}
			</span>
		{/if}
	</div>
</div>

<style>
	.preview {
		inline-size: 20rem;
		max-inline-size: calc(100vw - 2rem);
		font-size: var(--text-chat);
		line-height: 1.5;

		p {
			margin: 0;
		}
	}

	.summary {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-5) var(--space-5) var(--space-4);
		border-block-end: 1px solid var(--color-border);
	}

	.title {
		display: flex;
		align-items: baseline;
		gap: var(--space-4);
	}

	.headline {
		flex: 1;
		min-inline-size: 0;
		font-family: var(--font-mono);
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.badge {
		flex: none;
		padding: 0.05em 0.5em;
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--color-muted);
		font-size: var(--text-meta);
		font-weight: 500;
	}

	.purpose {
		display: -webkit-box;
		overflow: hidden;
		color: var(--color-muted);
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.facts {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-5);
		padding: var(--space-4) var(--space-5);
		color: var(--color-muted);
		font-size: var(--text-meta);
	}

	.fact {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-2);

		svg {
			--size: 1.15em;

			flex: none;
			inline-size: var(--size);
			block-size: var(--size);
			translate: 0 calc((var(--size) - 1cap) / 2);
			fill: none;
			stroke: currentColor;
			stroke-width: 1.4;
			stroke-linecap: round;
			stroke-linejoin: round;
		}
	}

	.sha {
		color: var(--color-fg);
		font-family: var(--font-mono);
		text-decoration: none;
	}

	a.sha:hover {
		color: var(--color-accent);
		text-decoration: underline;
	}

	.avatars {
		--avatar-size: 1.5em;

		display: inline-flex;
		margin-inline-start: auto;

		:global(.avatar + .avatar) {
			margin-inline-start: -0.35em;
			box-shadow: 0 0 0 2px var(--color-bg);
		}
	}
</style>
