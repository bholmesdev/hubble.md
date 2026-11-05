# Radio Selects

Use real radio inputs for keyboard semantics. Style the label.

```html
<fieldset class="grid gap-2" x-data="{ view: 'recent' }">
	<legend class="text-sm font-medium text-foreground">Sort</legend>

	<div class="grid grid-cols-2 gap-2">
		<label
			class="rounded-sm border border-border bg-background px-3 py-2 text-sm transition-colors has-[:checked]:border-primary has-[:checked]:bg-selected has-[:checked]:text-selected-foreground"
		>
			<input class="sr-only" type="radio" name="sort" value="recent" x-model="view" />
			Recent
		</label>

		<label
			class="rounded-sm border border-border bg-background px-3 py-2 text-sm transition-colors has-[:checked]:border-primary has-[:checked]:bg-selected has-[:checked]:text-selected-foreground"
		>
			<input class="sr-only" type="radio" name="sort" value="name" x-model="view" />
			Name
		</label>
	</div>
</fieldset>
```

For segmented controls, keep a single row and use `aria-pressed` buttons when the choice triggers immediate UI state rather than form submission.
