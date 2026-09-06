---
name: trellis-check
description: "Verify changed behavior against acceptance and relevant contracts with checks proportionate to risk. Use after implementation or meaningful changes, before delivery or authorized commits."
---

# Code Quality Check

Verify the entire current task diff against acceptance and applicable specs. Preserve unrelated work and distinguish regressions from pre-existing failures or environment limits.

When the request is a read-only review, return findings without edits. The fix steps below apply only when implementing or correcting the changes is authorized.

---

## Step 1: Identify What Changed

```bash
git diff --name-only HEAD
git status
```

## Step 2: Read Task Artifacts and Applicable Specs

Read the current task artifacts in order:

- `prd.md`
- `design.md` if present
- `implement.md` if present

```bash
python3 ./.trellis/scripts/get_context.py --mode packages
```

For each changed package/layer, read the spec index and follow its **Quality Check** section:

```bash
cat .trellis/spec/<package>/<layer>/index.md
```

Read the specific guideline files referenced — the index is a pointer, not the goal.

## Step 3: Run Project Checks

Run required repository checks applicable to affected layers, plus meaningful tests scaled to risk and blast radius. Prose/rule changes generally need consistency, links, and any relevant parser checks, not the full application suite. Fix this task's regressions or issues necessary for its outcome; report unrelated failures and environment limits without widening scope.

## Step 4: Review Against Checklist

### Code Quality

- [ ] Linter passes?
- [ ] Type checker passes (if applicable)?
- [ ] Tests pass?
- [ ] No debug logging left in?
- [ ] No suppressed warnings or type-safety bypasses?

### Test Coverage

- [ ] Important new behavior or regression risk has meaningful coverage?
- [ ] Existing tests reflect changed contracts where needed?
- [ ] Reversible low-impact changes avoid tests that merely restate the implementation?

### Spec Sync

- [ ] Does `.trellis/spec/` need updates? (new patterns, conventions, lessons learned)

> "If I fixed a bug or discovered something non-obvious, should I document it so future me won't hit the same issue?" → If YES, update the relevant spec doc.

## Step 5: Cross-Layer Dimensions (if applicable)

Skip this step if your change is confined to a single layer.

### A. Data Flow (changes touch 3+ layers)

- [ ] Read flow traces correctly: Storage → Service → API → UI
- [ ] Write flow traces correctly: UI → API → Service → Storage
- [ ] Types/schemas correctly passed between layers?
- [ ] Errors properly propagated to caller?

### B. Code Reuse (modifying constants, creating utilities)

- [ ] Searched for existing similar code before creating new?
  ```bash
  rg "pattern" src/
  ```
- [ ] Shared abstractions remove real complexity or meaningful duplication without coupling unrelated concepts?
- [ ] After batch modification, all occurrences updated?

### C. Import/Dependency (creating new files)

- [ ] Correct import paths (relative vs absolute)?
- [ ] No circular dependencies?

### D. Same-Layer Consistency

- [ ] Other places using the same concept are consistent?

---

## Step 6: Report and Fix

Fix findings introduced by this task or needed for its acceptance, then rerun affected checks. Once applicable checks pass, proceed to completion. Broaden/repeat only for new edits, failures, or unresolved concerns. Report persistent blockers precisely; do not loop indefinitely or silently expand into unrelated cleanup.
