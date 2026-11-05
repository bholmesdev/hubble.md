# Tabs

Use buttons with tab roles and panels keyed from Alpine state.

```html
<section class="grid gap-3" x-data="{ tab: 'files' }">
	<div class="inline-flex rounded-md border border-border bg-secondary p-1" role="tablist" aria-label="View">
		<button
			type="button"
			role="tab"
			class="rounded-sm px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			:aria-selected="tab === 'files'"
			@click="tab = 'files'"
		>
			Files
		</button>
		<button
			type="button"
			role="tab"
			class="rounded-sm px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			:aria-selected="tab === 'activity'"
			@click="tab = 'activity'"
		>
			Activity
		</button>
	</div>

	<div role="tabpanel" x-show="tab === 'files'" class="rounded-md border border-border bg-card p-3">
		<p class="m-0 text-sm text-muted-foreground">Files panel</p>
	</div>

	<div role="tabpanel" x-show="tab === 'activity'" class="rounded-md border border-border bg-card p-3">
		<p class="m-0 text-sm text-muted-foreground">Activity panel</p>
	</div>
</section>
```
