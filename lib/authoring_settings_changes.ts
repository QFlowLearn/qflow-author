import type { AuthoringSettingsPatch } from './authoring_preferences.ts';

type Change = { readonly value: unknown };

/** Captured explicit changes, retaining each edit's identity across an asynchronous operation. */
export type CapturedAuthoringSettings = {
  readonly patch: AuthoringSettingsPatch;
  readonly changes: ReadonlyMap<string, Change>;
};

/** Tracks which explicit setting edits a successful save or reset has consumed. */
export class AuthoringSettingsChanges {
  private readonly pending = new Map<string, Change>();

  /** Record only the closed setting patch produced by the authoring domain. */
  record(patch: AuthoringSettingsPatch): void {
    for (const [key, value] of Object.entries(patch)) this.pending.set(key, { value });
  }

  /** Capture the current edits without consuming them before an operation succeeds. */
  capture(): CapturedAuthoringSettings {
    // SAFETY: entries originate only from typed setting patches; key/value pairs stay intact.
    const patch = Object.fromEntries(
      [...this.pending].map(([key, change]) => [key, change.value]),
    ) as AuthoringSettingsPatch;
    return { patch, changes: new Map(this.pending) };
  }

  /** Consume captured edits individually; retain every edit made while the operation was pending. */
  acknowledge(saved: CapturedAuthoringSettings): void {
    for (const [key, change] of saved.changes) {
      if (this.pending.get(key) === change) this.pending.delete(key);
    }
  }

  /** Starting another question discards its predecessor's uncommitted preferences. */
  clear(): void {
    this.pending.clear();
  }
}
