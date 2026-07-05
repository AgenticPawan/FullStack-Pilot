---
name: angular-shared-ui-kit
description: Reviews the shared UI-kit layer beyond forms and tables already covered by angular-shared-libraries — modals/dialogs, toast/notification service, and confirmation prompts. Flags MatDialog/CDK Overlay usage reimplemented per feature instead of a shared DialogService, ad-hoc snackbar/toast calls with inconsistent styling and no queuing policy, destructive actions with no shared confirmation-dialog component, and dialog/toast components with no accessibility contract (focus trap, aria-live announcement). Outputs findings with pilot-angular shared-ui-kit standard IDs.
when_to_use: MatDialog, CDK Overlay, modal, confirmation dialog, toast, snackbar, notification service, DialogService, ConfirmDialogComponent, alert banner, shared UI kit, design system component
---

## Standard IDs

| ID | Severity | What it checks |
|----|----------|-----------------|
| SUI-001 | P1 | Modal/dialog opened via raw `MatDialog`/CDK Overlay reimplemented per feature instead of a shared `DialogService` |
| SUI-002 | P2 | Toast/snackbar calls are ad-hoc per feature with inconsistent styling and no queuing/dedup policy |
| SUI-003 | P1 | Destructive action (delete/cancel/discard) has no shared confirmation-dialog component gating it |
| SUI-004 | P1 | Dialog/toast component has no accessibility contract — no focus trap on open, no `aria-live` announcement |

---

## Check A — Dialogs reimplemented per feature (SUI-001)

### Detection

Grep feature components for direct `MatDialog.open(SomeCustomComponent, {...})` calls with
bespoke width/panelClass/data-passing conventions repeated across features. Confirm a single
shared `DialogService` in the UI-kit library wraps `MatDialog` with a consistent API (typed
`open<TResult>(component, data)`, consistent width/backdrop/close behavior) so every feature
gets the same dialog affordances for free instead of reinventing them.

### BAD — every feature configures MatDialog by hand, inconsistently

```typescript
// orders feature
this.dialog.open(EditOrderComponent, { width: '600px', data: order, disableClose: true });

// invoices feature — different width, different close behavior, same intent
this.dialog.open(EditInvoiceComponent, { width: '50vw', data: invoice });
```

### GOOD — one shared DialogService, consistent defaults, typed result

```typescript
// libs/shared-ui/src/lib/dialog/dialog.service.ts
@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly dialog = inject(MatDialog);

  open<TResult, TData = unknown>(component: ComponentType<unknown>, data?: TData): Observable<TResult | undefined> {
    return this.dialog.open(component, {
      width: '600px',
      disableClose: true,
      autoFocus: 'first-tabbable',
      data,
    }).afterClosed();
  }
}

// any feature
this.dialogService.open<Order>(EditOrderComponent, order).subscribe(result => { ... });
```

---

## Check B — Ad-hoc toast/snackbar calls (SUI-002)

### Detection

Grep for direct `MatSnackBar.open(...)` calls scattered across features with different
durations, styles, and no dedup — the same error toast firing three times in a row when a
retried request fails three times. Confirm a shared `NotificationService` centralizes
success/error/warning variants with a consistent duration and a dedup/queue policy.

### BAD — raw snackbar calls, inconsistent duration, no dedup

```typescript
this.snackBar.open('Order saved', 'OK', { duration: 2000 });
// elsewhere, same intent, different config
this.snackBar.open('Saved successfully!', undefined, { duration: 5000, panelClass: 'success' });
// a retried failed request can fire this three times back to back
this.snackBar.open('Failed to save', 'Dismiss');
```

### GOOD — shared NotificationService with consistent variants and dedup

```typescript
// libs/shared-ui/src/lib/notification/notification.service.ts
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly snackBar = inject(MatSnackBar);
  private lastMessage: { text: string; at: number } | null = null;

  success(message: string): void { this.show(message, 'success', 3000); }
  error(message: string): void { this.show(message, 'error', 6000); }

  private show(message: string, variant: 'success' | 'error', duration: number): void {
    const now = Date.now();
    if (this.lastMessage?.text === message && now - this.lastMessage.at < 1000) return; // dedup rapid repeats
    this.lastMessage = { text: message, at: now };
    this.snackBar.open(message, 'Dismiss', { duration, panelClass: `notification--${variant}` });
  }
}
```

---

## Check C — No shared confirmation dialog for destructive actions (SUI-003)

### Detection

Grep delete/cancel/discard handlers for either no confirmation at all, or a one-off
`window.confirm(...)`/bespoke inline confirm component built per feature. Confirm a shared
`ConfirmDialogComponent` (typed with a title/message/confirm-label input) gates every
destructive action consistently.

### BAD — native confirm, or a bespoke confirm built per feature

```typescript
deleteOrder(id: string): void {
  if (!window.confirm('Delete this order?')) return; // unstyled, untestable, blocks the JS thread
  this.orderService.delete(id).subscribe();
}
```

### GOOD — shared, typed confirmation dialog

```typescript
// libs/shared-ui/src/lib/confirm-dialog/confirm-dialog.component.ts
export interface ConfirmDialogData { title: string; message: string; confirmLabel?: string; }

deleteOrder(id: string): void {
  this.dialogService.open<boolean, ConfirmDialogData>(ConfirmDialogComponent, {
    title: 'Delete order',
    message: 'This cannot be undone.',
    confirmLabel: 'Delete',
  }).subscribe(confirmed => {
    if (confirmed) this.orderService.delete(id).subscribe();
  });
}
```

---

## Check D — No accessibility contract on dialogs/toasts (SUI-004)

### Detection

Per `angular-a11y`, check the shared dialog component for `cdkTrapFocus`/`autoFocus`
handling on open and focus restoration to the triggering element on close, and check the
shared toast/notification component for an `aria-live="polite"` (or `"assertive"` for
errors) region so screen-reader users are told a toast appeared instead of it silently
flashing on screen.

### BAD — dialog has no focus management, toast has no live-region announcement

```html
<!-- confirm-dialog.component.html -->
<div class="dialog"> <!-- no role, no focus trap — keyboard focus can escape behind the backdrop -->
  <p>{{ data.message }}</p>
</div>
```

```typescript
this.snackBar.open(message); // MatSnackBar announces by default, but a hand-rolled toast component may not
```

### GOOD — focus trapped in the dialog, toast announced via a live region

```html
<!-- confirm-dialog.component.html -->
<div class="dialog" role="alertdialog" aria-modal="true" cdkTrapFocus cdkTrapFocusAutoCapture>
  <h2 id="dialog-title">{{ data.title }}</h2>
  <p>{{ data.message }}</p>
</div>
```

```typescript
// notification.service.ts
constructor(private liveAnnouncer: LiveAnnouncer) {}
private show(message: string, variant: 'success' | 'error', duration: number): void {
  this.liveAnnouncer.announce(message, variant === 'error' ? 'assertive' : 'polite');
  this.snackBar.open(message, 'Dismiss', { duration, panelClass: `notification--${variant}` });
}
```

---

## Shared UI-kit checklist

- [ ] All dialogs open through one shared `DialogService`, not raw `MatDialog.open(...)` per feature
- [ ] All toasts/snackbars go through one shared `NotificationService` with consistent duration and dedup
- [ ] Every destructive action (delete/cancel/discard) is gated by a shared `ConfirmDialogComponent`, never `window.confirm`
- [ ] Dialogs trap focus on open and restore it to the trigger element on close
- [ ] Toasts announce through an `aria-live` region (`polite` for success, `assertive` for errors)
