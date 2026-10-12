<script module lang="ts">
	const shown = 4;

	const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
</script>

<script lang="ts">
	import Button from '../Button.svelte';

	interface Props {
		commits: number;
		sha: string;
		headline: string;
		conflicts?: string[];
		updating?: boolean;
		onupdate?: () => void;
	}

	let { commits, sha, headline, conflicts = [], updating = false, onupdate }: Props = $props();

	let expanded = $state(false);

	const id = $props.id();

	let hidden = $derived(conflicts.length - shown > 1 ? conflicts.length - shown : 0);
	let visible = $derived(expanded || !hidden ? conflicts : conflicts.slice(0, shown));

	function split(path: string) {
		const slash = path.lastIndexOf('/') + 1;
		return { dir: path.slice(0, slash), name: path.slice(slash) };
	}
</script>

<section
	class={['behind', 'chat-enter', { conflicts: conflicts.length }]}
	aria-labelledby="{id}-title"
>
	<div class="layout">
		<svg class="mark" viewBox="0 0 16 16" aria-hidden="true">
			{#if conflicts.length}
				<path d="M8 2.25 14.5 13.5h-13Z" />
				<path d="M8 6.5v3.25M8 11.75v.01" />
			{:else}
				<path d="M8 2.5v8M4.75 7.25 8 10.5l3.25-3.25M3 13.5h10" />
			{/if}
		</svg>
		<div class="body">
			<p id="{id}-title" class="title">Main has {plural(commits, 'new commit')}</p>
			<p class="commit" title={headline}>
				<svg class="commit-icon" viewBox="0 0 16 16" aria-hidden="true">
					<circle cx="8" cy="8" r="2.75" />
					<path d="M1.5 8h3.75M10.75 8h3.75" />
				</svg>
				<code class="sha">{sha.slice(0, 7)}</code>
				<span class="headline">{headline}</span>
			</p>
			{#if conflicts.length}
				<p class="label">Conflicts in {plural(conflicts.length, 'file')}</p>
				<ul id="{id}-files">
					{#each visible as file (file)}
						{@const path = split(file)}
						<li title={file}>
							<code><bdi dir="ltr"><span class="dir">{path.dir}</span>{path.name}</bdi></code>
						</li>
					{/each}
				</ul>
				{#if hidden}
					<div class="more">
						<Button
							variant="ghost"
							size="xs"
							aria-expanded={expanded}
							aria-controls="{id}-files"
							onclick={() => (expanded = !expanded)}
							>{expanded ? 'Show fewer' : `Show ${hidden} more`}</Button
						>
					</div>
				{/if}
			{/if}
		</div>
		{#if onupdate}
			<div class="action">
				<Button
					variant={conflicts.length ? 'primary' : 'quiet'}
					size="sm"
					disabled={updating}
					onclick={onupdate}>{updating ? 'Updating…' : 'Bring up to date'}</Button
				>
			</div>
		{/if}
	</div>
</section>

<style>
	.behind {
		--icon-size: 1.1em;
		--mark: var(--color-muted);

		container-type: inline-size;
		padding: var(--space-4) var(--space-4) var(--space-4) var(--space-5);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		font-size: var(--text-chat);

		&.conflicts {
			--mark: var(--color-danger-text);

			border-color: color-mix(in oklab, var(--color-danger-text) 35%, var(--color-border));
		}
	}

	.layout {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: start;
		gap: var(--space-4);
	}

	.mark {
		inline-size: var(--icon-size);
		block-size: var(--icon-size);
		translate: 0 calc((var(--icon-size) - 1cap) / 2);
		fill: none;
		stroke: var(--mark);
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.action {
		align-self: center;
	}

	@container (width < 30rem) {
		.layout {
			grid-template-columns: auto minmax(0, 1fr);
		}

		.action {
			grid-column: 2;
		}
	}

	.body {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-2);
	}

	p,
	ul {
		margin: 0;
	}

	.title {
		font-weight: 600;
	}

	.commit {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-inline-size: 0;
		font-family: var(--font-mono);
		font-size: var(--text-meta);
	}

	.commit-icon {
		flex: none;
		inline-size: 1em;
		block-size: 1em;
		fill: none;
		stroke: var(--color-muted);
		stroke-width: 1.5;
		stroke-linecap: round;
	}

	.sha {
		flex: none;
		color: var(--color-muted);
	}

	.headline {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.label {
		margin-block-start: var(--space-2);
		color: var(--color-danger-text);
		font-size: var(--text-meta);
	}

	ul {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-1);
		padding: 0;
		list-style: none;
	}

	code {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
	}

	li code {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		direction: rtl;
		text-align: left;
	}

	.more {
		margin-inline-start: -0.5em;
		font-size: var(--text-meta);
	}

	.dir {
		color: var(--color-muted);
	}
</style>
