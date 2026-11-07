# Going live after a pull request

A reusable checklist for putting a finished pull request (PR) on the live app at **https://ktdisco.github.io/chorklist/**.

## 1. Check whether the PR needs a database step

- [ ] Open the PR on GitHub and read the description.
- [ ] Look for a **⚠️ Database step** section. If there isn't one, skip to step 3.

## 2. Run the database step (only if the PR has one)

- [ ] Open the file the PR names (in [`supabase/migrations/`](../supabase/migrations)) on GitHub and tap the **copy** icon.
- [ ] In Supabase, go to **SQL Editor → + New query**, paste it, and tap **Run**.
- [ ] You should see **"Success"**.
  - **"already exists"** means it had already been run. That's harmless; carry on.
  - **Any other error:** stop, and don't merge yet. Send the error to Claude.
- [ ] Run each database file **once only**. Don't edit it.

If you merge before running it, chores keep working, but the new feature won't until the database step is done.

## 3. Merge

- [ ] On the PR page, tap **Merge pull request → Confirm merge**.
- [ ] Optional: tap **Delete branch** afterwards. That's fine; Claude recreates it for the next change.

## 4. Wait for the publish

- [ ] Open **https://github.com/ktdisco/chorklist/actions**.
- [ ] Wait for **Publish to GitHub Pages** to show a green ✓ (about 1 minute).
- [ ] **Red ✗?** Send Claude the link to the failed run.

## 5. Check the live site in Safari

- [ ] Open **https://ktdisco.github.io/chorklist/** in Safari and pull down to refresh.
- [ ] Confirm the new change is there.

## 6. Update the home-screen app

- [ ] Wait **10 minutes** after the green ✓, so phones stop using their saved copy.
- [ ] Swipe Chorklist **fully closed** in the app switcher, then reopen it.
- [ ] **Still the old version?** Press and hold the icon → **Remove App → Delete from Home Screen**. Re-add it from Safari (**Share → Add to Home Screen**) and sign in again. Your data is safe because it lives in Supabase, not on the phone.

## 7. Quick test (2 minutes)

- [ ] Chores load. Tick one off, then tap **Undo**.
- [ ] Lists load. Add an item, check it, then clear it.
- [ ] Try whatever the PR changed.

## 8. Tell the household

- [ ] Ask everyone to fully close and reopen Chorklist.

---

## If something's broken after going live

1. Open the merged PR and tap **Revert**. GitHub creates an undo PR.
2. Merge that undo PR. The site republishes the previous version in about a minute.
3. Tell Claude what went wrong.

**Note:** reverting undoes app changes only, **not database steps**. Database updates add things rather than remove them, so they're normally fine to leave in place. If you're unsure, ask before changing anything in Supabase.
