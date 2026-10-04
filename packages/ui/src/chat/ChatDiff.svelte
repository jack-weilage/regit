<script module lang="ts">
	import type { DiffFile } from './types.ts';

	const badges: Record<DiffFile['change'], { letter: string; label: string }> = {
		added: { letter: 'A', label: 'Added' },
		modified: { letter: 'M', label: 'Modified' },
		deleted: { letter: 'D', label: 'Deleted' },
		renamed: { letter: 'R', label: 'Renamed' }
	};

	function split(path: string) {
		const slash = path.lastIndexOf('/');
		return { dir: path.slice(0, slash + 1), name: path.slice(slash + 1) };
	}

	const plural = (count: number, word: string) =>
		`${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;
</script>

<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';

	interface Props {
		files: DiffFile[];
	}

	let { files }: Props = $props();

	const id = $props.id();
	const collapsed = new SvelteSet<string>();
	const revealed = new SvelteSet<string>();

	function jump(path: string) {
		collapsed.delete(path);
		document
			.getElementById(`${id}-${files.findIndex((file) => file.path === path)}`)
			?.scrollIntoView({
				block: 'start'
			});
	}
</script>

{#snippet counts(file: DiffFile)}
	<span class="counts">
		{#if file.additions}<span class="added">+{file.additions}</span>{/if}
		{#if file.deletions}<span class="removed">−{file.deletions}</span>{/if}
	</span>
{/snippet}

{#snippet path(file: DiffFile)}
	{@const { dir, name } = split(file.path)}
	<span class="path" title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}>
		<span class="dir">{file.oldPath ? `${file.oldPath} → ` : ''}{dir}</span><span class="name"
			>{name}</span
		>
	</span>
{/snippet}

<div class="diff">
	<nav aria-label="Changed files">
		<ul class="files">
			{#each files as file (file.path)}
				<li>
					<button type="button" onclick={() => jump(file.path)}>
						<span class={['badge', file.change]} title={badges[file.change].label}
							>{badges[file.change].letter}</span
						>
						{@render path(file)}
						{@render counts(file)}
					</button>
				</li>
			{/each}
		</ul>
	</nav>

	{#each files as file, index (file.path)}
		{@const open = !collapsed.has(file.path)}
		<section id="{id}-{index}" class="file" aria-label={file.path}>
			<h3>
				<button
					type="button"
					aria-expanded={open}
					onclick={() => (open ? collapsed.add(file.path) : collapsed.delete(file.path))}
				>
					<svg class={['chevron', { open }]} viewBox="0 0 16 16" aria-hidden="true"
						><path d="m6 4 4 4-4 4" /></svg
					>
					<span class={['badge', file.change]} title={badges[file.change].label}
						>{badges[file.change].letter}</span
					>
					{@render path(file)}
					{@render counts(file)}
				</button>
			</h3>

			{#if open}
				{#if file.binary}
					<p class="note">Binary file</p>
				{:else if file.tooLarge && !revealed.has(file.path)}
					<p class="note">
						{plural(file.additions + file.deletions, 'changed line')}
						{#if file.hunks.length}
							·
							<button type="button" class="link" onclick={() => revealed.add(file.path)}
								>Show</button
							>
						{/if}
					</p>
				{:else}
					<div class="scroll">
						<table>
							<tbody>
								{#each file.hunks as hunk, hunkIndex (hunkIndex)}
									{#if hunk.skipped || hunk.context}
										<tr class="hunk">
											<td colspan="4">
												{#if hunk.skipped}<span>⋯ {plural(hunk.skipped, 'unchanged line')}</span
													>{/if}
												{#if hunk.context}<code>{hunk.context}</code>{/if}
											</td>
										</tr>
									{/if}
									{#each hunk.lines as line, lineIndex (lineIndex)}
										<tr class={line.kind}>
											<td class="number old">{line.old ?? ''}</td>
											<td class="number new">{line.new ?? ''}</td>
											<td class="marker" aria-hidden="true"
												>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''}</td
											>
											<td class="code"
												>{#if line.kind !== 'context'}<span class="sr-only"
														>{line.kind === 'added' ? 'Added: ' : 'Removed: '}</span
													>{/if}{line.text}</td
											>
										</tr>
									{/each}
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			{/if}
		</section>
	{/each}
</div>

<style>
	.diff {
		container: diff / inline-size;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-5);
		font-size: var(--text-chat);
	}

	.files {
		display: grid;
		margin: 0;
		padding: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		list-style: none;

		button {
			display: flex;
			align-items: center;
			gap: var(--space-4);
			inline-size: 100%;
			padding: var(--space-3) var(--space-4);
			border: 0;
			border-radius: calc(var(--radius) - 2px);
			background: none;
			color: inherit;
			font: inherit;
			text-align: start;
			cursor: pointer;

			&:hover {
				background: var(--color-surface);
			}

			&:focus-visible {
				outline: 2px solid var(--color-accent);
				outline-offset: -2px;
			}
		}
	}

	.file {
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		scroll-margin-block-start: var(--space-4);
	}

	h3 {
		position: sticky;
		inset-block-start: 0;
		z-index: 1;
		margin: 0;
		border-radius: var(--radius) var(--radius) 0 0;
		background: var(--color-bg);
		font: inherit;

		button {
			display: flex;
			align-items: center;
			gap: var(--space-4);
			inline-size: 100%;
			padding: var(--space-4) var(--space-5);
			border: 0;
			border-block-end: 1px solid var(--color-border);
			border-radius: inherit;
			background: color-mix(in oklab, var(--color-surface) 60%, var(--color-bg));
			color: inherit;
			font: inherit;
			text-align: start;
			cursor: pointer;

			&[aria-expanded='false'] {
				border-block-end: 0;
				border-radius: var(--radius);
			}

			&:focus-visible {
				outline: 2px solid var(--color-accent);
				outline-offset: -2px;
			}
		}
	}

	.chevron {
		flex: none;
		inline-size: 1em;
		block-size: 1em;
		fill: none;
		stroke: var(--color-muted);
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;

		&.open {
			rotate: 90deg;
		}
	}

	.badge {
		flex: none;
		inline-size: 1.4em;
		padding-block: 0.05em;
		border-radius: 0.3em;
		font-family: var(--font-mono);
		font-size: 0.85em;
		font-weight: 600;
		line-height: 1.4;
		text-align: center;

		&.added {
			background: color-mix(in oklab, var(--color-added) 18%, transparent);
			color: var(--color-added);
		}

		&.deleted {
			background: color-mix(in oklab, var(--color-removed) 18%, transparent);
			color: var(--color-removed);
		}

		&.modified,
		&.renamed {
			background: var(--color-surface);
			color: var(--color-muted);
		}
	}

	.path {
		display: flex;
		flex: 1;
		min-inline-size: 0;
		font-family: var(--font-mono);
		font-size: 0.95em;
		white-space: nowrap;
	}

	.dir {
		min-inline-size: 0;
		overflow: hidden;
		color: var(--color-muted);
		text-overflow: ellipsis;
	}

	.name {
		flex: none;
	}

	.counts {
		display: flex;
		flex: none;
		gap: var(--space-3);
		font-family: var(--font-mono);
		font-size: 0.95em;
	}

	.added {
		color: var(--color-added);
	}

	.removed {
		color: var(--color-removed);
	}

	.note {
		margin: 0;
		padding: var(--space-5) var(--space-6);
		color: var(--color-muted);
	}

	.link {
		padding: 0;
		border: 0;
		background: none;
		color: var(--color-fg);
		font: inherit;
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}

	.scroll {
		overflow-x: auto;
		border-radius: 0 0 var(--radius) var(--radius);
	}

	table {
		min-inline-size: 100%;
		border-collapse: collapse;
		font-family: var(--font-mono);
		font-size: 0.92em;
		line-height: 1.55;
		tab-size: 2;
	}

	td {
		padding: 0;
		vertical-align: top;
	}

	.number {
		inline-size: 1%;
		min-inline-size: 3ch;
		padding-inline: var(--space-4);
		color: var(--color-muted);
		text-align: end;
		white-space: nowrap;
		user-select: none;
	}

	.marker {
		inline-size: 1%;
		padding-inline: var(--space-2) var(--space-3);
		user-select: none;
	}

	.code {
		padding-inline-end: var(--space-6);
		white-space: pre;
	}

	tr.added {
		background: color-mix(in oklab, var(--color-added) 12%, transparent);

		.marker,
		.number {
			color: var(--color-added);
		}
	}

	tr.removed {
		background: color-mix(in oklab, var(--color-removed) 12%, transparent);

		.marker,
		.number {
			color: var(--color-removed);
		}
	}

	tr.hunk td {
		padding: var(--space-2) var(--space-5);
		background: var(--color-surface);
		color: var(--color-muted);
		font-family: var(--font-sans);
		font-size: var(--text-meta);

		span + code {
			margin-inline-start: var(--space-5);
		}

		code {
			font-family: var(--font-mono);
		}
	}

	tr:first-child.hunk td {
		border-block-start: 0;
	}

	.sr-only {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	@container diff (width < 32rem) {
		.old {
			display: none;
		}

		.code {
			white-space: pre-wrap;
			overflow-wrap: anywhere;
		}
	}
</style>
