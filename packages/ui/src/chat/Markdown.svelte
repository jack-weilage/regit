<script module lang="ts">
	import { Lexer, type Token, type Tokens } from 'marked';

	function safeHref(href: string) {
		return /^(https?:|mailto:)/i.test(href.trim()) ? href : undefined;
	}

	function imageHref(href: string) {
		return /^\/[A-Za-z0-9._-]+\/images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
			href
		)
			? href
			: undefined;
	}
</script>

<script lang="ts">
	interface Props {
		source: string;
	}

	let { source }: Props = $props();

	let tokens = $derived(Lexer.lex(source));
</script>

{#snippet task(checked: boolean)}
	<svg
		class={['task', { checked }]}
		viewBox="0 0 16 16"
		role="img"
		aria-label={checked ? 'Done' : 'Not done'}
	>
		<rect x="2" y="2" width="12" height="12" rx="3" />
		{#if checked}<path d="m5 8.2 2 2 4-4.4" />{/if}
	</svg>
{/snippet}

{#snippet blocks(tokens: Token[])}
	{#each tokens as token, index (index)}
		{#if token.type === 'paragraph'}
			<p>{@render inline((token as Tokens.Paragraph).tokens)}</p>
		{:else if token.type === 'heading'}
			<p class="heading">{@render inline((token as Tokens.Heading).tokens)}</p>
		{:else if token.type === 'code'}
			<pre><code>{(token as Tokens.Code).text}</code></pre>
		{:else if token.type === 'blockquote'}
			<blockquote>{@render blocks((token as Tokens.Blockquote).tokens)}</blockquote>
		{:else if token.type === 'list'}
			{@const list = token as Tokens.List}
			<svelte:element
				this={list.ordered ? 'ol' : 'ul'}
				start={list.ordered && list.start !== '' ? list.start : undefined}
			>
				{#each list.items as item, itemIndex (itemIndex)}
					<li class={{ task: item.task }}>{@render blocks(item.tokens)}</li>
				{/each}
			</svelte:element>
		{:else if token.type === 'table'}
			{@const table = token as Tokens.Table}
			<div class="table">
				<table>
					<thead>
						<tr>
							{#each table.header as cell, cellIndex (cellIndex)}
								<th style:text-align={cell.align}>{@render inline(cell.tokens)}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each table.rows as row, rowIndex (rowIndex)}
							<tr>
								{#each row as cell, cellIndex (cellIndex)}
									<td style:text-align={cell.align}>{@render inline(cell.tokens)}</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else if token.type === 'hr'}
			<hr />
		{:else if token.type === 'checkbox'}
			{@render task((token as Tokens.Checkbox).checked)}
		{:else if token.type === 'text'}
			{@const text = token as Tokens.Text}
			{#if text.tokens}{@render inline(text.tokens)}{:else}{text.text}{/if}
		{:else if token.type === 'html'}
			<p>{(token as Tokens.HTML).text}</p>
		{/if}
	{/each}
{/snippet}

{#snippet inline(tokens: Token[])}
	{#each tokens as token, index (index)}
		{#if token.type === 'strong'}
			<strong>{@render inline((token as Tokens.Strong).tokens)}</strong>
		{:else if token.type === 'em'}
			<em>{@render inline((token as Tokens.Em).tokens)}</em>
		{:else if token.type === 'del'}
			<del>{@render inline((token as Tokens.Del).tokens)}</del>
		{:else if token.type === 'codespan'}
			<code>{(token as Tokens.Codespan).text}</code>
		{:else if token.type === 'br'}
			<br />
		{:else if token.type === 'link'}
			{@const link = token as Tokens.Link}
			{@const href = safeHref(link.href)}
			{#if href}
				<a {href} target="_blank" rel="noreferrer">{@render inline(link.tokens)}</a>
			{:else}
				{@render inline(link.tokens)}
			{/if}
		{:else if token.type === 'image'}
			{@const image = token as Tokens.Image}
			{@const href = safeHref(image.href)}
			{@const src = imageHref(image.href)}
			{#if src}
				<a href={src} target="_blank" rel="noreferrer" class="image">
					<img {src} alt={image.text || 'Agent image'} loading="lazy" />
				</a>
			{:else if href}
				<a {href} target="_blank" rel="noreferrer">{image.text || href}</a>
			{:else}
				{image.text}
			{/if}
		{:else if token.type === 'checkbox'}
			{@render task((token as Tokens.Checkbox).checked)}
		{:else if 'tokens' in token && token.tokens}
			{@render inline(token.tokens)}
		{:else if 'text' in token}
			{token.text}
		{/if}
	{/each}
{/snippet}

<div class="markdown">{@render blocks(tokens)}</div>

<style>
	.markdown {
		display: grid;
		gap: 0.625em;
		min-inline-size: 0;

		> :global(*) {
			margin: 0;
		}
	}

	p,
	blockquote,
	pre,
	ul,
	ol,
	hr {
		margin: 0;
	}

	.heading {
		font-weight: 600;
	}

	a.image {
		display: block;
		margin-block: var(--space-3);
	}

	img {
		display: block;
		box-sizing: border-box;
		max-inline-size: 100%;
		block-size: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}

	ul,
	ol {
		display: grid;
		gap: 0.25em;
		padding-inline-start: 1.4em;
	}

	li.task {
		margin-inline-start: -1.25em;
		list-style: none;
	}

	li > :global(p + p) {
		margin-block-start: 0.4em;
	}

	svg.task {
		inline-size: 1.05em;
		block-size: 1.05em;
		margin-inline-end: 0.3em;
		vertical-align: -0.15em;
		fill: none;
		stroke: var(--color-muted);
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;

		&.checked {
			rect {
				fill: var(--color-accent);
				stroke: var(--color-accent);
			}

			path {
				stroke: var(--color-accent-fg);
			}
		}
	}

	blockquote {
		display: grid;
		gap: 0.4em;
		padding-inline-start: 0.8em;
		border-inline-start: 2px solid var(--color-border);
		color: var(--color-muted);
	}

	pre {
		overflow-x: auto;
		padding: 0.7em 0.9em;
		border-radius: var(--radius);
		font-size: 0.92em;
		line-height: 1.45;
	}

	code {
		padding: 0.1em 0.3em;
		border-radius: 0.3em;
		font-size: 0.92em;
	}

	pre code {
		padding: 0;
		background: none;
		font-size: inherit;
	}

	a {
		color: inherit;
		text-decoration: underline;
		text-decoration-color: color-mix(in oklab, currentColor 40%, transparent);
		text-underline-offset: 2px;

		&:hover {
			text-decoration-color: currentColor;
		}
	}

	hr {
		border: 0;
		border-block-start: 1px solid var(--color-border);
	}

	.table {
		overflow-x: auto;
	}

	table {
		border-collapse: collapse;
		font-size: 0.95em;
	}

	th,
	td {
		padding: 0.35em 0.7em;
		border: 1px solid var(--color-border);
		text-align: start;
	}

	th {
		font-weight: 600;
	}
</style>
