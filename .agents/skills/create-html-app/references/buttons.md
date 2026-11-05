# Buttons

Use `<button>` for actions. Keep labels short.

```
<button
	type="button"
	class="inline-flex min-h-8 items-center justify-center rounded-sm bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
>
	Save
</button>

<button
	type="button"
	class="inline-flex min-h-8 items-center justify-center rounded-sm bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
>
	Cancel
</button>
```

Loading state example:

```
<button
	type="button"
	class="inline-flex min-h-8 items-center justify-center rounded-sm bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:pointer-events-none disabled:opacity-70"
	:disabled="isSaving"
>
	<span x-text="isSaving ? 'Saving...' : 'Save'"></span>
</button>
```

