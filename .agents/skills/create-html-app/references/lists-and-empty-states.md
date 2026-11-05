# Lists and Empty States

Compact result list:

```html
<section class="grid gap-2" x-data="{ files: [], loading: true, error: '' }">
	<p class="m-0 text-sm text-muted-foreground" x-show="loading">Loading...</p>
	<p class="m-0 text-sm text-destructive" x-show="error" x-text="error"></p>

	<div
		class="rounded-md border border-dashed border-border bg-card p-4 text-center"
		x-show="!loading && !error && files.length === 0"
	>
		<p class="m-0 text-sm font-medium text-foreground">No files found</p>
		<p class="m-0 mt-1 text-sm text-muted-foreground">Try a different filter.</p>
	</div>

	<ul class="m-0 grid list-none gap-1.5 p-0" x-show="files.length > 0">
		<template x-for="file in files" :key="file.path">
			<li>
				<button
					type="button"
					class="grid w-full gap-0.5 rounded-sm border border-border bg-background px-3 py-2 text-start transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<span class="truncate text-sm font-medium text-foreground" x-text="file.path"></span>
					<span class="text-xs text-muted-foreground" x-text="`${file.size} bytes`"></span>
				</button>
			</li>
		</template>
	</ul>
</section>
```
