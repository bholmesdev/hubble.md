# Forms

Use labels, help text, and error text. Keep controls compact.

```html
<form class="grid gap-3" @submit.prevent="save">
	<label class="grid gap-1.5">
		<span class="text-sm font-medium text-foreground">Title</span>
		<input
			type="text"
			x-model="title"
			class="min-h-9 rounded-sm border border-input bg-background px-3 py-1.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
			placeholder="Project notes"
			aria-describedby="title-help title-error"
			:aria-invalid="Boolean(error)"
		/>
	</label>

	<p id="title-help" class="m-0 text-sm text-muted-foreground">
		Shown in the Folder list.
	</p>

	<p id="title-error" class="m-0 text-sm text-destructive" x-show="error" x-text="error"></p>

	<div class="flex items-center justify-end gap-2">
		<button
			type="button"
			class="rounded-sm bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			Cancel
		</button>
		<button
			type="submit"
			class="rounded-sm bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			Save
		</button>
	</div>
</form>
```
